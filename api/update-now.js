/**
 * UPDATE-NOW endpoint:
 * GET /api/update-now?secret=<token>&batchSize=100
 * Dispara atualização no servidor e retorna página com auto-close.
 */

require('dotenv').config({ path: '.env' });

const { runUpdateJob } = require('../src/core/serverlessJobs');

function getQueryValue(urlValue, key) {
  try {
    const base = 'https://dash-de-saldos.vercel.app';
    const url = new URL(String(urlValue || '/'), base);
    return url.searchParams.get(key) || '';
  } catch (_) {
    return '';
  }
}

function sendHtml(res, html, statusCode = 200) {
  if (res && typeof res.status === 'function' && typeof res.send === 'function') {
    return res.status(statusCode).send(html);
  }

  if (res && typeof res.setHeader === 'function' && typeof res.end === 'function') {
    res.statusCode = statusCode;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(html);
    return;
  }

  if (typeof Response !== 'undefined') {
    return new Response(html, {
      status: statusCode,
      headers: { 'content-type': 'text/html; charset=utf-8' }
    });
  }

  return { statusCode, body: html };
}

module.exports = async (req, res) => {
  const secretFromQuery = req && req.query ? String(req.query.secret || '') : getQueryValue(req && req.url, 'secret');
  const secretFromHeader = req && req.headers ? String(req.headers['x-cron-secret'] || '') : '';
  const secret = secretFromQuery || secretFromHeader;
  const expectedSecret = process.env.CRON_SECRET || '';

  if (!expectedSecret || !secret || secret !== expectedSecret) {
    return sendHtml(res, '<h1>401 - Unauthorized</h1>', 401);
  }

  const batchSizeParam = req && req.query ? req.query.batchSize : getQueryValue(req && req.url, 'batchSize');
  const batchSize = Math.max(1, Number(batchSizeParam || 100));

  let ok = true;
  let message = 'Atualização concluída com sucesso.';

  try {
    const result = await runUpdateJob({ batchSize });
    if (!result || !result.ok) {
      ok = false;
      message = 'Atualização retornou status inesperado.';
    } else if (result.finished === false) {
      message = 'Atualização iniciada e parcialmente concluída. Próximos lotes seguirão pelo cron.';
    }
  } catch (error) {
    ok = false;
    message = `Erro ao atualizar: ${error && error.message ? error.message : 'desconhecido'}`;
  }

  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Atualizando Planilha...</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
      padding: 40px;
      text-align: center;
      max-width: 400px;
      width: 100%;
    }
    .spinner {
      width: 50px;
      height: 50px;
      border: 4px solid #f0f0f0;
      border-top: 4px solid #667eea;
      border-radius: 50%;
      margin: 0 auto 20px;
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    h1 {
      color: #333;
      font-size: 24px;
      margin-bottom: 10px;
    }
    .status {
      color: #666;
      font-size: 14px;
      line-height: 1.6;
    }
    .status strong {
      color: #667eea;
    }
    .hidden {
      display: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="spinner"></div>
    <h1>Atualizando Planilha</h1>
    <div class="status">
      <p>${ok ? 'Processo executado.' : 'Falha na execução.'}</p>
      <p><strong>${message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</strong></p>
      <p style="margin-top: 10px; font-size: 12px; color: #999;">Esta janela fechará automaticamente.</p>
    </div>
  </div>

  <script>
    setTimeout(() => {
      window.close();
    }, ${ok ? 1200 : 2500});
  </script>
</body>
</html>
  `;

  return sendHtml(res, html, ok ? 200 : 500);
};
