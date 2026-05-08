const { getSheets } = require('../services/sheets');
const { run } = require('../run');
const { generateBlocosPorGestor } = require('./visualBlocks');
const { ensureDashboardsForAllGestores } = require('./gestorDashboards');
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
  return run({
    skipDashboards: true,
    ...options
  });
}

async function runFullUpdateJob(options = {}) {
  const batchSize = Math.max(1, Number(options.batchSize || process.env.UPDATE_BATCH_SIZE || 5));
  const maxIterations = Math.max(1, Number(options.maxIterations || 200));
  const maxMs = Math.max(5000, Number(options.maxMs || 45000));
  const includeSupervisor = options.includeSupervisor !== false;
  const includeDashboards = options.includeDashboards !== false;

  const startedAt = Date.now();
  let totalProcessed = 0;
  let finished = false;
  let iteration = 0;

  while (!finished && iteration < maxIterations) {
    if (Date.now() - startedAt >= maxMs) {
      return {
        ok: true,
        finished: false,
        reason: 'time_budget_reached',
        iterations: iteration,
        totalProcessed,
        batchSize
      };
    }

    iteration += 1;
    let result;
    try {
      result = await runUpdateJob({
        batchSize,
        enableStartStatus: iteration === 1
      });
    } catch (error) {
      const msg = String(error && (error.message || error.code || error.status) || '').toLowerCase();
      const isQuota = msg.includes('quota exceeded') || msg.includes('resource_exhausted') || String(error && error.status) === '429' || String(error && error.code) === '429';

      if (isQuota) {
        return {
          ok: true,
          finished: false,
          reason: 'quota_exceeded',
          iterations: iteration,
          totalProcessed,
          batchSize
        };
      }

      return {
        ok: false,
        finished: false,
        reason: 'update_failed',
        iterations: iteration,
        totalProcessed,
        batchSize,
        error: error && error.message ? error.message : 'Execução falhou'
      };
    }

    if (!result || !result.ok) {
      return {
        ok: false,
        finished: false,
        reason: 'update_failed',
        iterations: iteration,
        totalProcessed,
        batchSize,
        error: result && result.error ? result.error : 'Execução falhou'
      };
    }

    totalProcessed += Number(result.processed || 0);
    finished = result.finished === true;
  }

  if (!finished) {
    return {
      ok: true,
      finished: false,
      reason: 'max_iterations_reached',
      iterations: iteration,
      totalProcessed,
      batchSize
    };
  }

  const dashboardResult = await runDashboardJob({
    includeSupervisor,
    includeDashboards
  });

  if (!dashboardResult || dashboardResult.ok === false) {
    return {
      ok: false,
      finished: true,
      reason: 'dashboard_failed',
      iterations: iteration,
      totalProcessed,
      batchSize,
      dashboardResult
    };
  }

  return {
    ok: true,
    finished: true,
    iterations: iteration,
    totalProcessed,
    batchSize,
    dashboardResult
  };
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

async function runDashboardJob(options = {}) {
  try {
    const sheets = await getSheets();
    const spreadsheetId = process.env.SPREADSHEET_ID;

    const results = {};

    if (options.includeSupervisor !== false) {
      results.supervisor = await generateBlocosPorGestor(sheets, spreadsheetId);
    }

    if (options.includeDashboards !== false) {
      results.dashboards = await ensureDashboardsForAllGestores(sheets, spreadsheetId);
    }

    return { ok: true, ...results };
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : 'Erro ao gerar dashboards'
    };
  }
}

module.exports = {
  assertCronAuth,
  getCronSecretFromRequest,
  sendJson,
  runUpdateJob,
  runFullUpdateJob,
  runDashboardJob,
  runReportJob
};
