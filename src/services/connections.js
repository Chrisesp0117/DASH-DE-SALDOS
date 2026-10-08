/**
 * connections.js — fonte dos tokens de acesso às APIs.
 *
 * Os tokens vêm direto das variáveis de ambiente:
 *  - Google Ads: REFRESH_TOKEN (+ CLIENT_ID/CLIENT_SECRET/DEVELOPER_TOKEN)
 *  - Meta Ads:    META_TOKEN
 *
 * Qualquer conta vinculada a esses tokens é listada pela página de
 * configurações (/api/settings-ui) para seleção.
 */

async function getGoogleRefreshToken() {
  return process.env.REFRESH_TOKEN || null;
}

async function getMetaAccessToken() {
  return process.env.META_TOKEN || null;
}

/**
 * Presença dos tokens (sem expor valores) para a página de configurações.
 */
function getTokenStatus() {
  return {
    google: { configured: Boolean(String(process.env.REFRESH_TOKEN || '').trim()) },
    meta: { configured: Boolean(String(process.env.META_TOKEN || '').trim()) }
  };
}

module.exports = {
  getGoogleRefreshToken,
  getMetaAccessToken,
  getTokenStatus
};
