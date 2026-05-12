/**
 * UPDATE-NOW endpoint:
 * GET /api/update-now?secret=<token>&batchSize=100
 * Dispara atualização no servidor e retorna página com auto-close.
 */

require('dotenv').config({ path: '.env' });

const { runFullUpdateJob } = require('../src/core/serverlessJobs');
const { getSheets } = require('../src/services/sheets');
const { readJobState, getJobLockMeta } = require('../src/core/jobState');

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
  const lockMeta = getJobLockMeta(state);
  return { running: lockMeta.running, state, lockMeta };
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
        return sendJsonResponse(res, {
          ok: false,
          running: true,
          lockState: active.lockMeta && active.lockMeta.staleByHeartbeat ? 'active_stale' : 'active',
          heartbeatAgeMs: active.lockMeta ? active.lockMeta.heartbeatAgeMs : null,
          leaseRemainingMs: active.lockMeta ? active.lockMeta.leaseRemainingMs : 0,
          staleByHeartbeat: active.lockMeta ? active.lockMeta.staleByHeartbeat : false,
          state: active.state
        }, 409);
      }

      // Inicia o job em background (não aguarda conclusão)
      // Isso permite que o cliente veja progresso em tempo real via polling
      const jobPromise = runFullUpdateJob({
        batchSize,
        maxMs: Math.max(60000, Number(process.env.CRON_MAX_RUNTIME_MS || 120000)),
        rejectIfRunning: true,
        force,
        resetCursor,
        includeSupervisor: !databaseOnly,
        includeDashboards: !databaseOnly
      }).catch(err => {
        console.error('Background job error:', err && err.message);
      });

      // Retorna imediatamente ao cliente sem aguardar
      return sendJsonResponse(res, {
        ok: true,
        started: true,
        message: 'Atualização iniciada. Acompanhe o progresso em tempo real.',
        refreshInterval: 2000
      }, 202);

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
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f7fa;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }

    .container {
      background: white;
      border-radius: 16px;
      box-shadow: 0 4px 30px rgba(0, 0, 0, 0.08);
      padding: 40px;
      text-align: center;
      max-width: 600px;
      width: 100%;
    }

    .header {
      margin-bottom: 40px;
    }

    .icon {
      font-size: 56px;
      margin-bottom: 16px;
      display: inline-block;
      animation: pulse 2.5s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.05); opacity: 0.8; }
    }

    h1 {
      color: #1a2332;
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 6px;
    }

    .subtitle {
      color: #7c8999;
      font-size: 13px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    /* Status Section */
    .status-section {
      background: linear-gradient(135deg, #f8fafc 0%, #eef2f7 100%);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 24px;
      border: 1px solid #e1e8f0;
      text-align: left;
    }

    .status-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
    }

    .status-indicator {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #10b981;
      animation: none;
    }

    .status-indicator.running {
      background: #fbbf24;
      animation: blink 1s ease-in-out infinite;
    }

    .status-indicator.error {
      background: #ef4444;
    }

    @keyframes blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    .status-text {
      color: #1a2332;
      font-size: 14px;
      font-weight: 600;
    }

    .status-detail {
      color: #7c8999;
      font-size: 12px;
      line-height: 1.5;
      margin-top: 8px;
    }

    /* Progress Section */
    .progress-section {
      margin-bottom: 28px;
    }

    .progress-label {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
      font-size: 13px;
      color: #1a2332;
      font-weight: 600;
    }

    .progress-number {
      color: #3b82f6;
      font-weight: 700;
      font-size: 14px;
    }

    .progress-bar {
      width: 100%;
      height: 10px;
      background: #e5e7eb;
      border-radius: 6px;
      overflow: hidden;
      box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.05);
    }

    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #3b82f6 0%, #2563eb 100%);
      border-radius: 6px;
      transition: width 0.4s ease;
      width: 0%;
      box-shadow: 0 0 10px rgba(59, 130, 246, 0.3);
    }

    .progress-fill.complete {
      background: linear-gradient(90deg, #10b981 0%, #059669 100%);
    }

    /* Action Buttons */
    .button-group {
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
    }

    button {
      flex: 1;
      padding: 12px 16px;
      border: none;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.3s ease;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    #startBtn {
      background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
      color: white;
      box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
    }

    #startBtn:hover:not([disabled]) {
      transform: translateY(-2px);
      box-shadow: 0 8px 20px rgba(59, 130, 246, 0.4);
    }

    #startBtn[disabled] {
      opacity: 0.5;
      cursor: not-allowed;
    }

    #refreshBtn {
      background: #e5e7eb;
      color: #374151;
      flex: 0.35;
      font-weight: 600;
      font-size: 16px;
    }

    #refreshBtn:hover:not([disabled]) {
      background: #d1d5db;
      transform: rotate(180deg);
    }

    /* Options */
    .options {
      display: flex;
      justify-content: center;
      gap: 16px;
      margin-bottom: 20px;
    }

    .option {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      color: #7c8999;
    }

    .option input[type="checkbox"] {
      width: 16px;
      height: 16px;
      cursor: pointer;
    }

    /* Messages */
    .message-box {
      display: none;
      padding: 12px 14px;
      border-radius: 8px;
      font-size: 13px;
      margin-bottom: 16px;
      border-left: 4px solid;
      animation: slideIn 0.3s ease;
    }

    .message-box.show {
      display: block;
    }

    @keyframes slideIn {
      from { transform: translateX(-10px); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }

    .message-box.error {
      background: #fee2e2;
      color: #b91c1c;
      border-left-color: #ef4444;
    }

    .message-box.success {
      background: #dcfce7;
      color: #166534;
      border-left-color: #22c55e;
    }

    .message-box.info {
      background: #dbeafe;
      color: #0c4a6e;
      border-left-color: #3b82f6;
    }

    /* History */
    .history-section {
      text-align: left;
      background: #f9fafb;
      border-radius: 10px;
      padding: 16px;
      border: 1px solid #e5e7eb;
    }

    .history-title {
      font-size: 12px;
      font-weight: 700;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 12px;
    }

    .history-item {
      font-size: 12px;
      color: #7c8999;
      padding: 8px;
      border-radius: 6px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
    }

    .history-item:last-child {
      margin-bottom: 0;
    }

    .history-item.running {
      background: #fef3c7;
      color: #7c2d12;
    }

    .history-item.success {
      background: #f0fdf4;
      color: #166534;
    }

    .history-item.error {
      background: #fef2f2;
      color: #991b1b;
    }

    .history-time {
      font-weight: 600;
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
      <div class="subtitle">Central de Controle</div>
    </div>

    <!-- Status Live -->
    <div class="status-section">
      <div class="status-header">
        <div class="status-indicator" id="statusIndicator"></div>
        <div class="status-text" id="statusLabel">Carregando...</div>
      </div>
      <div class="status-detail" id="statusDetail">Conectando ao servidor...</div>
    </div>

    <!-- Progress Bar -->
    <div class="progress-section">
      <div class="progress-label">
        <span>Progresso</span>
        <span class="progress-number"><span id="currentProgress">0</span>/<span id="totalProgress">0</span></span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" id="progressFill"></div>
      </div>
    </div>

    <!-- Message Box -->
    <div class="message-box" id="messageBox"></div>

    <!-- Action Buttons -->
    <div class="button-group">
      <button id="startBtn">Atualizar Agora</button>
      <button id="refreshBtn">↻</button>
    </div>

    <!-- Options -->
    <div class="options">
      <label class="option">
        <input id="forceCheck" type="checkbox">
        <span>Forçar</span>
      </label>
    </div>

    <!-- History -->
    <div class="history-section">
      <div class="history-title">Histórico Recent</div>
      <div id="historyList">
        <div style="color: #b4b5b7; font-size: 12px; padding: 8px; text-align: center;">Carregando...</div>
      </div>
    </div>
  </div>

  <script>
    // DOM Elements
    const statusLabel = document.getElementById('statusLabel');
    const statusDetail = document.getElementById('statusDetail');
    const statusIndicator = document.getElementById('statusIndicator');
    const statusIcon = document.getElementById('statusIcon');
    const currentProgress = document.getElementById('currentProgress');
    const totalProgress = document.getElementById('totalProgress');
    const progressFill = document.getElementById('progressFill');
    const messageBox = document.getElementById('messageBox');
    const startBtn = document.getElementById('startBtn');
    const refreshBtn = document.getElementById('refreshBtn');
    const forceCheck = document.getElementById('forceCheck');
    const historyList = document.getElementById('historyList');

    // Config
    const statusUrl = '/api/update-status?secret=${encodeURIComponent(secret)}';
    const startUrlBase = '/api/update-now?secret=${encodeURIComponent(secret)}&batchSize=50';

    // State
    let refreshInFlight = false;
    let manualRunActive = false;
    let waitForIdleTimer = null;
    let lastKnownState = null;
    let executionHistory = [];

    // Utilities
    function showMessage(text, type) {
      messageBox.className = 'message-box show ' + type;
      messageBox.textContent = text;
      setTimeout(() => {
        messageBox.classList.remove('show');
      }, 5000);
    }

    function formatTime(date) {
      const now = new Date();
      const diff = now - date;
      if (diff < 60000) return 'agora';
      if (diff < 3600000) return Math.floor(diff / 60000) + 'm';
      return Math.floor(diff / 3600000) + 'h';
    }

    function formatDate(dateStr) {
      if (!dateStr) return '—';
      const date = new Date(dateStr);
      return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }

    function updateHistoryUI() {
      if (executionHistory.length === 0) {
        historyList.innerHTML = '<div style="color: #b4b5b7; font-size: 12px; padding: 8px; text-align: center;">Nenhuma execução recente</div>';
        return;
      }

      historyList.innerHTML = executionHistory
        .slice(0, 5)
        .map((item, idx) => \`
          <div class="history-item \${item.status}">
            <div>
              <span class="history-time">\${item.time}</span>
              <span style="margin: 0 8px;">•</span>
              <span>\${item.label}</span>
            </div>
            <div style="font-size: 11px; color: inherit; opacity: 0.7;">\${item.details}</div>
          </div>
        \`).join('');
    }

    function addToHistory(status, label, details) {
      const now = new Date();
      executionHistory.unshift({
        status: status,
        label: label,
        details: details,
        time: formatDate(now),
        timestamp: now
      });
      updateHistoryUI();
    }

    function getStatusDescription(json, state) {
      const lockState = String(json && json.lockState || '').trim();
      const leaseRemainingMs = Number(json && json.leaseRemainingMs || 0);
      const heartbeatAgeMs = json && json.heartbeatAgeMs !== null ? Number(json.heartbeatAgeMs) : null;
      const total = Number(json && json.totalClients || 0);
      const cursor = Number(json && json.displayCursor || 0);
      const pct = total > 0 ? Math.round((cursor / total) * 100) : 0;

      // Running states
      if (lockState === 'active') {
        const remainingSecs = Math.max(0, Math.ceil(leaseRemainingMs / 1000));
        return {
          label: '⏳ Processando',
          indicator: 'running',
          detail: \`Lote em andamento. Progresso: \${cursor}/\${total} (\${pct}%). Restam \${remainingSecs}s.\`,
          icon: '⌛',
          canStart: false
        };
      }

      if (lockState === 'active_stale') {
        const staleSecs = heartbeatAgeMs ? Math.ceil(heartbeatAgeMs / 1000) : '?';
        return {
          label: '⚠️ Possível Travamento',
          indicator: 'error',
          detail: \`Lock ativo há \${staleSecs}s sem heartbeat. Pode estar travado. Use Forçar para retomar.\`,
          icon: '⚠️',
          canStart: true
        };
      }

      if (lockState === 'expired') {
        return {
          label: '⏰ Lock Expirado',
          indicator: 'error',
          detail: 'Atualização anterior expirou. Use Forçar para retomar ou clique para recomeçar.',
          icon: '⏰',
          canStart: true
        };
      }

      // Idle state
      const lastUpdate = state && state.updatedAt ? formatDate(state.updatedAt) : null;
      return {
        label: '✅ Pronto',
        indicator: 'idle',
        detail: lastUpdate ? \`Última atualização: \${lastUpdate}\` : 'Nenhuma atualização em andamento.',
        icon: '✨',
        canStart: true
      };
    }

    async function waitForIdleAndRetry() {
      const maxWaitMs = 10 * 60 * 1000;
      const startedAt = Date.now();

      async function checkAndRetry() {
        try {
          const res = await fetch(statusUrl, { cache: 'no-store' });
          const json = await res.json().catch(() => ({}));
          const state = json && json.state ? json.state : {};
          const running = String(state.status || '') === 'running' && Number(state.leaseUntil || 0) > Date.now();

          // Ainda rodando? Continua esperando
          if (running) {
            waitForIdleTimer = setTimeout(checkAndRetry, 2000);
            return;
          }

          // Job terminou! Verifica se pode iniciar próximo
          const total = Number(json && json.totalClients || 0);
          const cursor = Number(json && json.displayCursor || 0);

          if (cursor < total) {
            // Ainda há clientes para processar, inicia próximo lote automaticamente
            addToHistory('success', 'Retomando', 'Iniciando próximo lote...');
            await new Promise(r => setTimeout(r, 300));
            return await start({ internalRetry: true });
          } else {
            // Todos os clientes foram processados!
            addToHistory('success', 'Completo', 'Todos os clientes atualizados');
            showMessage('✅ Todos os lotes foram concluídos!', 'success');
            manualRunActive = false;
            await refresh();
          }

        } catch (e) {
          if (Date.now() - startedAt > maxWaitMs) {
            addToHistory('error', 'Timeout', 'Excedeu tempo máximo de espera');
            showMessage('⏱️ Tempo de espera excedido.', 'info');
            manualRunActive = false;
            await refresh();
            return;
          }
          waitForIdleTimer = setTimeout(checkAndRetry, 2000);
        }
      }

      checkAndRetry();
    }

    async function refresh() {
      if (refreshInFlight) return;
      refreshInFlight = true;

      try {
        const res = await fetch(statusUrl, { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        const state = json && json.state ? json.state : {};
        const total = Number(json && json.totalClients !== undefined ? json.totalClients : state.totalClients || 0);
        const cursor = Number(json && json.displayCursor !== undefined ? json.displayCursor : state.cursor || 0);

        console.log('[UI] refresh: cursor=' + cursor + ', total=' + total + ', json.totalClients=' + json.totalClients + ', state.totalClients=' + state.totalClients + ', running=' + (desc && desc.indicator === 'running'));

        lastKnownState = json;

        const desc = getStatusDescription(json, state);

        // Update status section
        statusLabel.textContent = desc.label;
        statusIcon.textContent = desc.icon;
        statusDetail.textContent = desc.detail;
        statusIndicator.className = 'status-indicator ' + (desc.indicator === 'running' ? 'running' : desc.indicator === 'error' ? 'error' : '');

        // Update progress
        currentProgress.textContent = cursor;
        totalProgress.textContent = total;
        const pct = total > 0 ? Math.round((cursor / total) * 100) : 0;
        progressFill.style.width = pct + '%';
        if (cursor >= total && total > 0) {
          progressFill.classList.add('complete');
        } else {
          progressFill.classList.remove('complete');
        }

        // Se manualRunActive mas job não está mais rodando
        if (manualRunActive && desc.indicator !== 'running') {
          console.log('[UI] Job terminado. cursor=' + cursor + ', total=' + total + ', manualRunActive=' + manualRunActive);
          // Job terminou!
          if (cursor >= total && total > 0) {
            // Todos processados
            console.log('[UI] TUDO COMPLETO');
            addToHistory('success', 'Completo', 'Todos os clientes atualizados');
            showMessage('✅ Todos os lotes foram concluídos!', 'success');
            manualRunActive = false;
          } else if (total > 0) {
            // Ainda há clientes, inicia próximo lote IMEDIATAMENTE
            console.log('[UI] Iniciando próximo lote. cursor=' + cursor + ', total=' + total);
            addToHistory('info', 'Continuando', 'Iniciando próximo lote...');
            // NÃO seta manualRunActive = false, deixa continuar!
            // Inicia próximo lote em 300ms (tempo para heartbeat limpar)
            setTimeout(() => start({ internalRetry: true }), 300);
            return; // Early return
          } else {
            console.log('[UI] total=0, aguardando carregamento');
            manualRunActive = false;
          }
        }

        // Update buttons
        if (desc.indicator === 'running') {
          startBtn.disabled = !forceCheck.checked;
          refreshBtn.disabled = false;
          if (!manualRunActive) {
            messageBox.innerHTML = '';
          }
        } else {
          startBtn.disabled = false;
          refreshBtn.disabled = false;
        }

      } catch (e) {
        console.error('[UI] refresh erro:', e && e.message);
        statusLabel.textContent = '❌ Erro';
        statusIcon.textContent = '🔌';
        statusDetail.textContent = 'Falha ao conectar com servidor.';
        currentProgress.textContent = '?';
        totalProgress.textContent = '?';
        startBtn.disabled = false;
        refreshBtn.disabled = false;
      } finally {
        refreshInFlight = false;
      }
    }

    async function start(options = {}) {
      const internalRetry = options && options.internalRetry === true;

      if (manualRunActive && !internalRetry) {
        console.log('[UI] start() BLOCKED: manualRunActive=true and not internalRetry');
        return;
      }

      console.log('[UI] start() EXECUTA. internalRetry=' + internalRetry + ', manualRunActive=' + manualRunActive);
      manualRunActive = true;
      startBtn.disabled = true;
      messageBox.classList.remove('show');

      try {
        const url = startUrlBase + (forceCheck && forceCheck.checked ? '&force=true' : '');
        console.log('[UI] POST para: ' + url);
        const res = await fetch(url, { method: 'POST' });
        const json = await res.json().catch(() => ({}));

        console.log('[UI] Resposta: status=' + res.status + ', ok=' + json.ok + ', started=' + json.started);

        if (res.status === 409) {
          // Job já está em andamento
          const desc = getStatusDescription(json, json.state || {});
          if (desc.indicator === 'error') {
            addToHistory('error', 'Bloqueado', 'Lock em estado inválido');
            showMessage('⚠️ Há um lock que precisa ser resolvido. Marque "Forçar" se necessário.', 'error');
          } else {
            addToHistory('info', 'Aguardando', 'Outro lote em progresso');
            showMessage('ℹ️ Outro lote já está em progresso. Acompanhando progresso...', 'info');
          }
          manualRunActive = false;

        } else if (res.status === 202) {
          // Job foi iniciado em background!
          const msg = internalRetry ? '⏳ Continuando com próximo lote...' : '⏳ Atualização iniciada! Acompanhando progresso...';
          addToHistory('info', 'Iniciado', 'Processando em background...');
          showMessage(msg, 'info');
          console.log('[UI] 202 recebido, manualRunActive=true, polling continuará');
          // Manter manualRunActive=true para continuar
          return;

        } else if (!res.ok) {
          addToHistory('error', 'Erro', json && json.error ? json.error : 'Desconhecido');
          showMessage('❌ ' + (json && json.error ? json.error : 'Erro ao iniciar'), 'error');
          manualRunActive = false;

        } else {
          addToHistory('success', 'Completo', 'Todos os clientes atualizados');
          showMessage('✅ Atualização completa!', 'success');
          manualRunActive = false;
        }

      } catch (e) {
        console.error('[UI] Erro em start():', e && e.message);
        addToHistory('error', 'Conexão', 'Erro ao conectar');
        showMessage('❌ Erro de conexão: ' + (e && e.message ? e.message : 'desconhecido'), 'error');
        manualRunActive = false;
      } finally {
        console.log('[UI] start() terminou. manualRunActive=' + manualRunActive);
        setTimeout(refresh, 400);
        if (!manualRunActive) {
          setTimeout(refresh, 1500);
        }
      }
    }

        } else if (!res.ok) {
          addToHistory('error', 'Erro', json && json.error ? json.error : 'Desconhecido');
          showMessage('❌ ' + (json && json.error ? json.error : 'Erro ao iniciar'), 'error');
          manualRunActive = false;

        } else if (json && json.finished === false) {
          // Resposta antiga: lote concluído, mas há mais para fazer
          addToHistory('success', 'Lote OK', 'Continuando...');
          showMessage('✓ Lote concluído. Continuando com o próximo...', 'success');
          await waitForIdleAndRetry();
          return;

        } else {
          // Resposta antiga: tudo completo
          addToHistory('success', 'Completo', 'Todos os clientes atualizados');
          showMessage('✅ Atualização completa!', 'success');
          manualRunActive = false;
        }

      } catch (e) {
        console.error('[UI] start() error:', e && e.message);
        addToHistory('error', 'Conexão', 'Erro ao conectar');
        showMessage('❌ Erro de conexão: ' + (e && e.message ? e.message : 'desconhecido'), 'error');
        manualRunActive = false;
      } finally {
        setTimeout(refresh, 400);
        if (!manualRunActive) {
          setTimeout(refresh, 1500);
        }
      }
    }

    // Event listeners
    startBtn.addEventListener('click', start);
    refreshBtn.addEventListener('click', refresh);

    // Initialize
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
