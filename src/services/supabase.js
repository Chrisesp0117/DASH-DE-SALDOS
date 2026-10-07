require('dotenv').config({ path: '.env' });
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('SUPABASE_URL e SUPABASE_KEY (ou SUPABASE_ANON_KEY) devem estar definidas no .env');
}

const DATABASE_TABLE = process.env.SUPABASE_DATABASE_TABLE || 'database_rows';

// Colunas principais (formato legado) + colunas de insights de performance.
const DATABASE_CORE_COLUMNS = 'data,cliente,plataforma,saldo,gasto_ontem,media_diaria,dias_restantes,gestor,supervisor,status,obs,data_iso,identificador,ordem_configs,updated_at';
const DATABASE_INSIGHT_COLUMNS = 'leads,resultados,mensagens,ctr,frequencia,cpc';

let _client = null;
function getClient() {
  if (!_client) {
    _client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return _client;
}

/**
 * Descreve erros do Supabase/PostgREST com código, detalhes e hint.
 * O .message sozinho costuma ser genérico demais para diagnóstico.
 */
function describeSupabaseError(error) {
  if (!error) return 'erro desconhecido';
  const parts = [error.message || String(error)];
  if (error.code) parts.push('code=' + error.code);
  if (error.details) parts.push('details=' + error.details);
  if (error.hint) parts.push('hint=' + error.hint);
  return parts.join(' | ');
}

/**
 * Detecta erros de coluna inexistente (migração das colunas de insights ainda
 * não aplicada no Supabase). Usado para degradar graciosamente em vez de falhar.
 */
function isMissingColumnError(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const message = String(error.message || '');
  return code === 'PGRST204' || code === '42703' || /could not find the '.+?' column/i.test(message);
}

function normalizeInsightCell(value) {
  if (value === null || value === undefined) return '-';
  const text = String(value).trim();
  return text === '' ? '-' : text;
}

/**
 * Chave de conflito (cliente, plataforma, identificador) de uma linha posicional,
 * igual à usada no onConflict do upsert e à constraint uq_database_rows_cpi.
 */
function conflictKeyOfRow(row) {
  const cliente = String(row[1] || '').trim();
  const plataforma = String(row[2] || '').trim().toUpperCase();
  const identificador = String(row[12] || '').trim();
  return JSON.stringify([cliente, plataforma, identificador]);
}

function normalizeDatabaseRow(row) {
  return {
    data: row[0] || '',
    cliente: String(row[1] || '').trim(),
    plataforma: String(row[2] || '').trim().toUpperCase(),
    saldo: row[3] || '-',
    gasto_ontem: row[4] || '-',
    media_diaria: row[5] || '-',
    dias_restantes: row[6] || '-',
    gestor: String(row[7] || '').trim(),
    supervisor: String(row[8] || '').trim(),
    status: String(row[9] || '').trim(),
    obs: String(row[10] || '').trim(),
    data_iso: row[11] || null,
    identificador: String(row[12] || '').trim(),
    ordem_configs: Number(row[13]) || 0,
    leads: normalizeInsightCell(row[14]),
    resultados: normalizeInsightCell(row[15]),
    mensagens: normalizeInsightCell(row[16]),
    ctr: normalizeInsightCell(row[17]),
    frequencia: normalizeInsightCell(row[18]),
    cpc: normalizeInsightCell(row[19])
  };
}

function stripInsightColumns(payload) {
  const { leads, resultados, mensagens, ctr, frequencia, cpc, ...core } = payload;
  return core;
}

async function upsertDatabaseRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return { upserted: 0 };
  const client = getClient();

  // Deduplica pela chave de conflito (cliente, plataforma, identificador).
  // O Postgres rejeita upsert em lote quando o próprio lote contém chaves repetidas:
  // "ON CONFLICT DO UPDATE command cannot affect row a second time". Isso acontece
  // quando o CONFIGS lista o mesmo cliente+plataforma mais de uma vez.
  // Manter a última ocorrência replica a semântica de upserts sequenciais.
  const uniqueRows = new Map();
  for (const row of rows) {
    uniqueRows.set(conflictKeyOfRow(row), row);
  }
  const payloads = Array.from(uniqueRows.values()).map(normalizeDatabaseRow);

  const { error } = await client
    .from(DATABASE_TABLE)
    .upsert(payloads, { onConflict: 'cliente,plataforma,identificador' });
  if (error && isMissingColumnError(error)) {
    // Migração das colunas de insights ainda não aplicada: grava no formato
    // legado para não travar a atualização e avisa no log.
    console.warn('[upsertDatabaseRows] colunas de insights ausentes em ' + DATABASE_TABLE + ' — gravando formato legado. Rode a migração do supabase_schema.sql no Supabase.');
    const legacyPayloads = payloads.map(stripInsightColumns);
    const { error: legacyError } = await client
      .from(DATABASE_TABLE)
      .upsert(legacyPayloads, { onConflict: 'cliente,plataforma,identificador' });
    if (legacyError) {
      const described = describeSupabaseError(legacyError);
      console.error('[upsertDatabaseRows] erro ao upsertar ' + legacyPayloads.length + ' linha(s) em ' + DATABASE_TABLE + ': ' + described);
      const err = new Error('Supabase upsert falhou em ' + DATABASE_TABLE + ': ' + described);
      err.supabaseError = legacyError;
      throw err;
    }
    return { upserted: legacyPayloads.length, duplicates: rows.length - legacyPayloads.length, legacyShape: true };
  }
  if (error) {
    const described = describeSupabaseError(error);
    console.error('[upsertDatabaseRows] erro ao upsertar ' + payloads.length + ' linha(s) em ' + DATABASE_TABLE + ': ' + described);
    const err = new Error('Supabase upsert falhou em ' + DATABASE_TABLE + ': ' + described);
    err.supabaseError = error;
    throw err;
  }
  return { upserted: payloads.length, duplicates: rows.length - payloads.length };
}

async function upsertDatabaseRow(row) {
  return upsertDatabaseRows([row]);
}

async function readDatabaseRows() {
  const client = getClient();
  let data;
  let error;
  let legacyShape = false;

  ({ data, error } = await client
    .from(DATABASE_TABLE)
    .select(`${DATABASE_CORE_COLUMNS},${DATABASE_INSIGHT_COLUMNS}`)
    .order('ordem_configs', { ascending: true }));

  if (error && isMissingColumnError(error)) {
    // Migração das colunas de insights ainda não aplicada: lê no formato legado
    // (as colunas novas retornam null e os DASHs mostram "-").
    console.warn('[readDatabaseRows] colunas de insights ausentes em ' + DATABASE_TABLE + ' — usando leitura legada. Rode a migração do supabase_schema.sql no Supabase.');
    ({ data, error } = await client
      .from(DATABASE_TABLE)
      .select(DATABASE_CORE_COLUMNS)
      .order('ordem_configs', { ascending: true }));
    legacyShape = true;
  }

  if (error) {
    console.error('[readDatabaseRows] erro ao ler ' + DATABASE_TABLE + ': ' + describeSupabaseError(error));
    throw error;
  }

  return (data || []).map(r => [
    r.data,
    r.cliente,
    r.plataforma,
    r.saldo,
    r.gasto_ontem,
    r.media_diaria,
    r.dias_restantes,
    r.gestor,
    r.supervisor,
    r.status,
    r.obs,
    r.data_iso,
    r.identificador,
    r.ordem_configs,
    legacyShape ? null : (r.leads != null ? r.leads : null),
    legacyShape ? null : (r.resultados != null ? r.resultados : null),
    legacyShape ? null : (r.mensagens != null ? r.mensagens : null),
    legacyShape ? null : (r.ctr != null ? r.ctr : null),
    legacyShape ? null : (r.frequencia != null ? r.frequencia : null),
    legacyShape ? null : (r.cpc != null ? r.cpc : null)
  ]);
}

async function clearDatabase() {
  const client = getClient();
  const { error } = await client.from(DATABASE_TABLE).delete().neq('id', 0);
  if (error) {
    console.error('[clearDatabase] erro ao limpar ' + DATABASE_TABLE + ': ' + describeSupabaseError(error));
    throw error;
  }
  return { cleared: true };
}

module.exports = {
  DATABASE_TABLE,
  getClient,
  describeSupabaseError,
  isMissingColumnError,
  conflictKeyOfRow,
  normalizeDatabaseRow,
  upsertDatabaseRow,
  upsertDatabaseRows,
  readDatabaseRows,
  clearDatabase
};
