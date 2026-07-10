require('dotenv').config({ path: '.env' });

const { assertCronAuth, sendJson } = require('../../src/core/serverlessJobs');
const { enqueueJob } = require('../../src/services/jobQueue');
const { readJobState } = require('../../src/core/jobStateSupabase');

function getQueryValue(urlValue, key) {
  try {
    const rawUrl = String(urlValue || '/');
    if (rawUrl.startsWith('http')) {
      const url = new URL(rawUrl);
      return url.searchParams.get(key) || '';
    }
    const qIdx = rawUrl.indexOf('?');
    if (qIdx === -1) return '';
    const params = new URLSearchParams(rawUrl.substring(qIdx + 1));
    return params.get(key) || '';
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
    const batchSizeRaw = (req && req.query && req.query.batchSize) || getQueryValue(req && req.url, 'batchSize') || process.env.UPDATE_BATCH_SIZE || 20;
    const batchSize = Math.max(5, Number(batchSizeRaw));

    const resetRaw = (req && req.query && req.query.reset) || getQueryValue(req && req.url, 'reset');
    let resetCursor = String(resetRaw || '').toLowerCase() === '1' || String(resetRaw || '').toLowerCase() === 'true';

    const dbOnlyRaw = (req && req.query && req.query.databaseOnly) || getQueryValue(req && req.url, 'databaseOnly');
    const databaseOnly = String(dbOnlyRaw || '').toLowerCase() === '1' || String(dbOnlyRaw || '').toLowerCase() === 'true';

    const triggeredByRaw = (req && req.query && req.query.triggered_by) || getQueryValue(req && req.url, 'triggered_by') || 'cron';

    // Se o job_state anterior está "done" ou com cursor >= totalClients, este novo job precisa resetar o cursor
    // para processar todos os clientes novamente. Sem isso, o job "termina" imediatamente sem atualizar dados.
    // Só fazemos isso se resetCursor não foi explicitamente passed=false pelo caller (mas como default é false,
    // precisamos forçar quando detectamos estado "done" ou cursor exausto).
    if (!resetCursor) {
      try {
        const state = await readJobState();
        const stage = String(state.stage || 'idle');
        const totalClients = Number(state.totalClients) || 0;
        const progressCursor = Number(state.progressCursor) || 0;
        const storedCursor = Number(state.cursor) || 0;
        const effectiveCursor = Math.max(progressCursor, storedCursor);
        const looksDone = stage === 'done' || (totalClients > 0 && effectiveCursor >= totalClients);
        if (looksDone) {
          resetCursor = true;
          console.log('[enqueue] job_state stage=' + stage + ', cursor=' + effectiveCursor + '/' + totalClients + ' — forçando resetCursor=true para reprocessar clientes');
        }
      } catch (e) {
        console.warn('[enqueue] falha ao ler job_state para decisão de reset:', e && e.message);
      }
    }

    const jobOptions = {
      batchSize,
      resetCursor,
      databaseOnly,
      includeSupervisor: !databaseOnly,
      includeDashboards: !databaseOnly
    };

    const job = await enqueueJob({
      triggered_by: String(triggeredByRaw).slice(0, 120),
      options: jobOptions
    });

    return sendJson(res, {
      ok: true,
      message: 'Job enfileirado. O worker do Apps Script processará no próximo tick.',
      enqueued: true,
      jobId: job.id,
      options: jobOptions
    }, 202);
  } catch (error) {
    console.error('❌ Erro no enqueue:', error);
    return sendJson(res, { ok: false, error: error && error.message ? error.message : 'Erro ao enfileirar' }, 500);
  }
};
