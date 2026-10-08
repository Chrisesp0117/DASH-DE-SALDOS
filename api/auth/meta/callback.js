/**
 * GET /api/auth/meta/callback?code=...&state=...
 * Callback do OAuth Meta: troca o code por um token de curta duração,
 * converte para longa duração (~60 dias), identifica o usuário e salva a
 * conexão em app_connections.
 */
require('dotenv').config({ path: '.env' });

const {
  exchangeMetaCode,
  getMetaRedirectUri,
  getMetaUser,
  sendRedirect
} = require('../../../src/core/oauth');
const {
  exchangeMetaLongLived,
  upsertConnection
} = require('../../../src/services/connections');

function getQueryValue(req, key) {
  try {
    if (req && req.query && req.query[key] !== undefined) {
      return String(req.query[key]);
    }
    const rawUrl = String((req && req.url) || '/');
    const url = new URL(rawUrl, 'https://example.com');
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
  const expectedState = String(process.env.CRON_SECRET || '');

  if (!expectedState || state !== expectedState) {
    return sendRedirect(res, settingsUrl({ error: 'unauthorized' }));
  }
  if (!code) {
    return sendRedirect(res, settingsUrl({ error: 'missing_code' }));
  }

  try {
    const redirectUri = getMetaRedirectUri(req);
    const shortTokens = await exchangeMetaCode(code, redirectUri);
    const shortToken = shortTokens.access_token;
    if (!shortToken) {
      throw new Error('Meta não retornou access_token para o código informado');
    }

    const longTokens = await exchangeMetaLongLived(shortToken);
    const longToken = longTokens.access_token || shortToken;

    const user = await getMetaUser(longToken);

    await upsertConnection('meta', {
      access_token: longToken,
      meta_user_id: user.id || '',
      account_name: user.name || '',
      scopes: 'ads_read,business_management',
      status: 'connected',
      error_message: null,
      token_expires_at: longTokens.expires_in
        ? new Date(Date.now() + Number(longTokens.expires_in) * 1000).toISOString()
        : null
    });

    console.log('[meta/callback] conexão meta salva. user=' + (user.name || '') + ' (' + (user.id || '') + ') long_lived=' + Boolean(longTokens.access_token));
    return sendRedirect(res, settingsUrl({ connected: 'meta' }));
  } catch (error) {
    console.error('[meta/callback] erro:', error && error.message);
    try {
      await require('../../../src/services/connections').markConnectionError('meta', error && error.message);
    } catch (e) { /* ignore */ }
    return sendRedirect(res, settingsUrl({ error: 'meta_connect_failed', detail: String(error && error.message || '').slice(0, 200) }));
  }
};
