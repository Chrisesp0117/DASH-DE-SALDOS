require('dotenv').config({ path: '.env' });

const { assertCronAuth, sendJson, runReportJob } = require('../src/core/serverlessJobs');

module.exports = async (req, res) => {
  const authResponse = assertCronAuth(req, res);
  if (authResponse) {
    return authResponse;
  }

  try {
    const report = await runReportJob();
    return sendJson(res, { ok: true, message: 'Relatório enviado', report }, 200);
  } catch (error) {
    console.error('❌ Erro no report serverless:', error);
    return sendJson(res, { ok: false, error: error.message }, 500);
  }
};
