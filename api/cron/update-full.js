require('dotenv').config({ path: '.env' });

const { assertCronAuth, sendJson, runFullUpdateJob } = require('../../src/core/serverlessJobs');

function getQueryValue(urlValue, key) {
  try {
    const base = 'https://dash-de-saldos.vercel.app';
    const url = new URL(String(urlValue || '/'), base);
    return url.searchParams.get(key) || '';
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
    const rawBatchSize = req.query?.batchSize || getQueryValue(req && req.url, 'batchSize') || process.env.UPDATE_BATCH_SIZE || 5;
    const batchSize = Math.max(5, Number(rawBatchSize));
    const maxMs = Math.max(10000, Number(process.env.CRON_MAX_RUNTIME_MS || 45000));

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
          ok: false,
          running: true,
          reason: result.reason || 'job_already_running'
        }, 409);
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

    return sendJson(res, {
      ok: true,
      message: 'Parcial: limite da função atingido; continuará no próximo agendamento',
      finished: false,
      reason: result.reason || 'time_budget_reached',
      iterations: result.iterations,
      totalProcessed: result.totalProcessed,
      batchSize,
      resetCursor,
      databaseOnly
    }, 200);
  } catch (error) {
    console.error('❌ Erro no cron update-full:', error);
    return sendJson(res, { ok: false, error: error.message }, 500);
  }
};
