require('dotenv').config({ path: '.env' });

const { assertCronAuth, sendJson, runDashboardJob } = require('../../src/core/serverlessJobs');

module.exports = async (req, res) => {
  const authResponse = assertCronAuth(req, res);
  if (authResponse) {
    return authResponse;
  }

  try {
    const result = await runDashboardJob({
      includeSupervisor: true,
      includeDashboards: true,
      triggeredBy: 'cron'
    });

    return sendJson(res, {
      ok: true,
      message: 'Dashboards e blocos atualizados com sucesso',
      result
    }, 200);
  } catch (error) {
    console.error('❌ Erro no cron dashboards:', error);
    return sendJson(res, { ok: false, error: error.message }, 500);
  }
};
