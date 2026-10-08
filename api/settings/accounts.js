/**
 * /api/settings/accounts
 *  - GET  (?secret=...): lista as contas salvas em accounts_config.
 *  - POST (header x-cron-secret ou ?secret=...): substitui a lista completa.
 *    Body: { accounts: [{ plataforma, customer_id, cliente, gestor, supervisor,
 *                         revisao, login_customer_id }] }
 */
require('dotenv').config({ path: '.env' });

const { assertCronAuth, sendJson } = require('../../src/core/serverlessJobs');
const { listAccounts, saveAccounts } = require('../../src/services/accountsConfig');
const { readJsonBody } = require('../../src/core/oauth');

module.exports = async (req, res) => {
  const authResponse = assertCronAuth(req, res);
  if (authResponse) return authResponse;

  const method = String(req && req.method || 'GET').toUpperCase();

  try {
    if (method === 'GET') {
      const accounts = await listAccounts();
      return sendJson(res, { ok: true, accounts }, 200);
    }

    if (method === 'POST') {
      const body = await readJsonBody(req);
      const accounts = body && body.accounts;
      if (!Array.isArray(accounts)) {
        return sendJson(res, { ok: false, error: 'Envie { accounts: [...] } no body' }, 400);
      }
      const result = await saveAccounts(accounts);
      console.log('[settings/accounts] ' + result.saved + ' conta(s) salva(s) na accounts_config');
      return sendJson(res, { ok: true, ...result }, 200);
    }

    return sendJson(res, { ok: false, error: 'Método não suportado: ' + method }, 405);
  } catch (error) {
    console.error('[settings/accounts] erro:', error && error.message);
    return sendJson(res, { ok: false, error: error && error.message ? error.message : 'Erro ao salvar contas' }, 500);
  }
};
