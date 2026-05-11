const { getSheets } = require('../services/sheets');
const {
  run,
  acquireJobStateLock,
  assertJobStateActive,
  finishJobState,
  releaseJobState,
  readJobState
} = require('../run');
const { generateBlocosPorGestor } = require('./visualBlocks');
const { ensureDashboardsForAllGestores, atomicRefreshAllDashboards } = require('./gestorDashboards');
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
  const urlSecret = (() => {
    try {
      const rawUrl = String(req && req.url || '/');
      const parsed = new URL(rawUrl, 'https://dash-de-saldos.vercel.app');
      return parsed.searchParams.get('secret') || parsed.searchParams.get('token') || '';
    } catch (_) {
      return '';
    }
  })();

  return (
    readHeader(req, 'x-cron-secret') ||
    readHeader(req, 'x-cron-job-secret') ||
    req.query?.secret ||
    req.query?.token ||
    urlSecret ||
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
  const batchSize = Math.max(1, Number(options.batchSize || process.env.UPDATE_BATCH_SIZE || 10));
  const maxIterations = Math.max(1, Number(options.maxIterations || 200));
  const maxMs = Math.max(5000, Number(options.maxMs || 45000));
  const includeSupervisor = options.includeSupervisor !== false;
  const includeDashboards = options.includeDashboards !== false;
  const rejectIfRunning = options.rejectIfRunning !== false;
  const force = options.force === true;
  const resetCursor = options.resetCursor === true;

  const sheets = await getSheets();
  const spreadsheetId = process.env.SPREADSHEET_ID;

  if (rejectIfRunning && !force) {
    const current = await readJobState(sheets, spreadsheetId);
    const running = String(current.status || '') === 'running' && Number(current.leaseUntil || 0) > Date.now();
    if (running) {
      return {
        ok: false,
        running: true,
        reason: 'job_already_running',
        state: current
      };
    }
  }
  const jobControl = await acquireJobStateLock(sheets, spreadsheetId, {
    leaseMs: Number(process.env.JOB_LEASE_MS || 10 * 60 * 1000),
    resetCursor
  });
  console.log('[diagnostic] acquired job lock', { jobId: jobControl.jobId, generation: jobControl.generation, leaseUntil: jobControl.leaseUntil });

  const startedAt = Date.now();
  let totalProcessed = 0;
  let finished = false;
  let iteration = 0;

  while (!finished && iteration < maxIterations) {
    if (Date.now() - startedAt >= maxMs) {
      await releaseJobState(sheets, spreadsheetId, jobControl, 'idle');
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
        enableStartStatus: iteration === 1,
        jobControl
      });
      console.log('[diagnostic] runUpdateJob result', { iteration, result });
    } catch (error) {
      if (String(error && error.code || '') === 'JOB_INTERRUPTED') {
        console.log('[diagnostic] runUpdateJob interrupted by newer job at iteration', iteration);
        await releaseJobState(sheets, spreadsheetId, jobControl, 'idle');
        return {
          ok: true,
          finished: false,
          reason: 'restarted_by_newer_job',
          iterations: iteration - 1,
          totalProcessed,
          batchSize
        };
      }

      const msg = String(error && (error.message || error.code || error.status) || '').toLowerCase();
      const isQuota = msg.includes('quota exceeded') || msg.includes('resource_exhausted') || String(error && error.status) === '429' || String(error && error.code) === '429';

      if (isQuota) {
        await releaseJobState(sheets, spreadsheetId, jobControl, 'idle');
        return {
          ok: true,
          finished: false,
          reason: 'quota_exceeded',
          iterations: iteration,
          totalProcessed,
          batchSize
        };
      }

      await releaseJobState(sheets, spreadsheetId, jobControl, 'idle');
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
      await releaseJobState(sheets, spreadsheetId, jobControl, 'idle');
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

    const active = await assertJobStateActive(sheets, spreadsheetId, jobControl);
    console.log('[diagnostic] assertJobStateActive', { iteration, active });
    if (!active.active) {
      console.log('[diagnostic] job no longer active, stopping', { iteration });
      await releaseJobState(sheets, spreadsheetId, jobControl, 'idle');
      return {
        ok: true,
        finished: false,
        reason: 'restarted_by_newer_job',
        iterations: iteration,
        totalProcessed,
        batchSize
      };
    }

    totalProcessed += Number(result.processed || 0);
    finished = result.finished === true;
  }

  if (!finished) {
    await releaseJobState(sheets, spreadsheetId, jobControl, 'idle');
    return {
      ok: true,
      finished: false,
      reason: 'max_iterations_reached',
      iterations: iteration,
      totalProcessed,
      batchSize
    };
  }

  const supervisorResult = includeSupervisor
    ? await generateBlocosPorGestor(sheets, spreadsheetId)
    : null;

  const dashboardResult = await runDashboardJob({
    includeSupervisor: false,
    includeDashboards,
    jobControl,
    supervisorResult
  });

  if (!dashboardResult || dashboardResult.ok === false) {
    if (dashboardResult && String(dashboardResult.error || '').includes('mais recente')) {
      await releaseJobState(sheets, spreadsheetId, jobControl, 'idle');
      return {
        ok: true,
        finished: false,
        reason: 'restarted_by_newer_job',
        iterations: iteration,
        totalProcessed,
        batchSize
      };
    }

    await releaseJobState(sheets, spreadsheetId, jobControl, 'idle');
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

  await finishJobState(sheets, spreadsheetId, jobControl, 'idle');

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
    const jobControl = options.jobControl || null;

    if (jobControl) {
      const active = await assertJobStateActive(sheets, spreadsheetId, jobControl);
      if (!active.active) {
        return { ok: false, error: 'Job interrompido por uma atualização mais recente.' };
      }
    }

    const results = {};
    const supervisorResult = options.supervisorResult || null;

    if (options.includeSupervisor !== false) {
      results.supervisor = supervisorResult || await generateBlocosPorGestor(sheets, spreadsheetId);
    } else if (supervisorResult) {
      results.supervisor = supervisorResult;
    }

    if (options.includeDashboards !== false) {
      // Use atomic refresh to delete + rewrite all dashboards atomically
      // This prevents partial write errors during dashboard updates
      results.dashboards = await atomicRefreshAllDashboards(sheets, spreadsheetId);
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
