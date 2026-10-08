/**
 * GET /api/accounts/discover?secret=...[&mcc=1234567890]
 * Lista TODAS as contas de anúncio vinculadas aos tokens do ambiente:
 *  - Google Ads:
 *      a) listAccessibleCustomers (contas com acesso direto ao REFRESH_TOKEN)
 *      b) hierarquia de cada MCC conhecido (customer_client): contas gerenciadas
 *         — MCCs vêm de: query ?mcc=, env MCC_ID/MCC_FALLBACK_*, contas salvas
 *           na accounts_config e coluna MCC/Login da aba CONFIGS (legado)
 *  - Meta Ads: /me/adaccounts (META_TOKEN)
 * Cada conta retornada vem marcada com os dados já salvos na accounts_config
 * (existing) para a UI pré-selecionar.
 */
require('dotenv').config({ path: '.env' });
const axios = require('axios');

const { assertCronAuth, sendJson } = require('../../src/core/serverlessJobs');
const { ads } = require('../../src/services/googleAds');
const { getGoogleRefreshToken, getMetaAccessToken } = require('../../src/services/connections');
const { listAccounts } = require('../../src/services/accountsConfig');

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v18.0';
const GOOGLE_NAME_CONCURRENCY = Number(process.env.DISCOVER_GOOGLE_CONCURRENCY || 8);
const GOOGLE_NAME_TIMEOUT_MS = Number(process.env.DISCOVER_GOOGLE_TIMEOUT_MS || 12000);
const GOOGLE_MAX_ACCOUNTS = Number(process.env.DISCOVER_GOOGLE_MAX || 500);
const GOOGLE_MCC_CONCURRENCY = 3;
const GOOGLE_MCC_TIMEOUT_MS = 25000;
const META_MAX_PAGES = 5;

// CustomerStatus (enum): UNKNOWN=1, ENABLED=2, CANCELED=3, SUSPENDED=4, CLOSED=5
const GOOGLE_STATUS_ENABLED = 2;

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
  });
  const guarded = promise.finally(() => clearTimeout(timer));
  // Se o timeout vencer antes, a promise original pode rejeitar depois —
  // anexa um catch para não gerar unhandledRejection no runtime.
  guarded.catch(() => { /* intencional */ });
  return Promise.race([guarded, timeoutPromise]);
}

function formatGoogleId(digits) {
  const d = String(digits || '').replace(/\D/g, '');
  return d.length === 10 ? d.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3') : d;
}

function normalizeTenDigits(value) {
  const d = String(value || '').replace(/\D/g, '');
  return /^\d{10}$/.test(d) ? d : '';
}

function getQueryValues(req, key) {
  const values = [];
  try {
    if (req && req.query && req.query[key] !== undefined) {
      const raw = req.query[key];
      if (Array.isArray(raw)) values.push(...raw);
      else values.push(raw);
      return values.map(String);
    }
    const rawUrl = String((req && req.url) || '/');
    const url = new URL(rawUrl, 'https://example.com');
    return url.searchParams.getAll(key);
  } catch (_) {
    return values;
  }
}

/**
 * MCCs conhecidos: query (?mcc=), env (MCC_ID/MCC_FALLBACK_*), contas salvas
 * na accounts_config e aba CONFIGS legada (se ainda existir na planilha).
 */
async function collectKnownMccIds(req) {
  const set = new Set();

  for (const raw of getQueryValues(req, 'mcc')) {
    for (const part of String(raw).split(/[,;\s]+/)) {
      const id = normalizeTenDigits(part);
      if (id) set.add(id);
    }
  }

  for (const key of ['MCC_ID', 'MCC_FALLBACK_1', 'MCC_FALLBACK_2']) {
    const id = normalizeTenDigits(process.env[key]);
    if (id) set.add(id);
  }

  try {
    const rows = await listAccounts();
    for (const row of rows) {
      const id = normalizeTenDigits(row && row.login_customer_id);
      if (id) set.add(id);
    }
  } catch (e) {
    console.warn('[accounts/discover] falha ao ler accounts_config para MCCs:', e && e.message);
  }

  try {
    if (process.env.SPREADSHEET_ID) {
      const { getSheets } = require('../../src/services/sheets');
      const sheets = await getSheets();
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: 'CONFIGS!A1:Z5000'
      });
      const values = res.data.values || [];
      const headerRow = values[0] || [];
      const headerMap = new Map(headerRow.map((h, i) => [String(h || '').trim().toLowerCase(), i]));
      const idxMcc = ['logincustomerid', 'login customer id', 'mcc', 'mcc_id', 'login mcc']
        .map(n => headerMap.get(n))
        .find(v => v !== undefined);
      if (idxMcc !== undefined) {
        for (let i = 1; i < values.length; i++) {
          const id = normalizeTenDigits(values[i] && values[i][idxMcc]);
          if (id) set.add(id);
        }
      }
    }
  } catch (e) {
    // Aba CONFIGS pode não existir mais — é só uma fonte extra de MCCs.
    console.warn('[accounts/discover] aba CONFIGS indisponível para MCCs (ignorado):', e && e.message);
  }

  return Array.from(set);
}

/**
 * Contas gerenciadas por um MCC: query customer_client no próprio MCC
 * (login_customer_id = ele). Level 0 = o próprio MCC; level 1 = contas filhas.
 */
async function discoverGoogleHierarchyForMcc(refreshToken, mccId) {
  const customer = ads.Customer({
    customer_id: mccId,
    refresh_token: refreshToken,
    login_customer_id: mccId
  });

  const rows = await withTimeout(
    customer.query(`
      SELECT
        customer_client.client_customer,
        customer_client.descriptive_name,
        customer_client.manager,
        customer_client.currency_code,
        customer_client.status,
        customer_client.level
      FROM customer_client
      WHERE customer_client.level <= 1
    `),
    GOOGLE_MCC_TIMEOUT_MS,
    'mcc hierarchy query'
  );

  const accounts = [];
  for (const row of rows || []) {
    const cc = row.customer_client || {};
    const id = normalizeTenDigits(cc.client_customer);
    if (!id) continue;
    accounts.push({
      id,
      name: String(cc.descriptive_name || '').trim() || null,
      manager: cc.manager === true,
      currency: cc.currency_code || '',
      inactive: Number(cc.status) !== GOOGLE_STATUS_ENABLED,
      fromMcc: mccId,
      mccLogin: mccId
    });
  }
  return accounts;
}

async function discoverGoogleAccounts(req, existingBykey) {
  const refreshToken = await getGoogleRefreshToken();
  if (!refreshToken) {
    return {
      ok: false,
      error: 'REFRESH_TOKEN não configurado no ambiente — toda conta Google Ads vinculada a esse token seria listada aqui.'
    };
  }

  const byId = new Map();
  const directIds = [];

  // 1) Contas com acesso direto ao token
  try {
    const response = await withTimeout(
      ads.listAccessibleCustomers(refreshToken),
      20000,
      'listAccessibleCustomers'
    );
    const resourceNames = (response && (response.resourceNames || response.resource_names)) || [];
    for (const name of resourceNames) {
      const id = normalizeTenDigits(name);
      if (id && !byId.has(id)) {
        directIds.push(id);
        byId.set(id, {
          id,
          name: null,
          manager: false,
          currency: '',
          inactive: false,
          direct: true
        });
      }
    }
  } catch (error) {
    const raw = (error && error.response && JSON.stringify(error.response.errors)) || (error && error.message) || String(error);
    console.error('[accounts/discover] google listAccessibleCustomers:', raw);
  }

  // 2) Hierarquia dos MCCs conhecidos (contas gerenciadas não aparecem no
  //    listAccessibleCustomers — só via customer_client no manager).
  const mccIds = await collectKnownMccIds(req);
  const mccsUsed = [];
  const mccErrors = [];
  for (let start = 0; start < mccIds.length; start += GOOGLE_MCC_CONCURRENCY) {
    const chunk = mccIds.slice(start, start + GOOGLE_MCC_CONCURRENCY);
    const results = await Promise.all(chunk.map(async (mccId) => {
      try {
        const accounts = await discoverGoogleHierarchyForMcc(refreshToken, mccId);
        return { mccId, accounts, error: null };
      } catch (error) {
        const raw = (error && error.response && JSON.stringify(error.response.errors)) || (error && error.message) || String(error);
        console.warn('[accounts/discover] hierarquia do MCC ' + mccId + ' falhou:', String(raw).slice(0, 200));
        return { mccId, accounts: [], error: String(raw).slice(0, 120) };
      }
    }));
    for (const result of results) {
      if (result.error) {
        mccErrors.push(result.mccId + ': ' + result.error);
      } else {
        mccsUsed.push(result.mccId);
      }
      for (const acc of result.accounts) {
        // A hierarquia traz nome/conflict currency/status — prioriza sobre a direta
        byId.set(acc.id, acc);
      }
    }
  }

  // 3) Nome das contas diretas que ainda não têm nome
  const unnamedDirect = directIds.filter(id => {
    const acc = byId.get(id);
    return acc && acc.direct && !acc.name;
  }).slice(0, GOOGLE_MAX_ACCOUNTS);

  for (let start = 0; start < unnamedDirect.length; start += GOOGLE_NAME_CONCURRENCY) {
    const chunk = unnamedDirect.slice(start, start + GOOGLE_NAME_CONCURRENCY);
    const results = await Promise.all(chunk.map(async (id) => {
      try {
        const customer = ads.Customer({ customer_id: id, refresh_token: refreshToken });
        const rows = await withTimeout(
          customer.query('SELECT customer.descriptive_name, customer.manager, customer.currency_code FROM customer'),
          GOOGLE_NAME_TIMEOUT_MS,
          'customer name query'
        );
        const c = (rows && rows[0] && rows[0].customer) || {};
        return { id, name: String(c.descriptive_name || '').trim() || null, manager: c.manager === true, currency: c.currency_code || '' };
      } catch (e) {
        return { id, name: null, manager: false, currency: '' };
      }
    }));
    for (const r of results) {
      const acc = byId.get(r.id);
      if (acc) {
        acc.name = acc.name || r.name;
        acc.manager = acc.manager || r.manager;
        acc.currency = acc.currency || r.currency;
      }
    }
  }

  let accounts = Array.from(byId.values()).slice(0, GOOGLE_MAX_ACCOUNTS);
  accounts.sort((a, b) => Number(a.manager === false) - Number(b.manager === false) || String(a.name || a.id).localeCompare(String(b.name || b.id)));

  // Hint quando não veio nada: guia o usuário para informar o MCC
  let hint = null;
  if (!accounts.length) {
    hint = mccIds.length
      ? 'Nenhuma conta encontrada nem via MCCs conhecidos (' + mccIds.join(', ') + '). Verifique se o REFRESH_TOKEN tem acesso ao MCC e se o ID está correto.'
      : 'Nenhuma conta com acesso direto ao REFRESH_TOKEN (listAccessibleCustomers vazio). Se suas contas ficam sob um MCC (conta gerenciadora), informe o ID dele (10 dígitos) no campo "MCC Google" ao lado e clique em Buscar de novo.';
  }

  return {
    ok: true,
    accounts: accounts.map(a => ({ ...a, idFormatted: formatGoogleId(a.id), existing: existingBykey.get('GOOGLE|' + a.id) || null })),
    total: accounts.length,
    directTotal: directIds.length,
    mccsUsed,
    mccErrors,
    hint
  };
}

async function discoverMetaAccounts(existingBykey) {
  const token = await getMetaAccessToken();
  if (!token) {
    return {
      ok: false,
      error: 'META_TOKEN não configurado no ambiente — toda conta de anúncio vinculada a esse token seria listada aqui.'
    };
  }

  try {
    const accounts = [];
    let nextUrl = `https://graph.facebook.com/${META_GRAPH_VERSION}/me/adaccounts?fields=id,name,account_id,account_status,currency&limit=200&access_token=${encodeURIComponent(token)}`;
    let pages = 0;

    while (nextUrl && pages < META_MAX_PAGES) {
      const res = await withTimeout(axios.get(nextUrl, { timeout: 15000 }), 20000, 'meta adaccounts');
      const data = res.data && res.data.data ? res.data.data : [];
      for (const acc of data) {
        const id = String(acc.account_id || '').replace(/\D/g, '');
        if (!id) continue;
        accounts.push({
          id,
          name: String(acc.name || '').trim() || null,
          inactive: acc.account_status !== 1,
          currency: acc.currency || '',
          existing: existingBykey.get('META|' + id) || null
        });
      }
      nextUrl = (res.data && res.data.paging && res.data.paging.next) || null;
      pages += 1;
    }

    return { ok: true, accounts, total: accounts.length };
  } catch (error) {
    const info = error && error.response && error.response.data && error.response.data.error;
    const msg = info && info.message ? info.message : (error && error.message) || String(error);
    console.error('[accounts/discover] meta:', msg);
    return { ok: false, error: 'Falha ao listar contas Meta: ' + String(msg).slice(0, 300) };
  }
}

module.exports = async (req, res) => {
  const authResponse = assertCronAuth(req, res);
  if (authResponse) return authResponse;

  try {
    // Contas já salvas → marcar como selecionadas
    let saved = [];
    try {
      saved = await listAccounts();
    } catch (e) {
      console.warn('[accounts/discover] falha ao ler accounts_config:', e && e.message);
    }
    const existingBykey = new Map(
      saved.map(a => [a.plataforma + '|' + a.customer_id, a])
    );

    const google = await discoverGoogleAccounts(req, existingBykey);
    const meta = await discoverMetaAccounts(existingBykey);

    return sendJson(res, { ok: true, google, meta }, 200);
  } catch (error) {
    console.error('[accounts/discover] erro:', error && error.message);
    return sendJson(res, { ok: false, error: error && error.message ? error.message : 'Erro ao descobrir contas' }, 500);
  }
};
