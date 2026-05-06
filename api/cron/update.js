require('dotenv').config({ path: '.env' });

const { assertCronAuth, sendJson, runUpdateJob } = require('../../src/core/serverlessJobs');

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
    const rawBatchSize = req.query?.batchSize || getQueryValue(req && req.url, 'batchSize') || process.env.UPDATE_BATCH_SIZE || 3;
    const batchSize = Math.max(1, Number(rawBatchSize));
    const result = await runUpdateJob({ batchSize });
    return sendJson(res, { ok: true, message: 'Planilha atualizada com sucesso', batchSize, result }, 200);
  } catch (error) {
    console.error('❌ Erro no cron de atualização:', error);
    return sendJson(res, { ok: false, error: error.message }, 500);
  }
};
