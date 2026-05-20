/**
 * PLANO DE MIGRAÇÃO PARA SUPABASE
 * 
 * Abordagem: Dual-write durante transição
 * 
 * FASE 1: Setup
 * - ✅ Instalar @supabase/supabase-js
 * - ✅ Criar jobStateSupabase.js com mesma API que jobState.js
 * - ⏳ Criar tabelas no Supabase
 * - ⏳ Testar localmente
 * 
 * FASE 2: Deploy com fallback
 * - Criar jobStateAdapter.js que escolhe entre Sheets e Supabase
 * - USE_SUPABASE=false (default) → continua com Sheets
 * - USE_SUPABASE=true → usa Supabase, fallback para Sheets se erro
 * - Deploy em prod com USE_SUPABASE=false
 * - Monitorar 24h
 * 
 * FASE 3: Switch gradual
 * - Dia 1: 10% tráfego em Supabase
 * - Dia 2: 50% tráfego em Supabase
 * - Dia 3: 100% em Supabase, Sheets apenas para configs
 * 
 * FASE 4: Cleanup
 * - Remover código de jobState.js que usa Sheets
 * - Deixar apenas leitura de clientes em Sheets
 * - Arquivar job_history periodicamente
 */

// ==================== TESTE LOCAL ====================
// npm test -- test/supabase-migration.test.js

const assert = require('assert');
const jobState = require('../src/core/jobStateSupabase');

async function runMigrationTests() {
  console.log('🧪 Iniciando testes de migração para Supabase...\n');

  try {
    // 1. Read initial state
    console.log('✓ Teste 1: Read job state');
    let state = await jobState.readJobState();
    assert.strictEqual(state.status, 'idle', 'Status inicial deve ser idle');
    console.log('  Status inicial:', state.status, '\n');

    // 2. Acquire lock
    console.log('✓ Teste 2: Acquire job lock');
    const jobControl = await jobState.acquireJobStateLock({ 
      owner: 'test-local',
      reason: 'migration test'
    });
    assert.strictEqual(jobControl.status, 'running', 'Status após acquire deve ser running');
    assert(jobControl.generation > 0, 'Generation deve ter incrementado');
    console.log('  Generation:', jobControl.generation);
    console.log('  JobId:', jobControl.jobId.slice(0, 8) + '...\n');

    // 3. Touch (update fields)
    console.log('✓ Teste 3: Touch job state');
    await jobState.touchJobState(jobControl, {
      totalClients: 116,
      progressCursor: 10,
      cursor: 10,
      stage: 'database',
      lastAction: 'batch_1'
    });
    state = await jobState.readJobState();
    assert.strictEqual(state.totalClients, 116, 'totalClients deve ser 116');
    assert.strictEqual(state.progressCursor, 10, 'progressCursor deve ser 10');
    console.log('  Total Clients:', state.totalClients);
    console.log('  Progress Cursor:', state.progressCursor, '\n');

    // 4. Heartbeat
    console.log('✓ Teste 4: Heartbeat');
    const heartbeatOk = await jobState.heartbeatJobState(jobControl, 60000);
    assert.strictEqual(heartbeatOk, true, 'Heartbeat deve retornar true');
    state = await jobState.readJobState();
    console.log('  Heartbeat At:', state.heartbeatAt, '\n');

    // 5. Release
    console.log('✓ Teste 5: Release job state');
    await jobState.releaseJobState(jobControl, 'done');
    state = await jobState.readJobState();
    assert.strictEqual(state.status, 'done', 'Status após release deve ser done');
    assert.strictEqual(state.leaseUntil, 0, 'leaseUntil deve ser 0');
    console.log('  Status final:', state.status, '\n');

    console.log('✅ Todos os testes passaram!\n');
    console.log('Próximos passos:');
    console.log('1. npm run test -- test/supabase-migration.test.js');
    console.log('2. Verificar dados em: https://app.supabase.com/project/XXX/editor');
    console.log('3. Criar jobStateAdapter.js');
    console.log('4. Deploy gradual em produção\n');

  } catch (error) {
    console.error('❌ Erro durante testes:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  runMigrationTests();
}

module.exports = { runMigrationTests };
