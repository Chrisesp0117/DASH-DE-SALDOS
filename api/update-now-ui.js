/**
 * update-now-ui.js — Monitor de fila (Formato A)
 *
 * Mudanças em relação à versão anterior:
 *  - Sem auto-chain / fetch recursivo / retry de continuação. O servidor retorna
 *    202 imediato ao enfileirar; não há nada a "forçar" do navegador.
 *  - Sem botão "Forçar Retomada" (a fila + reenqueueStaleRunning lidam com isso).
 *  - Sem CRON_SECRET opcionalmente aceitável por URL (?secret=...) — legado mantido.
 *  - Sem system-strip (Lock, leaseRemainingMs, sync text): detalhe técnico que só
 *    Rica confusão ao usuário final.
 *  - Layout minimalista: anel de progresso stroke 6, cantos 14px, espaçamentos
 *    generosos, fonte system stack com tracking apurado, paleta laranja mantida.
 *  - Activity-log discreto (no máximo 4 linhas, fonte 11px).
 *  - Polling de status a cada 2s (baixo custo, sem spam — estado no Postgres).
 */

function renderHtmlPage(params) {
  const initialStateJson = JSON.stringify(params.initialState || { running: false, cursor: 0, totalClients: 0, stage: 'idle' });
  const secret = String(params.secret || '');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>FINANCE DASH — Monitor de Fila</title>
  <style>
    :root {
      --bg: #0d0d0d;
      --card: #161616;
      --ink: #f4f4f5;
      --muted: #71717a;
      --line: #232323;
      --primary: #ff9500;
      --primary-soft: rgba(255, 149, 0, 0.12);
      --success: #10b981;
      --warn: #f59e0b;
      --error: #ef4444;
      --ring-bg: #2a2a2a;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0; padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", "SF Pro Display", system-ui, sans-serif;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      letter-spacing: -0.011em;
      background: var(--bg);
      color: var(--ink);
      min-height: 100vh;
    }
    body {
      background:
        radial-gradient(ellipse 60% 40% at 50% -10%, rgba(255, 149, 0, 0.06), transparent),
        linear-gradient(180deg, #0a0a0a 0%, #0d0d0d 40%, #0d0d0d 100%);
    }
    .container {
      max-width: 580px;
      margin: 0 auto;
      padding: 32px 20px;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    .card {
      background: var(--card);
      border-radius: 14px;
      border: 1px solid var(--line);
      padding: 28px;
      position: relative;
    }

    /* HEADER */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 28px;
    }
    .brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .brand-mark {
      width: 36px; height: 36px; border-radius: 9px;
      background: linear-gradient(135deg, var(--primary), #e68400);
      display: flex; align-items: center; justify-content: center;
      font-weight: 800; font-size: 12px; color: #000;
      letter-spacing: 0.04em;
      box-shadow: 0 2px 8px rgba(255, 149, 0, 0.18);
    }
    .brand-name {
      font-size: 14px; font-weight: 600; letter-spacing: 0.08em;
      text-transform: uppercase; line-height: 1.2;
    }
    .brand-sub { font-size: 11px; color: var(--muted); margin-top: 1px; }

    .status-badge {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 4px 10px; border-radius: 999px;
      font-size: 10px; font-weight: 600; letter-spacing: 0.06em;
      text-transform: uppercase; flex-shrink: 0;
      transition: all 0.25s ease;
    }
    .status-dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
    .status-badge.idle { color: var(--muted); background: rgba(113, 113, 122, 0.08); }
    .status-badge.running { color: var(--primary); background: var(--primary-soft); }
    .status-badge.running .status-dot { animation: pulseDot 1.6s ease-in-out infinite; }
    .status-badge.completed { color: var(--success); background: rgba(16, 185, 129, 0.08); }
    @keyframes pulseDot { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.75); } }

    /* PIPELINE */
    .pipeline {
      display: flex; justify-content: space-between;
      margin-bottom: 28px; position: relative; padding: 0 12px;
    }
    .pipeline::before {
      content: ''; position: absolute; top: 13px; left: 18%; right: 18%; height: 1px;
      background: var(--line); z-index: 0;
    }
    .step {
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      position: relative; z-index: 1;
    }
    .step-bubble {
      width: 26px; height: 26px; border-radius: 50%;
      border: 1px solid var(--line); background: var(--card);
      display: flex; align-items: center; justify-content: center;
      font-size: 10px; font-weight: 600; color: var(--muted);
      transition: all 0.3s ease;
    }
    .step-label {
      font-size: 10px; color: var(--muted); text-align: center;
      letter-spacing: 0.02em; line-height: 1.2;
    }
    .step.done .step-bubble {
      border-color: var(--success); color: var(--success); background: var(--card);
    }
    .step.done .step-bubble::after {
      content: '\\2713'; font-size: 11px; font-weight: 700;
    }
    .step.done .step-bubble span { display: none; }
    .step.active .step-bubble {
      border-color: var(--primary); color: var(--primary); background: var(--primary-soft);
      box-shadow: 0 0 0 4px rgba(255, 149, 0, 0.08);
      animation: stepPulse 2.4s ease-in-out infinite;
    }
    @keyframes stepPulse {
      0%, 100% { box-shadow: 0 0 0 4px rgba(255, 149, 0, 0.08); }
      50% { box-shadow: 0 0 0 7px rgba(255, 149, 0, 0.05); }
    }

    /* HERO — anel + contagem */
    .hero {
      display: flex; align-items: center; gap: 24px;
      margin-bottom: 24px;
    }
    .ring {
      position: relative; width: 88px; height: 88px; flex-shrink: 0;
    }
    .ring svg { transform: rotate(-90deg); width: 100%; height: 100%; }
    .ring-bg { fill: none; stroke: var(--ring-bg); stroke-width: 6; }
    .ring-fill {
      fill: none; stroke: var(--primary); stroke-width: 6; stroke-linecap: round;
      stroke-dasharray: 251.3; stroke-dashoffset: 251.3;
      transition: stroke-dashoffset 0.5s ease, stroke 0.3s ease;
    }
    .ring.done .ring-fill { stroke: var(--success); }
    .ring-center {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
    }
    .ring-pct {
      font-size: 17px; font-weight: 700; color: var(--primary);
      font-variant-numeric: tabular-nums; letter-spacing: -0.02em;
    }
    .ring.done .ring-pct { color: var(--success); }

    .meta { flex: 1; min-width: 0; }
    .meta-count {
      font-size: 24px; font-weight: 700; font-variant-numeric: tabular-nums;
      letter-spacing: -0.025em; line-height: 1;
    }
    .meta-count span { color: var(--muted); font-weight: 500; }
    .meta-stage {
      font-size: 12px; color: var(--muted);
      margin-top: 6px; letter-spacing: 0.01em;
    }
    .meta-client {
      font-size: 11px; color: var(--ink); margin-top: 4px;
      min-height: 14px; max-width: 280px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      letter-spacing: 0.01em; font-weight: 500;
    }
    .meta-client:empty { display: none; }
    .meta-client::before {
      content: '👉 '; color: var(--primary); font-weight: 700;
    }

    /* BAR */
    .bar {
      height: 3px; background: var(--line); border-radius: 2px;
      overflow: hidden; margin-bottom: 6px;
    }
    .bar-fill {
      height: 100%; width: 0%;
      background: var(--primary);
      border-radius: 2px; transition: width 0.5s ease;
    }
    .bar-fill.running::after {
      content: ''; position: absolute; inset: 0;
      background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.25), transparent);
      animation: shimmer 2.4s linear infinite;
    }
    .bar-label {
      font-size: 9px; color: var(--muted); display: flex;
      justify-content: space-between; margin-bottom: 14px;
      letter-spacing: 0.02em; text-transform: uppercase;
    }
    @keyframes shimmer {
      0% { transform: translateX(-100%); }
      100% { transform: translateX(100%); }
    }
    .bar-wrap { position: relative; }

    /* METRICS */
    .metrics {
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;
      margin-bottom: 18px;
    }
    .metric {
      padding: 10px 12px; border-radius: 8px;
      background: rgba(255, 255, 255, 0.015);
      border: 1px solid var(--line);
    }
    .metric-label {
      font-size: 9px; color: var(--muted); text-transform: uppercase;
      letter-spacing: 0.08em; margin-bottom: 4px;
    }
    .metric-value {
      font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums;
    }

    /* LOG */
    .log {
      max-height: 88px; overflow-y: auto; margin-bottom: 20px;
      border-radius: 8px; background: rgba(0, 0, 0, 0.18);
      border: 1px solid var(--line);
    }
    .log:empty::before {
      content: 'Aguardando eventos';
      display: block; padding: 10px 12px;
      font-size: 10px; color: var(--muted); text-align: center;
      letter-spacing: 0.02em;
    }
    .log-item {
      display: flex; gap: 10px; padding: 7px 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.03);
      font-size: 11px; line-height: 1.45;
    }
    .log-item:last-child { border-bottom: 0; }
    .log-time { color: var(--muted); font-variant-numeric: tabular-nums; flex-shrink: 0; }
    .log-text { color: var(--ink); }
    .log-info .log-text { color: #a0a0a8; }
    .log-success .log-text { color: var(--success); }
    .log-warn .log-text { color: var(--warn); }
    .log-error .log-text { color: var(--error); }
    .log::-webkit-scrollbar { width: 4px; }
    .log::-webkit-scrollbar-thumb { background: var(--line); border-radius: 2px; }

    /* MESSAGE */
    .message {
      background: rgba(255, 255, 255, 0.02);
      border-left: 2px solid var(--primary);
      padding: 10px 14px; border-radius: 6px;
      font-size: 12px; margin-bottom: 20px;
      display: none; align-items: center; gap: 8px;
      animation: slideIn 0.25s ease;
    }
    .message.visible { display: flex; }
    .message.success { border-left-color: var(--success); color: #6ee7b7; }
    .message.error { border-left-color: var(--error); color: #fca5a5; }
    .message.warn { border-left-color: var(--warn); color: #fcd34d; }
    .message.info { color: #d4d4d8; }
    @keyframes slideIn {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: none; }
    }

    /* CONTROLS */
    .options {
      display: flex; align-items: center; gap: 14px;
      margin-bottom: 14px;
      font-size: 12px; color: var(--muted);
    }
    .check {
      display: flex; align-items: center; gap: 7px;
      cursor: pointer; user-select: none;
      transition: color 0.2s ease;
    }
    .check:hover { color: var(--ink); }
    .check input { display: none; }
    .check-box {
      width: 14px; height: 14px; border-radius: 4px;
      border: 1px solid var(--line); background: transparent;
      display: flex; align-items: center; justify-content: center;
      transition: all 0.2s ease; flex-shrink: 0;
    }
    .check input:checked + .check-box {
      background: var(--primary); border-color: var(--primary);
    }
    .check input:checked + .check-box::after {
      content: '\\2713'; font-size: 9px; color: #000; font-weight: 700;
    }

    /* BUTTONS */
    .actions {
      display: flex; gap: 8px;
    }
    .btn {
      padding: 11px 18px; border: 0; border-radius: 10px;
      font-size: 12px; font-weight: 600; cursor: pointer;
      transition: all 0.2s ease;
      display: flex; align-items: center; justify-content: center; gap: 7px;
      letter-spacing: 0.01em;
    }
    .btn:hover:not([disabled]) { transform: translateY(-1px); }
    .btn[disabled] { opacity: 0.4; cursor: not-allowed; transform: none; }
    .btn-primary {
      flex: 1;
      background: linear-gradient(135deg, var(--primary), #e68400);
      color: #000; font-weight: 700;
      box-shadow: 0 2px 12px rgba(255, 149, 0, 0.18);
    }
    .btn-secondary {
      background: transparent; color: var(--ink);
      border: 1px solid var(--line);
    }
    .btn-secondary:hover:not([disabled]) {
      border-color: var(--primary); color: var(--primary);
    }
    .spinner {
      width: 13px; height: 13px;
      border: 2px solid rgba(0, 0, 0, 0.2); border-radius: 50%;
      border-top-color: #000; animation: spin 0.7s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* FOOTER */
    .footer {
      margin-top: 22px; padding-top: 18px;
      border-top: 1px solid var(--line);
      text-align: center; font-size: 10px; color: var(--muted);
      letter-spacing: 0.04em;
    }

    @media (max-width: 520px) {
      .container { padding: 20px 14px; }
      .card { padding: 22px; }
      .hero { gap: 18px; }
      .meta-count { font-size: 20px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="header">
        <div class="brand">
          <div class="brand-mark">FD</div>
          <div>
            <div class="brand-name">FINANCE DASH</div>
            <div class="brand-sub">Monitor de fila</div>
          </div>
        </div>
        <div class="status-badge idle" id="badge">
          <span class="status-dot"></span>
          <span id="badge-text">Aguardando</span>
        </div>
      </div>

      <div class="pipeline" id="pipeline">
        <div class="step" data-step="0"><div class="step-bubble"><span>1</span></div><div class="step-label">Base de Dados</div></div>
        <div class="step" data-step="1"><div class="step-bubble"><span>2</span></div><div class="step-label">Supervisor</div></div>
        <div class="step" data-step="2"><div class="step-bubble"><span>3</span></div><div class="step-label">Painéis</div></div>
        <div class="step" data-step="3"><div class="step-bubble"><span>4</span></div><div class="step-label">Concluído</div></div>
      </div>

      <div class="hero">
        <div class="ring" id="ring">
          <svg viewBox="0 0 100 100">
            <circle class="ring-bg" cx="50" cy="50" r="40"/>
            <circle class="ring-fill" id="ring-fill" cx="50" cy="50" r="40"/>
          </svg>
          <div class="ring-center"><span class="ring-pct" id="pct">0%</span></div>
        </div>
        <div class="meta">
          <div class="meta-count"><span id="cursor">0</span><span> / </span><span id="total">0</span></div>
          <div class="meta-stage" id="stage">Inativo</div>
          <div class="meta-client" id="current-client"></div>
        </div>
      </div>

      <div class="bar-wrap">
        <div class="bar"><div class="bar-fill" id="bar"></div></div>
        <div class="bar-label"><span id="phase-label">Inativo</span><span id="stage-pct">0%</span></div>
      </div>

      <div class="metrics">
        <div class="metric"><div class="metric-label">Tempo</div><div class="metric-value" id="elapsed">0s</div></div>
        <div class="metric"><div class="metric-label">Velocidade</div><div class="metric-value" id="throughput">\\u2014</div></div>
        <div class="metric"><div class="metric-label">ETA</div><div class="metric-value" id="eta">\\u2014</div></div>
      </div>

      <div class="log" id="log"></div>

      <div class="message" id="msg">
        <span id="msg-text"></span>
      </div>

      <div class="options">
        <label class="check">
          <input type="checkbox" id="opt-reset" />
          <span class="check-box"></span>
          Resetar cursor (iniciar ciclo novo)
        </label>
      </div>

      <div class="actions">
        <button id="btn-start" class="btn btn-primary">
          <span id="btn-spinner" class="spinner" style="display:none"></span>
          <span id="btn-text">Iniciar Atualização</span>
        </button>
        <button id="btn-refresh" class="btn btn-secondary">Atualizar Status</button>
      </div>

      <div class="footer">Fila · continuação server-side · apps script de 1 min</div>
    </div>
  </div>

  <script>
    (() => {
      const initialState = ${initialStateJson};
      const secret = ${JSON.stringify(secret)};

      const RING_CIRC = 251.3;
      const POLL_MS = 1500;

      const $ = (id) => document.getElementById(id);
      const badge = $('badge');
      const badgeText = $('badge-text');
      const ringFill = $('ring-fill');
      const ring = $('ring');
      const pct = $('pct');
      const cursorEl = $('cursor');
      const totalEl = $('total');
      const stageEl = $('stage');
      const bar = $('bar');
      const elapsed = $('elapsed');
      const throughput = $('throughput');
      const eta = $('eta');
      const log = $('log');
      const msg = $('msg');
      const msgText = $('msg-text');
      const btnStart = $('btn-start');
      const btnStartText = $('btn-text');
      const btnSpinner = $('btn-spinner');
      const btnRefresh = $('btn-refresh');
      const optReset = $('opt-reset');
      const pipeline = $('pipeline');
      const phaseLabel = $('phase-label');
      const stagePct = $('stage-pct');
      const currentClientEl = $('current-client');

      let activityEntries = [];
      let lastStage = '';
      let lastCursor = -1;
      let lastRunning = false;
      let startTime = 0;
      let busy = false;
      let pollTimer = null;
      let knownState = {
        running: false, cursor: 0, totalClients: 0, stage: 'idle',
        overallPercent: 0, stagePercent: 0, clienteAtual: '', stageDescription: 'Inativo', phaseLabel: 'Inativo'
      };

      let lastCliente = '';

      const STAGE_LABELS = {
        idle: 'Inativo',
        database: 'Processando base de dados',
        database_complete: 'Base processada',
        dashboards: 'Atualizando painéis',
        dashboards_pending: 'Painéis pendentes',
        supervisor: 'Processando supervisor',
        done: 'Concluído',
        paused: 'Pausado'
      };

      function stageLabel(s) { return STAGE_LABELS[s] || s; }

      function pipelineIndex(stage) {
        if (stage === 'done') return 3;
        if (stage === 'dashboards' || stage === 'dashboards_pending') return 2;
        if (stage === 'supervisor') return 1;
        if (stage === 'database' || stage === 'database_complete' || stage === 'paused') return 0;
        return -1;
      }

      function fmtTime(sec) {
        if (sec < 60) return Math.round(sec) + 's';
        const m = Math.floor(sec / 60), s = Math.round(sec % 60);
        return m + 'm ' + s + 's';
      }

      function fmtThroughput(c, sec) {
        if (sec < 1 || c === 0) return '\\u2014';
        const rps = c / sec;
        return rps < 1 ? (Math.round(rps * 100) / 100) + '/s' : (Math.round(rps * 10) / 10) + '/s';
      }

      function fmtEta(c, total, sec) {
        if (c <= 0 || total <= c || sec < 2) return '\\u2014';
        const remaining = (total - c) / (c / sec);
        return fmtTime(remaining);
      }

      function pushLog(text, type) {
        type = type || 'info';
        const t = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        activityEntries.unshift({ time: t, text: text, type: type });
        if (activityEntries.length > 4) activityEntries.length = 4;
        log.innerHTML = activityEntries.map(e =>
          '<div class="log-item log-' + e.type + '"><span class="log-time">' + e.time + '</span><span class="log-text">' + e.text + '</span></div>'
        ).join('');
      }

      function showMsg(text, type) {
        msg.className = 'message visible ' + (type || 'info');
        msgText.textContent = String(text || '');
      }
      function hideMsg() { msg.className = 'message'; }

      function updatePipeline(stage, running) {
        const idx = pipelineIndex(stage);
        const steps = pipeline.children;
        for (let i = 0; i < steps.length; i++) {
          steps[i].classList.remove('done', 'active');
          if (stage === 'done') steps[i].classList.add('done');
          else if (i < idx) steps[i].classList.add('done');
          else if (i === idx && idx >= 0 && (running || stage !== 'idle')) steps[i].classList.add('active');
        }
      }

      function updateBadge() {
        let cls = 'idle', label = 'Disponível';
        if (knownState.running) { cls = 'running'; label = 'Atualizando'; }
        else if (knownState.stage === 'done') { cls = 'completed'; label = 'Concluído'; }
        badge.className = 'status-badge ' + cls;
        badgeText.textContent = label;
      }

      function renderProgress() {
        const total = knownState.totalClients || 0;
        const c = knownState.cursor || 0;
        const overall = Math.min(100, Math.max(0, knownState.overallPercent || 0));
        const stagePctVal = Math.min(100, Math.max(0, knownState.stagePercent || 0));

        bar.style.width = overall + '%';
        bar.classList.toggle('running', !!knownState.running);
        pct.textContent = Math.round(overall) + '%';
        ringFill.style.strokeDashoffset = String(RING_CIRC * (1 - overall / 100));
        ring.classList.toggle('done', knownState.stage === 'done');

        cursorEl.textContent = c;
        totalEl.textContent = total;
        stageEl.textContent = knownState.stageDescription || stageLabel(knownState.stage);
        stagePct.textContent = Math.round(stagePctVal) + '%';
        phaseLabel.textContent = knownState.phaseLabel || stageLabel(knownState.stage);

        if (knownState.clienteAtual && knownState.stage !== 'done' && knownState.stage !== 'idle') {
          currentClientEl.textContent = knownState.clienteAtual;
        } else {
          currentClientEl.textContent = '';
        }

        if (startTime > 0) {
          const sec = (Date.now() - startTime) / 1000;
          elapsed.textContent = fmtTime(sec);
          throughput.textContent = fmtThroughput(c, sec);
          eta.textContent = fmtEta(c, total, sec);
        }
        updatePipeline(knownState.stage, knownState.running);
      }

      function updateButtons() {
        btnStart.disabled = busy || knownState.running;
        btnSpinner.style.display = (busy || knownState.running) ? 'inline-block' : 'none';
        if (knownState.running) btnStartText.textContent = 'Atualizando...';
        else if (knownState.stage === 'done') btnStartText.textContent = 'Nova Atualização';
        else btnStartText.textContent = 'Iniciar Atualização';
      }

      function trackChanges() {
        const s = knownState.stage;
        const c = knownState.cursor;
        const r = knownState.running;
        const cli = knownState.clienteAtual || '';
        if (s !== lastStage && s !== 'idle') {
          pushLog('Etapa: ' + (knownState.phaseLabel || stageLabel(s)), 'info');
          lastStage = s;
        }
        if (cli && cli !== lastCliente && (s === 'database' || s === 'paused')) {
          pushLog('Atualizando: ' + cli, 'info');
          lastCliente = cli;
        }
        if (!cli) lastCliente = '';
        if (c >= 0 && lastCursor >= 0 && c - lastCursor >= 5) pushLog(c + ' clientes processados', 'info');
        if (r !== lastRunning) {
          pushLog(r ? 'Job em execução no servidor' : (s === 'done' ? 'Atualização concluída' : 'Job pausado entre ticks'), r ? 'info' : (s === 'done' ? 'success' : 'warn'));
          lastRunning = r;
        }
        lastCursor = c;
      }

      function schedulePoll(ms) {
        if (pollTimer) clearTimeout(pollTimer);
        pollTimer = setTimeout(() => { pollTimer = null; fetchStatus(); }, Math.max(500, ms || POLL_MS));
      }

      async function fetchStatus() {
        try {
          const res = await fetch('/api/update-status', {
            method: 'GET',
            headers: { accept: 'application/json', 'x-cron-secret': secret },
            cache: 'no-store'
          });
          if (!res.ok) {
            showMsg('Erro ao consultar status (HTTP ' + res.status + ')', 'error');
            schedulePoll(POLL_MS);
            return;
          }
          const data = await res.json();
          if (data.ok === false) {
            showMsg('Status indisponível: ' + (data.error || 'desconhecido'), 'error');
            schedulePoll(POLL_MS);
            return;
          }

          // Lógica simples com a fila: cursor e totalClients vêm direto do job_state.
          knownState = {
            running: !!data.running,
            stage: String(data.stage || 'idle'),
            cursor: Number(data.displayCursor || data.cursor || 0),
            totalClients: Number(data.totalClients || 0),
            overallPercent: Number(data.overallPercent || 0),
            stagePercent: Number(data.stagePercent || 0),
            clienteAtual: String(data.clienteAtual || ''),
            stageDescription: String(data.stageDescription || ''),
            phaseLabel: String(data.phaseLabel || '')
          };

          if (knownState.running && startTime === 0) startTime = Date.now();
          if (knownState.stage === 'done') {
            hideMsg();
            if (knownState.running === false && lastRunning === false && startTime > 0) {
              // detectado fim
            }
          }

          trackChanges();
          renderProgress();
          updateBadge();
          updateButtons();

          if (knownState.running) showMsg('Atualização em andamento no servidor. Aguarde...', 'info');
          else if (knownState.stage === 'done' && knownState.cursor > 0) {
            showMsg('Atualização concluída com sucesso!', 'success');
            startTime = 0;
          }
          schedulePoll(POLL_MS);
        } catch (e) {
          showMsg('Erro de conexão: ' + (e && e.message ? e.message : String(e)), 'error');
          schedulePoll(POLL_MS);
        }
      }

      async function startJob() {
        if (busy) return;
        busy = true;
        updateButtons();
        showMsg('Enfileirando atualização...', 'info');

        const params = new URLSearchParams({ secret: secret, triggered_by: 'manual' });
        if (optReset.checked) params.set('reset', '1');

        try {
          const res = await fetch('/api/cron/enqueue?' + params.toString(), {
            method: 'POST',
            headers: { accept: 'application/json', 'x-cron-secret': secret },
            cache: 'no-store'
          });
          const data = await res.json().catch(() => ({}));

          if (!res.ok || data.ok === false) {
            showMsg('Falha ao enfileirar: ' + (data.error || 'HTTP ' + res.status), 'error');
            pushLog('Enfileiramento falhou', 'error');
            busy = false;
            updateButtons();
            return;
          }

          showMsg('Job enfileirado. O worker (Apps Script) processará em até 1 min.', 'info');
          pushLog('Job enfileirado \\u2192 fila #' + (data.jobId || '-'), 'success');
          startTime = Date.now();
          optReset.checked = false;
          schedulePoll(800);
        } catch (e) {
          showMsg('Erro ao enfileirar: ' + (e && e.message ? e.message : String(e)), 'error');
        } finally {
          busy = false;
          updateButtons();
        }
      }

      btnStart.addEventListener('click', startJob);
      btnRefresh.addEventListener('click', () => { fetchStatus(); });

      // Inicialização
      knownState = {
        running: !!initialState.running,
        stage: String(initialState.stage || 'idle'),
        cursor: Number(initialState.cursor || 0),
        totalClients: Number(initialState.totalClients || 0),
        overallPercent: 0,
        stagePercent: 0,
        clienteAtual: '',
        stageDescription: stageLabel(String(initialState.stage || 'idle')),
        phaseLabel: stageLabel(String(initialState.stage || 'idle'))
      };
      if (knownState.running) startTime = Date.now();
      renderProgress();
      updateBadge();
      updateButtons();
      fetchStatus();
      schedulePoll(POLL_MS);
    })();
  </script>
</body>
</html>`;
}

module.exports = { renderHtmlPage };
