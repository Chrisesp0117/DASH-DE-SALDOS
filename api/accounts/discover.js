/**
 * GET /api/accounts/discover?secret=...
 * Lista as contas de anúncio acessíveis pelo usuário conectado:
 *  - Google Ads: listAccessibleCustomers (refresh token OAuth) + nome via GAQL
 *  - Meta Ads: /me/adaccounts (token long-lived OAuth)
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
const GOOGLE_MAX_ACCOUNTS = Number(process.env.DISCOVER_GOOGLE_MAX || 300);
const META_MAX_PAGES = 5;

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    timeoutPromise
  ]);
}

function formatGoogleId(digits) {
  const d = String(digits || '').replace(/\D/g, '');
  return d.length === 10 ? d.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3') : d;
}

async function discoverGoogleAccounts(existingBykey) {
  const refreshToken = await getGoogleRefreshToken();
  if (!refreshToken) {
    return {
      ok: false,
      error: 'Nenhuma conta Google conectada. Conecte o Google na página de configurações (ou defina REFRESH_TOKEN no .env).'
    };
  }

  try {
    const response = await withTimeout(
      ads.listAccessibleCustomers(refreshToken),
      20000,
      'listAccessibleCustomers'
    );
    const resourceNames = (response && response.resourceNames) || [];
    const ids = resourceNames
      .map(name => String(name || '').replace(/\D/g, ''))
      .filter(id => /^\d{10}$/.test(id))
      .slice(0, GOOGLE_MAX_ACCOUNTS);

    // Busca o nome de cada conta (GAQL sem métricas funciona também em MCCs).
    const accounts = [];
    for (let start = 0; start < ids.length; start += GOOGLE_NAME_CONCURRENCY) {
      const chunk = ids.slice(start, start + GOOGLE_NAME_CONCURRENCY);
      const results = await Promise.all(chunk.map(async (id) => {
        try {
          const customer = ads.Customer({ customer_id: id, refresh_token: refreshToken });
          const rows = await withTimeout(
            customer.query('SELECT customer.descriptive_name, customer.manager, customer.currency_code, customer.time_zone FROM customer'),
            GOOGLE_NAME_TIMEOUT_MS,
            'customer name query'
          );
          const c = (rows && rows[0] && rows[0].customer) || {};
          return {
            id,
            name: String(c.descriptive_name || '').trim() || null,
            manager: c.manager === true,
            currency: c.currency_code || '',
            existing: existingBykey.get('GOOGLE|' + id) || null
          };
        } catch (e) {
          return {
            id,
            name: null,
            manager: false,
            currency: '',
            existing: existingBykey.get('GOOGLE|' + id) || null
          };
        }
      }));
      accounts.push(...results);
    }

    return {
      ok: true,
      accounts: accounts.map(a => ({ ...a, idFormatted: formatGoogleId(a.id) })),
      total: ids.length
    };
  } catch (error) {
    const raw = (error && error.response && JSON.stringify(error.response.errors)) || (error && error.message) || String(error);
    console.error('[accounts/discover] google:', raw);
    return { ok: false, error: 'Falha ao listar contas Google Ads: ' + String(raw).slice(0, 300) };
  }
}

async function discoverMetaAccounts(existingBykey) {
  const token = await getMetaAccessToken();
  if (!token) {
    return {
      ok: false,
      error: 'Nenhuma conta Meta conectada. Conecte o Meta na página de configurações (ou defina META_TOKEN no .env).'
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
          status: acc.account_status,
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

    const [google, meta] = await Promise.all([
      discoverGoogleAccounts(existingBykey),
      discoverMetaAccounts(existingBykey)
    ]);

    return sendJson(res, { ok: true, google, meta }, 200);
  } catch (error) {
    console.error('[accounts/discover] erro:', error && error.message);
    return sendJson(res, { ok: false, error: error && error.message ? error.message : 'Erro ao descobrir contas' }, 500);
  }
};
