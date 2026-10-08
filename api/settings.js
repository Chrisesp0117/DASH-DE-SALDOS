/**
 * GET /api/settings?secret=...
 * Estado atual da configuração web: presença dos tokens (sem expor valores)
 * + contas já selecionadas. Usado pela página /api/settings-ui.
 */
require('dotenv').config({ path: '.env' });

const { assertCronAuth, sendJson } = require('../src/core/serverlessJobs');
const { getTokenStatus } = require('../src/services/connections');
const { listAccounts, ACCOUNTS_TABLE } = require('../src/services/accountsConfig');

module.exports = async (req, res) => {
  const authResponse = assertCronAuth(req, res);
  if (authResponse) return authResponse;

  try {
    const [tokens, accounts] = await Promise.all([
      Promise.resolve(getTokenStatus()),
      listAccounts()
    ]);

    return sendJson(res, {
      ok: true,
      tokens,
      accounts,
      counts: {
        total: accounts.length,
        GOOGLE: accounts.filter(a => a.plataforma === 'GOOGLE').length,
        META: accounts.filter(a => a.plataforma === 'META').length
      },
      accountsTable: ACCOUNTS_TABLE
    }, 200);
  } catch (error) {
    console.error('[settings] erro:', error && error.message);
    return sendJson(res, { ok: false, error: error && error.message ? error.message : 'Erro ao carregar configurações' }, 500);
  }
};
