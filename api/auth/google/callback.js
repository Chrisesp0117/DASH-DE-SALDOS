/**
 * GET /api/auth/google/callback?code=...&state=...
 * Callback do OAuth Google: troca o code por tokens, salva a conexão em
 * app_connections e volta para a página de configurações.
 */
require('dotenv').config({ path: '.env' });

const {
  exchangeGoogleCode,
  getGoogleRedirectUri,
  getGoogleUserEmail,
  sendRedirect
} = require('../../../src/core/oauth');
const { upsertConnection } = require('../../../src/services/connections');

function getQueryValue(req, key) {
  try {
    if (req && req.query && req.query[key] !== undefined) {
      return String(req.query[key]);
    }
    const rawUrl = String((req && req.url) || '/');
    const base = 'https://example.com';
    const url = new URL(rawUrl, base);
    return url.searchParams.get(key) || '';
  } catch (_) {
    return '';
  }
}

function settingsUrl(params) {
  const secret = String(process.env.CRON_SECRET || '');
  const query = new URLSearchParams({ secret });
  for (const [key, value] of Object.entries(params || {})) {
    if (value) query.set(key, String(value));
  }
  return '/api/settings-ui?' + query.toString();
}

module.exports = async (req, res) => {
  const code = getQueryValue(req, 'code');
  const state = getQueryValue(req, 'state');
  const oauthError = getQueryValue(req, 'error');
  const expectedState = String(process.env.CRON_SECRET || '');

  if (!expectedState || state !== expectedState) {
    return sendRedirect(res, settingsUrl({ error: 'unauthorized' }));
  }
  // Google redireciona com ?error=access_denied quando o usuário cancela o consentimento.
  if (oauthError) {
    console.warn('[google/callback] oauth error=' + oauthError);
    return sendRedirect(res, settingsUrl({
      error: oauthError === 'access_denied' ? 'access_denied' : 'google_connect_failed',
      detail: oauthError
    }));
  }
  if (!code) {
    return sendRedirect(res, settingsUrl({ error: 'missing_code' }));
  }

  try {
    const redirectUri = getGoogleRedirectUri(req);
    const tokens = await exchangeGoogleCode(code, redirectUri);

    const accessToken = tokens.access_token || '';
    const refreshToken = tokens.refresh_token || '';
    const scopes = tokens.scope || '';
    const email = await getGoogleUserEmail(accessToken, tokens.id_token);

    const existingFields = {};
    // Se o Google não devolver refresh_token (reautorização sem prompt),
    // preserva o refresh token salvo anteriormente.
    if (!refreshToken) {
      try {
        const { getConnection } = require('../../../src/services/connections');
        const existing = await getConnection('google');
        if (existing && existing.refresh_token) {
          existingFields.refresh_token = existing.refresh_token;
        }
      } catch (e) {
        console.warn('[google/callback] falha ao ler conexão existente:', e && e.message);
      }
    }

    await upsertConnection('google', {
      ...existingFields,
      refresh_token: refreshToken || existingFields.refresh_token || null,
      access_token: accessToken || null,
      email,
      scopes,
      status: 'connected',
      error_message: null,
      token_expires_at: tokens.expires_in
        ? new Date(Date.now() + Number(tokens.expires_in) * 1000).toISOString()
        : null
    });

    console.log('[google/callback] conexão google salva. email=' + email + ' refresh=' + (refreshToken ? 'novo' : 'preservado'));
    return sendRedirect(res, settingsUrl({ connected: 'google' }));
  } catch (error) {
    console.error('[google/callback] erro:', error && error.message);
    try {
      await require('../../../src/services/connections').markConnectionError('google', error && error.message);
    } catch (e) { /* ignore */ }
    return sendRedirect(res, settingsUrl({ error: 'google_connect_failed', detail: String(error && error.message || '').slice(0, 200) }));
  }
};
