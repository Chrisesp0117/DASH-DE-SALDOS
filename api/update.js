require('dotenv').config({ path: '.env' });

const { assertCronAuth, sendJson, runUpdateJob } = require('../src/core/serverlessJobs');

module.exports = async (req, res) => {
  const authResponse = assertCronAuth(req, res);
  if (authResponse) {
    return authResponse;
  }

  try {
    const batchSize = Number(req.query?.batchSize || process.env.UPDATE_BATCH_SIZE || 3);
    const result = await runUpdateJob({ batchSize });
    return sendJson(res, { ok: true, message: 'Planilha atualizada com sucesso', batchSize, result }, 200);
  } catch (error) {
    console.error('❌ Erro no update serverless:', error);
    return sendJson(res, { ok: false, error: error.message }, 500);
  }
};
