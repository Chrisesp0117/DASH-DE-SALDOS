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
    
    let totalProcessed = 0;
    let finished = false;
    const maxIterations = 1000; // safety limit
    let iteration = 0;

    // Executa lotes até o fim (finished=true)
    while (!finished && iteration < maxIterations) {
      iteration++;
      const result = await runUpdateJob({ batchSize });
      
      if (!result || !result.ok) {
        return sendJson(res, { ok: false, error: 'Execução falhou', iteration, totalProcessed }, 500);
      }

      totalProcessed += Number(result.processed || 0);
      finished = result.finished === true;

      if (!finished) {
        console.log(`Iteração ${iteration}: processed=${result.processed}, nextCursor=${result.nextCursor}/${result.total}`);
      }
    }

    return sendJson(res, { 
      ok: true, 
      message: 'Execução completa finalizada com sucesso', 
      iterations: iteration,
      totalProcessed,
      batchSize
    }, 200);
  } catch (error) {
    console.error('❌ Erro no cron update-full:', error);
    return sendJson(res, { ok: false, error: error.message }, 500);
  }
};
