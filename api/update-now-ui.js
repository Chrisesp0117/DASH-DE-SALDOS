function renderHtmlPage(params) {
  const initialStateJson = JSON.stringify(params.initialState || { running: false, cursor: 0, totalClients: 0, stage: 'idle' });
  const secret = String(params.secret || '');
  const batchSize = Number(params.batchSize || 10);
  const force = params.force ? '1' : '0';
  const reset = params.resetCursor ? '1' : '0';
  const databaseOnly = params.databaseOnly ? '1' : '0';
  const maxMs = Number(params.maxMs || 150000);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>FINANCE DASH — Atualização</title>
  <style>
    :root {
      --bg: #0f0f0f;
      --card: #1a1a1a;
      --ink: #ffffff;
      --muted: #a0aec0;
      --line: #333333;
      --primary: #ff9500;
      --primary-dark: #e68400;
      --success: #10b981;
      --warn: #f59e0b;
      --error: #ef4444;
      --info: #06b6d4;
      --ring-bg: #2a2a2a;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0; padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--ink);
      min-height: 100vh;
    }
    body {
      background:
        radial-gradient(ellipse 80% 50% at 50% -10%, rgba(255,149,0,0.12), transparent),
        linear-gradient(160deg, #0a0a0a, #141414 50%, #0f0f0f);
    }
    .container {
      max-width: 640px;
      margin: 0 auto;
      padding: 16px;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    .card {
      background: var(--card);
      border-radius: 20px;
      border: 1px solid rgba(255,149,0,0.15);
      box-shadow: 0 24px 64px rgba(0,0,0,0.45);
      padding: 24px;
      position: relative;
      overflow: hidden;
    }
    .card::before {
      content: '';
      position: absolute; top: 0; left: 0; right: 0; height: 1px;
      background: linear-gradient(90deg, transparent, rgba(255,149,0,0.45), transparent);
    }
    .header-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 20px;
    }
    .brand-header { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .brand-logo { width: 44px; height: 44px; object-fit: contain; border-radius: 8px; filter: drop-shadow(0 2px 6px rgba(255,149,0,0.3)); }
    .brand-fallback {
      display: none; width: 44px; height: 44px; border-radius: 8px;
      background: linear-gradient(135deg, var(--primary), var(--primary-dark));
      align-items: center; justify-content: center;
      font-weight: 800; font-size: 13px; color: #000;
    }
    .brand-text h1 {
      margin: 0; font-size: 18px; font-weight: 800;
      letter-spacing: 0.08em; text-transform: uppercase; line-height: 1.2;
    }
    .brand-text p { margin: 2px 0 0; font-size: 11px; color: var(--muted); }
    .status-badge {
      display: inline-flex; align-items: center; gap: 7px;
      padding: 5px 11px; border-radius: 20px;
      font-size: 10px; font-weight: 700; letter-spacing: 0.04em;
      text-transform: uppercase; flex-shrink: 0;
    }
    .status-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
    .status-badge.idle { background: rgba(160,174,192,0.1); color: var(--muted); border: 1px solid rgba(160,174,192,0.2); }
    .status-badge.running { background: rgba(255,149,0,0.12); color: var(--primary); border: 1px solid rgba(255,149,0,0.3); }
    .status-badge.running .status-dot { animation: pulseDot 1.4s infinite; }
    .status-badge.completed { background: rgba(16,185,129,0.12); color: var(--success); border: 1px solid rgba(16,185,129,0.3); }
    .status-badge.stale { background: rgba(239,68,68,0.12); color: var(--error); border: 1px solid rgba(239,68,68,0.3); }
    @keyframes pulseDot { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(.8)} }

    .pipeline {
      display: flex; align-items: flex-start; justify-content: space-between;
      margin-bottom: 20px; position: relative; gap: 4px;
    }
    .pipeline::before {
      content: ''; position: absolute; top: 14px; left: 8%; right: 8%; height: 2px;
      background: var(--line); z-index: 0;
    }
    .pipeline-step {
      flex: 1; display: flex; flex-direction: column; align-items: center;
      gap: 6px; position: relative; z-index: 1; min-width: 0;
    }
    .step-circle {
      width: 28px; height: 28px; border-radius: 50%;
      border: 2px solid var(--line); background: var(--bg);
      display: flex; align-items: center; justify-content: center;
      font-size: 11px; font-weight: 700; color: var(--muted);
      transition: all 0.35s ease;
    }
    .step-label {
      font-size: 9px; color: var(--muted); text-align: center;
      text-transform: uppercase; letter-spacing: 0.03em; line-height: 1.2;
      max-width: 72px;
    }
    .pipeline-step.done .step-circle {
      border-color: var(--success); background: rgba(16,185,129,0.15); color: var(--success);
    }
    .pipeline-step.active .step-circle {
      border-color: var(--primary); background: rgba(255,149,0,0.15); color: var(--primary);
      box-shadow: 0 0 12px rgba(255,149,0,0.35);
      animation: stepPulse 2s infinite;
    }
    .pipeline-step.stale .step-circle {
      border-color: var(--error); background: rgba(239,68,68,0.15); color: var(--error);
    }
    @keyframes stepPulse { 0%,100%{box-shadow:0 0 8px rgba(255,149,0,0.25)} 50%{box-shadow:0 0 16px rgba(255,149,0,0.5)} }

    .hero-progress { display: flex; align-items: center; gap: 20px; margin-bottom: 16px; }
    .ring-wrap { position: relative; width: 100px; height: 100px; flex-shrink: 0; }
    .ring-wrap svg { transform: rotate(-90deg); width: 100%; height: 100%; }
    .ring-bg { fill: none; stroke: var(--ring-bg); stroke-width: 8; }
    .ring-fill {
      fill: none; stroke: var(--primary); stroke-width: 8; stroke-linecap: round;
      stroke-dasharray: 326.7; stroke-dashoffset: 326.7;
      transition: stroke-dashoffset 0.45s ease, stroke 0.3s ease;
    }
    .ring-wrap.done .ring-fill { stroke: var(--success); }
    .ring-center {
      position: absolute; inset: 0;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
    }
    .hero-pct { font-size: 20px; font-weight: 800; color: var(--primary); font-variant-numeric: tabular-nums; }
    .ring-wrap.done .hero-pct { color: var(--success); }
    .hero-counts { flex: 1; min-width: 0; }
    .hero-ratio {
      font-size: 28px; font-weight: 800; font-variant-numeric: tabular-nums; line-height: 1;
    }
    .hero-ratio span { color: var(--muted); font-size: 16px; font-weight: 600; }
    .hero-stage { font-size: 12px; color: var(--muted); margin-top: 4px; }
    .progress-bar {
      height: 4px; background: var(--line); border-radius: 4px;
      overflow: hidden; margin-bottom: 12px;
    }
    .progress-fill {
      height: 100%; width: 0%;
      background: linear-gradient(90deg, var(--primary), var(--primary-dark));
      border-radius: 4px; transition: width 0.4s ease; position: relative;
    }
    .progress-fill.running::after {
      content: ''; position: absolute; inset: 0;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent);
      animation: shimmer 2s infinite;
    }
    @keyframes shimmer { 0%{transform:translateX(-100%)} 100%{transform:translateX(100%)} }

    .metrics-row {
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 14px;
    }
    .metric {
      background: rgba(0,0,0,0.35); border: 1px solid var(--line);
      border-radius: 10px; padding: 10px 8px; text-align: center;
    }
    .metric-label {
      font-size: 9px; color: var(--muted); text-transform: uppercase;
      letter-spacing: 0.05em; margin-bottom: 4px;
    }
    .metric-value {
      font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums;
    }
    .metric-value.accent { color: var(--primary); }

    .system-strip {
      display: none; flex-wrap: wrap; gap: 8px 16px;
      padding: 10px 12px; margin-bottom: 14px;
      background: rgba(0,0,0,0.3); border: 1px solid var(--line); border-radius: 10px;
      font-size: 11px; color: var(--muted);
    }
    .system-strip.visible { display: flex; }
    .system-item { display: flex; align-items: center; gap: 5px; }
    .system-item strong { color: var(--ink); font-weight: 600; }
    .sys-dot { width: 5px; height: 5px; border-radius: 50%; }
    .sys-dot.ok { background: var(--success); }
    .sys-dot.warn { background: var(--warn); }
    .sys-dot.err { background: var(--error); }

    .activity-log {
      margin-bottom: 16px; max-height: 110px; overflow-y: auto;
      border: 1px solid var(--line); border-radius: 10px;
      background: rgba(0,0,0,0.25);
    }
    .activity-log:empty::before {
      content: 'Nenhum evento ainda';
      display: block; padding: 12px; font-size: 11px; color: var(--muted); text-align: center;
    }
    .log-item {
      display: flex; gap: 10px; padding: 8px 12px;
      border-bottom: 1px solid rgba(255,255,255,0.04);
      font-size: 11px; line-height: 1.4;
    }
    .log-item:last-child { border-bottom: 0; }
    .log-time { color: var(--muted); font-variant-numeric: tabular-nums; flex-shrink: 0; }
    .log-info .log-text { color: var(--info); }
    .log-success .log-text { color: var(--success); }
    .log-warn .log-text { color: var(--warn); }
    .log-error .log-text { color: var(--error); }

    .message-box {
      background: rgba(0,0,0,0.35); border-left: 3px solid var(--info);
      padding: 12px 14px; border-radius: 8px; font-size: 12px;
      margin-bottom: 16px; display: none; align-items: flex-start; gap: 8px;
      animation: slideIn 0.25s ease;
    }
    .message-box.visible { display: flex; }
    .message-box.error { border-left-color: var(--error); background: rgba(61,21,21,0.6); color: #fca5a5; }
    .message-box.success { border-left-color: var(--success); background: rgba(20,61,47,0.6); color: #a7f3d0; }
    .message-box.warn { border-left-color: var(--warn); background: rgba(42,32,16,0.8); color: #fcd34d; }
    .message-box.info { border-left-color: var(--info); color: #a5f3fc; }
    @keyframes slideIn { from{opacity:0;transform:translateY(-6px)} to{opacity:1;transform:none} }

    .actions { display: flex; flex-direction: column; gap: 8px; }
    .actions-row { display: flex; gap: 8px; }
    button {
      padding: 12px 16px; border: 0; border-radius: 10px;
      font-size: 13px; font-weight: 600; cursor: pointer;
      transition: all 0.2s ease;
      display: flex; align-items: center; justify-content: center; gap: 8px;
    }
    button:hover:not([disabled]) { transform: translateY(-1px); }
    button[disabled] { opacity: 0.55; cursor: not-allowed; transform: none; }
    .btn-primary {
      width: 100%;
      background: linear-gradient(135deg, var(--primary), var(--primary-dark));
      color: #000; font-weight: 700;
      box-shadow: 0 4px 16px rgba(255,149,0,0.25);
    }
    .btn-primary:hover:not([disabled]) { box-shadow: 0 6px 20px rgba(255,149,0,0.35); }
    .btn-secondary {
      flex: 1; background: transparent; color: var(--ink);
      border: 1px solid var(--line);
    }
    .btn-secondary:hover:not([disabled]) { border-color: var(--primary); color: var(--primary); }
    .btn-danger {
      flex: 1; background: transparent; color: var(--error);
      border: 1px solid rgba(239,68,68,0.4);
    }
    .btn-danger:hover:not([disabled]) { background: rgba(239,68,68,0.12); }
    .btn-icon { width: 16px; height: 16px; flex-shrink: 0; }
    .spinner {
      width: 16px; height: 16px;
      border: 2px solid rgba(0,0,0,0.2); border-radius: 50%;
      border-top-color: #000; animation: spin 0.7s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .footer {
      margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line);
      text-align: center; font-size: 10px; color: var(--muted); letter-spacing: 0.02em;
    }
    @media (max-width: 520px) {
      .pipeline { flex-direction: column; align-items: stretch; gap: 10px; }
      .pipeline::before { display: none; }
      .pipeline-step { flex-direction: row; gap: 10px; }
      .step-label { text-align: left; max-width: none; font-size: 10px; }
      .hero-progress { flex-direction: column; align-items: center; text-align: center; }
      .metrics-row { grid-template-columns: repeat(2, 1fr); }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="header-row">
        <div class="brand-header">
          <div class="brand-logo-wrap">
            <img id="brandLogo" class="brand-logo" src="/assets/finance-dash/logo.png" alt="FINANCE DASH" />
            <div id="brandFallback" class="brand-fallback">FD</div>
          </div>
          <div class="brand-text">
            <h1>FINANCE DASH</h1>
            <p>Sincronização de saldos</p>
          </div>
        </div>
        <div class="status-badge idle" id="statusBadge"><span class="status-dot"></span><span id="statusBadgeText">Aguardando</span></div>
      </div>

      <div class="pipeline" id="pipeline">
        <div class="pipeline-step pending" data-step="0"><div class="step-circle">1</div><span class="step-label">Base de Dados</span></div>
        <div class="pipeline-step pending" data-step="1"><div class="step-circle">2</div><span class="step-label">Supervisor</span></div>
        <div class="pipeline-step pending" data-step="2"><div class="step-circle">3</div><span class="step-label">Painéis</span></div>
        <div class="pipeline-step pending" data-step="3"><div class="step-circle">4</div><span class="step-label">Concluído</span></div>
      </div>

      <div class="hero-progress">
        <div class="ring-wrap" id="ringWrap">
          <svg viewBox="0 0 120 120"><circle class="ring-bg" cx="60" cy="60" r="52"/><circle class="ring-fill" id="ringFill" cx="60" cy="60" r="52"/></svg>
          <div class="ring-center"><span class="hero-pct" id="progressPercent">0%</span></div>
        </div>
        <div class="hero-counts">
          <div class="hero-ratio"><span id="cursorDisplay">0</span><span> / </span><span id="totalDisplay">0</span></div>
          <div class="hero-stage" id="stageName">Inativo</div>
        </div>
      </div>

      <div class="progress-bar"><div class="progress-fill" id="progressFill"></div></div>

      <div class="metrics-row">
        <div class="metric"><div class="metric-label">Tempo</div><div class="metric-value" id="elapsedTime">0s</div></div>
        <div class="metric"><div class="metric-label">Velocidade</div><div class="metric-value accent" id="throughput">—</div></div>
        <div class="metric"><div class="metric-label">ETA</div><div class="metric-value" id="etaDisplay">—</div></div>
      </div>

      <div class="system-strip" id="systemStrip">
        <div class="system-item"><span class="sys-dot ok" id="heartbeatDot"></span><span id="heartbeatText">Sinal —</span></div>
        <div class="system-item"><span>Lock:</span><strong id="leaseText">—</strong></div>
        <div class="system-item"><span id="modeText">Modo —</span></div>
        <div class="system-item"><span>Sync:</span><strong id="syncText">—</strong></div>
      </div>

      <div class="activity-log" id="activityLog"></div>

      <div id="messageBox" class="message-box">
        <div class="message-text" id="messageText"></div>
      </div>

      <div class="actions">
        <button id="startBtn" class="btn-primary">
          <span id="startBtnSpinner" class="spinner" style="display:none"></span>
          <span id="startBtnText">Iniciar Atualização</span>
        </button>
        <div class="actions-row">
          <button id="refreshBtn" class="btn-secondary">
            <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
            Atualizar Status
          </button>
          <button id="forceBtn" class="btn-danger" style="display:none">
            <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            Forçar Retomada
          </button>
        </div>
      </div>

      <div class="footer">Bloqueio automático · multiusuário · continuação server-side</div>
    </div>
  </div>

  <script>
    (() => {
      const initialState = ${initialStateJson};
      const secret = ${JSON.stringify(secret)};
      const batchSize = ${JSON.stringify(String(batchSize))};
      const force = ${JSON.stringify(force)};
      const reset = ${JSON.stringify(reset)};
      const databaseOnly = ${JSON.stringify(databaseOnly)};
      const maxMsParam = ${JSON.stringify(String(maxMs))};
      const RING_CIRC = 326.7;

      const startBtn = document.getElementById('startBtn');
      const refreshBtn = document.getElementById('refreshBtn');
      const forceBtn = document.getElementById('forceBtn');
      const statusBadge = document.getElementById('statusBadge');
      const statusBadgeText = document.getElementById('statusBadgeText');
      const messageBox = document.getElementById('messageBox');
      const messageText = document.getElementById('messageText');
      const progressFill = document.getElementById('progressFill');
      const progressPercent = document.getElementById('progressPercent');
      const stageName = document.getElementById('stageName');
      const cursorDisplay = document.getElementById('cursorDisplay');
      const totalDisplay = document.getElementById('totalDisplay');
      const elapsedTime = document.getElementById('elapsedTime');
      const throughput = document.getElementById('throughput');
      const etaDisplay = document.getElementById('etaDisplay');
      const startBtnText = document.getElementById('startBtnText');
      const startBtnSpinner = document.getElementById('startBtnSpinner');
      const ringFill = document.getElementById('ringFill');
      const ringWrap = document.getElementById('ringWrap');
      const pipelineEl = document.getElementById('pipeline');
      const systemStrip = document.getElementById('systemStrip');
      const activityLog = document.getElementById('activityLog');
      const brandLogo = document.getElementById('brandLogo');
      const brandFallback = document.getElementById('brandFallback');
      const heartbeatDot = document.getElementById('heartbeatDot');
      const heartbeatText = document.getElementById('heartbeatText');
      const leaseText = document.getElementById('leaseText');
      const modeText = document.getElementById('modeText');
      const syncText = document.getElementById('syncText');

      brandLogo.onerror = function() {
        brandLogo.style.display = 'none';
        brandFallback.style.display = 'flex';
      };

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
      let chainFallbackNeeded = false;
      let lastContinuationReason = '';
      let pollingTimer = null;
      let pollingIntervalMs = 500;
      let backoffAttempts = 0;
      const MAX_BACKOFF_ATTEMPTS = 6;
      const BASE_BACKOFF_MS = 1000;

      let activityEntries = [];
      let lastSeenStage = '';
      let lastSeenCursor = -1;
      let lastSeenRunning = false;
      let lastMeta = {};

      const savedState = sessionStorage.getItem('updateProgress');
      const savedTime = parseInt(sessionStorage.getItem('updateStartTime') || '0', 10);
      const shouldRestoreState = savedState && (Date.now() - savedTime) < 300000 && savedTime > 0;

      let currentState = shouldRestoreState ? JSON.parse(savedState) : {
        running: false, cursor: 0, totalClients: 0, stage: 'idle', displayCursor: 0
      };
      if (shouldRestoreState && savedTime > 0) updateStartTime = savedTime;

      function getStageLabel(stage) {
        const labels = {
          idle: 'Inativo',
          database: 'Processando base de dados',
          database_complete: 'Base processada',
          dashboards: 'Atualizando painéis',
          dashboards_pending: 'Painéis pendentes',
          done: 'Concluído',
          supervisor: 'Processando supervisor',
          paused: 'Pausado'
        };
        return labels[stage] || stage;
      }

      function getPipelineIndex(stage) {
        if (stage === 'done') return 3;
        if (stage === 'dashboards' || stage === 'dashboards_pending') return 2;
        if (stage === 'supervisor') return 1;
        if (stage === 'database' || stage === 'database_complete' || stage === 'paused') return 0;
        return -1;
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
        return rps < 1 ? (Math.round(rps * 100) / 100) + '/s' : (Math.round(rps * 10) / 10) + '/s';
      }

      function formatEta(cursor, total, elapsedSec) {
        if (cursor <= 0 || total <= cursor || elapsedSec < 2) return '—';
        const remaining = ((total - cursor) / (cursor / elapsedSec));
        return formatTime(remaining);
      }

      function pushActivity(text, type) {
        type = type || 'info';
        const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        activityEntries.unshift({ time: time, text: text, type: type });
        if (activityEntries.length > 6) activityEntries.length = 6;
        activityLog.innerHTML = activityEntries.map(function(e) {
          return '<div class="log-item log-' + e.type + '"><span class="log-time">' + e.time + '</span><span class="log-text">' + e.text + '</span></div>';
        }).join('');
      }

      function trackActivityChanges(data) {
        const stage = String(currentState.stage || 'idle');
        const cursor = currentState.displayCursor || 0;
        const running = !!currentState.running;
        if (stage !== lastSeenStage && stage !== 'idle') {
          pushActivity('Etapa: ' + getStageLabel(stage), 'info');
          lastSeenStage = stage;
        }
        if (cursor >= 0 && lastSeenCursor >= 0 && cursor - lastSeenCursor >= 5) {
          pushActivity(cursor + ' clientes processados', 'info');
        }
        if (running !== lastSeenRunning) {
          pushActivity(running ? 'Job em execução no servidor' : (stage === 'done' ? 'Atualização concluída' : 'Job pausado entre fatias'), running ? 'info' : (stage === 'done' ? 'success' : 'warn'));
          lastSeenRunning = running;
        }
        lastSeenCursor = cursor;
      }

      function updatePipeline(stage, running, stale) {
        const activeIdx = getPipelineIndex(stage);
        const steps = pipelineEl.querySelectorAll('.pipeline-step');
        steps.forEach(function(step, i) {
          step.classList.remove('pending', 'active', 'done', 'stale');
          if (stage === 'done') {
            step.classList.add('done');
            step.querySelector('.step-circle').textContent = '✓';
          } else if (i < activeIdx) {
            step.classList.add('done');
            step.querySelector('.step-circle').textContent = '✓';
          } else if (i === activeIdx && activeIdx >= 0 && (running || stage !== 'idle')) {
            step.classList.add(stale ? 'stale' : 'active');
            step.querySelector('.step-circle').textContent = String(i + 1);
          } else {
            step.classList.add('pending');
            step.querySelector('.step-circle').textContent = String(i + 1);
          }
        });
      }

      function updateSystemStrip(data) {
        if (!data || (!data.running && !manualRunActive)) {
          systemStrip.classList.remove('visible');
          return;
        }
        systemStrip.classList.add('visible');
        const hbMs = Number(data.heartbeatAgeMs || 0);
        const hbSec = Math.round(hbMs / 1000);
        if (data.staleByHeartbeat) {
          heartbeatDot.className = 'sys-dot err';
          heartbeatText.textContent = 'Sinal stale (' + hbSec + 's)';
        } else if (hbSec < 30) {
          heartbeatDot.className = 'sys-dot ok';
          heartbeatText.textContent = 'Sinal há ' + hbSec + 's';
        } else {
          heartbeatDot.className = 'sys-dot warn';
          heartbeatText.textContent = 'Sinal há ' + hbSec + 's';
        }
        const leaseMs = Number(data.leaseRemainingMs || 0);
        leaseText.textContent = leaseMs > 0 ? formatTime(leaseMs / 1000) : '—';
        modeText.textContent = chainFallbackNeeded ? 'Fallback local ativo' : 'Continuação server-side';
        const updatedAt = data.state && data.state.updatedAt ? data.state.updatedAt : '';
        if (updatedAt) {
          try {
            syncText.textContent = new Date(updatedAt).toLocaleTimeString('pt-BR');
          } catch (_) { syncText.textContent = '—'; }
        } else {
          syncText.textContent = '—';
        }
      }

      function showMessage(text, type) {
        type = type || 'info';
        messageBox.className = 'message-box visible ' + type;
        messageText.textContent = String(text || '').trim() || 'Operação em andamento';
      }

      function hideMessage() {
        messageBox.className = 'message-box';
      }

      function clearAutoResumeTimer() {
        if (autoResumeTimer) { clearTimeout(autoResumeTimer); autoResumeTimer = null; }
      }

      function scheduleNextPoll(delayMs) {
        if (pollingTimer) clearTimeout(pollingTimer);
        pollingTimer = setTimeout(function() { pollingTimer = null; fetchStatus(); }, Math.max(0, Number(delayMs || pollingIntervalMs)));
      }

      function updateProgressDisplay() {
        const total = currentState.totalClients || 0;
        const cursor = currentState.displayCursor || 0;
        const pct = total > 0 ? Math.min(100, Math.max(0, Math.round((cursor / total) * 100))) : 0;

        progressFill.style.width = pct + '%';
        progressFill.classList.toggle('running', !!currentState.running);
        progressPercent.textContent = pct + '%';
        ringFill.style.strokeDashoffset = String(RING_CIRC * (1 - pct / 100));
        ringWrap.classList.toggle('done', currentState.stage === 'done');
        cursorDisplay.textContent = cursor;
        totalDisplay.textContent = total;
        stageName.textContent = getStageLabel(currentState.stage);

        if (updateStartTime > 0) {
          const elapsed = (Date.now() - updateStartTime) / 1000;
          elapsedTime.textContent = formatTime(elapsed);
          throughput.textContent = formatThroughput(cursor, elapsed);
          etaDisplay.textContent = formatEta(cursor, total, elapsed);
        }
        updatePipeline(currentState.stage, currentState.running, currentState.staleByHeartbeat);
      }

      function updateStatusBadge() {
        let cls = 'idle';
        let label = 'Aguardando';
        if (currentState.staleByHeartbeat) { cls = 'stale'; label = 'Travado'; }
        else if (currentState.running) { cls = 'running'; label = 'Atualizando'; }
        else if (currentState.stage === 'done') { cls = 'completed'; label = 'Concluído'; }
        else if (manualRunActive) { cls = 'running'; label = 'Monitorando'; }
        statusBadge.className = 'status-badge ' + cls;
        statusBadgeText.textContent = label;
      }

      function updateButtonStates() {
        const hasProgress = manualRunActive && currentState.totalClients > 0 && currentState.displayCursor < currentState.totalClients;
        const shouldDisable = manualRunActive && hasProgress && !currentState.running && !chainFallbackNeeded;
        startBtn.disabled = currentState.running || lockUi || shouldDisable;
        forceBtn.style.display = currentState.staleByHeartbeat ? 'flex' : 'none';
        forceBtn.disabled = !currentState.staleByHeartbeat || lockUi;
        startBtnSpinner.style.display = (lockUi || (currentState.running && manualRunActive)) ? 'inline-block' : 'none';

        if (currentState.running) startBtnText.textContent = 'Atualizando...';
        else if (shouldDisable && chainFallbackNeeded) startBtnText.textContent = 'Retomando...';
        else if (manualRunActive && hasProgress) startBtnText.textContent = 'Monitorando...';
        else startBtnText.textContent = 'Iniciar Atualização';
      }

      function scheduleAutoResume() {
        const total = currentState.totalClients || 0;
        const cursor = currentState.displayCursor || 0;
        if (cursor > lastAutoResumeCursor) { lastAutoResumeCursor = cursor; autoResumeAttempts = 0; }
        if (!chainFallbackNeeded || currentState.running || lockUi || !manualRunActive || total <= 0 || cursor >= total) {
          clearAutoResumeTimer(); return;
        }
        if (autoResumeAttempts >= 8) {
          clearAutoResumeTimer(); manualRunActive = false; chainFallbackNeeded = false;
          showMessage('Continuação automática falhou' + (lastContinuationReason ? ' (' + lastContinuationReason + ')' : '') + '.', 'error');
          pushActivity('Fallback esgotado', 'error');
          updateButtonStates(); return;
        }
        if (autoResumeTimer) return;
        autoResumeTimer = setTimeout(async function() {
          autoResumeTimer = null; autoResumeAttempts += 1;
          if (!lockUi && manualRunActive && chainFallbackNeeded) {
            showMessage('Retomando (fallback ' + autoResumeAttempts + '/8)...', 'warn');
            await startUpdate(true);
          }
        }, 300);
      }

      async function fetchStatus() {
        try {
          const res = await fetch('/api/update-status', {
            method: 'GET',
            headers: { accept: 'application/json', 'x-cron-secret': secret },
            cache: 'no-store'
          });
          let data = null;
          let isQuota = res.status === 429;
          try {
            data = await res.json();
            if (data && data.error && String(data.error).toLowerCase().includes('quota')) isQuota = true;
          } catch (_) { data = null; }

          if (isQuota) {
            backoffAttempts = Math.min(MAX_BACKOFF_ATTEMPTS, backoffAttempts + 1);
            const delay = Math.min(BASE_BACKOFF_MS * Math.pow(2, backoffAttempts), 60000) + Math.floor(Math.random() * 500);
            showMessage('Google Sheets atingiu limite. Retentando em ' + Math.round(delay / 1000) + 's', 'warn');
            scheduleNextPoll(delay); return null;
          }

          if (!data || data.ok === false) {
            showMessage('Erro ao consultar status: ' + (typeof data?.error === 'string' ? data.error : 'desconhecido'), 'error');
            scheduleNextPoll(pollingIntervalMs); return null;
          }

          lastMeta = data;
          const incomingRunning = !!data.running;
          const incomingCursor = Number(data.displayCursor || data.cursor || 0);
          const incomingStoredCursor = Number(data.cursor || 0);
          const incomingTotal = Number(data.totalClients || 0);
          let incomingStage = String(data.stage || 'idle');

          if (manualRunActive) {
            if (incomingTotal <= 0 && lastStableTotal > 0) currentState.totalClients = lastStableTotal;
            else {
              currentState.totalClients = incomingTotal;
              if (incomingTotal > 0) lastStableTotal = Math.max(lastStableTotal, incomingTotal);
            }
            const stable = Math.max(incomingCursor, incomingStoredCursor, lastStableCursor);
            currentState.displayCursor = incomingStage === 'done' ? Math.max(incomingCursor, incomingStoredCursor, lastStableCursor) : (currentState.totalClients > 0 ? stable : incomingCursor);
            if (currentState.displayCursor > lastStableCursor) lastStableCursor = currentState.displayCursor;
            if (incomingStage === 'idle' && lastStableStage !== 'done' && currentState.displayCursor > 0) incomingStage = lastStableStage;
            else if (incomingStage !== 'idle') lastStableStage = incomingStage;
          } else {
            currentState.totalClients = incomingTotal;
            currentState.displayCursor = incomingCursor;
            if (incomingTotal > 0) { lastStableTotal = incomingTotal; lastStableCursor = incomingCursor; if (incomingStage !== 'idle') lastStableStage = incomingStage; }
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

          sessionStorage.setItem('updateProgress', JSON.stringify(currentState));
          sessionStorage.setItem('updateStartTime', String(updateStartTime));

          trackActivityChanges(data);
          updateProgressDisplay();
          updateStatusBadge();
          updateSystemStrip(data);

          if (!currentState.running && !lockUi && manualRunActive) {
            const total = currentState.totalClients || 0;
            const cursor = currentState.displayCursor || 0;
            if (total > 0 && cursor < total) {
              if (chainFallbackNeeded) {
                showMessage('Continuação falhou. Retomando localmente (' + cursor + '/' + total + ')...', 'warn');
                scheduleAutoResume();
              } else {
                showMessage('Atualização em andamento no servidor (' + cursor + '/' + total + '). Aguarde...', 'info');
                clearAutoResumeTimer();
              }
            } else if (total > 0 && cursor >= total && currentState.stage === 'done') {
              manualRunActive = false; chainFallbackNeeded = false;
              showMessage('Atualização concluída com sucesso!', 'success');
              clearAutoResumeTimer();
              sessionStorage.removeItem('updateProgress');
              sessionStorage.removeItem('updateStartTime');
            } else { hideMessage(); clearAutoResumeTimer(); }
          } else if (currentState.running) {
            showMessage('Atualização automática em andamento — aguarde conclusão', 'info');
            clearAutoResumeTimer();
          }

          updateButtonStates();
          backoffAttempts = 0;
          scheduleNextPoll(pollingIntervalMs);
          return data;
        } catch (e) {
          showMessage('Erro de conexão: ' + (e?.message || String(e)), 'error');
          return null;
        }
      }

      async function startUpdate(forceRestart) {
        clearAutoResumeTimer();
        if (!forceRestart) { chainFallbackNeeded = false; lastContinuationReason = ''; }
        autoResumeAttempts = 0; lastAutoResumeCursor = -1;
        const wasActive = manualRunActive;
        manualRunActive = true; lockUi = true;
        if (!wasActive || updateStartTime <= 0) updateStartTime = Date.now();
        const prevState = Object.assign({}, currentState);
        updateButtonStates();
        showMessage(forceRestart ? 'Retomando atualização...' : 'Iniciando atualização...', 'warn');
        if (!forceRestart) pushActivity('Iniciando atualização', 'info');

        try {
          const statusData = await fetchStatus();
          if (statusData && statusData.running) {
            showMessage('Atualização já em andamento. Monitorando progresso...', 'info');
            lockUi = false; updateButtonStates(); return;
          }
          if (forceRestart && prevState.displayCursor > 0 && currentState.displayCursor < prevState.displayCursor) {
            currentState.displayCursor = prevState.displayCursor;
            currentState.totalClients = Math.max(prevState.totalClients || 0, currentState.totalClients || 0);
            updateProgressDisplay();
          }
          const query = new URLSearchParams({ batchSize: batchSize, force: forceRestart ? '1' : force, reset: reset, databaseOnly: databaseOnly, owner: ownerId, maxMs: maxMsParam }).toString();
          const res = await fetch('/api/update-now?' + query, {
            method: 'POST',
            headers: { accept: 'application/json', 'x-cron-secret': secret },
            cache: 'no-store'
          });
          const data = await res.json();

          if (res.status === 409 || (data && data.running)) {
            showMessage(data.message || 'Atualização já em andamento. Monitorando...', 'info');
            pushActivity('Job em andamento — modo monitor', 'info');
            chainFallbackNeeded = false; lockUi = false; updateButtonStates(); return;
          }
          if (!res.ok || !data || data.ok === false) {
            showMessage('Falha: ' + (typeof data?.error === 'string' ? data.error : 'desconhecido'), 'error');
            pushActivity('Falha ao iniciar', 'error');
            manualRunActive = false; chainFallbackNeeded = false; lockUi = false; updateButtonStates(); return;
          }
          if (data.continuation) {
            lastContinuationReason = String(data.continuation.reason || '');
            chainFallbackNeeded = data.continuation.scheduled === false;
            if (chainFallbackNeeded) pushActivity('Chain falhou: ' + lastContinuationReason, 'warn');
          } else if (data.finished) chainFallbackNeeded = false;

          showMessage(data.finished ? 'Atualização concluída!' : (chainFallbackNeeded ? 'Fatia ok. Tentando continuar localmente...' : 'Fatia ok. Continuação server-side...'), data.finished ? 'success' : 'warn');
          await fetchStatus();
        } catch (e) {
          showMessage('Erro ao iniciar: ' + (e?.message || String(e)), 'error');
          manualRunActive = false;
        } finally {
          lockUi = false; updateButtonStates();
        }
      }

      startBtn.addEventListener('click', function() { startUpdate(false); });
      refreshBtn.addEventListener('click', fetchStatus);
      forceBtn.addEventListener('click', function() { startUpdate(true); });

      currentState = Object.assign({}, initialState, { displayCursor: initialState.cursor || 0 });
      if (currentState.running || currentState.displayCursor > 0) manualRunActive = true;
      updateProgressDisplay();
      updateStatusBadge();
      updateButtonStates();
      if (currentState.running) updateSystemStrip({ running: true, heartbeatAgeMs: 0, leaseRemainingMs: 0, state: {} });
      hideMessage();
      fetchStatus();
      scheduleNextPoll(pollingIntervalMs);
    })();
  </script>
</body>
</html>`;
}

module.exports = { renderHtmlPage };
