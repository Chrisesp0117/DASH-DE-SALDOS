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
    const rawBatchSize = req.query?.batchSize || getQueryValue(req && req.url, 'batchSize') || process.env.UPDATE_BATCH_SIZE || 5;
    const batchSize = Math.max(5, Number(rawBatchSize));
    const startedAt = Date.now();
    const maxMs = Math.max(10000, Number(process.env.CRON_MAX_RUNTIME_MS || 25000));
    
    let totalProcessed = 0;
    let finished = false;
    const maxIterations = 200; // safety limit
    let iteration = 0;

    // Executa lotes até o fim (finished=true)
    while (!finished && iteration < maxIterations) {
      if (Date.now() - startedAt >= maxMs) {
        return sendJson(res, {
          ok: true,
          message: 'Parcial: limite de tempo da função atingido; continuará no próximo agendamento',
          finished: false,
          reason: 'time_budget_reached',
          iterations: iteration,
          totalProcessed,
          batchSize
        }, 200);
      }

      iteration++;
      let result;
      try {
        result = await runUpdateJob({ batchSize, enableStartStatus: iteration === 1 });
      } catch (error) {
        const msg = String(error && (error.message || error.code || error.status) || '').toLowerCase();
        const isQuota = msg.includes('quota exceeded') || msg.includes('resource_exhausted') || String(error && error.status) === '429' || String(error && error.code) === '429';
        if (isQuota) {
          return sendJson(res, {
            ok: true,
            message: 'Parcial: limite de escrita do Google Sheets atingido; continuará no próximo agendamento',
            finished: false,
            reason: 'quota_exceeded',
            iterations: iteration,
            totalProcessed,
            batchSize
          }, 200);
        }
        throw error;
      }
      
      if (!result || !result.ok) {
        return sendJson(res, { ok: false, error: 'Execução falhou', iteration, totalProcessed }, 500);
      }

      totalProcessed += Number(result.processed || 0);
      finished = result.finished === true;

      if (!finished) {
        console.log(`Iteração ${iteration}: processed=${result.processed}, nextCursor=${result.nextCursor}/${result.total}`);
      }

      if (Date.now() - startedAt >= maxMs) {
        return sendJson(res, {
          ok: true,
          message: 'Parcial: limite de tempo da função atingido; continuará no próximo agendamento',
          finished: false,
          reason: 'time_budget_reached',
          iterations: iteration,
          totalProcessed,
          batchSize
        }, 200);
      }
    }

    return sendJson(res, { 
      ok: true, 
      message: 'Execução completa finalizada com sucesso', 
      finished: true,
      iterations: iteration,
      totalProcessed,
      batchSize
    }, 200);
  } catch (error) {
    console.error('❌ Erro no cron update-full:', error);
    return sendJson(res, { ok: false, error: error.message }, 500);
  }
};
