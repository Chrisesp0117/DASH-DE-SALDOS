require('dotenv').config({ path: '.env' });

const { assertCronAuth, runUpdateJob } = require('../src/core/serverlessJobs');

module.exports = async (req, res) => {
  if (!assertCronAuth(req, res)) {
    return;
  }

  try {
    await runUpdateJob();
    return res.status(200).json({ ok: true, message: 'Planilha atualizada com sucesso' });
  } catch (error) {
    console.error('❌ Erro no update serverless:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
};
