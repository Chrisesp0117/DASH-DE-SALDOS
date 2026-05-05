const { getSheets } = require('../services/sheets');
const { run } = require('../run');
const { generateReport } = require('./reportGenerator');

function readHeader(req, name) {
  const headers = req && req.headers;

  if (!headers) {
    return '';
  }

  if (typeof headers.get === 'function') {
    return headers.get(name) || '';
  }

  return headers[name] || headers[name.toLowerCase()] || '';
}

function sendJson(res, payload, statusCode = 200) {
  if (res && typeof res.status === 'function' && typeof res.json === 'function') {
    return res.status(statusCode).json(payload);
  }

  if (res && typeof res.setHeader === 'function' && typeof res.end === 'function') {
    res.statusCode = statusCode;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
    return;
  }

  if (typeof Response !== 'undefined') {
    return new Response(JSON.stringify(payload), {
      status: statusCode,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }

  return { statusCode, body: JSON.stringify(payload) };
}

function getCronSecretFromRequest(req) {
  return (
    readHeader(req, 'x-cron-secret') ||
    readHeader(req, 'x-cron-job-secret') ||
    req.query?.secret ||
    req.query?.token ||
    ''
  );
}

function assertCronAuth(req, res) {
  const expected = process.env.CRON_SECRET || '';

  if (!expected) {
    return null;
  }

  const incoming = String(getCronSecretFromRequest(req) || '').trim();

  if (incoming !== expected) {
    return sendJson(res, { ok: false, error: 'Unauthorized cron request' }, 401);
  }

  return null;
}

async function runUpdateJob(options = {}) {
  return run(options);
}

async function runReportJob(options = {}) {
  const alertTitle = String(options.alertTitle || '').trim();
  const sheets = await getSheets();
  const report = await generateReport(sheets, process.env.SPREADSHEET_ID);
  const message = alertTitle ? `<b>${alertTitle}</b>\n\n${report}` : report;
  // Previously this function broadcasted the report via Telegram.
  // Bot integration removed — return the generated report for callers to use.
  return report;
}

module.exports = {
  assertCronAuth,
  getCronSecretFromRequest,
  sendJson,
  runUpdateJob,
  runReportJob
};
