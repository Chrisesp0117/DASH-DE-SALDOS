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
} = require('./jobState');
const { run } = require('../run');
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

function getRequestBaseUrl(req) {
  const forwardedHost = String(readHeader(req, 'x-forwarded-host') || '').trim();
  const host = forwardedHost || String(readHeader(req, 'host') || '').trim();
  if (!host) return '';

  const forwardedProto = String(readHeader(req, 'x-forwarded-proto') || '').trim().toLowerCase();
  const proto = forwardedProto === 'http' || forwardedProto === 'https' ? forwardedProto : 'https';
  return `${proto}://${host}`;
}

async function triggerNextCycle(req, options = {}) {
  const autoEnabled = String(process.env.AUTO_CHAIN_ENABLED || '1').trim().toLowerCase() !== '0';
  if (!autoEnabled) {
    return { scheduled: false, reason: 'auto_chain_disabled' };
  }

  if (typeof fetch !== 'function') {
    return { scheduled: false, reason: 'fetch_unavailable' };
  }

  const expectedSecret = String(process.env.CRON_SECRET || '').trim();
  if (!expectedSecret) {
    return { scheduled: false, reason: 'missing_cron_secret' };
  }

  const incomingDepth = Number(readHeader(req, 'x-auto-chain-depth') || 0);
  const depth = Number.isFinite(incomingDepth) && incomingDepth >= 0 ? incomingDepth : 0;
  // Permite mais elos para que a atualização manual não pare cedo demais em bases maiores.
  const maxDepth = Math.max(0, Number(process.env.AUTO_CHAIN_MAX_DEPTH || 25));
  if (depth >= maxDepth) {
    return { scheduled: false, reason: 'max_depth_reached', depth, maxDepth };
  }

  const baseUrl = getRequestBaseUrl(req);
  if (!baseUrl) {
    return { scheduled: false, reason: 'missing_host' };
  }

  const path = String(options.path || '/api/cron/update-full');
  const query = options.query || {};
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || String(value) === '') return;
    params.set(key, String(value));
  });

  const targetUrl = `${baseUrl}${path}${params.toString() ? `?${params.toString()}` : ''}`;
  const timeoutMs = Math.max(1000, Number(process.env.AUTO_CHAIN_FETCH_TIMEOUT_MS || 5000));
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeout = setTimeout(() => {
    if (controller) {
      controller.abort();
    }
  }, timeoutMs);

  try {
    await fetch(targetUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'x-cron-secret': expectedSecret,
        'x-auto-chain': '1',
        'x-auto-chain-depth': String(depth + 1)
      },
      cache: 'no-store',
      signal: controller ? controller.signal : undefined
    });

    return {
      scheduled: true,
      reason: 'triggered',
      depth: depth + 1,
      maxDepth
    };
  } catch (error) {
    return {
      scheduled: false,
      reason: error && error.name === 'AbortError' ? 'request_timeout' : 'request_error',
      error: error && error.message ? error.message : String(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runUpdateJob(options = {}) {
  return run({
    skipDashboards: true,
    includeSupervisorAgg: options.includeSupervisorAgg !== false,
    ...options
  });
}

async function runFullUpdateJob(options = {}) {
  const batchSize = Math.max(5, Number(options.batchSize || process.env.UPDATE_BATCH_SIZE || 10));
  const includeDashboards = options.includeDashboards !== false;
  const includeSupervisor = options.includeSupervisor !== false;
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
      resetCursor,
      owner: options.owner
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
  const startTime = Date.now();
  const maxMs = Math.max(10000, Number(options.maxMs || process.env.CRON_MAX_RUNTIME_MS || 150000));
  let iterations = 0;
  let totalProcessed = 0;
  let result = null;

  console.log(`[runFullUpdateJob] Starting loop with maxMs=${maxMs}, jobId=${jobControl.jobId}, generation=${jobControl.generation}`);

  while (true) {
    const elapsed = Date.now() - startTime;
    console.log(`[runFullUpdateJob-loop] iterations=${iterations}, elapsed=${elapsed}ms/${maxMs}ms, totalProcessed=${totalProcessed}`);
    
    if (elapsed >= maxMs) {
      console.warn(`[runFullUpdateJob] TIMEOUT! elapsed=${elapsed}ms >= maxMs=${maxMs}ms, iterations=${iterations}, totalProcessed=${totalProcessed}, result.nextCursor=${result?.nextCursor}`);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      // Importante: atualizar o cursor ANTES de liberar o lock
      if (result && result.nextCursor !== undefined) {
        try {
          console.log(`[runFullUpdateJob] Saving cursor on timeout: nextCursor=${result.nextCursor}, total=${result.total}`);
          await touchJobState(sheets, spreadsheetId, jobControl, {
            cursor: result.nextCursor,
            progressCursor: result.nextCursor,
            totalClients: result.total,
            stage: 'database',
            lastAction: 'timeout_save_cursor'
          });
          console.log(`[runFullUpdateJob] Cursor saved successfully`);
        } catch (e) {
          console.warn('[runFullUpdateJob] falha ao salvar cursor antes do timeout:', e && e.message);
        }
      }
      await releaseJobState(sheets, spreadsheetId, jobControl, 'idle');
      console.log(`[runFullUpdateJob] Released job lock, returning time_budget_reached`);
      return {
        ok: true,
        finished: false,
        reason: 'time_budget_reached',
        iterations,
        totalProcessed,
        batchSize
      };
    }

    try {
      const preRunTime = Date.now();
      result = await runUpdateJob({
        batchSize,
        includeSupervisorAgg: includeSupervisor,
        jobControl
      });
      const postRunTime = Date.now();
      const runMs = postRunTime - preRunTime;
      console.log(`[runFullUpdateJob] runUpdateJob duration=${runMs}ms, result.ok=${result?.ok}, result.finished=${result?.finished}, processed=${result?.processed}`);
    } catch (error) {
      if (String(error && error.code || '') === 'JOB_INTERRUPTED') {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        await releaseJobState(sheets, spreadsheetId, jobControl, 'idle');
        return {
          ok: true,
          finished: false,
          reason: 'restarted_by_newer_job',
          iterations,
          totalProcessed,
          batchSize
        };
      }

      const msg = String(error && (error.message || error.code || error.status) || '').toLowerCase();
      const isQuota = msg.includes('quota exceeded') || msg.includes('resource_exhausted') || String(error && error.status) === '429' || String(error && error.code) === '429';

      if (heartbeatTimer) clearInterval(heartbeatTimer);
      // Importante: atualizar o cursor ANTES de liberar o lock
      if (result && result.nextCursor !== undefined) {
        try {
          await touchJobState(sheets, spreadsheetId, jobControl, {
            cursor: result.nextCursor,
            totalClients: result.total,
            stage: 'database',
            lastAction: 'error_save_cursor'
          });
        } catch (e) {
          console.warn('[runFullUpdateJob] falha ao salvar cursor antes de erro:', e && e.message);
        }
      }
      await releaseJobState(sheets, spreadsheetId, jobControl, 'idle');

      return {
        ok: isQuota ? true : false,
        finished: false,
        reason: isQuota ? 'quota_exceeded' : 'update_failed',
        iterations,
        totalProcessed,
        batchSize,
        error: isQuota ? undefined : (error && error.message ? error.message : 'Execução falhou')
      };
    }

    if (!result || !result.ok) {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      // Importante: atualizar o cursor ANTES de liberar o lock
      if (result && result.nextCursor !== undefined) {
        try {
          await touchJobState(sheets, spreadsheetId, jobControl, {
            cursor: result.nextCursor,
            totalClients: result.total,
            stage: 'database',
            lastAction: 'failure_save_cursor'
          });
        } catch (e) {
          console.warn('[runFullUpdateJob] falha ao salvar cursor antes de falha:', e && e.message);
        }
      }
      await releaseJobState(sheets, spreadsheetId, jobControl, 'idle');
      return {
        ok: false,
        finished: false,
        reason: 'update_failed',
        iterations,
        totalProcessed,
        batchSize,
        error: result && result.error ? result.error : 'Execução falhou'
      };
    }

    iterations++;
    totalProcessed += Number(result.processed || 0);

    if (result.finished === true) {
      break;
    }
  }

  let supervisorResult = null;

  if (includeSupervisor) {
    try {
      await touchJobState(sheets, spreadsheetId, jobControl, { stage: 'supervisor', lastAction: 'pre_supervisor' });
    } catch (e) { }

    supervisorResult = await generateBlocosPorGestor(sheets, spreadsheetId);
  }

  // Verifica se ainda há tempo suficiente para gerar dashboards.
  // Se não houver, salva o estado e libera o lock para que outro ciclo possa continuar.
  try {
    const elapsedAfterSupervisor = Date.now() - startTime;
    const remainingMsAfterSupervisor = maxMs - elapsedAfterSupervisor;
    // Reserve pelo menos 40s para a atualização de dashboards (ajustável)
    if (includeDashboards && remainingMsAfterSupervisor < 40000) {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      try {
        await touchJobState(sheets, spreadsheetId, jobControl, { stage: 'dashboards_pending', lastAction: 'insufficient_time_for_dashboards' });
      } catch (e) { }
      await releaseJobState(sheets, spreadsheetId, jobControl, 'idle');
      return {
        ok: true,
        finished: false,
        reason: 'insufficient_time_for_dashboards',
        iterations,
        totalProcessed,
        batchSize
      };
    }
  } catch (e) { /* ignora erros nessa verificação */ }

  try {
    await touchJobState(sheets, spreadsheetId, jobControl, { stage: 'dashboards', lastAction: 'pre_dashboards' });
  } catch (e) { }

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
        iterations: 1,
        totalProcessed: Number(result && result.processed || 0),
        batchSize
      };
    }

    if (heartbeatTimer) clearInterval(heartbeatTimer);
    await releaseJobState(sheets, spreadsheetId, jobControl, 'idle');
    return {
      ok: false,
      finished: true,
      reason: 'dashboard_failed',
      iterations,
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
    iterations,
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


module.exports = {
  assertCronAuth,
  getCronSecretFromRequest,
  triggerNextCycle,
  sendJson,
  runUpdateJob,
  runFullUpdateJob,
  runDashboardJob,
  runReportJob
};
