/**
 * UPDATE-NOW endpoint:
 * GET /api/update-now?secret=<token>&batchSize=100
 * Dispara atualização no servidor e retorna página com auto-close.
 */

require('dotenv').config({ path: '.env' });

const { runFullUpdateJob } = require('../src/core/serverlessJobs');
const { getSheets } = require('../src/services/sheets');
const { readJobState } = require('../src/run');

function getQueryValue(req, key) {
  try {
    const host = String(req && req.headers && (req.headers.host || req.headers.Host) || 'dash-de-saldos.vercel.app');
    const base = `https://${host}`;
    const url = new URL(String(req && req.url || '/'), base);
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
  const secretFromQuery = req && req.query ? String(req.query.secret || '') : getQueryValue(req, 'secret');
  const secretFromHeader = req && req.headers ? String(req.headers['x-cron-secret'] || '') : '';
  const secret = secretFromQuery || secretFromHeader;
  const expectedSecret = process.env.CRON_SECRET || '';

  if (!expectedSecret || !secret || secret !== expectedSecret) {
    return sendHtml(res, '<h1>401 - Unauthorized</h1>', 401);
  }

  const batchSizeParam = req && req.query ? req.query.batchSize : getQueryValue(req, 'batchSize');
  const batchSize = Math.max(10, Number(batchSizeParam || process.env.UPDATE_BATCH_SIZE || 50));
  const forceParam = req && req.query ? req.query.force : getQueryValue(req, 'force');
  const force = String(forceParam || '').toLowerCase() === 'true' || String(forceParam || '') === '1';

  const resetRaw = req && req.query ? req.query.reset : getQueryValue(req && req.url, 'reset');
  const resetCursor = String(resetRaw || '').toLowerCase() === 'true' || String(resetRaw || '') === '1';

  const dbOnlyRaw = req && req.query ? req.query.databaseOnly : getQueryValue(req && req.url, 'databaseOnly');
  const databaseOnly = String(dbOnlyRaw || '').toLowerCase() === 'true' || String(dbOnlyRaw || '') === '1';

  const method = String(req && req.method || 'GET').toUpperCase();

  if (method === 'POST' || isJsonRequest(req)) {
    try {
      const active = await isJobActiveNow();
      if (active.running) {
        return sendJsonResponse(res, { ok: false, running: true, state: active.state }, 409);
      }

      const result = await runFullUpdateJob({
        batchSize,
        maxMs: Math.max(60000, Number(process.env.CRON_MAX_RUNTIME_MS || 120000)),
        rejectIfRunning: true,
        force,
        resetCursor,
        includeSupervisor: !databaseOnly,
        includeDashboards: !databaseOnly
      });
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

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Atualização de Saldos</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }

    .container {
      background: linear-gradient(to bottom, #ffffff 0%, #f9f9f9 100%);
      border-radius: 20px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
      padding: 50px 40px;
      text-align: center;
      max-width: 500px;
      width: 100%;
      border: 3px solid #ffa500;
    }

    .header {
      margin-bottom: 30px;
    }

    .icon {
      font-size: 60px;
      margin-bottom: 15px;
      display: inline-block;
      animation: pulse 2s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.1); opacity: 0.8; }
    }

    h1 {
      color: #1a1a1a;
      font-size: 32px;
      font-weight: 700;
      margin-bottom: 10px;
      letter-spacing: -0.5px;
    }

    .subtitle {
      color: #666;
      font-size: 14px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 30px;
    }

    .stats {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 30px;
      background: #f0f0f0;
      padding: 20px;
      border-radius: 12px;
      border-left: 4px solid #ffa500;
    }

    .stat-item {
      text-align: center;
    }

    .stat-label {
      color: #999;
      font-size: 12px;
      text-transform: uppercase;
      font-weight: 600;
      margin-bottom: 8px;
    }

    .stat-value {
      color: #1a1a1a;
      font-size: 28px;
      font-weight: 700;
    }

    .stat-value.amber {
      color: #ffa500;
    }

    .progress-bar {
      width: 100%;
      height: 8px;
      background: #e0e0e0;
      border-radius: 4px;
      overflow: hidden;
      margin: 20px 0;
    }

    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #ffa500 0%, #ff8c00 100%);
      border-radius: 4px;
      transition: width 0.3s ease;
      width: 0%;
    }

    .button-group {
      display: flex;
      gap: 12px;
      margin-top: 30px;
    }

    button {
      flex: 1;
      padding: 14px 20px;
      border: none;
      border-radius: 10px;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.3s ease;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    #startBtn {
      background: linear-gradient(135deg, #ffa500 0%, #ff8c00 100%);
      color: white;
      box-shadow: 0 4px 15px rgba(255, 165, 0, 0.3);
    }

    #startBtn:hover:not([disabled]) {
      transform: translateY(-2px);
      box-shadow: 0 8px 20px rgba(255, 165, 0, 0.4);
    }

    #startBtn[disabled] {
      opacity: 0.5;
      cursor: not-allowed;
    }

    #refreshBtn {
      background: #2d2d2d;
      color: white;
      flex: 0.5;
    }

    #refreshBtn:hover:not([disabled]) {
      background: #1a1a1a;
      transform: translateY(-2px);
    }

    .status-text {
      color: #999;
      font-size: 13px;
      margin-top: 20px;
      line-height: 1.6;
    }

    .error {
      background: #ffebee;
      color: #c62828;
      padding: 12px;
      border-radius: 8px;
      margin-top: 15px;
      font-size: 13px;
      border-left: 4px solid #c62828;
    }

    .success {
      background: #e8f5e9;
      color: #2e7d32;
      padding: 12px;
      border-radius: 8px;
      margin-top: 15px;
      font-size: 13px;
      border-left: 4px solid #2e7d32;
    }

    .hidden {
      display: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="icon" id="statusIcon">⚡</div>
      <h1>Atualização de Saldos</h1>
      <div class="subtitle">Painel de Controle</div>
    </div>

    <div class="stats">
      <div class="stat-item">
        <div class="stat-label">Status</div>
        <div class="stat-value" id="statusLabel">Carregando...</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">Progresso</div>
        <div class="stat-value amber" id="counter">0/0</div>
      </div>
    </div>

    <div class="progress-bar">
      <div class="progress-fill" id="progressFill"></div>
    </div>

    <div class="status-text" id="statusText">Carregando informações...</div>

    <div class="button-group">
      <button id="startBtn">Atualizar Agora</button>
      <button id="refreshBtn">↻</button>
    </div>

    <div style="margin-top:12px; display:flex; justify-content:center; gap:8px; align-items:center;">
      <label style="font-size:13px; color:#666"><input id="forceCheck" type="checkbox" style="margin-right:8px"> Forçar</label>
    </div>

    <div id="messageBox"></div>
  </div>

  <script>
    const statusEl = document.getElementById('statusLabel');
    const counterEl = document.getElementById('counter');
    const messageBox = document.getElementById('messageBox');
    const startBtn = document.getElementById('startBtn');
    const refreshBtn = document.getElementById('refreshBtn');
    const progressFill = document.getElementById('progressFill');
    const statusText = document.getElementById('statusText');
    const statusIcon = document.getElementById('statusIcon');
    const forceCheck = document.getElementById('forceCheck');
    const statusUrl = '/api/update-status?secret=${encodeURIComponent(secret)}';
    const startUrlBase = '/api/update-now?secret=${encodeURIComponent(secret)}';
    let manualRunActive = false;
    let refreshInFlight = false;
    let initialStatusLoaded = false;
    let manualRetryTimer = null;
    let idleWaitTimer = null;
    let lastUserMessage = '';

    function showMessage(text, type) {
      lastUserMessage = text;
      messageBox.innerHTML = '<div class="' + type + '">' + text.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>';
    }

    function setManualState(running) {
      manualRunActive = running;
      startBtn.disabled = running;
      refreshBtn.disabled = running;
      if (manualRetryTimer) {
        clearTimeout(manualRetryTimer);
        manualRetryTimer = null;
      }
      if (idleWaitTimer) {
        clearTimeout(idleWaitTimer);
        idleWaitTimer = null;
      }
    }

    function renderRunningState(label, icon, text) {
      statusEl.textContent = label;
      statusIcon.textContent = icon;
      statusText.textContent = text;
    }

    function renderLoadingState(message = 'Carregando status...') {
      statusEl.textContent = '⏳ Carregando';
      statusIcon.textContent = '⌛';
      statusText.textContent = message;
      counterEl.textContent = '— / —';
      progressFill.style.width = '12%';
      startBtn.disabled = true;
      refreshBtn.disabled = true;
    }

    function describeLockState(json) {
      const lockState = String(json && json.lockState || '').trim();
      const leaseRemainingMs = Number(json && json.leaseRemainingMs || 0);
      const heartbeatAgeMs = json && json.heartbeatAgeMs !== null && json.heartbeatAgeMs !== undefined
        ? Number(json.heartbeatAgeMs)
        : null;

      if (lockState === 'active') {
        return {
          label: '⏳ Em Progresso',
          icon: '⌛',
          text: 'A atualização está em andamento. Restam ' + Math.max(0, Math.ceil(leaseRemainingMs / 1000)) + 's no lock.',
          disabled: true,
          kind: 'active'
        };
      }

      if (lockState === 'active_stale') {
        return {
          label: '⚠️ Lock Ativo',
          icon: '⌛',
          text: 'O job ainda está marcado como rodando, mas o heartbeat está antigo (' + (heartbeatAgeMs ? Math.ceil(heartbeatAgeMs / 1000) : '?') + 's). Pode estar travado.',
          disabled: false,
          kind: 'stale'
        };
      }

      if (lockState === 'expired') {
        return {
          label: '⚠️ Lock Expirado',
          icon: '⏰',
          text: 'O job estava rodando, mas o lease já expirou. O próximo clique deve liberar normalmente, ou use Forçar se quiser tomar o lock.',
          disabled: false,
          kind: 'expired'
        };
      }

      return {
        label: '✅ Pronto',
        icon: '✨',
        text: 'Nenhuma atualização em andamento.',
        disabled: false,
        kind: 'idle'
      };
    }

    async function waitForIdleAndRetry(delayMs = 2000, maxWaitMs = 10 * 60 * 1000) {
      const startedAt = Date.now();

      async function tick() {
        try {
          const res = await fetch(statusUrl, { cache: 'no-store' });
          const json = await res.json().catch(() => ({}));
          const state = json && json.state ? json.state : {};
          const running = String(state.status || '') === 'running' && Number(state.leaseUntil || 0) > Date.now();

          if (!running) {
            renderRunningState('⏳ Continuando', '⌛', 'O lote anterior terminou. Iniciando o próximo...');
            idleWaitTimer = setTimeout(() => start({ internalRetry: true }), 300);
            return;
          }

          if (Date.now() - startedAt > maxWaitMs) {
            showMessage('⚠️ Tempo de espera excedido. A atualização continua em andamento; tente novamente mais tarde.', 'error');
            setManualState(false);
            return;
          }

          renderRunningState('⏳ Em Progresso', '⌛', 'Aguardando o término do lote atual...');
          idleWaitTimer = setTimeout(tick, delayMs);
        } catch (e) {
          idleWaitTimer = setTimeout(tick, delayMs);
        }
      }

      tick();
    }

    async function refresh() {
      if (refreshInFlight) {
        return;
      }

      refreshInFlight = true;

      if (!initialStatusLoaded) {
        renderLoadingState('Carregando status da atualização...');
      }

      try {
        const res = await fetch(statusUrl, { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        const state = json && json.state ? json.state : {};
        const total = Number(json && json.totalClients ? json.totalClients : 0);
        const cursor = Number(state.cursor || 0);
        const lockView = describeLockState(json);
        const running = lockView.kind === 'active' || lockView.kind === 'stale';

        const pct = total > 0 ? Math.round((cursor / total) * 100) : 0;
        progressFill.style.width = pct + '%';

        if (manualRunActive && !running) {
          renderRunningState('⏳ Continuando', '⌛', 'Processando o próximo lote...');
          startBtn.disabled = true;
          refreshBtn.disabled = true;
        } else if (running) {
          renderRunningState(lockView.label, lockView.icon, lockView.text);
          startBtn.disabled = !forceCheck.checked;
          refreshBtn.disabled = true;
        } else {
          statusEl.textContent = lockView.label;
          statusIcon.textContent = lockView.icon;
          statusText.textContent = state.updatedAt ? ('Última: ' + state.updatedAt) : lockView.text;
          startBtn.disabled = false;
          refreshBtn.disabled = false;
        }

        counterEl.textContent = cursor + ' / ' + total;
        initialStatusLoaded = true;
      } catch (e) {
        statusEl.textContent = '❌ Erro';
        statusIcon.textContent = '⚠️';
        statusText.textContent = 'Falha ao conectar. A contagem não pôde ser carregada.';
        counterEl.textContent = '— / —';
        startBtn.disabled = false;
        refreshBtn.disabled = false;
        initialStatusLoaded = true;
      } finally {
        refreshInFlight = false;
      }
    }

    async function start(options = {}) {
      const internalRetry = options && options.internalRetry === true;

      if (manualRunActive && !internalRetry) {
        return;
      }

      setManualState(true);
      renderRunningState('⏳ Iniciando...', '⏳', 'Iniciando atualização manual...');
      messageBox.innerHTML = '';
      lastUserMessage = '';

      try {
        const sendUrl = startUrlBase + (forceCheck && forceCheck.checked ? '&force=true' : '');
        const res = await fetch(sendUrl, { method: 'POST' });
        const json = await res.json().catch(() => ({}));

        if (res.status === 409) {
          const lockView = describeLockState(json);
          if (lockView.kind === 'stale' || lockView.kind === 'expired') {
            showMessage('⚠️ Há um lock antigo ou expirado. Marque "Forçar" para tomar o controle e reiniciar.', 'error');
          } else {
            showMessage('ℹ️ Já existe uma atualização em progresso. A tela continua atualizando a contagem enquanto o lote roda.', 'success');
          }
          setManualState(false);
        } else if (!res.ok) {
          showMessage('❌ ' + ((json && json.error) ? json.error : 'Erro ao iniciar'), 'error');
          setManualState(false);
        } else {
          if (json && json.finished === false) {
            showMessage('⏳ Lote concluído. Aguardando o próximo ciclo...', 'success');
            await waitForIdleAndRetry(2000);
            return;
          }

          showMessage('✅ Atualização finalizada com sucesso!', 'success');
          setManualState(false);
        }
      } catch (e) {
        showMessage('❌ Erro ao conectar', 'error');
        setManualState(false);
      } finally {
        setTimeout(refresh, 600);
        setTimeout(refresh, 2000);
      }
    }

    startBtn.addEventListener('click', start);
    refreshBtn.addEventListener('click', refresh);
    refresh();
    setInterval(refresh, 2000);
  </script>
</body>
</html>`;

  return sendHtml(res, html, 200);
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
