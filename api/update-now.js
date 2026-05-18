require('dotenv').config({ path: '.env' });

const { runFullUpdateJob, triggerNextCycle } = require('../src/core/serverlessJobs');
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

function renderHtmlPage(params) {
  const initialStateJson = JSON.stringify(params.initialState || { running: false, cursor: 0, totalClients: 0, stage: 'idle' });
  const secret = String(params.secret || '');
  const batchSize = Number(params.batchSize || 10);
  const force = params.force ? '1' : '0';
  const reset = params.resetCursor ? '1' : '0';
  const databaseOnly = params.databaseOnly ? '1' : '0';
  const maxMs = Number(params.maxMs || process.env.CRON_MAX_RUNTIME_MS || 240000);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Atualização de Saldos</title>
  <style>
    :root {
      --bg: #f0f4f9;
      --card: #ffffff;
      --ink: #1a202c;
      --muted: #718096;
      --line: #e2e8f0;
      --primary: #3b82f6;
      --primary-dark: #1d4ed8;
      --success: #10b981;
      --warn: #f59e0b;
      --error: #ef4444;
      --info: #06b6d4;
    }
    * {
      box-sizing: border-box;
    }
    html, body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: linear-gradient(135deg, var(--bg) 0%, #e8f1f8 100%);
      color: var(--ink);
      min-height: 100vh;
    }
    .container {
      max-width: 700px;
      margin: 0 auto;
      padding: 20px;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    .card {
      background: var(--card);
      border-radius: 16px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.08);
      padding: 32px;
      position: relative;
    }
    .header {
      margin-bottom: 32px;
      text-align: center;
    }
    .title {
      font-size: 28px;
      font-weight: 700;
      margin: 0 0 8px;
      color: var(--ink);
    }
    .subtitle {
      font-size: 14px;
      color: var(--muted);
      margin: 0;
    }
    .status-badge {
      display: inline-block;
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      margin-top: 12px;
      transition: all 0.3s ease;
    }
    .status-badge.idle {
      background: #e0f2fe;
      color: #0369a1;
    }
    .status-badge.running {
      background: #fef3c7;
      color: #92400e;
      animation: pulse 2s infinite;
    }
    .status-badge.completed {
      background: #d1fae5;
      color: #065f46;
    }
    .status-badge.error {
      background: #fee2e2;
      color: #991b1b;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }
    .progress-section {
      margin: 32px 0;
    }
    .progress-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 12px;
    }
    .progress-label {
      font-size: 14px;
      font-weight: 600;
      color: var(--ink);
    }
    .progress-info {
      display: flex;
      gap: 16px;
      font-size: 12px;
    }
    .progress-stat {
      color: var(--muted);
    }
    .progress-stat strong {
      color: var(--ink);
      font-weight: 700;
    }
    .progress-bar {
      position: relative;
      height: 8px;
      background: var(--line);
      border-radius: 10px;
      overflow: hidden;
      margin-bottom: 8px;
    }
    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--primary) 0%, var(--primary-dark) 100%);
      transition: width 0.3s ease;
      border-radius: 10px;
      position: relative;
    }
    .progress-fill::after {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
      animation: shimmer 2s infinite;
    }
    @keyframes shimmer {
      0% { transform: translateX(-100%); }
      100% { transform: translateX(100%); }
    }
    .progress-percent {
      font-size: 13px;
      font-weight: 600;
      color: var(--primary);
      margin-top: 4px;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      margin-top: 16px;
    }
    .stat-box {
      background: var(--bg);
      padding: 12px;
      border-radius: 10px;
      border: 1px solid var(--line);
      text-align: center;
    }
    .stat-label {
      font-size: 11px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
    }
    .stat-value {
      font-size: 18px;
      font-weight: 700;
      color: var(--ink);
    }
    .stat-value.accent {
      color: var(--primary);
    }
    .message-box {
      background: var(--bg);
      border-left: 4px solid var(--info);
      padding: 14px 16px;
      border-radius: 8px;
      font-size: 13px;
      color: var(--ink);
      margin: 20px 0;
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }
    .message-box.error {
      border-left-color: var(--error);
      background: #fef2f2;
      color: #7f1d1d;
    }
    .message-box.success {
      border-left-color: var(--success);
      background: #f0fdf4;
      color: #065f46;
    }
    .message-box.warn {
      border-left-color: var(--warn);
      background: #fffbeb;
      color: #92400e;
    }
    .message-icon {
      flex-shrink: 0;
      width: 18px;
      height: 18px;
      margin-top: 1px;
    }
    .message-text {
      flex: 1;
      line-height: 1.5;
    }
    .actions {
      display: flex;
      gap: 10px;
      margin: 28px 0 0;
      flex-wrap: wrap;
    }
    button {
      flex: 1;
      min-width: 140px;
      padding: 12px 16px;
      border: 0;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    button:hover:not([disabled]) {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }
    button:active:not([disabled]) {
      transform: translateY(0);
    }
    button[disabled] {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .btn-primary {
      background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
      color: white;
    }
    .btn-secondary {
      background: var(--bg);
      color: var(--ink);
      border: 1.5px solid var(--line);
    }
    .btn-secondary:hover:not([disabled]) {
      border-color: var(--primary);
      background: var(--primary);
      color: white;
    }
    .btn-danger {
      background: var(--error);
      color: white;
    }
    .btn-danger:hover:not([disabled]) {
      background: #dc2626;
    }
    .footer {
      margin-top: 24px;
      padding-top: 20px;
      border-top: 1px solid var(--line);
      text-align: center;
      font-size: 12px;
      color: var(--muted);
    }
    .spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid rgba(255,255,255,0.3);
      border-radius: 50%;
      border-top-color: white;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    @media (max-width: 600px) {
      .container {
        padding: 16px;
      }
      .card {
        padding: 24px;
      }
      .title {
        font-size: 24px;
      }
      .stats-grid {
        grid-template-columns: repeat(2, 1fr);
      }
      button {
        min-width: 100px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="header">
        <h1 class="title">Atualização de Saldos</h1>
        <p class="subtitle">Sincronizar dados com Google Sheets</p>
        <div class="status-badge idle" id="statusBadge">Aguardando</div>
      </div>

      <div class="progress-section">
        <div class="progress-header">
          <span class="progress-label">Andamento</span>
          <div class="progress-info">
            <span class="progress-stat">Etapa: <strong id="stageName">Inativo</strong></span>
          </div>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" id="progressFill" style="width: 0%"></div>
        </div>
        <div class="progress-percent" id="progressPercent">0%</div>
      </div>

      <div class="stats-grid">
        <div class="stat-box">
          <div class="stat-label">Registros</div>
          <div class="stat-value accent" id="cursorDisplay">0</div>
          <div class="stat-label" style="font-size: 10px; margin-top: 6px;" id="totalDisplay">de 0</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Tempo Decorrido</div>
          <div class="stat-value" id="elapsedTime">0s</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Velocidade</div>
          <div class="stat-value" id="throughput">—</div>
        </div>
      </div>

      <div id="messageBox" class="message-box" style="display: none;">
        <div class="message-icon">ℹ️</div>
        <div class="message-text" id="messageText">Pronto para iniciar</div>
      </div>

      <div class="actions">
        <button id="startBtn" class="btn-primary">
          <span id="startBtnText">Iniciar Atualização</span>
        </button>
        <button id="refreshBtn" class="btn-secondary">Atualizar Status</button>
        <button id="forceBtn" class="btn-danger" style="display: none;">Forçar Retomada</button>
      </div>

      <div class="footer">
        Interface multiusuário • Bloqueio automático durante atualização em andamento
      </div>
    </div>
  </div>

  <script>
    (() => {
      // ==================== INICIALIZAÇÃO ====================
      const initialState = ${initialStateJson};
      const secret = ${JSON.stringify(secret)};
      const batchSize = ${JSON.stringify(String(batchSize))};
      const force = ${JSON.stringify(force)};
      const reset = ${JSON.stringify(reset)};
      const databaseOnly = ${JSON.stringify(databaseOnly)};
      const maxMsParam = ${JSON.stringify(String(maxMs))};

      // ==================== ELEMENTOS DOM ====================
      const startBtn = document.getElementById('startBtn');
      const refreshBtn = document.getElementById('refreshBtn');
      const forceBtn = document.getElementById('forceBtn');
      const statusBadge = document.getElementById('statusBadge');
      const messageBox = document.getElementById('messageBox');
      const messageText = document.getElementById('messageText');
      const progressFill = document.getElementById('progressFill');
      const progressPercent = document.getElementById('progressPercent');
      const stageName = document.getElementById('stageName');
      const cursorDisplay = document.getElementById('cursorDisplay');
      const totalDisplay = document.getElementById('totalDisplay');
      const elapsedTime = document.getElementById('elapsedTime');
      const throughput = document.getElementById('throughput');
      const startBtnText = document.getElementById('startBtnText');

      // ==================== ESTADO ====================
      let ownerId = 'ui|' + Math.random().toString(36).slice(2, 10) + '|' + Date.now().toString(36);
      let manualRunActive = false;
      let autoResumeTimer = null;
      let autoResumeAttempts = 0;
      let lastAutoResumeCursor = -1;
      let lockUi = false;
      let updateStartTime = 0;
      let lastStableCursor = 0;
      let lastStableTotal = 0;
      let lastStableStage = 'idle';
      let closeWindowTimer = null;
      let pollingTimer = null;
      let pollingIntervalMs = 1000; // cliente polling padrão (ms)
      let backoffAttempts = 0;
      const MAX_BACKOFF_ATTEMPTS = 6;
      const BASE_BACKOFF_MS = 1000;

      // ==================== ESTADO DO PROGRESSO ====================
      let currentState = {
        running: false,
        cursor: 0,
        totalClients: 0,
        stage: 'idle',
        displayCursor: 0
      };

      // ==================== UTILITÁRIOS ====================
      function getStageLabel(stage) {
        const labels = {
          idle: 'Inativo',
          database: 'Processando Base de Dados',
          database_complete: 'Base Processada',
          dashboards: 'Atualizando Painéis',
          done: 'Concluído',
          supervisor: 'Processando Supervisor'
        };
        return labels[stage] || stage;
      }

      function formatTime(seconds) {
        if (seconds < 60) return Math.round(seconds) + 's';
        const mins = Math.floor(seconds / 60);
        const secs = Math.round(seconds % 60);
        return mins + 'm ' + secs + 's';
      }

      function formatThroughput(cursor, totalSeconds) {
        if (totalSeconds < 1 || cursor === 0) return '—';
        const rps = cursor / totalSeconds;
        if (rps < 1) return Math.round(rps * 1000) / 1000 + '/s';
        return Math.round(rps * 10) / 10 + '/s';
      }

      function showMessage(text, type = 'info') {
        messageBox.className = 'message-box ' + type;
        messageText.textContent = text;
        messageBox.style.display = 'flex';
      }

      function hideMessage() {
        messageBox.style.display = 'none';
      }

      function clearAutoResumeTimer() {
        if (autoResumeTimer) {
          clearTimeout(autoResumeTimer);
          autoResumeTimer = null;
        }
      }

      function scheduleWindowClose() {
        if (closeWindowTimer) {
          clearTimeout(closeWindowTimer);
        }
        closeWindowTimer = setTimeout(() => {
          if (window.opener) {
            window.close();
          }
        }, 5000);
      }

      function scheduleNextPoll(delayMs) {
        if (pollingTimer) {
          clearTimeout(pollingTimer);
          pollingTimer = null;
        }
        pollingTimer = setTimeout(() => {
          pollingTimer = null;
          fetchStatus();
        }, Math.max(0, Number(delayMs || pollingIntervalMs)));
      }

      // ==================== ATUALIZAR UI ====================
      function updateProgressDisplay() {
        const total = currentState.totalClients || 0;
        const cursor = currentState.displayCursor || 0;
        const pct = total > 0 ? Math.min(100, Math.max(0, Math.round((cursor / total) * 100))) : 0;

        progressFill.style.width = pct + '%';
        progressPercent.textContent = pct + '%';
        cursorDisplay.textContent = cursor;
        totalDisplay.textContent = 'de ' + total;
        stageName.textContent = getStageLabel(currentState.stage);

        // Atualizar tempo decorrido
        if (updateStartTime > 0) {
          const elapsed = (Date.now() - updateStartTime) / 1000;
          elapsedTime.textContent = formatTime(elapsed);
          throughput.textContent = formatThroughput(cursor, elapsed);
        }
      }

      function updateStatusBadge() {
        statusBadge.className = 'status-badge ' + (currentState.running ? 'running' : currentState.stage === 'done' ? 'completed' : 'idle');
        statusBadge.textContent = currentState.running ? 'Atualizando...' : (currentState.stage === 'done' ? 'Concluído' : 'Aguardando');
      }

      function updateButtonStates() {
        const hasStableProgress = manualRunActive && lastStableTotal > 0 && lastStableCursor < lastStableTotal;
        const hasCurrentProgress = currentState.totalClients > 0 && currentState.displayCursor < currentState.totalClients;
        const shouldKeepStartDisabled = manualRunActive && (hasCurrentProgress || hasStableProgress);

        startBtn.disabled = currentState.running || lockUi || shouldKeepStartDisabled;
        forceBtn.style.display = currentState.staleByHeartbeat ? 'flex' : 'none';
        forceBtn.disabled = !currentState.staleByHeartbeat || lockUi;

        if (currentState.running) {
          startBtnText.textContent = 'Atualizando...';
        } else if (shouldKeepStartDisabled) {
          startBtnText.textContent = 'Retomando...';
        } else {
          startBtnText.textContent = 'Iniciar Atualização';
        }
      }

      // ==================== SCHEDULE AUTO-RESUME ====================
      function scheduleAutoResume(payload) {
        const running = !!payload.running;
        const total = currentState.totalClients || 0;
        const cursor = currentState.displayCursor || 0;

        if (cursor > lastAutoResumeCursor) {
          lastAutoResumeCursor = cursor;
          autoResumeAttempts = 0;
        }

        if (running || lockUi || !manualRunActive || total <= 0 || cursor >= total) {
          clearAutoResumeTimer();
          return;
        }

        if (autoResumeAttempts >= 8) {
          clearAutoResumeTimer();
          manualRunActive = false;
          showMessage('A atualização pausou várias vezes. Revise os logs e tente novamente.', 'error');
          updateButtonStates();
          return;
        }

        if (autoResumeTimer) {
          return;
        }

        autoResumeTimer = setTimeout(async () => {
          autoResumeTimer = null;
          autoResumeAttempts += 1;

          if (lockUi || !manualRunActive) {
            return;
          }

          showMessage('Retomando atualização (tentativa ' + autoResumeAttempts + '/8)...', 'warn');
          await startUpdate(true);
        }, 750);
      }

      // ==================== FETCH STATUS ====================
      async function fetchStatus() {
        try {
          const res = await fetch('/api/update-status', {
            method: 'GET',
            headers: {
              accept: 'application/json',
              'x-cron-secret': secret
            },
            cache: 'no-store'
          });

          let data = null;
          let isQuota = false;
          if (res.status === 429) {
            isQuota = true;
          }
          try {
            data = await res.json();
            if (data && data.error && String(data.error || '').toLowerCase().includes('quota')) {
              isQuota = true;
            }
          } catch (e) {
            data = null;
          }

          if (isQuota) {
            backoffAttempts = Math.min(MAX_BACKOFF_ATTEMPTS, backoffAttempts + 1);
            const jitter = Math.floor(Math.random() * 500);
            const delay = Math.min(BASE_BACKOFF_MS * Math.pow(2, backoffAttempts), 60000) + jitter;
            showMessage('Google Sheets atingiu limite. Retentando em ' + Math.round(delay / 1000) + 's', 'warn');
            scheduleNextPoll(delay);
            return null;
          }

          if (!data || data.ok === false) {
            showMessage('Erro ao consultar status: ' + (data?.error || 'desconhecido'), 'error');
            // schedule normal retry
            scheduleNextPoll(pollingIntervalMs);
            return null;
          }

          // Atualizar estado sem deixar o progresso regredir visualmente
          const incomingRunning = !!data.running;
          const incomingCursor = Number(data.displayCursor || data.cursor || 0);
          const incomingStoredCursor = Number(data.cursor || 0);
          const incomingTotal = Number(data.totalClients || 0);
          let incomingStage = String(data.stage || 'idle');

          if (manualRunActive) {
            if (incomingTotal <= 0 && lastStableTotal > 0) {
              currentState.totalClients = lastStableTotal;
            } else {
              currentState.totalClients = incomingTotal;
              if (incomingTotal > 0) {
                lastStableTotal = Math.max(lastStableTotal, incomingTotal);
              }
            }

            const stableCursorCandidate = Math.max(incomingCursor, incomingStoredCursor, lastStableCursor);
            // Quando stage === 'done', preservar o cursor final (não deixar zerar)
            currentState.displayCursor = incomingStage === 'done'
              ? Math.max(incomingCursor, incomingStoredCursor, lastStableCursor)
              : (currentState.totalClients > 0 ? stableCursorCandidate : incomingCursor);

            if (currentState.displayCursor > lastStableCursor) {
              lastStableCursor = currentState.displayCursor;
            }

            if (incomingStage === 'idle' && lastStableStage !== 'done' && currentState.displayCursor > 0) {
              incomingStage = lastStableStage;
            } else if (incomingStage !== 'idle') {
              lastStableStage = incomingStage;
            }
          } else {
            currentState.totalClients = incomingTotal;
            currentState.displayCursor = incomingCursor;
            if (incomingTotal > 0) {
              lastStableTotal = incomingTotal;
              lastStableCursor = incomingCursor;
              if (incomingStage !== 'idle') {
                lastStableStage = incomingStage;
              }
            }
          }

          currentState = {
            running: incomingRunning,
            cursor: incomingStoredCursor,
            displayCursor: currentState.displayCursor,
            totalClients: currentState.totalClients,
            stage: incomingStage,
            staleByHeartbeat: !!data.staleByHeartbeat,
            heartbeatAgeMs: Number(data.heartbeatAgeMs || 0)
          };

          updateProgressDisplay();
          updateStatusBadge();

          // Lógica de auto-resume
          if (!currentState.running && !lockUi && manualRunActive) {
            const total = currentState.totalClients || 0;
            const cursor = currentState.displayCursor || 0;

            if (total > 0 && cursor < total) {
              showMessage('Aguardando retomada automática (' + cursor + '/' + total + ')...', 'warn');
              scheduleAutoResume(data);
            } else if (total > 0 && cursor >= total) {
              manualRunActive = false;
              showMessage('Atualização concluída com sucesso! Fechando em 5 segundos...', 'success');
              clearAutoResumeTimer();
              scheduleWindowClose();
            } else {
              hideMessage();
              clearAutoResumeTimer();
            }
          } else if (currentState.running) {
            clearAutoResumeTimer();
          }

          updateButtonStates();
          // sucesso: resetar backoff e agendar próxima consulta
          backoffAttempts = 0;
          scheduleNextPoll(pollingIntervalMs);
          return data;
        } catch (e) {
          showMessage('Erro de conexão: ' + (e?.message || e), 'error');
          return null;
        }
      }

      // ==================== START UPDATE ====================
      async function startUpdate(forceRestart = false) {
        clearAutoResumeTimer();
        autoResumeAttempts = 0;
        lastAutoResumeCursor = -1;
        const wasManualRunActive = manualRunActive;
        manualRunActive = true;
        lockUi = true;
        if (!wasManualRunActive || updateStartTime <= 0) {
          updateStartTime = Date.now();
        }

        // Preserve previous state during resume
        const prevState = { ...currentState };

        updateButtonStates();
        showMessage(forceRestart ? 'Retomando atualização...' : 'Iniciando atualização...', 'warn');

        try {
          const statusData = await fetchStatus();
          if (statusData && statusData.running) {
            showMessage('Atualização já em andamento. Aguarde...', 'warn');
            lockUi = false;
            return;
          }

          // If resume and cursor regressed, keep the best known progress on screen
          if (forceRestart && prevState.displayCursor > 0 && currentState.displayCursor < prevState.displayCursor) {
            currentState.displayCursor = prevState.displayCursor;
            currentState.totalClients = Math.max(prevState.totalClients || 0, currentState.totalClients || 0);
            updateProgressDisplay();
          }

          const query = new URLSearchParams({
            batchSize,
            force: forceRestart ? '1' : force,
            reset,
            databaseOnly,
            owner: ownerId,
            maxMs: maxMsParam
          }).toString();

          const res = await fetch('/api/update-now?' + query, {
            method: 'POST',
            headers: {
              accept: 'application/json',
              'x-cron-secret': secret
            },
            cache: 'no-store'
          });

          const data = await res.json();
          if (res.status === 409 || (data && data.running)) {
            showMessage('Atualização em andamento por outro usuário/processo.', 'warn');
            await fetchStatus();
            lockUi = false;
            return;
          }

          if (!res.ok || !data || data.ok === false) {
            showMessage((data && data.error) ? data.error : 'Falha ao iniciar atualização.', 'error');
            manualRunActive = false;
            lockUi = false;
            updateButtonStates();
            return;
          }

          showMessage(forceRestart ? 'Retomada iniciada. Sincronizando dados...' : 'Atualização iniciada. Sincronizando dados...', 'warn');
          await fetchStatus();
        } catch (e) {
          showMessage('Erro ao iniciar: ' + (e?.message || e), 'error');
          manualRunActive = false;
        } finally {
          lockUi = false;
          updateButtonStates();
        }
      }

      // ==================== EVENT LISTENERS ====================
      startBtn.addEventListener('click', () => startUpdate(false));
      refreshBtn.addEventListener('click', fetchStatus);
      forceBtn.addEventListener('click', () => startUpdate(true));

      // ==================== INICIALIZAÇÃO ====================
      currentState = {
        ...initialState,
        displayCursor: initialState.cursor
      };
      updateProgressDisplay();
      updateStatusBadge();
      updateButtonStates();
      hideMessage();

      // Polling mais agressivo para melhor responsividade (1s) com backoff
      fetchStatus();
      scheduleNextPoll(pollingIntervalMs);
    })();
  </script>
</body>
</html>`;
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
  const batchSize = Math.max(5, Number(batchSizeParam || process.env.UPDATE_BATCH_SIZE || 10));
  const forceParam = req && req.query ? req.query.force : getQueryValue(req, 'force');
  const force = String(forceParam || '').toLowerCase() === 'true' || String(forceParam || '') === '1';

  const resetRaw = req && req.query ? req.query.reset : getQueryValue(req, 'reset');
  const resetCursor = String(resetRaw || '').toLowerCase() === 'true' || String(resetRaw || '') === '1';

  const dbOnlyRaw = req && req.query ? req.query.databaseOnly : getQueryValue(req, 'databaseOnly');
  const databaseOnly = String(dbOnlyRaw || '').toLowerCase() === 'true' || String(dbOnlyRaw || '') === '1';
  const ownerParam = req && req.query ? req.query.owner : getQueryValue(req, 'owner');
  const owner = String(ownerParam || '').trim().slice(0, 120);

  const method = String(req && req.method || 'GET').toUpperCase();

  if (method === 'POST' || isJsonRequest(req)) {
    try {
      const active = await isJobActiveNow();
      if (active.running && !(force && active.lockMeta && active.lockMeta.staleByHeartbeat)) {
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

      const maxMsParam = req.query?.maxMs || getQueryValue(req, 'maxMs');
      const parsedMax = Number(maxMsParam);
      const maxMs = Number.isFinite(parsedMax) && parsedMax >= 10000
        ? Math.max(10000, parsedMax)
        : Math.max(10000, Number(process.env.CRON_MAX_RUNTIME_MS || 25000));

      const result = await runFullUpdateJob({
        batchSize,
        maxMs,
        rejectIfRunning: true,
        force,
        resetCursor,
        owner,
        includeSupervisor: !databaseOnly,
        includeDashboards: !databaseOnly
      });

      if (!result || !result.ok) {
        if (result && result.running) {
          return sendJsonResponse(res, {
            ok: false,
            running: true,
            reason: result.reason || 'job_already_running',
            state: result.state
          }, 409);
        }
        return sendJsonResponse(res, {
          ok: false,
          error: result && result.error ? result.error : 'Execução falhou'
        }, 500);
      }

      let continuation = null;
      const shouldAutoContinue = result.reason === 'time_budget_reached' || result.reason === 'insufficient_time_for_dashboards';
      if (shouldAutoContinue) {
        continuation = await triggerNextCycle(req, {
          path: '/api/update-now',
          query: {
            batchSize,
            force: '0',
            reset: '0',
            databaseOnly: databaseOnly ? '1' : '0'
          }
        });
      }

      return sendJsonResponse(res, {
        ok: true,
        started: true,
        finished: result.finished,
        message: result.finished
          ? 'Atualização concluída com sucesso.'
          : 'Atualização parcial concluída. O restante será processado no próximo ciclo.',
        iterations: result.iterations,
        totalProcessed: result.totalProcessed,
        refreshInterval: 1500,
        continuation
      }, result.finished ? 200 : 202);
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

  try {
    const active = await isJobActiveNow();
    const html = renderHtmlPage({
      secret,
      batchSize,
      force,
      resetCursor,
      databaseOnly,
      maxMs: Number(process.env.CRON_MAX_RUNTIME_MS || 240000),
      initialState: {
        running: active.running,
        stage: active && active.state ? active.state.stage : 'idle',
        cursor: active && active.state ? active.state.progressCursor || active.state.cursor || 0 : 0,
        totalClients: active && active.state ? active.state.totalClients || 0 : 0
      }
    });
    return sendHtml(res, html, 200);
  } catch (error) {
    return sendHtml(res, `<h1>500 - Erro</h1><p>${error && error.message ? error.message : 'Erro ao carregar página'}</p>`, 500);
  }
};



