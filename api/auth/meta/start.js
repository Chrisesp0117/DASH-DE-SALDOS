/**
 * GET /api/auth/meta/start?secret=...
 * Inicia o fluxo OAuth do Meta (escopos: ads_read + business_management) e
 * redireciona para a tela de login/consentimento do Facebook.
 */
require('dotenv').config({ path: '.env' });

const { assertCronAuth, sendJson } = require('../../../src/core/serverlessJobs');
const { buildMetaAuthUrl, getMetaRedirectUri } = require('../../../src/core/oauth');

module.exports = async (req, res) => {
  const authResponse = assertCronAuth(req, res);
  if (authResponse) return authResponse;

  if (!process.env.META_APP_ID || !process.env.META_APP_SECRET) {
    return sendJson(res, {
      ok: false,
      error: 'META_APP_ID/META_APP_SECRET não configurados. Crie um app no Meta for Developers e configure as variáveis de ambiente.'
    }, 500);
  }

  const state = String(process.env.CRON_SECRET || '');
  if (!state) {
    return sendJson(res, {
      ok: false,
      error: 'CRON_SECRET não configurado no ambiente.'
    }, 500);
  }

  const redirectUri = getMetaRedirectUri(req);
  const url = buildMetaAuthUrl(redirectUri, state);

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
