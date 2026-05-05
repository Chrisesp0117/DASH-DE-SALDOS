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

module.exports = (req, res) => sendText(res, 'OK', 200);
