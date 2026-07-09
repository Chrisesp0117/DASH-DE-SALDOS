const { getSheets } = require('../services/sheets');
const {
  acquireJobStateLock,
  assertJobStateActive,
  finishJobState,
  releaseJobState,
  readJobState,
  touchJobState,
  startHeartbeatTimer,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_STALE_THRESHOLD_MS,
  getJobLockMeta
} = require('./jobStateSupabase');
const { run } = require('../run');
const { generateBlocosPorGestor } = require('./visualBlocks');
const { ensureDashboardsForAllGestores, atomicRefreshAllDashboards } = require('./gestorDashboards');
const { generateReport } = require('./reportGenerator');
const VERCEL_HARD_LIMIT_MS = 180000;
const SAFETY_MARGIN_MS = 30000;
const DEFAULT_SAFE_MAX_MS = VERCEL_HARD_LIMIT_MS - SAFETY_MARGIN_MS;
function getSafeMaxMs(value) {
  const parsed = Number(value);
  const fallback = Number(process.env.CRON_MAX_RUNTIME_MS || DEFAULT_SAFE_MAX_MS);
  const raw = Number.isFinite(parsed) && parsed >= 10000 ? parsed : fallback;
  return Math.max(10000, Math.min(raw, DEFAULT_SAFE_MAX_MS));
}

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
      const active = await assertJobStateActive(jobControl);
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
      results.dashboards = await atomicRefreshAllDashboards(sheets, spreadsheetId, {
        supervisorResult: results.supervisor
      });
    }
    return { ok: true, ...results };
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : 'Erro ao gerar dashboards'
    };
  }
}

/**
 * runQueuedUpdateJob
 *
 * Job principal do fluxo de fila (formato A).
 * Características:
 *  - Não usa auto-chain (sem fetch recursivo). O worker Apps Script a cada 1 min
 *    chama este endpoint novamente para continuar do cursor salvo no job_state.
 *  - Recebe jobQueueId para que o caller marque complete/fail/reenqueue na job_queue.
 *  - Retorna finished=false quando esgota o tempo (reason='time_budget_reached'),
 *    e o caller decide re-enfileirar.
 */
async function runQueuedUpdateJob(options = {}) {
  const batchSize = Math.max(5, Number(options.batchSize || process.env.UPDATE_BATCH_SIZE || 10));
  const includeDashboards = options.includeDashboards !== false;
  const includeSupervisor = options.includeSupervisor !== false;
  const force = options.force === true;
  const resetCursor = options.resetCursor === true;
  const jobQueueId = options.jobQueueId || null;
  if (force === false) {
    const current = await readJobState();
    const lockMeta = getJobLockMeta(current);
    if (lockMeta.running) {
      // Já há um job rodando (provavelmente de outro claim concorrente).
      // O caller deve re-enfileirar este item se quiser tentar depois.
      return {
        ok: false,
        running: true,
        reason: 'job_already_running',
        state: current,
        shouldReenqueue: true
      };
    }
  }
  let jobControl;
  try {
    jobControl = await acquireJobStateLock({
      leaseMs: 60000,
      resetCursor,
      owner: options.owner || (jobQueueId ? 'queue#' + jobQueueId : undefined),
      force
    });
    console.log('[runQueuedUpdateJob] acquired lock', { jobId: jobControl.jobId, generation: jobControl.generation, jobQueueId });
  } catch (e) {
    if (e && e.code === 'JOB_ALREADY_RUNNING' && e.state) {
      return { ok: false, running: true, reason: 'job_already_running', state: e.state, shouldReenqueue: true };
    }
    throw e;
  }
  const heartbeatTimer = await startHeartbeatTimer(jobControl, DEFAULT_HEARTBEAT_INTERVAL_MS);
  const startTime = Date.now();
  const maxMs = getSafeMaxMs(options.maxMs);
  let iterations = 0;
  let totalProcessed = 0;
  let result = null;
  console.log(`[runQueuedUpdateJob] start maxMs=${maxMs}, jobQueueId=${jobQueueId}, jobId=${jobControl.jobId}`);
  while (true) {
    const elapsed = Date.now() - startTime;
    if (elapsed >= maxMs) {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (result && result.nextCursor !== undefined) {
        try {
          await touchJobState(jobControl, {
            cursor: result.nextCursor,
            progressCursor: result.nextCursor,
            totalClients: result.total,
            stage: 'database',
            lastAction: 'timeout_save_cursor'
          });
        } catch (e) {
          console.warn('[runQueuedUpdateJob] falha ao salvar cursor antes do timeout:', e && e.message);
        }
      }
      await releaseJobState(jobControl, 'idle');
      return {
        ok: true,
        finished: false,
        reason: 'time_budget_reached',
        iterations,
        totalProcessed,
        batchSize,
        jobQueueId,
        shouldReenqueue: true
      };
    }
    try {
      result = await runUpdateJob({
        batchSize,
        includeSupervisor,
        jobControl
      });
    } catch (error) {
      if (String(error && error.code || '') === 'JOB_INTERRUPTED') {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        await releaseJobState(jobControl, 'idle');
        return {
          ok: true,
          finished: false,
          reason: 'restarted_by_newer_job',
          iterations,
          totalProcessed,
          batchSize,
          jobQueueId,
          shouldReenqueue: true
        };
      }
      const msg = String(error && (error.message || error.code || error.status) || '').toLowerCase();
      const isQuota = msg.includes('quota exceeded') || msg.includes('resource_exhausted') || String(error && error.status) === '429' || String(error && error.code) === '429';
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (result && result.nextCursor !== undefined) {
        try {
          await touchJobState(jobControl, {
            cursor: result.nextCursor,
            totalClients: result.total,
            stage: 'database',
            lastAction: 'error_save_cursor'
          });
        } catch (e) {
          console.warn('[runQueuedUpdateJob] falha ao salvar cursor antes de erro:', e && e.message);
        }
      }
      await releaseJobState(jobControl, 'idle');
      return {
        ok: isQuota ? true : false,
        finished: false,
        reason: isQuota ? 'quota_exceeded' : 'update_failed',
        iterations,
        totalProcessed,
        batchSize,
        jobQueueId,
        shouldReenqueue: isQuota,
        error: isQuota ? undefined : (error && error.message ? error.message : 'Execução falhou')
      };
    }
    if (!result || !result.ok) {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (result && result.nextCursor !== undefined) {
        try {
          await touchJobState(jobControl, {
            cursor: result.nextCursor,
            totalClients: result.total,
            stage: 'database',
            lastAction: 'failure_save_cursor'
          });
        } catch (e) {
          console.warn('[runQueuedUpdateJob] falha ao salvar cursor antes de falha:', e && e.message);
        }
      }
      await releaseJobState(jobControl, 'idle');
      return {
        ok: false,
        finished: false,
        reason: 'update_failed',
        iterations,
        totalProcessed,
        batchSize,
        jobQueueId,
        shouldReenqueue: false,
        error: result && result.error ? result.error : 'Execução falhou'
      };
    }
    iterations++;
    totalProcessed += Number(result.processed || 0);
    if (result.finished === true) {
      break;
    }
  }
  // DATABASE completa — agora supervisor + dashboards (se inclusos)
  let supervisorResult = null;
  if (includeSupervisor) {
    try {
      await touchJobState(jobControl, { stage: 'supervisor', lastAction: 'pre_supervisor' });
    } catch (e) { }
    supervisorResult = await generateBlocosPorGestor(sheets, spreadsheetId);
  }
  try {
    const elapsedAfterSupervisor = Date.now() - startTime;
    const remainingMsAfterSupervisor = maxMs - elapsedAfterSupervisor;
    if (includeDashboards && remainingMsAfterSupervisor < 40000) {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      try {
        await touchJobState(jobControl, { stage: 'dashboards_pending', lastAction: 'insufficient_time_for_dashboards' });
      } catch (e) { }
      await releaseJobState(jobControl, 'idle');
      return {
        ok: true,
        finished: false,
        reason: 'insufficient_time_for_dashboards',
        iterations,
        totalProcessed,
        batchSize,
        jobQueueId,
        shouldReenqueue: true
      };
    }
  } catch (e) { }
  try {
    await touchJobState(jobControl, { stage: 'dashboards', lastAction: 'pre_dashboards' });
  } catch (e) { }
  const dashboardResult = await runDashboardJob({
    includeSupervisor: false,
    includeDashboards,
    jobControl,
    supervisorResult
  });
  if (!dashboardResult || dashboardResult.ok === false) {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    await releaseJobState(jobControl, 'idle');
    return {
      ok: false,
      finished: true,
      reason: 'dashboard_failed',
      iterations,
      totalProcessed,
      batchSize,
      jobQueueId,
      shouldReenqueue: false,
      dashboardResult
    };
  }
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  await finishJobState(jobControl, 'idle');
  return {
    ok: true,
    finished: true,
    iterations,
    totalProcessed,
    batchSize,
    jobQueueId,
    shouldReenqueue: false,
    dashboardResult
  };
}

module.exports = {
  assertCronAuth,
  getCronSecretFromRequest,
  getSafeMaxMs,
  sendJson,
  runUpdateJob,
  runQueuedUpdateJob,
  runDashboardJob,
  runReportJob
};
