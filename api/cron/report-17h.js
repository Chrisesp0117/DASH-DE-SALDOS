require('dotenv').config({ path: '.env' });

const { assertCronAuth, runReportJob } = require('../../src/core/serverlessJobs');

module.exports = async (req, res) => {
  if (!assertCronAuth(req, res)) {
    return;
  }

  try {
    const report = await runReportJob({ alertTitle: '🌆 ALERTA 17h' });

    return res.status(200).json({ ok: true, message: 'Relatório das 17h enviado' });
  } catch (error) {
    console.error('❌ Erro no cron das 17h:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
};
