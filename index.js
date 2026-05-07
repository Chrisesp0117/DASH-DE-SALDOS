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

  if (path === '/api') {
    return require('./api/index')(req, res);
  }

  if (path === '/api/update') {
    // `api/update` foi removido; redireciona para `api/update-now`
    return require('./api/update-now')(req, res);
  }

  if (path === '/api/update-now') {
    return require('./api/update-now')(req, res);
  }

  if (path === '/api/report') {
    return require('./api/report')(req, res);
  }

  if (path === '/api/cron/update') {
    return require('./api/cron/update')(req, res);
  }

  if (path === '/api/cron/update-full') {
    return require('./api/cron/update-full')(req, res);
  }

  if (path === '/api/cron/report-8h') {
    return require('./api/cron/report-8h')(req, res);
  }

  if (path === '/api/cron/report-17h') {
    return require('./api/cron/report-17h')(req, res);
  }

  return sendText(res, 'OK', 200);
};
