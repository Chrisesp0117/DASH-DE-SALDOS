require('dotenv').config({ path: '.env' });

const axios = require('axios');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const vercelUrl = process.env.VERCEL_URL;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET || '';

  if (!token) {
    return res.status(400).json({ ok: false, error: 'TELEGRAM_BOT_TOKEN não configurado' });
  }

  if (!vercelUrl) {
    return res.status(400).json({ ok: false, error: 'VERCEL_URL não disponível' });
  }

  const webhookUrl = `https://${vercelUrl}/api/telegram`;

  try {
    const payload = {
      url: webhookUrl,
      secret_token: secret || undefined,
      drop_pending_updates: true
    };

    const response = await axios.post(`https://api.telegram.org/bot${token}/setWebhook`, payload);

    return res.status(200).json({
      ok: true,
      webhookUrl,
      telegram: response.data
    });
  } catch (error) {
    console.error('❌ Erro ao configurar webhook:', error.response ? error.response.data : error.message);
    return res.status(500).json({
      ok: false,
      error: error.response ? error.response.data : error.message
    });
  }
};
