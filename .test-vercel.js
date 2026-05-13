// Teste do fluxo de continuação automática contra Vercel
require('dotenv').config({ path: '.env' });

async function testUpdateFlow() {
  console.log('🧪 Teste de Continuação Automática Entre Lotes\n');
  console.log('Endpoint: https://dash-de-saldos.vercel.app/api/update-now');
  
  const SECRET = process.env.CRON_SECRET;
  if (!SECRET) {
    console.error('❌ CRON_SECRET não configurado em .env');
    process.exit(1);
  }

  const statusUrl = `https://dash-de-saldos.vercel.app/api/update-status?secret=${SECRET}`;
  const updateUrl = `https://dash-de-saldos.vercel.app/api/update-now?secret=${SECRET}`;

  try {
    // 1. Status inicial
    console.log('📊 1️⃣  Verificando status inicial...');
    let res = await fetch(statusUrl);
    let json = await res.json();
    console.log(`   cursor: ${json.displayCursor}/${json.totalClients}`);
    console.log(`   running: ${json.running}`);
    console.log(`   stage: ${json.state?.stage || 'N/A'}`);
    console.log('');

    // 2. Inicia update
    console.log('▶️  2️⃣  Iniciando atualização...');
    res = await fetch(updateUrl, { method: 'POST' });
    json = await res.json();
    console.log(`   HTTP ${res.status}`);
    console.log(`   started: ${json.started || false}`);
    console.log(`   message: ${json.message || 'N/A'}`);
    console.log('');

    // 3. Polling
    console.log('⏳ 3️⃣  Monitorando progresso (máx 5 minutos)...\n');
    let lastCursor = 0;
    let iterations = 0;
    const maxIterations = 150; // 150 * 2s = 300s = 5 min

    const startTime = Date.now();

    while (iterations < maxIterations) {
      await new Promise(r => setTimeout(r, 2000));
      iterations++;
      const elapsedSecs = Math.floor((Date.now() - startTime) / 1000);

      try {
        res = await fetch(statusUrl);
        json = await res.json();
        
        const cursor = json.displayCursor || 0;
        const total = json.totalClients || 0;
        const running = json.running || false;
        const stage = json.state?.stage || '?';
        const pct = total > 0 ? Math.round((cursor / total) * 100) : 0;

        const indicator = running ? '⏳' : '✅';
        const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));

        console.log(`[${String(elapsedSecs).padStart(3)}s] ${indicator} ${bar} ${cursor}/${total} (${String(pct).padStart(3)}%) | ${stage}`);

        // Progrediu?
        if (cursor > lastCursor) {
          lastCursor = cursor;
        }

        // Completo?
        if (!running && cursor >= total && total > 0) {
          console.log('\n✅ SUCESSO! Todos os lotes foram processados!');
          console.log(`   Total de clientes: ${total}`);
          console.log(`   Tempo total: ${elapsedSecs}s`);
          break;
        }

      } catch (e) {
        console.error(`[${elapsedSecs}s] ❌ Erro ao fazer polling:`, e.message);
      }

      // Timeout
      if (iterations >= maxIterations) {
        console.log('\n⏰ TIMEOUT - Estourou tempo máximo de 5 minutos');
        break;
      }
    }

    // Status final
    console.log('\n📋 Status Final:');
    res = await fetch(statusUrl);
    json = await res.json();
    console.log(`   cursor: ${json.displayCursor}/${json.totalClients}`);
    console.log(`   running: ${json.running}`);
    console.log(`   stage: ${json.state?.stage || 'N/A'}`);

  } catch (e) {
    console.error('❌ Erro crítico:', e.message);
    process.exit(1);
  }

  process.exit(0);
}

testUpdateFlow();
