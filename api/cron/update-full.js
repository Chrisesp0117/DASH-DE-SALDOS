require('dotenv').config({ path: '.env' });

const { assertCronAuth, sendJson, runFullUpdateJob, triggerNextCycle, getSafeMaxMs } = require('../../src/core/serverlessJobs');

function getQueryValue(urlValue, key) {
  try {
    const rawUrl = String(urlValue || '/');
    // Handle both full URLs and paths
    if (rawUrl.startsWith('http')) {
      const url = new URL(rawUrl);
      return url.searchParams.get(key) || '';
    } else {
      // For paths, use the query string parsing directly
      const qIdx = rawUrl.indexOf('?');
      if (qIdx === -1) return '';
      const queryString = rawUrl.substring(qIdx + 1);
      const params = new URLSearchParams(queryString);
      return params.get(key) || '';
    }
  } catch (_) {
    return '';
  }
}

module.exports = async (req, res) => {
  const authResponse = assertCronAuth(req, res);
  if (authResponse) {
    return authResponse;
  }

  try {
    const rawBatchSize = req.query?.batchSize || getQueryValue(req && req.url, 'batchSize') || process.env.UPDATE_BATCH_SIZE || 20;
    const batchSize = Math.max(5, Number(rawBatchSize));
    // Leave 30s margin for function cleanup before Vercel timeout (maxDuration: 180)
    const maxMs = getSafeMaxMs(process.env.CRON_MAX_RUNTIME_MS);

    const resetRaw = req.query?.reset || getQueryValue(req && req.url, 'reset');
    const resetCursor = String(resetRaw || '').toLowerCase() === '1' || String(resetRaw || '').toLowerCase() === 'true';

    const dbOnlyRaw = req.query?.databaseOnly || getQueryValue(req && req.url, 'databaseOnly');
    const databaseOnly = String(dbOnlyRaw || '').toLowerCase() === '1' || String(dbOnlyRaw || '').toLowerCase() === 'true';

    const result = await runFullUpdateJob({
      batchSize,
      maxMs,
      includeSupervisor: !databaseOnly,
      includeDashboards: !databaseOnly,
      rejectIfRunning: true,
      resetCursor
    });

    if (!result || !result.ok) {
      if (result && result.running) {
        return sendJson(res, {
          ok: true,
          running: true,
          message: 'Job já em andamento; cron pode tentar novamente no próximo ciclo.',
          reason: result.reason || 'job_already_running'
        }, 202);
      }
      return sendJson(res, {
        ok: false,
        error: result && result.error ? result.error : 'Execução falhou'
      }, 500);
    }

    if (result.finished) {
      return sendJson(res, {
        ok: true,
        message: 'Execução completa finalizada com sucesso',
        finished: true,
        iterations: result.iterations,
        totalProcessed: result.totalProcessed,
        batchSize,
        resetCursor,
        databaseOnly,
        dashboards: result.dashboardResult || null
      }, 200);
    }

    let continuation = null;
    const shouldAutoContinue = result.reason === 'time_budget_reached' || result.reason === 'insufficient_time_for_dashboards';
    if (shouldAutoContinue) {
      continuation = await triggerNextCycle(req, {
        path: '/api/cron/update-full',
        query: {
          batchSize,
          reset: '0',
          databaseOnly: databaseOnly ? '1' : '0'
        }
      });
    }

    return sendJson(res, {
      ok: true,
      message: 'Parcial: limite da função atingido; continuará no próximo agendamento',
      finished: false,
      reason: result.reason || 'time_budget_reached',
      iterations: result.iterations,
      totalProcessed: result.totalProcessed,
      batchSize,
      resetCursor,
      databaseOnly,
      continuation
    }, 200);
  } catch (error) {
    console.error('❌ Erro no cron update-full:', error);
    return sendJson(res, { ok: false, error: error.message }, 500);
  }
};
