/**
 * POST /api/auth/disconnect
 * Body: { provider: 'google' | 'meta' }
 * Remove a conexão OAuth salva (os tokens passam a vir do .env, se existirem).
 */
require('dotenv').config({ path: '.env' });

const { assertCronAuth, sendJson } = require('../../src/core/serverlessJobs');
const { deleteConnection } = require('../../src/services/connections');
const { readJsonBody } = require('../../src/core/oauth');

module.exports = async (req, res) => {
  const authResponse = assertCronAuth(req, res);
  if (authResponse) return authResponse;

  try {
    const body = await readJsonBody(req);
    const provider = String(body && body.provider || '').trim().toLowerCase();

    if (provider !== 'google' && provider !== 'meta') {
      return sendJson(res, { ok: false, error: "provider deve ser 'google' ou 'meta'" }, 400);
    }

    await deleteConnection(provider);
    console.log('[auth/disconnect] conexão ' + provider + ' removida');
    return sendJson(res, { ok: true, disconnected: provider }, 200);
  } catch (error) {
    console.error('[auth/disconnect] erro:', error && error.message);
    return sendJson(res, { ok: false, error: error && error.message ? error.message : 'Erro ao desconectar' }, 500);
  }
};
