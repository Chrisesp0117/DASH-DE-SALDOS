require('dotenv').config({ path: '.env' });

const { assertCronAuth, sendJson, runUpdateJob } = require('../../src/core/serverlessJobs');

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
    const rawBatchSize = req.query?.batchSize || getQueryValue(req && req.url, 'batchSize') || process.env.UPDATE_BATCH_SIZE || 3;
    const batchSize = Math.max(1, Number(rawBatchSize));
    const result = await runUpdateJob({ batchSize });
    return sendJson(res, { ok: true, message: 'Planilha atualizada com sucesso', batchSize, result }, 200);
  } catch (error) {
    console.error('❌ Erro no cron de atualização:', error);
    return sendJson(res, { ok: false, error: error.message }, 500);
  }
};
