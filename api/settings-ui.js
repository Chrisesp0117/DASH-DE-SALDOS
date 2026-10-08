/**
 * GET /api/settings-ui → redireciona para a página única com abas,
 * abrindo direto na aba de configurações (#configuracoes).
 * Mantido para compatibilidade com links antigos.
 */
require('dotenv').config({ path: '.env' });

function getQueryValue(req, key) {
  try {
    if (req && req.query && req.query[key] !== undefined) return String(req.query[key]);
    const rawUrl = String((req && req.url) || '/');
    const url = new URL(rawUrl, 'https://example.com');
    return url.searchParams.get(key) || '';
  } catch (_) {
    return '';
  }
}

module.exports = async (req, res) => {
  const secret = getQueryValue(req, 'secret')
    || String((req && req.headers && (req.headers['x-cron-secret'] || '')) || '');
  const location = '/api/update-now?secret=' + encodeURIComponent(secret) + '#configuracoes';

  if (res && typeof res.setHeader === 'function' && typeof res.end === 'function') {
    res.statusCode = 302;
    res.setHeader('Location', location);
    res.end('');
    return;
  }
  if (typeof Response !== 'undefined') {
    return new Response(null, { status: 302, headers: { Location: location } });
  }
  return { statusCode: 302, headers: { Location: location }, body: '' };
};
