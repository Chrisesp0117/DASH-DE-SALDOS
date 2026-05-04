require('dotenv').config({ path: '.env' });

const { getSheets } = require('../../src/services/sheets');
const { initTelegramBot, broadcastAlert } = require('../../src/services/telegram');
const { generateReport } = require('../../src/core/reportGenerator');

module.exports = async (req, res) => {
  try {
    const sheets = await getSheets();
    initTelegramBot(sheets, process.env.SPREADSHEET_ID);
    const report = await generateReport(sheets, process.env.SPREADSHEET_ID);
    await broadcastAlert(`<b>🌅 ALERTA 8h</b>\n\n${report}`);

    return res.status(200).json({ ok: true, message: 'Relatório das 8h enviado' });
  } catch (error) {
    console.error('❌ Erro no cron das 8h:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
};
