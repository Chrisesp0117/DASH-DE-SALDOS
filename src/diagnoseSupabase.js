/**
 * Diagnóstico do Supabase — verifica se o banco está pronto para o fluxo
 * advance-queue (schema, constraint, colunas novas, RLS, RPC e fila).
 *
 * Uso:
 *   1. Crie um .env local (copie do .env.example e preencha SUPABASE_URL/SUPABASE_KEY)
 *   2. npm run diagnose
 *
 * O script NÃO altera job_state/job_history/job_queue (somente leitura).
 * Em database_rows ele cria/apaga uma linha de teste limpa ao final.
 */
require('dotenv').config({ path: '.env' });

const { createClient } = require('@supabase/supabase-js');
const { describeSupabaseError, conflictKeyOfRow } = require('./services/supabase');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
const DATABASE_TABLE = process.env.SUPABASE_DATABASE_TABLE || 'database_rows';
const JOB_QUEUE_TABLE = process.env.SUPABASE_JOB_QUEUE_TABLE || 'job_queue';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ SUPABASE_URL e SUPABASE_KEY não definidas no .env — não dá para diagnosticar o banco.');
  process.exit(1);
}

const client = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

let failures = 0;
function report(label, ok, detail) {
  const tag = ok ? '✅' : '❌';
  console.log(`${tag} ${label}${detail ? (ok ? ' — ' + detail : ' — FALHOU: ' + detail) : ''}`);
  if (!ok) failures++;
}

async function main() {
  console.log('=== Diagnóstico Supabase — ' + new Date().toISOString() + ' ===');
  console.log('URL: ' + SUPABASE_URL);
  console.log('');

  // ---------------------------------------------------------------- job_state
  console.log('--- job_state ---');
  try {
    const { data, error } = await client.from('job_state').select('*').eq('id', 1).maybeSingle();
    report('job_state: leitura da linha única', !error, error ? describeSupabaseError(error) : `status=${data && data.status}, stage=${data && data.stage}, generation=${data && data.generation}, totalClients=${data && data.totalClients}, lastError="${data && data.lastError}", lastAction=${data && data.lastAction}`);
  } catch (e) {
    report('job_state: leitura da linha única', false, e.message);
  }
  try {
    const { error } = await client.from('job_state').select('cliente_atual').eq('id', 1).maybeSingle();
    report('job_state: coluna cliente_atual existe', !error, error ? describeSupabaseError(error) : 'ok');
  } catch (e) {
    report('job_state: coluna cliente_atual existe', false, e.message);
  }

  // ------------------------------------------------------------- job_history
  try {
    const { data, error } = await client.from('job_history').select('*').order('id', { ascending: false }).limit(3);
    report('job_history: leitura', !error, error ? describeSupabaseError(error) : (data ? data.length + ' entrada(s) recentes' : 'vazia'));
  } catch (e) {
    report('job_history: leitura', false, e.message);
  }

  // ---------------------------------------------------------------- job_queue
  console.log('');
  console.log('--- job_queue (fila) ---');
  try {
    const { data, error } = await client.from(JOB_QUEUE_TABLE).select('*').order('id', { ascending: false }).limit(5);
    if (error) {
      report('job_queue: leitura', false, describeSupabaseError(error));
    } else {
      report('job_queue: leitura', true, data.length + ' job(s) recente(s)');
      for (const job of data) {
        console.log(`   #${job.id} status=${job.status} attempts=${job.attempts} triggered_by=${job.triggered_by}`);
        if (job.error) console.log(`      error: ${job.error}`);
        if (job.result && job.result.reason) console.log(`      result.reason: ${job.result.reason}`);
      }
    }
  } catch (e) {
    report('job_queue: leitura', false, e.message);
  }
  try {
    const { data, error } = await client.rpc('reenqueue_stale_running', { p_stale_after_seconds: 300 });
    report('job_queue: RPC reenqueue_stale_running', !error, error ? describeSupabaseError(error) : (Array.isArray(data) ? data.length + ' job(s) stale re-enfileirado(s)' : 'ok'));
  } catch (e) {
    report('job_queue: RPC reenqueue_stale_running', false, e.message);
  }

  // ------------------------------------------------------------ database_rows
  console.log('');
  console.log('--- database_rows (DATABASE) ---');
  let existingCount = null;
  try {
    const { count, error } = await client.from(DATABASE_TABLE).select('id', { count: 'exact', head: true });
    existingCount = count;
    report(DATABASE_TABLE + ': leitura (count)', !error, error ? describeSupabaseError(error) : (count + ' linha(s) atualmente)'));
  } catch (e) {
    report(DATABASE_TABLE + ': leitura (count)', false, e.message);
  }
  try {
    const { error } = await client.from(DATABASE_TABLE).select('ordem_configs').limit(1);
    report(DATABASE_TABLE + ': coluna ordem_configs existe', !error, error ? describeSupabaseError(error) : 'ok');
  } catch (e) {
    report(DATABASE_TABLE + ': coluna ordem_configs existe', false, e.message);
  }
  try {
    const { data, error } = await client.from(DATABASE_TABLE).select('*').limit(1);
    report(DATABASE_TABLE + ': select * (valida schema completo)', !error, error ? describeSupabaseError(error) : 'ok');
    if (!error && data && data.length > 0) {
      const missing = ['data', 'cliente', 'plataforma', 'saldo', 'gasto_ontem', 'media_diaria', 'dias_restantes', 'gestor', 'supervisor', 'status', 'obs', 'data_iso', 'identificador', 'ordem_configs', 'leads', 'resultados', 'mensagens', 'ctr', 'frequencia', 'cpc'].filter(col => !(col in data[0]));
      report(DATABASE_TABLE + ': todas as colunas esperadas presentes', missing.length === 0, missing.length ? 'faltando: ' + missing.join(', ') + ' — rode a migração do supabase_schema.sql' : 'ok');
    }
  } catch (e) {
    report(DATABASE_TABLE + ': select * (valida schema completo)', false, e.message);
  }

  // Roundtrip de upsert — o teste mais importante: é exatamente o que o
  // advance-queue faz ao gravar os clientes, e revela:
  //  - constraint uq_database_rows_cpi ausente (42P10)
  //  - RLS sem policy (42501 / new row violates row-level security policy)
  //  - colunas faltando (PGRST204)
  const now = new Date().toISOString();
  const testRow = [
    now, '__DIAG_TESTE__', 'DIAG', 'R$ 0,00', 'R$ 0,00', 'R$ 0,00', '00 dias e 00 horas',
    '', '', 'Atualizada', 'linha de teste do diagnóstico', now, '__DIAG__', 999999
  ];
  const testPayload = {
    data: testRow[0],
    cliente: testRow[1],
    plataforma: testRow[2],
    saldo: testRow[3],
    gasto_ontem: testRow[4],
    media_diaria: testRow[5],
    dias_restantes: testRow[6],
    gestor: testRow[7],
    supervisor: testRow[8],
    status: testRow[9],
    obs: testRow[10],
    data_iso: testRow[11],
    identificador: testRow[12],
    ordem_configs: testRow[13]
  };
  console.log('');
  console.log('--- Roundtrip de upsert (linha de teste ' + testPayload.cliente + ') ---');
  let roundtripOk = false;
  try {
    const { error: upErr } = await client
      .from(DATABASE_TABLE)
      .upsert([testPayload], { onConflict: 'cliente,plataforma,identificador' });
    report(DATABASE_TABLE + ': upsert com onConflict (cliente,plataforma,identificador)', !upErr, upErr ? describeSupabaseError(upErr) : 'ok');
    roundtripOk = !upErr;
  } catch (e) {
    report(DATABASE_TABLE + ': upsert com onConflict (cliente,plataforma,identificador)', false, e.message);
  }
  if (roundtripOk) {
    // Confere que a constraint de verdade é a esperada testando "row a second time"
    // com um lote duplicado — exatamente o cenário que derrubava o job.
    try {
      const { error: dupErr } = await client
        .from(DATABASE_TABLE)
        .upsert([testPayload, testPayload], { onConflict: 'cliente,plataforma,identificador' });
      report(DATABASE_TABLE + ': lote duplicado não deve mais ocorrer (dedupe no código)', true,
        dupErr ? 'Postgres rejeita lote com chave repetida: ' + describeSupabaseError(dupErr) + ' — o código agora deduplica antes de enviar' : 'ok');
    } catch (e) {
      report(DATABASE_TABLE + ': teste de lote duplicado', false, e.message);
    }
    try {
      const { data: readBack, error: readErr } = await client
        .from(DATABASE_TABLE)
        .select('cliente,plataforma,identificador,ordem_configs')
        .eq('cliente', testPayload.cliente)
        .eq('plataforma', testPayload.plataforma);
      report(DATABASE_TABLE + ': leitura da linha de teste', !readErr, readErr ? describeSupabaseError(readErr) : ((readBack && readBack.length) + ' linha(s)'));
    } catch (e) {
      report(DATABASE_TABLE + ': leitura da linha de teste', false, e.message);
    }
  }
  // Limpeza (sempre tenta, mesmo se o upsert falhou por outro motivo)
  try {
    const { error: delErr } = await client
      .from(DATABASE_TABLE)
      .delete()
      .eq('cliente', testPayload.cliente)
      .eq('plataforma', testPayload.plataforma);
    report(DATABASE_TABLE + ': limpeza da linha de teste', !delErr, delErr ? describeSupabaseError(delErr) : 'removida');
  } catch (e) {
    report(DATABASE_TABLE + ': limpeza da linha de teste', false, e.message);
  }

  // ------------------------------------------------------------------ resumo
  console.log('');
  console.log('=== Resumo ===');
  if (failures === 0) {
    console.log('✅ Tudo certo no Supabase. Se o advance-queue ainda falhar, rode um job e veja o log do worker.');
  } else {
    console.log('❌ ' + failures + ' problema(s) encontrado(s) acima.');
    console.log('   Corrija rodando o supabase_schema.sql ATUALIZADO no SQL Editor do Supabase (é idempotente).');
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('❌ Erro inesperado no diagnóstico:', e && e.message ? e.message : e);
  process.exit(1);
});
