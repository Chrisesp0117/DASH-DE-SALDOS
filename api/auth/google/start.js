/**
 * GET /api/auth/google/start?secret=...
 * Inicia o fluxo OAuth do Google (escopos: Google Ads + e-mail) e
 * redireciona para a tela de consentimento.
 */
require('dotenv').config({ path: '.env' });

const { assertCronAuth, sendJson } = require('../../../src/core/serverlessJobs');
const { buildGoogleAuthUrl, getGoogleRedirectUri } = require('../../../src/core/oauth');

module.exports = async (req, res) => {
  const authResponse = assertCronAuth(req, res);
  if (authResponse) return authResponse;

  if (!process.env.CLIENT_ID || !process.env.CLIENT_SECRET) {
    return sendJson(res, {
      ok: false,
      error: 'CLIENT_ID/CLIENT_SECRET não configurados. Configure as variáveis de ambiente do Google OAuth.'
    }, 500);
  }

  const state = String(process.env.CRON_SECRET || '');
  if (!state) {
    return sendJson(res, {
      ok: false,
      error: 'CRON_SECRET não configurado no ambiente.'
    }, 500);
  }

  const redirectUri = getGoogleRedirectUri(req);
  const url = buildGoogleAuthUrl(redirectUri, state);

  if (res && typeof res.setHeader === 'function' && typeof res.end === 'function') {
    res.statusCode = 302;
    res.setHeader('Location', url);
    res.end('');
    return;
  }
  if (typeof Response !== 'undefined') {
    return new Response(null, { status: 302, headers: { Location: url } });
  }
  return { statusCode: 302, headers: { Location: url }, body: '' };
};
