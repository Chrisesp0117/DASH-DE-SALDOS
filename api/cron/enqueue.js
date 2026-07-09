require('dotenv').config({ path: '.env' });

const { assertCronAuth, sendJson } = require('../../src/core/serverlessJobs');
const { enqueueJob } = require('../../src/services/jobQueue');

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
    const resetCursor = String(resetRaw || '').toLowerCase() === '1' || String(resetRaw || '').toLowerCase() === 'true';

    const dbOnlyRaw = (req && req.query && req.query.databaseOnly) || getQueryValue(req && req.url, 'databaseOnly');
    const databaseOnly = String(dbOnlyRaw || '').toLowerCase() === '1' || String(dbOnlyRaw || '').toLowerCase() === 'true';

    const triggeredByRaw = (req && req.query && req.query.triggered_by) || getQueryValue(req && req.url, 'triggered_by') || 'cron';

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
