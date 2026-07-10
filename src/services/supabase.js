require('dotenv').config({ path: '.env' });
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('SUPABASE_URL e SUPABASE_KEY (ou SUPABASE_ANON_KEY) devem estar definidas no .env');
}

const DATABASE_TABLE = process.env.SUPABASE_DATABASE_TABLE || 'database_rows';

let _client = null;
function getClient() {
  if (!_client) {
    _client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return _client;
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
    ordem_configs: Number(row[13]) || 0
  };
}

async function upsertDatabaseRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return { upserted: 0 };
  const client = getClient();
  const payloads = rows.map(normalizeDatabaseRow);
  const { error } = await client
    .from(DATABASE_TABLE)
    .upsert(payloads, { onConflict: 'cliente,plataforma,identificador' });
  if (error) throw error;
  return { upserted: payloads.length };
}

async function upsertDatabaseRow(row) {
  return upsertDatabaseRows([row]);
}

async function readDatabaseRows() {
  const client = getClient();
  const { data, error } = await client
    .from(DATABASE_TABLE)
    .select('data,cliente,plataforma,saldo,gasto_ontem,media_diaria,dias_restantes,gestor,supervisor,status,obs,data_iso,identificador,ordem_configs,updated_at')
    .order('ordem_configs', { ascending: true });
  if (error) throw error;
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
    r.ordem_configs
  ]);
}

async function clearDatabase() {
  const client = getClient();
  const { error } = await client.from(DATABASE_TABLE).delete().neq('id', 0);
  if (error) throw error;
  return { cleared: true };
}

module.exports = {
  DATABASE_TABLE,
  getClient,
  normalizeDatabaseRow,
  upsertDatabaseRow,
  upsertDatabaseRows,
  readDatabaseRows,
  clearDatabase
};
