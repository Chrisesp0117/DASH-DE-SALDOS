/**
 * UPDATE-NOW endpoint:
 * GET /api/update-now?secret=<token>&batchSize=100
 * Dispara atualização no servidor e retorna página com auto-close.
 */

require('dotenv').config({ path: '.env' });

const { runFullUpdateJob } = require('../src/core/serverlessJobs');
const { getSheets } = require('../src/services/sheets');
const { readJobState } = require('../src/run');

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

function isQuotaExceededError(error) {
  const msg = String((error && (error.message || error.code || error.status)) || '').toLowerCase();
  return msg.includes('quota exceeded') || msg.includes('resource_exhausted') || String(error && error.status) === '429' || String(error && error.code) === '429';
}

async function isJobActiveNow() {
  const sheets = await getSheets();
  const state = await readJobState(sheets, process.env.SPREADSHEET_ID);
  const running = String(state.status || '') === 'running' && Number(state.leaseUntil || 0) > Date.now();
  return { running, state };
}

function isJsonRequest(req) {
  const method = String(req && req.method || 'GET').toUpperCase();
  if (method === 'POST') return true;
  const accept = String(req && req.headers && (req.headers.accept || req.headers.Accept) || '').toLowerCase();
  return accept.includes('application/json');
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
  const batchSize = Math.max(1, Number(batchSizeParam || 5));

  const method = String(req && req.method || 'GET').toUpperCase();

  if (method === 'POST' || isJsonRequest(req)) {
    try {
      const active = await isJobActiveNow();
      if (active.running) {
        return sendJsonResponse(res, { ok: false, running: true, state: active.state }, 409);
      }

      const result = await runFullUpdateJob({ batchSize, maxMs: 45000 });
      return sendJsonResponse(res, result, result && result.ok === false ? 500 : 200);
    } catch (error) {
      const payload = {
        ok: false,
        error: isQuotaExceededError(error)
          ? 'Google Sheets com limite de leitura por minuto. Aguarde ~1 minuto e tente novamente.'
          : `Erro ao atualizar: ${error && error.message ? error.message : 'desconhecido'}`
      };
      return sendJsonResponse(res, payload, 500);
    }
  }

  let ok = true;
  let message = 'Atualização concluída com sucesso.';
  let finished = false;
  let processedTotal = 0;

  try {
    const result = await runFullUpdateJob({ batchSize, maxMs: 45000 });

    if (!result || !result.ok) {
      ok = false;
      message = 'Atualização retornou status inesperado.';
    } else {
      processedTotal = Number(result.totalProcessed || 0);
      finished = result.finished === true;

      if (finished) {
        message = `Atualização concluída com sucesso. Registros processados: ${processedTotal}.`;
      } else if (result.reason === 'time_budget_reached') {
        message = 'Atualização iniciada e parcialmente concluída. Os próximos lotes seguem automaticamente no cron.';
      } else {
        message = 'Atualização iniciada e parcialmente concluída. Os próximos lotes seguem automaticamente no cron.';
      }
    }
  } catch (error) {
    ok = false;
    if (isQuotaExceededError(error)) {
      message = 'Google Sheets com limite de leitura por minuto. Aguarde ~1 minuto e tente novamente.';
    } else {
      message = `Erro ao atualizar: ${error && error.message ? error.message : 'desconhecido'}`;
    }
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
      try {
        window.open('', '_self');
        window.close();
      } catch (e) {
        // ignore
      }

      setTimeout(() => {
        try {
          window.location.replace('about:blank');
        } catch (e) {
          // ignore
        }
      }, 250);
    }, ${ok ? 1200 : 2500});
  </script>
</body>
</html>
  `;

  return sendHtml(res, html, ok ? 200 : 500);
};

function sendJsonResponse(res, payload, statusCode = 200) {
  if (res && typeof res.status === 'function' && typeof res.json === 'function') {
    return res.status(statusCode).json(payload);
  }

  if (res && typeof res.setHeader === 'function' && typeof res.end === 'function') {
    res.statusCode = statusCode;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
    return;
  }

  if (typeof Response !== 'undefined') {
    return new Response(JSON.stringify(payload), {
      status: statusCode,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }

  return { statusCode, body: JSON.stringify(payload) };
}
