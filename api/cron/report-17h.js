require('dotenv').config({ path: '.env' });

const { assertCronAuth, sendJson, runReportJob } = require('../../src/core/serverlessJobs');

module.exports = async (req, res) => {
  const authResponse = assertCronAuth(req, res);
  if (authResponse) {
    return authResponse;
  }

  try {
    await runReportJob({ alertTitle: '🌆 ALERTA 17h' });

    return sendJson(res, { ok: true, message: 'Relatório das 17h enviado' }, 200);
  } catch (error) {
    console.error('❌ Erro no cron das 17h:', error);
    return sendJson(res, { ok: false, error: error.message }, 500);
  }
};
