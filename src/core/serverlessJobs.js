const { getSheets } = require('../services/sheets');
const { run } = require('../run');
const { generateReport } = require('./reportGenerator');

function getCronSecretFromRequest(req) {
  return (
    req.headers['x-cron-secret'] ||
    req.headers['x-cron-job-secret'] ||
    req.query?.secret ||
    req.query?.token ||
    ''
  );
}

function assertCronAuth(req, res) {
  const expected = process.env.CRON_SECRET || '';

  if (!expected) {
    return true;
  }

  const incoming = String(getCronSecretFromRequest(req) || '').trim();

  if (incoming !== expected) {
    res.status(401).json({ ok: false, error: 'Unauthorized cron request' });
    return false;
  }

  return true;
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
  runUpdateJob,
  runReportJob
};
