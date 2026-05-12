const { getSheets } = require('../services/sheets');
const {
  run,
  acquireJobStateLock,
  assertJobStateActive,
  finishJobState,
  releaseJobState,
  readJobState,
  touchJobState,
  startHeartbeatTimer,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_STALE_THRESHOLD_MS
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

function getJobLockMeta(state) {
  const now = Date.now();
  const leaseUntil = Number(state && state.leaseUntil || 0);
  const heartbeatAt = state && state.heartbeatAt ? Date.parse(state.heartbeatAt) : 0;
  const heartbeatAgeMs = heartbeatAt > 0 ? Math.max(0, now - heartbeatAt) : null;
  const staleByHeartbeat = heartbeatAgeMs !== null && heartbeatAgeMs > HEARTBEAT_STALE_THRESHOLD_MS;
  const status = String(state && state.status || '').trim();
  const leaseActive = leaseUntil > now;
  const running = status === 'running' && leaseActive && !staleByHeartbeat;

  return {
    running,
    leaseActive,
    staleByHeartbeat,
    heartbeatAgeMs,
    leaseRemainingMs: Math.max(0, leaseUntil - now)
  };
}

function getCronSecretFromRequest(req) {
  const urlSecret = (() => {
    try {
      const rawUrl = String(req && req.url || '/');
      let url;
      if (rawUrl.startsWith('http')) {
        url = new URL(rawUrl);
      } else {
        const qIdx = rawUrl.indexOf('?');
        if (qIdx === -1) {
          return '';
        }
        const queryString = rawUrl.substring(qIdx + 1);
        const params = new URLSearchParams(queryString);
        return params.get('secret') || params.get('token') || '';
      }
      return url.searchParams.get('secret') || url.searchParams.get('token') || '';
    } catch (_) {
      return '';
    }
  })();

  const headerSecret = readHeader(req, 'x-cron-secret');
  const querySecret = req && req.query ? (req.query.secret || req.query.token) : '';

  return (
    headerSecret ||
    readHeader(req, 'x-cron-job-secret') ||
    querySecret ||
    urlSecret ||
    ''
  );
}

function assertCronAuth(req, res) {
  const expected = process.env.CRON_SECRET || '';

  if (!expected) {
    console.warn('⚠️ CRON_SECRET não configurado no ambiente');
    return null;
  }

  const incoming = String(getCronSecretFromRequest(req) || '').trim();
  const isVercelCron = String(readHeader(req, 'x-vercel-cron') || '').trim().toLowerCase() === '1'
    || String(readHeader(req, 'x-vercel-cron') || '').trim().toLowerCase() === 'true';

  if (incoming !== expected && !isVercelCron) {
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
  const batchSize = Math.max(1, Number(options.batchSize || process.env.UPDATE_BATCH_SIZE || 50));
  const maxIterations = Math.max(1, Number(options.maxIterations || process.env.UPDATE_MAX_ITERATIONS || 10));
  const maxMs = Math.max(5000, Number(options.maxMs || process.env.CRON_MAX_RUNTIME_MS || 120000));
  const includeSupervisor = options.includeSupervisor !== false;
  const includeDashboards = options.includeDashboards !== false;
  const rejectIfRunning = options.rejectIfRunning !== false;
  const force = options.force === true;
  const resetCursor = options.resetCursor === true;

  const sheets = await getSheets();
  const spreadsheetId = process.env.SPREADSHEET_ID;

  if (rejectIfRunning && !force) {
    const current = await readJobState(sheets, spreadsheetId);
    const lockMeta = getJobLockMeta(current);
    if (lockMeta.running) {
      return {
        ok: false,
        running: true,
        lockState: lockMeta.staleByHeartbeat ? 'active_stale' : 'active',
        heartbeatAgeMs: lockMeta.heartbeatAgeMs,
        leaseRemainingMs: lockMeta.leaseRemainingMs,
        staleByHeartbeat: lockMeta.staleByHeartbeat,
        reason: 'job_already_running',
        state: current
      };
    }
  }
  let jobControl;
  try {
    jobControl = await acquireJobStateLock(sheets, spreadsheetId, {
      leaseMs: 60000,
      resetCursor
    });
    console.log('[diagnostic] acquired job lock', { jobId: jobControl.jobId, generation: jobControl.generation, leaseUntil: jobControl.leaseUntil });
  } catch (e) {
    if (e && e.code === 'JOB_ALREADY_RUNNING' && e.state) {
      return {
        ok: false,
        running: true,
        reason: 'job_already_running',
        state: e.state
      };
    }
    throw e;
  }

  const heartbeatTimer = await startHeartbeatTimer(sheets, spreadsheetId, jobControl, DEFAULT_HEARTBEAT_INTERVAL_MS);

  const startedAt = Date.now();
  let totalProcessed = 0;
  let finished = false;
  let iteration = 0;

  while (!finished && iteration < maxIterations) {
    if (Date.now() - startedAt >= maxMs) {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
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
        if (heartbeatTimer) clearInterval(heartbeatTimer);
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
        if (heartbeatTimer) clearInterval(heartbeatTimer);
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

      if (heartbeatTimer) clearInterval(heartbeatTimer);
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
      if (heartbeatTimer) clearInterval(heartbeatTimer);
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
      if (heartbeatTimer) clearInterval(heartbeatTimer);
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
    if (heartbeatTimer) clearInterval(heartbeatTimer);
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

  try {
    await touchJobState(sheets, spreadsheetId, jobControl, { stage: 'supervisor', lastAction: 'pre_supervisor' });
  } catch (e) { /* best-effort */ }

  const supervisorResult = includeSupervisor
    ? await generateBlocosPorGestor(sheets, spreadsheetId)
    : null;

  try {
    await touchJobState(sheets, spreadsheetId, jobControl, { stage: 'dashboards', lastAction: 'pre_dashboards' });
  } catch (e) { /* best-effort */ }

  const dashboardResult = await runDashboardJob({
    includeSupervisor: false,
    includeDashboards,
    jobControl,
    supervisorResult
  });

  if (!dashboardResult || dashboardResult.ok === false) {
    if (dashboardResult && String(dashboardResult.error || '').includes('mais recente')) {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
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

    if (heartbeatTimer) clearInterval(heartbeatTimer);
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

  if (heartbeatTimer) clearInterval(heartbeatTimer);
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
