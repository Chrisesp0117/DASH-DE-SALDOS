require('dotenv').config({ path: '.env' });

const axios = require('axios');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const vercelUrl = process.env.VERCEL_URL || req.headers['x-forwarded-host'] || req.headers.host;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET || '';

  if (!token) {
    return res.status(400).json({ ok: false, error: 'TELEGRAM_BOT_TOKEN não configurado' });
  }

  if (!vercelUrl) {
    return res.status(400).json({ ok: false, error: 'VERCEL_URL não disponível' });
  }

  const normalizedHost = String(vercelUrl).replace(/^https?:\/\//, '').replace(/\/$/, '');
  const webhookUrl = `https://${normalizedHost}/api/telegram`;

  try {
    const payload = new URLSearchParams();
    payload.set('url', webhookUrl);
    payload.set('drop_pending_updates', 'true');

    if (secret) {
      payload.set('secret_token', secret);
    }

    const response = await axios.post(
      `https://api.telegram.org/bot${token}/setWebhook`,
      payload.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

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
