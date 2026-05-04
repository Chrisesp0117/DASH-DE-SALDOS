const schedule = require('node-schedule');
const { broadcastAlert } = require('../services/telegram');
const { generateReport } = require('./reportGenerator');

let scheduledJobs = [];

function scheduleAlerts(sheets, spreadsheetId, runUpdateFunction) {
  // Cancel existing jobs
  scheduledJobs.forEach(job => job.cancel());
  scheduledJobs = [];

  // Atualizar planilha a cada 2 horas (*/2 = a cada 2 horas)
  const jobUpdate = schedule.scheduleJob('0 */2 * * *', async () => {
    console.log('🔄 Atualizando dados da planilha (a cada 2h)...');
    try {
      if (typeof runUpdateFunction === 'function') {
        await runUpdateFunction();
        console.log('✅ Dados atualizados com sucesso');
      }
    } catch (err) {
      console.error('❌ Erro ao atualizar dados:', err);
    }
  });

  // 8h (08:00) - Enviar relatório
  const job8 = schedule.scheduleJob('0 8 * * *', async () => {
    console.log('⏰ Gerando relatório para 8h...');
    try {
      const report = await generateReport(sheets, spreadsheetId);
      await broadcastAlert(`<b>🌅 ALERTA 8h</b>\n\n${report}`);
    } catch (err) {
      console.error('❌ Erro ao gerar alerta das 8h:', err);
    }
  });

  // 17h (17:00) - Enviar relatório
  const job17 = schedule.scheduleJob('0 17 * * *', async () => {
    console.log('⏰ Gerando relatório para 17h...');
    try {
      const report = await generateReport(sheets, spreadsheetId);
      await broadcastAlert(`<b>🌆 ALERTA 17h</b>\n\n${report}`);
    } catch (err) {
      console.error('❌ Erro ao gerar alerta das 17h:', err);
    }
  });

  scheduledJobs.push(jobUpdate, job8, job17);
  console.log('✅ Agendamentos configurados:');
  console.log('   • Atualização de dados: a cada 2 horas');
  console.log('   • Relatório: 8h e 17h');

  return { jobUpdate, job8, job17 };
}

function stopScheduler() {
  scheduledJobs.forEach(job => job.cancel());
  scheduledJobs = [];
  console.log('⛔ Agendador interrompido');
}

module.exports = {
  scheduleAlerts,
  stopScheduler
};
