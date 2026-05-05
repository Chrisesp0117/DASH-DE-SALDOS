require('dotenv').config({ path: '.env' });

const { getSheets } = require('../src/services/sheets');
const { handleWebhookUpdate } = require('../src/services/telegram');

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, message: 'Telegram webhook endpoint online' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const incomingSecret = req.headers['x-telegram-bot-api-secret-token'];

  if (expectedSecret && incomingSecret !== expectedSecret) {
    return res.status(401).json({ ok: false, error: 'Invalid webhook secret' });
  }

  try {
    const sheets = await getSheets();
    const update = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    console.log('📩 Telegram webhook update received');
    await handleWebhookUpdate(update, sheets, process.env.SPREADSHEET_ID);
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('❌ Erro no webhook Telegram:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
};
