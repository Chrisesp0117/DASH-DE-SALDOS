/**
 * GET /api/accounts/meta-check?secret=...&id=<ad_account_id>
 * Diagnóstico Meta: faz as chamadas de saldo e insights exatamente como o job
 * faz (e variações) e devolve as respostas cruas da Graph API — sem expor o
 * token. Útil para descobrir por que uma conta específica falha no job.
 */
require('dotenv').config({ path: '.env' });
const axios = require('axios');

const { assertCronAuth, sendJson } = require('../../src/core/serverlessJobs');
const { getMetaAccessToken } = require('../../src/services/connections');

async function tryGet(url) {
  try {
    const res = await axios.get(url, { timeout: 15000 });
    return { ok: true, status: res.status, data: res.data };
  } catch (err) {
    const info = err && err.response && err.response.data;
    return { ok: false, status: err && err.response ? err.response.status : null, error: info || (err && err.message) };
  }
}

module.exports = async (req, res) => {
  const authResponse = assertCronAuth(req, res);
  if (authResponse) return authResponse;

  try {
    const url = new URL(String((req && req.url) || '/'), 'https://example.com');
    const id = String(url.searchParams.get('id') || '').replace(/\D/g, '');
    if (!id) {
      return sendJson(res, { ok: false, error: 'informe ?id=<ad_account_id>' }, 400);
    }

    const token = await getMetaAccessToken();
    if (!token) {
      return sendJson(res, { ok: false, error: 'META_TOKEN não configurado' }, 500);
    }

    const t = encodeURIComponent(token);
    const results = {};

    // 1) Saldo exatamente como o job chama (v18, ID puro)
    results['saldo_v18_id_puro'] = await tryGet(`https://graph.facebook.com/v18.0/${id}?fields=spend_cap,amount_spent&access_token=${t}`);

    // 2) Saldo com prefixo act_ (formato clássico da Marketing API)
    results['saldo_v18_act'] = await tryGet(`https://graph.facebook.com/v18.0/act_${id}?fields=spend_cap,amount_spent&access_token=${t}`);

    // 3) Saldo em versões mais novas
    results['saldo_v21_act'] = await tryGet(`https://graph.facebook.com/v21.0/act_${id}?fields=spend_cap,amount_spent&access_token=${t}`);
    results['saldo_v22_act'] = await tryGet(`https://graph.facebook.com/v22.0/act_${id}?fields=spend_cap,amount_spent&access_token=${t}`);

    // 4) Insights como o job chama (v21 enriquecida)
    results['insights_v21_id_puro'] = await tryGet(`https://graph.facebook.com/v21.0/${id}/insights?level=account&fields=spend,clicks,impressions&date_preset=yesterday&access_token=${t}`);

    // 5) Insights com act_ (v21)
    results['insights_v21_act'] = await tryGet(`https://graph.facebook.com/v21.0/act_${id}/insights?level=account&fields=spend&date_preset=yesterday&access_token=${t}`);

    // 6) Insights v22 com act_
    results['insights_v22_act'] = await tryGet(`https://graph.facebook.com/v22.0/act_${id}/insights?level=account&fields=spend&date_preset=yesterday&access_token=${t}`);

    // 7) Info da conta em versão recente (nome/status/fuso)
    results['info_v22_act'] = await tryGet(`https://graph.facebook.com/v22.0/act_${id}?fields=name,account_status,currency,spend_cap,amount_spent&access_token=${t}`);

    // 8) O que /me devolve (identidade do token)
    results['me_v22'] = await tryGet(`https://graph.facebook.com/v22.0/me?fields=id,name&access_token=${t}`);

    return sendJson(res, { ok: true, id, results }, 200);
  } catch (error) {
    console.error('[accounts/meta-check] erro:', error && error.message);
    return sendJson(res, { ok: false, error: error && error.message ? error.message : 'Erro no diagnóstico' }, 500);
  }
};
