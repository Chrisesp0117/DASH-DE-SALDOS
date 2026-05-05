require('dotenv').config({ path: '.env' });

const { assertCronAuth, runReportJob } = require('../src/core/serverlessJobs');

module.exports = async (req, res) => {
  if (!assertCronAuth(req, res)) {
    return;
  }

  try {
    const report = await runReportJob();
    return res.status(200).json({ ok: true, message: 'Relatório enviado', report });
  } catch (error) {
    console.error('❌ Erro no report serverless:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
};
