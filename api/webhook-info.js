require('dotenv').config({ path: '.env' });

const axios = require('axios');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    return res.status(400).json({ ok: false, error: 'TELEGRAM_BOT_TOKEN não configurado' });
  }

  try {
    const response = await axios.get(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    return res.status(200).json({ ok: true, telegram: response.data });
  } catch (error) {
    console.error('❌ Erro ao consultar webhook:', error.response ? error.response.data : error.message);
    return res.status(500).json({
      ok: false,
      error: error.response ? error.response.data : error.message
    });
  }
};