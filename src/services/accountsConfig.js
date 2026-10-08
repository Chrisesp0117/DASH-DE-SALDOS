/**
 * accountsConfig.js — contas de anúncio configuradas pela página web.
 *
 * Substitui a aba CONFIGS da planilha como fonte das contas processadas
 * pelo job. As linhas são lidas aqui e convertidas para o mesmo formato
 * posicional esperado pelo parser de índices do run.js (header fixo), de
 * modo que o restante do pipeline não muda.
 *
 * A aba CONFIGS da planilha continua como fallback quando a tabela está
 * vazia (transição suave + botão de importação na página web).
 */
const { getClient, describeSupabaseError } = require('./supabase');

const ACCOUNTS_TABLE = process.env.SUPABASE_ACCOUNTS_TABLE || 'accounts_config';

// Header posicional compatível com o parser do run.js (getIndexAny)
const CONFIG_HEADER = ['Cliente', 'Plataforma', 'CustomerID', 'Gestor', 'Revisão', 'Supervisor', 'LoginCustomerId'];

function toPositionalRow(row) {
  return [
    row.cliente || '',
    row.plataforma || '',
    row.customer_id || '',
    row.gestor || '',
    row.revisao || 'ok',
    row.supervisor || '',
    row.login_customer_id || ''
  ];
}

/**
 * Normaliza e valida uma conta vinda da UI.
 * Retorna { ok, error, account }.
 */
function normalizeAccountInput(raw, index) {
  const cliente = String(raw && raw.cliente || '').trim();
  const plataforma = String(raw && raw.plataforma || '').trim().toUpperCase();
  const customerId = String(raw && raw.customer_id || '').replace(/\D/g, '');
  const gestor = String(raw && raw.gestor || '').trim();
  const supervisor = String(raw && raw.supervisor || '').trim();
  const revisao = String(raw && raw.revisao || 'ok').trim().toLowerCase() === 'ok' ? 'ok' : 'revisar';
  const loginCustomerId = String(raw && raw.login_customer_id || '').replace(/\D/g, '');

  if (!cliente) {
    return { ok: false, error: `Conta #${index + 1}: nome do cliente é obrigatório` };
  }
  if (plataforma !== 'GOOGLE' && plataforma !== 'META') {
    return { ok: false, error: `Conta "${cliente}": plataforma deve ser GOOGLE ou META` };
  }
  if (!customerId) {
    return { ok: false, error: `Conta "${cliente}": ID da conta é obrigatório` };
  }
  if (plataforma === 'GOOGLE' && !/^\d{10}$/.test(customerId)) {
    return { ok: false, error: `Conta "${cliente}": Customer ID do Google Ads deve ter 10 dígitos` };
  }

  return {
    ok: true,
    account: {
      cliente,
      plataforma,
      customer_id: customerId,
      gestor,
      supervisor,
      revisao,
      login_customer_id: plataforma === 'GOOGLE' ? loginCustomerId : ''
    }
  };
}

async function listAccounts() {
  const client = getClient();
  const { data, error } = await client
    .from(ACCOUNTS_TABLE)
    .select('*')
    .order('ordem', { ascending: true });
  if (error) {
    throw new Error('Falha ao ler ' + ACCOUNTS_TABLE + ': ' + describeSupabaseError(error));
  }
  return data || [];
}

/**
 * Substitui toda a lista de contas (delete + insert), preservando a ordem
 * recebida (ordem = índice) para manter a ordenação dos DASHs.
 */
async function saveAccounts(accounts) {
  if (!Array.isArray(accounts)) {
    throw new Error('Lista de contas inválida (esperado array)');
  }

  const normalized = [];
  for (let i = 0; i < accounts.length; i++) {
    const result = normalizeAccountInput(accounts[i], i);
    if (!result.ok) {
      throw new Error(result.error);
    }
    normalized.push({ ...result.account, ordem: i });
  }

  // Deduplica por (plataforma, customer_id) — constraint unique no banco.
  // Mantém a primeira ocorrência (mesma semântica da deduplicação da DATABASE).
  const seen = new Set();
  const unique = normalized.filter(item => {
    const key = item.plataforma + '|' + item.customer_id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const client = getClient();
  const { error: deleteError } = await client
    .from(ACCOUNTS_TABLE)
    .delete()
    .neq('id', 0);
  if (deleteError) {
    throw new Error('Falha ao limpar ' + ACCOUNTS_TABLE + ': ' + describeSupabaseError(deleteError));
  }

  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500).map((item, offset) => ({ ...item, ordem: i + offset }));
    const { error: insertError } = await client.from(ACCOUNTS_TABLE).insert(chunk);
    if (insertError) {
      throw new Error('Falha ao salvar contas em ' + ACCOUNTS_TABLE + ': ' + describeSupabaseError(insertError));
    }
  }

  return {
    saved: unique.length,
    duplicates: normalized.length - unique.length,
    byPlataforma: {
      GOOGLE: unique.filter(a => a.plataforma === 'GOOGLE').length,
      META: unique.filter(a => a.plataforma === 'META').length
    }
  };
}

/**
 * Carrega as contas no formato que o run.js espera:
 * { headerRow, configRows } — arrays posicionais no mesmo layout que a
 * antiga aba CONFIGS usava (o parser de índices do run.js não muda).
 */
async function loadClientesFromDatabase() {
  const rows = await listAccounts();
  if (!rows.length) {
    return null;
  }
  return {
    headerRow: CONFIG_HEADER,
    configRows: rows.map(toPositionalRow),
    source: 'supabase'
  };
}

module.exports = {
  ACCOUNTS_TABLE,
  CONFIG_HEADER,
  listAccounts,
  saveAccounts,
  loadClientesFromDatabase,
  normalizeAccountInput,
  toPositionalRow
};
