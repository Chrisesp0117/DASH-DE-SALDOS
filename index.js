function sendText(res, text, statusCode = 200) {
  if (res && typeof res.status === 'function' && typeof res.send === 'function') {
    return res.status(statusCode).send(text);
  }

  if (res && typeof res.setHeader === 'function' && typeof res.end === 'function') {
    res.statusCode = statusCode;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end(text);
    return;
  }

  if (typeof Response !== 'undefined') {
    return new Response(text, {
      status: statusCode,
      headers: { 'content-type': 'text/plain; charset=utf-8' }
    });
  }

  return { statusCode, body: text };
}

function normalizePath(urlValue) {
  const raw = String(urlValue || '/');
  const withoutQuery = raw.split('?')[0] || '/';
  return withoutQuery.replace(/\/+$/, '') || '/';
}

module.exports = async (req, res) => {
  const path = normalizePath(req && req.url);

  const routes = {
    '/api': './api/index',
    '/api/update': './api/update',
    '/api/report': './api/report',
    '/api/cron/update': './api/cron/update',
    '/api/cron/report-8h': './api/cron/report-8h',
    '/api/cron/report-17h': './api/cron/report-17h'
  };

  const target = routes[path];

  if (target) {
    const handler = require(target);
    return handler(req, res);
  }

  return sendText(res, 'OK', 200);
};
