require('dotenv').config({ path: '.env' });

const { assertCronAuth, runUpdateJob } = require('../src/core/serverlessJobs');

module.exports = async (req, res) => {
  if (!assertCronAuth(req, res)) {
    return;
  }

  try {
    const batchSize = Number(req.query?.batchSize || process.env.UPDATE_BATCH_SIZE || 3);
    await runUpdateJob({ batchSize });
    return res.status(200).json({ ok: true, message: 'Planilha atualizada com sucesso', batchSize });
  } catch (error) {
    console.error('❌ Erro no update serverless:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
};
