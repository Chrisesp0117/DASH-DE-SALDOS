/**
 * app-ui.js — Página única do FINANCE DASH (abas: Atualizações + Configurações)
 *
 * GET /api/update-now?secret=... → HTML desta página.
 *
 *  - Aba "Atualizações": monitor de fila (pipeline, anel de progresso, log)
 *  - Aba "Configurações": fonte de dados (tokens do ambiente) + lista única
 *    de contas Google/Meta com ícones, filtro por plataforma e seleção por
 *    checkbox. Ao marcar o check e salvar, a conta entra na planilha.
 *    O campo MCC/Login é detectado automaticamente (hierarquia do gerenciador)
 *    e a descoberta roda sozinha quando a aba é aberta.
 *
 * Protegida pelo mesmo CRON_SECRET da página de monitor.
 */

function getQueryValue(req, key) {
  try {
    const host = String(req && req.headers && (req.headers.host || req.headers.Host) || 'dash-de-saldos.vercel.app');
    const base = 'https://' + host;
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

function renderAppPage(params) {
  const secret = String(params && params.secret || '');
  const initialStateJson = JSON.stringify(params.initialState || { running: false, cursor: 0, totalClients: 0, stage: 'idle' });

  const ICON_GOOGLE = '<svg width="15" height="15" viewBox="0 0 18 18" style="flex-shrink:0" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.13-.84 2.08-1.8 2.72v2.26h2.91c1.7-1.57 2.68-3.87 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33C2.44 15.98 5.44 18 9 18z"/><path fill="#FBBC05" d="M3.96 10.71c-.18-.54-.28-1.12-.28-1.71s.1-1.17.28-1.71V4.96H.96C.35 6.17 0 7.55 0 9s.35 2.83.96 4.04l3-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.57-2.58C13.46.93 11.43 0 9 0 5.44 0 2.44 2.02.96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58z"/></svg>';
  const ICON_META = '<svg width="15" height="15" viewBox="0 0 24 24" style="flex-shrink:0" aria-hidden="true"><path fill="#1877F2" d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.03 1.79-4.7 4.53-4.7 1.31 0 2.69.24 2.69.24v2.97h-1.51c-1.5 0-1.96.93-1.96 1.89v2.26h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07z"/></svg>';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>FINANCE DASH</title>
  <style>
    :root {
      --bg: #0d0d0d;
      --card: #161616;
      --card-2: #1d1d1d;
      --ink: #f4f4f5;
      --muted: #71717a;
      --line: #232323;
      --primary: #ff9500;
      --primary-soft: rgba(255, 149, 0, 0.12);
      --success: #10b981;
      --warn: #f59e0b;
      --error: #ef4444;
      --google: #34a853;
      --google-soft: rgba(52, 168, 83, 0.12);
      --meta: #1877f2;
      --meta-soft: rgba(24, 119, 242, 0.12);
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
    .container { max-width: 960px; margin: 0 auto; padding: 32px 20px 80px; }
    .card {
      background: var(--card); border-radius: 14px; border: 1px solid var(--line);
      padding: 26px; margin-bottom: 18px;
    }

    /* HEADER + TABS */
    .header {
      display: flex; align-items: center; justify-content: space-between;
      gap: 12px; margin-bottom: 14px;
    }
    .brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .brand-mark {
      width: 36px; height: 36px; border-radius: 9px;
      background: linear-gradient(135deg, var(--primary), #e68400);
      display: flex; align-items: center; justify-content: center;
      font-weight: 800; font-size: 12px; color: #000; letter-spacing: 0.04em;
      box-shadow: 0 2px 8px rgba(255, 149, 0, 0.18);
    }
    .brand-name { font-size: 14px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; line-height: 1.2; }
    .brand-sub { font-size: 11px; color: var(--muted); margin-top: 1px; }
    .status-badge {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 4px 10px; border-radius: 999px;
      font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; flex-shrink: 0;
      transition: all 0.25s ease;
    }
    .status-dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
    .status-badge.idle { color: var(--muted); background: rgba(113, 113, 122, 0.08); }
    .status-badge.running { color: var(--primary); background: var(--primary-soft); }
    .status-badge.running .status-dot { animation: pulseDot 1.6s ease-in-out infinite; }
    .status-badge.completed { color: var(--success); background: rgba(16, 185, 129, 0.08); }
    @keyframes pulseDot { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.75); } }

    .tabs { display: flex; gap: 6px; margin-bottom: 20px; }
    .tab {
      padding: 9px 16px; border-radius: 10px; cursor: pointer;
      background: transparent; color: var(--muted); border: 1px solid var(--line);
      font-size: 12px; font-weight: 600; letter-spacing: 0.02em;
      display: inline-flex; align-items: center; gap: 7px;
      transition: all 0.2s ease; font-family: inherit;
    }
    .tab:hover { color: var(--ink); border-color: #333; }
    .tab.active { color: var(--primary); border-color: var(--primary); background: var(--primary-soft); }
    .tab-body { display: none; }
    .tab-body.active { display: block; }

    .section-title { font-size: 13px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; margin: 0 0 4px; }
    .section-desc { font-size: 12px; color: var(--muted); margin: 0 0 18px; line-height: 1.5; }

    /* PIPELINE */
    .pipeline { display: flex; justify-content: space-between; margin-bottom: 28px; position: relative; padding: 0 12px; }
    .pipeline::before { content: ''; position: absolute; top: 13px; left: 18%; right: 18%; height: 1px; background: var(--line); z-index: 0; }
    .step { display: flex; flex-direction: column; align-items: center; gap: 8px; position: relative; z-index: 1; }
    .step-bubble {
      width: 26px; height: 26px; border-radius: 50%;
      border: 1px solid var(--line); background: var(--card);
      display: flex; align-items: center; justify-content: center;
      font-size: 10px; font-weight: 600; color: var(--muted); transition: all 0.3s ease;
    }
    .step-label { font-size: 10px; color: var(--muted); text-align: center; letter-spacing: 0.02em; line-height: 1.2; }
    .step.done .step-bubble { border-color: var(--success); color: var(--success); }
    .step.done .step-bubble::after { content: '\\2713'; font-size: 11px; font-weight: 700; }
    .step.done .step-bubble span { display: none; }
    .step.active .step-bubble {
      border-color: var(--primary); color: var(--primary); background: var(--primary-soft);
      box-shadow: 0 0 0 4px rgba(255, 149, 0, 0.08);
      animation: stepPulse 2.4s ease-in-out infinite;
    }
    @keyframes stepPulse { 0%, 100% { box-shadow: 0 0 0 4px rgba(255, 149, 0, 0.08); } 50% { box-shadow: 0 0 0 7px rgba(255, 149, 0, 0.05); } }

    /* HERO */
    .hero { display: flex; align-items: center; gap: 24px; margin-bottom: 24px; }
    .ring { position: relative; width: 88px; height: 88px; flex-shrink: 0; }
    .ring svg { transform: rotate(-90deg); width: 100%; height: 100%; }
    .ring-bg { fill: none; stroke: var(--ring-bg); stroke-width: 6; }
    .ring-fill {
      fill: none; stroke: var(--primary); stroke-width: 6; stroke-linecap: round;
      stroke-dasharray: 251.3; stroke-dashoffset: 251.3;
      transition: stroke-dashoffset 0.5s ease, stroke 0.3s ease;
    }
    .ring.done .ring-fill { stroke: var(--success); }
    .ring-center { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
    .ring-pct { font-size: 17px; font-weight: 700; color: var(--primary); font-variant-numeric: tabular-nums; }
    .ring.done .ring-pct { color: var(--success); }
    .meta { flex: 1; min-width: 0; }
    .meta-count { font-size: 24px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -0.025em; line-height: 1; }
    .meta-count span { color: var(--muted); font-weight: 500; }
    .meta-stage { font-size: 12px; color: var(--muted); margin-top: 6px; }
    .meta-client {
      font-size: 11px; color: var(--ink); margin-top: 4px; min-height: 14px; max-width: 280px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500;
    }
    .meta-client:empty { display: none; }
    .meta-client::before { content: '👉 '; }

    /* BAR */
    .bar { height: 3px; background: var(--line); border-radius: 2px; overflow: hidden; margin-bottom: 6px; }
    .bar-fill { height: 100%; width: 0%; background: var(--primary); border-radius: 2px; transition: width 0.5s ease; }
    .bar-label { font-size: 9px; color: var(--muted); display: flex; justify-content: space-between; margin-bottom: 14px; letter-spacing: 0.02em; text-transform: uppercase; }

    /* METRICS */
    .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 18px; }
    .metric { padding: 10px 12px; border-radius: 8px; background: rgba(255, 255, 255, 0.015); border: 1px solid var(--line); }
    .metric-label { font-size: 9px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; }
    .metric-value { font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; }

    /* LOG */
    .log { max-height: 88px; overflow-y: auto; margin-bottom: 20px; border-radius: 8px; background: rgba(0, 0, 0, 0.18); border: 1px solid var(--line); }
    .log:empty::before { content: 'Aguardando eventos'; display: block; padding: 10px 12px; font-size: 10px; color: var(--muted); text-align: center; }
    .log-item { display: flex; gap: 10px; padding: 7px 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.03); font-size: 11px; line-height: 1.45; }
    .log-item:last-child { border-bottom: 0; }
    .log-time { color: var(--muted); font-variant-numeric: tabular-nums; flex-shrink: 0; }
    .log-text { color: var(--ink); }
    .log-info .log-text { color: #a0a0a8; }
    .log-success .log-text { color: var(--success); }
    .log-warn .log-text { color: var(--warn); }
    .log-error .log-text { color: var(--error); }

    /* MESSAGE */
    .message {
      background: rgba(255, 255, 255, 0.02); border-left: 2px solid var(--primary);
      padding: 10px 14px; border-radius: 6px; font-size: 12px; margin-bottom: 20px;
      display: none; align-items: center; gap: 8px;
    }
    .message.visible { display: flex; }
    .message.success { border-left-color: var(--success); color: #6ee7b7; }
    .message.error { border-left-color: var(--error); color: #fca5a5; }
    .message.warn { border-left-color: var(--warn); color: #fcd34d; }
    .message.info { color: #d4d4d8; }

    /* CONTROLS */
    .options { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; font-size: 12px; color: var(--muted); }
    .check { display: flex; align-items: center; gap: 7px; cursor: pointer; user-select: none; }
    .check:hover { color: var(--ink); }
    .check input { display: none; }
    .check-box { width: 14px; height: 14px; border-radius: 4px; border: 1px solid var(--line); display: flex; align-items: center; justify-content: center; transition: all 0.2s ease; flex-shrink: 0; }
    .check input:checked + .check-box { background: var(--primary); border-color: var(--primary); }
    .check input:checked + .check-box::after { content: '\\2713'; font-size: 9px; color: #000; font-weight: 700; }

    /* BUTTONS */
    .btn {
      padding: 11px 18px; border: 0; border-radius: 10px;
      font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.2s ease;
      display: inline-flex; align-items: center; justify-content: center; gap: 7px; font-family: inherit;
      white-space: nowrap;
    }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-primary { background: linear-gradient(135deg, var(--primary), #e68400); color: #000; font-weight: 700; box-shadow: 0 2px 12px rgba(255, 149, 0, 0.18); }
    .btn-primary:hover:not([disabled]) { filter: brightness(1.08); }
    .btn-secondary { background: transparent; color: var(--ink); border: 1px solid var(--line); }
    .btn-secondary:hover:not([disabled]) { border-color: var(--primary); color: var(--primary); }
    .btn-danger { background: transparent; color: var(--error); border: 1px solid rgba(239, 68, 68, 0.3); }
    .btn-danger:hover:not([disabled]) { background: rgba(239, 68, 68, 0.08); }
    .spinner {
      width: 13px; height: 13px; border: 2px solid rgba(0, 0, 0, 0.2); border-radius: 50%;
      border-top-color: #000; animation: spin 0.7s linear infinite; display: none;
    }
    .spinner.light { border-color: rgba(255, 255, 255, 0.2); border-top-color: #fff; }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* CONEXÕES / FONTE DE DADOS */
    .conn { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border: 1px solid var(--line); border-radius: 11px; margin-bottom: 10px; background: var(--card-2); }
    .conn > svg { flex-shrink: 0; }
    .conn-name { font-size: 13px; font-weight: 600; }
    .conn-status { font-size: 11px; color: var(--muted); margin-top: 2px; }
    .conn-status.on { color: var(--success); }
    .conn-status.err { color: var(--error); }

    /* TOOLBAR */
    .toolbar { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-bottom: 16px; }
    .spacer { flex: 1; }
    .chip-group { display: inline-flex; border: 1px solid var(--line); border-radius: 999px; overflow: hidden; }
    .chip {
      padding: 7px 14px; background: transparent; color: var(--muted); border: 0; cursor: pointer;
      font-size: 11px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px;
      font-family: inherit; transition: all 0.15s ease;
    }
    .chip + .chip { border-left: 1px solid var(--line); }
    .chip:hover { color: var(--ink); }
    .chip.active { background: var(--primary-soft); color: var(--primary); }
    .filter-input {
      background: var(--card-2); border: 1px solid var(--line); color: var(--ink);
      border-radius: 9px; padding: 8px 12px; font-size: 12px; width: 220px; outline: none; font-family: inherit;
    }
    .filter-input:focus { border-color: var(--primary); }

    /* TABELA DE CONTAS (lista única) */
    .acc-table { border: 1px solid var(--line); border-radius: 11px; overflow: hidden; }
    .acc-headrow, .acc-row {
      display: grid;
      grid-template-columns: 40px minmax(220px, 1.6fr) minmax(150px, 1fr) minmax(130px, 1fr) minmax(130px, 1fr);
      gap: 10px; align-items: center; padding: 10px 12px;
    }
    .acc-headrow {
      background: #111; font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
      text-transform: uppercase; color: var(--muted); border-bottom: 1px solid var(--line);
    }
    .acc-row { border-bottom: 1px solid var(--line); }
    .acc-row:last-child { border-bottom: none; }
    .acc-row.unchecked { opacity: 0.55; }
    .acc-check { width: 16px; height: 16px; accent-color: var(--primary); cursor: pointer; }
    .acc-identity { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .acc-identity > svg { flex-shrink: 0; margin-top: 2px; }
    .acc-name { font-size: 12px; font-weight: 600; line-height: 1.3; word-break: break-word; }
    .acc-id { font-size: 10px; color: var(--muted); margin-top: 1px; }
    .acc-flag { display: inline-block; margin-top: 3px; padding: 2px 7px; border-radius: 999px; font-size: 9px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
    .acc-flag.manager { background: rgba(245, 158, 11, 0.12); color: var(--warn); }
    .acc-flag.inactive { background: rgba(239, 68, 68, 0.12); color: var(--error); }
    .acc-flag.saved { background: var(--primary-soft); color: var(--primary); }
    .acc-input {
      width: 100%; background: var(--card-2); border: 1px solid var(--line);
      color: var(--ink); border-radius: 7px; padding: 7px 9px; font-size: 11px; outline: none; font-family: inherit;
    }
    .acc-input:focus { border-color: var(--primary); }

    /* DROPDOWN DE NOMES (gestor/supervisor) — componente custom */
    .ddwrap { position: relative; }
    .ddbox {
      width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 6px;
      background: var(--card-2); border: 1px solid var(--line); color: var(--ink);
      border-radius: 7px; padding: 7px 9px; font-size: 11px; cursor: pointer;
      font-family: inherit; text-align: left; min-width: 0;
    }
    .ddbox:hover { border-color: var(--primary); }
    .dd-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dd-label.vazio { color: var(--muted); }
    .dd-caret { color: var(--muted); font-size: 9px; flex-shrink: 0; }
    .dd-menu {
      position: fixed; z-index: 95; min-width: 220px; max-width: 340px; max-height: 300px; overflow-y: auto;
      background: #1c1c1c; border: 1px solid #333; border-radius: 10px; padding: 6px;
      display: none; box-shadow: 0 16px 50px rgba(0, 0, 0, 0.6);
    }
    .dd-menu.visible { display: block; }
    .dd-menu::-webkit-scrollbar { width: 4px; }
    .dd-menu::-webkit-scrollbar-thumb { background: var(--line); border-radius: 2px; }
    .dd-item { display: flex; align-items: center; gap: 6px; padding: 7px 9px; border-radius: 7px; cursor: pointer; font-size: 12px; }
    .dd-item:hover { background: rgba(255, 255, 255, 0.05); }
    .dd-item.selected { color: var(--primary); }
    .dd-item-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dd-del {
      flex-shrink: 0; width: 22px; height: 22px; border-radius: 5px;
      border: 1px solid rgba(239, 68, 68, 0.3); background: transparent; color: var(--error);
      cursor: pointer; font-size: 11px; padding: 0;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .dd-del:hover { background: rgba(239, 68, 68, 0.12); }
    .dd-new { color: var(--primary); font-weight: 600; border-top: 1px solid var(--line); margin-top: 4px; padding-top: 9px; border-radius: 0 0 7px 7px; }
    .dd-input {
      width: 100%; background: var(--card-2); border: 1px solid var(--primary);
      color: var(--ink); border-radius: 7px; padding: 7px 9px; font-size: 12px; outline: none; font-family: inherit;
    }

    /* MODAL DE CONFIRMAÇÃO */
    .modal-overlay {
      position: fixed; inset: 0; z-index: 90;
      background: rgba(0, 0, 0, 0.65);
      display: none; align-items: center; justify-content: center;
      padding: 20px;
    }
    .modal-overlay.visible { display: flex; }
    .modal-box {
      background: var(--card); border: 1px solid var(--line); border-radius: 14px;
      padding: 22px; max-width: 400px; width: 100%;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.55);
    }
    .modal-title { font-size: 14px; font-weight: 700; margin-bottom: 8px; }
    .modal-text { font-size: 12px; color: var(--muted); line-height: 1.55; margin-bottom: 18px; }
    .modal-actions { display: flex; gap: 8px; justify-content: flex-end; }
    .empty {
      padding: 36px 20px; text-align: center; color: var(--muted); font-size: 12px; line-height: 1.6;
      border: 1px dashed var(--line); border-radius: 11px;
    }
    .savebar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 16px; flex-wrap: wrap; }
    .summary { font-size: 11px; color: var(--muted); }

    /* TOAST */
    .toast-wrap { position: fixed; top: 18px; right: 18px; z-index: 50; display: flex; flex-direction: column; gap: 8px; }
    .toast {
      padding: 12px 16px; border-radius: 10px; font-size: 12px; font-weight: 600;
      background: #1c1c1c; border: 1px solid var(--line); color: var(--ink);
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5); max-width: 360px;
      animation: toastIn 0.25s ease;
    }
    .toast.success { border-color: rgba(16, 185, 129, 0.4); color: var(--success); }
    .toast.error { border-color: rgba(239, 68, 68, 0.4); color: var(--error); }
    .toast.warn { border-color: rgba(245, 158, 11, 0.4); color: var(--warn); }
    @keyframes toastIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }

    .footer { margin-top: 8px; text-align: center; font-size: 10px; color: var(--muted); letter-spacing: 0.04em; }

    @media (max-width: 760px) {
      .container { padding: 20px 12px 70px; }
      .card { padding: 18px; }
      .acc-headrow { display: none; }
      .acc-row { grid-template-columns: 32px 1fr; row-gap: 8px; }
      .acc-row .acc-identity { grid-column: 2; }
      .acc-row .f-wrap { grid-column: 1 / -1; }
      .filter-input { width: 100%; }
      .metrics { grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
      .meta-client { display: none; }
    }
  </style>
</head>
<body>
  <div class="toast-wrap" id="toasts"></div>

  <div class="dd-menu" id="dd-menu"></div>

  <div class="modal-overlay" id="confirm-overlay">
    <div class="modal-box">
      <div class="modal-title" id="confirm-title"></div>
      <div class="modal-text" id="confirm-text"></div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="confirm-cancel" style="padding:8px 14px;">Cancelar</button>
        <button class="btn btn-danger" id="confirm-ok" style="padding:8px 14px;">Excluir</button>
      </div>
    </div>
  </div>

  <div class="container">
    <div class="header">
      <div class="brand">
        <div class="brand-mark">FD</div>
        <div>
          <div class="brand-name">FINANCE DASH</div>
          <div class="brand-sub">Saldos de contas de anúncio</div>
        </div>
      </div>
      <div class="status-badge idle" id="badge">
        <span class="status-dot"></span>
        <span id="badge-text">Aguardando</span>
      </div>
    </div>

    <div class="tabs">
      <button class="tab active" data-tab="monitor" id="tab-btn-monitor">📈 Atualizações</button>
      <button class="tab" data-tab="config" id="tab-btn-config">⚙️ Configurações</button>
    </div>

    <!-- ===================== ABA: ATUALIZAÇÕES ===================== -->
    <div class="tab-body active" id="tab-monitor">
      <div class="card">
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
          <div class="metric"><div class="metric-label">Velocidade</div><div class="metric-value" id="throughput">—</div></div>
          <div class="metric"><div class="metric-label">ETA</div><div class="metric-value" id="eta">—</div></div>
        </div>

        <div class="log" id="log"></div>
        <div class="message" id="msg"><span id="msg-text"></span></div>

        <div class="options">
          <label class="check">
            <input type="checkbox" id="opt-reset" />
            <span class="check-box"></span>
            Resetar cursor (iniciar ciclo novo)
          </label>
        </div>

        <div class="actions" style="display:flex; gap:8px;">
          <button id="btn-start" class="btn btn-primary" style="flex:1;">
            <span id="btn-spinner" class="spinner" style="display:none"></span>
            <span id="btn-text">Iniciar Atualização</span>
          </button>
          <button id="btn-refresh" class="btn btn-secondary">Atualizar Status</button>
        </div>
      </div>
    </div>

    <!-- ===================== ABA: CONFIGURAÇÕES ===================== -->
    <div class="tab-body" id="tab-config">
      <div class="card">
        <h2 class="section-title">Fonte de dados</h2>
        <p class="section-desc">As contas são buscadas com os tokens fixos das variáveis de ambiente: <b>REFRESH_TOKEN</b> (Google Ads) e <b>META_TOKEN</b> (Meta Ads).</p>
        <div class="conn">
          ${ICON_GOOGLE}
          <div>
            <div class="conn-name">Google Ads</div>
            <div class="conn-status" id="google-status">Carregando…</div>
          </div>
        </div>
        <div class="conn">
          ${ICON_META}
          <div>
            <div class="conn-name">Meta Ads</div>
            <div class="conn-status" id="meta-status">Carregando…</div>
          </div>
        </div>
      </div>

      <div class="card">
        <h2 class="section-title">Contas de anúncio</h2>
        <p class="section-desc">Marque as contas que devem entrar na planilha e preencha gestor/supervisor. A lista carrega automaticamente com todas as contas vinculadas aos tokens.</p>

        <div class="toolbar">
          <button id="btn-discover" class="btn btn-secondary">
            <span class="spinner light" id="discover-spinner"></span>
            <span id="discover-text">Buscar contas</span>
          </button>
          <div class="spacer"></div>
          <div class="chip-group" id="platform-filter">
            <button class="chip active" data-filter="all">Todas</button>
            <button class="chip" data-filter="GOOGLE">${ICON_GOOGLE} Google</button>
            <button class="chip" data-filter="META">${ICON_META} Meta</button>
          </div>
          <input class="filter-input" id="filter" placeholder="Filtrar por nome ou ID…" style="display:none" />
        </div>

        <div id="accounts-area">
          <div class="empty">Carregando contas…<br />A lista aparece automaticamente em instantes.</div>
        </div>

        <div class="savebar" id="savebar" style="display:none">
          <div class="summary" id="save-summary">0 contas selecionadas</div>
          <div class="summary" id="save-status">Alterações são salvas automaticamente</div>
        </div>
      </div>
    </div>

    <div class="footer">DASH-DE-SALDOS · atualização e configuração · fila + worker Apps Script</div>
  </div>

  <script>
    (() => {
      const secret = ${JSON.stringify(secret)};
      const initialState = ${initialStateJson};
      const HEADERS = { 'x-cron-secret': secret, 'Content-Type': 'application/json' };
      const ICON_GOOGLE = ${JSON.stringify(ICON_GOOGLE)};
      const ICON_META = ${JSON.stringify(ICON_META)};

      function $(id) { return document.getElementById(id); }
      function toast(text, type, durationMs) {
        const total = Number(durationMs) > 0 ? Number(durationMs) : 4600;
        const el = document.createElement('div');
        el.className = 'toast ' + (type || '');
        el.textContent = text;
        $('toasts').appendChild(el);
        setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; }, total - 400);
        setTimeout(() => { el.remove(); }, total);
      }
      function esc(v) {
        const d = document.createElement('div');
        d.textContent = v == null ? '' : String(v);
        return d.innerHTML;
      }
      async function apiGet(url) {
        const res = await fetch(url, { headers: HEADERS });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data && data.error ? data.error : 'HTTP ' + res.status);
        return data;
      }
      async function apiPost(url, body) {
        const res = await fetch(url, { method: 'POST', headers: HEADERS, body: JSON.stringify(body || {}) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data && data.error ? data.error : 'HTTP ' + res.status);
        return data;
      }
      function setBusy(btn, spinner, busy, labelIdle, labelBusy) {
        btn.disabled = busy;
        spinner.style.display = busy ? 'inline-block' : 'none';
        if (labelBusy) btn.querySelector('span:last-child').textContent = busy ? labelBusy : labelIdle;
      }

      // =================================================================
      // ABAS
      // =================================================================
      let activeTab = 'monitor';
      let configOpened = false;

      function switchTab(name) {
        activeTab = name;
        document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
        document.querySelectorAll('.tab-body').forEach(b => b.classList.toggle('active', b.id === 'tab-' + name));
        const hash = name === 'config' ? '#configuracoes' : '#atualizacoes';
        if ((location.hash || '') !== hash) {
          try { history.replaceState(null, '', location.pathname + location.search + hash); } catch (e) { }
        }
        if (name === 'monitor') { resumePolling(); }
        else {
          pausePolling();
          if (!configOpened) {
            configOpened = true;
            loadState().then(() => { if (!rows.length || !discoverDone) discover(); });
          }
        }
      }
      document.querySelectorAll('.tab').forEach(t => { t.addEventListener('click', () => switchTab(t.dataset.tab)); });

      // =================================================================
      // MONITOR (aba Atualizações)
      // =================================================================
      const RING_CIRC = 251.3;
      const POLL_MS = 1500;

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
      let knownState = { running: false, cursor: 0, totalClients: 0, stage: 'idle', overallPercent: 0, stagePercent: 0, clienteAtual: '', stageDescription: 'Inativo', phaseLabel: 'Inativo' };
      let lastCliente = '';

      const STAGE_LABELS = {
        idle: 'Inativo', database: 'Processando base de dados', database_complete: 'Base processada',
        dashboards: 'Atualizando painéis', dashboards_pending: 'Painéis pendentes',
        supervisor: 'Processando supervisor', done: 'Concluído', paused: 'Pausado'
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
        if (sec < 1 || c === 0) return '—';
        const rps = c / sec;
        return rps < 1 ? (Math.round(rps * 100) / 100) + '/s' : (Math.round(rps * 10) / 10) + '/s';
      }
      function fmtEta(c, total, sec) {
        if (c <= 0 || total <= c || sec < 2) return '—';
        return fmtTime((total - c) / (c / sec));
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
      function showMsg(text, type) { msg.className = 'message visible ' + (type || 'info'); msgText.textContent = String(text || ''); }
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
        bar.style.width = overall + '%';
        pct.textContent = Math.round(overall) + '%';
        ringFill.style.strokeDashoffset = String(RING_CIRC * (1 - overall / 100));
        ring.classList.toggle('done', knownState.stage === 'done');
        cursorEl.textContent = c;
        totalEl.textContent = total;
        stageEl.textContent = knownState.stageDescription || stageLabel(knownState.stage);
        stagePct.textContent = Math.round(Math.min(100, Math.max(0, knownState.stagePercent || 0))) + '%';
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
      function pausePolling() { if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; } }
      function resumePolling() { if (!pollTimer && activeTab === 'monitor') schedulePoll(POLL_MS); }

      let doneHoldUntil = 0; // ms — segura a tela de "Concluído" ~10s após o fim do ciclo

      async function fetchStatus() {
        try {
          const res = await fetch('/api/update-status', {
            method: 'GET',
            headers: { accept: 'application/json', 'x-cron-secret': secret },
            cache: 'no-store'
          });
          if (!res.ok) { showMsg('Erro ao consultar status (HTTP ' + res.status + ')', 'error'); schedulePoll(POLL_MS); return; }
          const data = await res.json();
          if (data.ok === false) { showMsg('Status indisponível: ' + (data.error || 'desconhecido'), 'error'); schedulePoll(POLL_MS); return; }

          // Um job em andamento cancela qualquer feedback de conclusão anterior
          if (data.running) doneHoldUntil = 0;

          const wasRunning = knownState.running;
          const now = Date.now();

          if (wasRunning && !data.running) {
            // O ciclo acabou de terminar: mostra "Concluído" e segura por ~10s
            doneHoldUntil = now + 10000;
            knownState = {
              running: false,
              stage: 'done',
              cursor: knownState.cursor || 0,
              totalClients: knownState.totalClients || 0,
              overallPercent: 100,
              stagePercent: 100,
              clienteAtual: '',
              stageDescription: 'Concluído',
              phaseLabel: 'Concluído'
            };
            startTime = 0;
            trackChanges();
            renderProgress();
            updateBadge();
            updateButtons();
            showMsg('✅ Atualização concluída com sucesso!', 'success');
            schedulePoll(POLL_MS);
            return;
          }

          if (!data.running && doneHoldUntil > now) {
            // Dentro da janela de feedback de conclusão — mantém a tela como está
            schedulePoll(POLL_MS);
            return;
          }
          if (doneHoldUntil && doneHoldUntil <= now) {
            doneHoldUntil = 0;
            hideMsg();
          }

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
          if (knownState.stage === 'done') hideMsg();
          trackChanges();
          renderProgress();
          updateBadge();
          updateButtons();
          if (knownState.running) showMsg('Atualização em andamento no servidor. Aguarde...', 'info');
          else if (knownState.stage === 'done' && knownState.cursor > 0) { showMsg('Atualização concluída com sucesso!', 'success'); startTime = 0; }
          schedulePoll(POLL_MS);
        } catch (e) {
          showMsg('Erro de conexão: ' + (e && e.message ? e.message : String(e)), 'error');
          schedulePoll(POLL_MS);
        }
      }

      async function startJob() {
        if (busy) return;
        doneHoldUntil = 0; // clicar para atualizar cancela o feedback de conclusão na hora
        hideMsg();
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
          pushLog('Job enfileirado → fila #' + (data.jobId || '-'), 'success');
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

      // =================================================================
      // CONFIGURAÇÕES (aba Config)
      // =================================================================
      let state = { tokens: null, accounts: [], nomes: { gestores: [], supervisores: [] } };
      let rows = [];
      let discoverDone = false;
      let platformFilter = 'all';

      function renderTokens() {
        const t = state.tokens || {};
        const g = t.google || { configured: false };
        const m = t.meta || { configured: false };
        const gs = $('google-status');
        gs.textContent = g.configured ? 'Token configurado (REFRESH_TOKEN no ambiente)' : 'Token ausente — defina REFRESH_TOKEN na Vercel';
        gs.className = 'conn-status ' + (g.configured ? 'on' : 'err');
        const ms = $('meta-status');
        ms.textContent = m.configured ? 'Token configurado (META_TOKEN no ambiente)' : 'Token ausente — defina META_TOKEN na Vercel';
        ms.className = 'conn-status ' + (m.configured ? 'on' : 'err');
      }

      // ---------- dropdowns de gestor/supervisor (componente custom) ----------
      function nomeList(type) {
        const n = state.nomes || {};
        return type === 'supervisor' ? (n.supervisores || []) : (n.gestores || []);
      }

      function nomeLabel(type) {
        return type === 'supervisor' ? 'supervisor' : 'gestor';
      }

      function nomeValue(rowEl, type) {
        const wrap = rowEl.querySelector(type === 'supervisor' ? '.f-supervisor' : '.f-gestor');
        return wrap ? String(wrap.dataset.value || '') : '';
      }

      let ddTarget = null; // ddwrap do campo que abriu o menu

      function setDDValue(wrap, value) {
        wrap.dataset.value = value || '';
        const label = wrap.querySelector('.dd-label');
        label.textContent = value || '—';
        label.classList.toggle('vazio', !value);
      }

      function closeDDMenu() {
        const menu = $('dd-menu');
        menu.classList.remove('visible');
        ddTarget = null;
      }

      function buildDDMenuHtml(type, current) {
        const list = nomeList(type);
        const label = nomeLabel(type);
        let html = '<div class="dd-item" data-value=""><span class="dd-item-name">—</span></div>';
        for (const n of list) {
          html += '<div class="dd-item' + (n === current ? ' selected' : '') + '" data-value="' + esc(n) + '">'
            + '<span class="dd-item-name">' + esc(n) + '</span>'
            + '<button class="dd-del" type="button" data-del="' + esc(n) + '" title="Excluir da lista">🗑</button>'
            + '</div>';
        }
        html += '<div class="dd-item dd-new"><span class="dd-item-name">➕ Novo ' + label + '…</span></div>';
        return html;
      }

      function openDDMenu(wrap) {
        ddTarget = wrap;
        const type = wrap.dataset.nomeType;
        const current = String(wrap.dataset.value || '');
        const menu = $('dd-menu');
        menu.innerHTML = buildDDMenuHtml(type, current);
        menu.classList.add('visible');
        menu.style.visibility = 'hidden';

        const r = wrap.getBoundingClientRect();
        const mw = menu.offsetWidth;
        const mh = menu.offsetHeight;
        let left = Math.max(8, Math.min(r.left, window.innerWidth - mw - 8));
        let top = r.bottom + 4;
        if (top + mh > window.innerHeight - 8) {
          top = Math.max(8, r.top - mh - 4);
        }
        menu.style.left = left + 'px';
        menu.style.top = top + 'px';
        menu.style.visibility = '';
      }

      function showDDNewInput() {
        const menu = $('dd-menu');
        const type = ddTarget ? ddTarget.dataset.nomeType : 'gestor';
        menu.innerHTML = '<input class="dd-input" id="dd-new-input" placeholder="Nome do novo ' + nomeLabel(type) + '">';
        const input = menu.querySelector('#dd-new-input');
        input.focus();
        let done = false;
        const voltarLista = () => {
          if (!ddTarget) { closeDDMenu(); return; }
          menu.innerHTML = buildDDMenuHtml(type, String(ddTarget.dataset.value || ''));
        };
        const confirmar = async () => {
          if (done) return;
          done = true;
          const nome = input.value.trim();
          if (!nome) { voltarLista(); return; }
          try {
            const data = await apiPost('/api/settings/nomes?secret=' + encodeURIComponent(secret), { action: 'add', type: type, nome: nome });
            state.nomes = { gestores: data.gestores || [], supervisores: data.supervisores || [] };
            toast('"' + nome + '" adicionado à lista de ' + nomeLabel(type) + 's', 'success');
            if (ddTarget) {
              setDDValue(ddTarget, nome);
              closeDDMenu();
              scheduleAutoSave(300);
            } else {
              closeDDMenu();
            }
          } catch (e) {
            toast('Falha ao salvar: ' + e.message, 'error');
            done = false;
            voltarLista();
          }
        };
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') { ev.preventDefault(); confirmar(); }
          if (ev.key === 'Escape') { ev.preventDefault(); done = true; closeDDMenu(); }
        });
        input.addEventListener('blur', confirmar);
      }

      function initDDEvents() {
        const menu = $('dd-menu');
        menu.addEventListener('click', (ev) => {
          const del = ev.target.closest('.dd-del');
          if (del && ddTarget) {
            const type = ddTarget.dataset.nomeType;
            const nome = del.dataset.del;
            closeDDMenu();
            askDeleteNome(type, nome);
            return;
          }
          if (ev.target.closest('.dd-new')) {
            showDDNewInput();
            return;
          }
          const item = ev.target.closest('.dd-item');
          if (item && ddTarget) {
            setDDValue(ddTarget, item.dataset.value || '');
            closeDDMenu();
            scheduleAutoSave(700);
          }
        });
        document.addEventListener('click', (ev) => {
          if (ev.target.closest && ev.target.closest('.ddbox')) return;
          if (menu.classList.contains('visible') && !menu.contains(ev.target)) {
            closeDDMenu();
          }
        });
        window.addEventListener('scroll', (ev) => {
          if (!menu.classList.contains('visible')) return;
          if (ev.target && menu.contains(ev.target)) return;
          closeDDMenu();
        }, true);
        window.addEventListener('resize', closeDDMenu);
      }

      function showConfirm(title, text, onOk) {
        const overlay = $('confirm-overlay');
        $('confirm-title').textContent = title;
        $('confirm-text').textContent = text;
        overlay.classList.add('visible');
        const ok = $('confirm-ok');
        const cancel = $('confirm-cancel');
        const close = () => {
          overlay.classList.remove('visible');
          ok.onclick = null;
          cancel.onclick = null;
        };
        ok.onclick = () => { close(); onOk(); };
        cancel.onclick = close;
        overlay.onclick = (ev) => { if (ev.target === overlay) close(); };
      }

      async function askDeleteNome(type, nome) {
        const col = type === 'gestor' ? 'gestor' : 'supervisor';
        const usedSaved = (state.accounts || []).filter(a => String(a[col] || '') === nome).length;
        let usedOnScreen = 0;
        document.querySelectorAll('.acc-row').forEach(rowEl => {
          if (nomeValue(rowEl, type) === nome) usedOnScreen++;
        });
        const used = Math.max(usedSaved, usedOnScreen);
        const label = nomeLabel(type);

        showConfirm(
          'Excluir ' + label,
          'Excluir "' + nome + '" da lista de ' + label + 's? ' +
          (used > 0 ? used + ' conta(s) o usam e ficarão sem ' + label + '. ' : '') +
          'Você pode adicioná-lo de novo depois.',
          async () => {
            try {
              const data = await apiPost('/api/settings/nomes?secret=' + encodeURIComponent(secret), { action: 'delete', type: type, nome: nome });
              state.nomes = { gestores: data.gestores || [], supervisores: data.supervisores || [] };
              await loadState();
              rows.forEach(r => {
                if (r.existing && String(r.existing[col] || '') === nome) r.existing[col] = '';
              });
              const edits = rows.length ? collectEdits() : null;
              if (edits) {
                edits.forEach(e => { if (e[col] === nome) e[col] = ''; });
              }
              renderRows(edits);
              toast('"' + nome + '" excluído', 'success');
            } catch (e) {
              toast('Falha ao excluir: ' + e.message, 'error');
            }
          }
        );
      }

      function savedByKey() {
        const map = new Map();
        for (const a of state.accounts || []) map.set(a.plataforma + '|' + a.customer_id, a);
        return map;
      }

      function mergeDiscovered(data) {
        const saved = savedByKey();
        const found = new Set();
        const out = [];
        const push = (platform, acc) => {
          const key = platform + '|' + acc.id;
          found.add(key);
          const existing = saved.get(key) || acc.existing || null;
          out.push({
            platform: platform,
            id: acc.id,
            name: acc.name || (existing && existing.cliente) || null,
            idFormatted: acc.idFormatted || acc.id,
            manager: acc.manager === true,
            inactive: acc.inactive === true,
            currency: acc.currency || '',
            mccLogin: acc.mccLogin || (existing && existing.login_customer_id) || '',
            fromSaved: false,
            existing: existing
          });
        };
        if (data.google && data.google.ok) { for (const acc of data.google.accounts || []) push('GOOGLE', acc); }
        if (data.meta && data.meta.ok) { for (const acc of data.meta.accounts || []) push('META', acc); }
        for (const [key, a] of saved.entries()) {
          if (!found.has(key)) {
            out.push({
              platform: a.plataforma, id: a.customer_id, name: a.cliente, idFormatted: a.customer_id,
              manager: false, inactive: false, currency: '', mccLogin: a.login_customer_id || '',
              fromSaved: true, existing: a
            });
          }
        }
        // lista única: ordena por nome (A-Z), sem separar por plataforma
        out.sort((x, y) => String(x.name || x.id).localeCompare(String(y.name || y.id), 'pt-BR', { sensitivity: 'base' }));
        rows = out;
      }

      function rowsFromSavedOnly() {
        rows = (state.accounts || []).map(a => ({
          platform: a.plataforma, id: a.customer_id, name: a.cliente, idFormatted: a.customer_id,
          manager: false, inactive: false, currency: '', mccLogin: a.login_customer_id || '',
          fromSaved: true, existing: a
        }));
        rows.sort((x, y) => String(x.name || x.id).localeCompare(String(y.name || y.id), 'pt-BR', { sensitivity: 'base' }));
      }

      function collectEdits() {
        const edits = new Map();
        $('accounts-area').querySelectorAll('.acc-row').forEach(rowEl => {
          edits.set(rowEl.dataset.platform + '|' + rowEl.dataset.id, {
            checked: rowEl.querySelector('.acc-check').checked,
            cliente: rowEl.querySelector('.f-cliente').value,
            gestor: nomeValue(rowEl, 'gestor'),
            supervisor: nomeValue(rowEl, 'supervisor')
          });
        });
        return edits;
      }

      function renderRows(priorEdits) {
        const area = $('accounts-area');
        const savebar = $('savebar');
        const filter = $('filter');

        if (!rows.length) {
          area.innerHTML = '<div class="empty">Nenhuma conta encontrada.<br />Verifique os tokens em Fonte de dados e clique em <b>Buscar contas</b>.</div>';
          savebar.style.display = 'none';
          filter.style.display = 'none';
          return;
        }
        filter.style.display = 'block';
        savebar.style.display = 'flex';

        let html = '<div class="acc-table">';
        html += '<div class="acc-headrow"><div></div><div>Conta</div><div>Cliente</div><div>Gestor</div><div>Supervisor</div></div>';

        for (const row of rows) {
          const idx = rows.indexOf(row);
          const e = row.existing || {};
          const clienteVal = e.cliente || row.name || row.idFormatted || row.id;
          const gestorVal = e.gestor || '';
          const supervisorVal = e.supervisor || '';
          const icon = row.platform === 'GOOGLE' ? ICON_GOOGLE : ICON_META;
          html += '<div class="acc-row unchecked" data-idx="' + idx + '" data-platform="' + row.platform + '" data-id="' + esc(row.id) + '" data-search="' + esc(String(row.name || '') + ' ' + row.id).toLowerCase() + '">'
            + '<div><input type="checkbox" class="acc-check"></div>'
            + '<div class="acc-identity">'
            + icon
            + '<div style="min-width:0"><div class="acc-name">' + esc(row.name || ('Conta ' + row.id)) + '</div>'
            + '<div class="acc-id">' + esc(row.idFormatted || row.id) + (row.currency ? ' · ' + esc(row.currency) : '') + '</div>'
            + (row.manager ? '<span class="acc-flag manager">Manager / MCC</span>' : '')
            + (row.inactive ? '<span class="acc-flag inactive">Não ativa</span>' : '')
            + (row.fromSaved ? '<span class="acc-flag saved">Salva (fora da API)</span>' : '')
            + '</div></div>'
            + '<div class="f-wrap"><input class="acc-input f-cliente" placeholder="Cliente" value="' + esc(clienteVal) + '"></div>'
            + '<div class="f-wrap"><div class="ddwrap f-gestor" data-nome-type="gestor" data-value="' + esc(gestorVal) + '"><button class="ddbox" type="button"><span class="dd-label' + (gestorVal ? '' : ' vazio') + '">' + esc(gestorVal || '—') + '</span><span class="dd-caret">▾</span></button></div></div>'
            + '<div class="f-wrap"><div class="ddwrap f-supervisor" data-nome-type="supervisor" data-value="' + esc(supervisorVal) + '"><button class="ddbox" type="button"><span class="dd-label' + (supervisorVal ? '' : ' vazio') + '">' + esc(supervisorVal || '—') + '</span><span class="dd-caret">▾</span></button></div></div>'
            + '</div>';
        }
        html += '</div>';
        area.innerHTML = html;

        area.querySelectorAll('.acc-row').forEach(rowEl => {
          const row = rows[Number(rowEl.dataset.idx)];
          const cb = rowEl.querySelector('.acc-check');
          cb.checked = Boolean(row.existing);
          rowEl.classList.toggle('unchecked', !cb.checked);
          cb.addEventListener('change', () => {
            rowEl.classList.toggle('unchecked', !cb.checked);
            updateSummary();
            scheduleAutoSave(700);
          });
          rowEl.querySelectorAll('input.acc-input').forEach(input => {
            input.addEventListener('input', () => { scheduleAutoSave(1600); });
          });
          rowEl.querySelectorAll('.ddwrap .ddbox').forEach(btn => {
            btn.addEventListener('click', (ev) => {
              ev.stopPropagation();
              const wrap = btn.closest('.ddwrap');
              if (ddTarget === wrap) { closeDDMenu(); return; }
              openDDMenu(wrap);
            });
          });
        });

        if (priorEdits && priorEdits.size) {
          area.querySelectorAll('.acc-row').forEach(rowEl => {
            const pe = priorEdits.get(rowEl.dataset.platform + '|' + rowEl.dataset.id);
            if (!pe) return;
            rowEl.querySelector('.acc-check').checked = pe.checked;
            rowEl.querySelector('.f-cliente').value = pe.cliente;
            const gWrap = rowEl.querySelector('.f-gestor');
            if (gWrap) setDDValue(gWrap, pe.gestor || '');
            const sWrap = rowEl.querySelector('.f-supervisor');
            if (sWrap) setDDValue(sWrap, pe.supervisor || '');
            rowEl.classList.toggle('unchecked', !pe.checked);
          });
        }

        filter.oninput = applyFilters;
        updateSummary();
        applyFilters();
      }

      function applyFilters() {
        const q = ($('filter').value || '').trim().toLowerCase();
        $('accounts-area').querySelectorAll('.acc-row').forEach(rowEl => {
          const matchPlatform = platformFilter === 'all' || rowEl.dataset.platform === platformFilter;
          const matchText = !q || (rowEl.dataset.search || '').indexOf(q) !== -1;
          rowEl.style.display = (matchPlatform && matchText) ? '' : 'none';
        });
      }

      function updateSummary() {
        const sel = $('accounts-area').querySelectorAll('.acc-row .acc-check:checked').length;
        $('save-summary').textContent = sel + ' conta(s) selecionada(s)';
      }

      function collectSelected() {
        const out = [];
        $('accounts-area').querySelectorAll('.acc-row').forEach(rowEl => {
          if (!rowEl.querySelector('.acc-check').checked) return;
          const idx = Number(rowEl.dataset.idx);
          const row = rows[idx] || {};
          out.push({
            plataforma: rowEl.dataset.platform,
            customer_id: rowEl.dataset.id,
            cliente: rowEl.querySelector('.f-cliente').value.trim(),
            gestor: nomeValue(rowEl, 'gestor').trim(),
            supervisor: nomeValue(rowEl, 'supervisor').trim(),
            login_customer_id: row.mccLogin || ''
          });
        });
        return out;
      }

      async function loadState() {
        try {
          const data = await apiGet('/api/settings?secret=' + encodeURIComponent(secret));
          state = {
            tokens: data.tokens,
            accounts: data.accounts || [],
            nomes: { gestores: (data.nomes && data.nomes.gestores) || [], supervisores: (data.nomes && data.nomes.supervisores) || [] }
          };
          renderTokens();
          if (!rows.length && state.accounts.length) {
            rowsFromSavedOnly();
            renderRows();
          }
        } catch (e) {
          toast('Falha ao carregar configurações: ' + e.message, 'error');
        }
      }

      async function discover(auto) {
        const btn = $('btn-discover');
        if (btn.disabled) return;
        const edits = rows.length ? collectEdits() : null;
        setBusy(btn, $('discover-spinner'), true, 'Buscar contas', 'Buscando…');
        try {
          const data = await apiGet('/api/accounts/discover?secret=' + encodeURIComponent(secret));
          const errs = [];
          if (data.google && !data.google.ok) errs.push('Google: ' + data.google.error);
          if (data.meta && !data.meta.ok) errs.push('Meta: ' + data.meta.error);
          mergeDiscovered(data);
          renderRows(edits);
          discoverDone = true;
          if (errs.length) {
            toast(errs.join(' · '), 'warn', 9000);
          } else if (data.google && data.google.ok && !(data.google.accounts || []).length && data.google.hint) {
            toast(data.google.hint, 'warn', 9000);
          } else {
            const total = ((data.google && data.google.accounts || []).length) + ((data.meta && data.meta.accounts || []).length);
            toast(total + ' conta(s) carregadas', 'success');
          }
        } catch (e) {
          toast('Falha ao buscar contas: ' + e.message, 'error');
        } finally {
          setBusy(btn, $('discover-spinner'), false, 'Buscar contas');
        }
      }

      // ---------- AUTO-SAVE (sem botão) ----------
      let saveTimer = null;
      let saveSeq = 0;

      function setSaveStatus(text, cls) {
        const el = $('save-status');
        el.textContent = text;
        el.style.color = cls === 'error' ? 'var(--error)' : (cls === 'saving' ? 'var(--primary)' : 'var(--muted)');
      }

      function scheduleAutoSave(delayMs) {
        if (saveTimer) clearTimeout(saveTimer);
        setSaveStatus('Salvando…', 'saving');
        saveTimer = setTimeout(() => {
          saveTimer = null;
          performAutoSave();
        }, Math.max(300, delayMs || 1000));
      }

      async function performAutoSave() {
        const seq = ++saveSeq;
        const selected = collectSelected();
        try {
          await apiPost('/api/settings/accounts?secret=' + encodeURIComponent(secret), { accounts: selected });
          if (seq !== saveSeq) return; // houve nova edição durante o save; o próximo save cobre
          const now = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
          setSaveStatus('✓ Salvo automaticamente às ' + now);
          await loadState();
          const saved = savedByKey();
          rows.forEach(r => { r.existing = saved.get(r.platform + '|' + r.id) || null; });
          updateSummary();
        } catch (e) {
          if (seq === saveSeq) setSaveStatus('Erro ao salvar — tente editar de novo', 'error');
          toast('Falha ao salvar: ' + e.message, 'error');
        }
      }

      $('btn-discover').onclick = () => discover(false);
      initDDEvents();
      $('platform-filter').querySelectorAll('.chip').forEach(chip => {
        chip.addEventListener('click', () => {
          platformFilter = chip.dataset.filter;
          $('platform-filter').querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === chip));
          applyFilters();
        });
      });

      // =================================================================
      // INICIALIZAÇÃO
      // =================================================================
      knownState = {
        running: !!initialState.running,
        stage: String(initialState.stage || 'idle'),
        cursor: Number(initialState.cursor || 0),
        totalClients: Number(initialState.totalClients || 0),
        overallPercent: 0, stagePercent: 0, clienteAtual: '',
        stageDescription: stageLabel(String(initialState.stage || 'idle')),
        phaseLabel: stageLabel(String(initialState.stage || 'idle'))
      };
      if (knownState.running) startTime = Date.now();
      renderProgress();
      updateBadge();
      updateButtons();

      const startTab = (location.hash === '#configuracoes') ? 'config' : 'monitor';
      switchTab(startTab);
      if (startTab === 'monitor') { fetchStatus(); schedulePoll(POLL_MS); }
    })();
  </script>
</body>
</html>`;
}

module.exports = { renderAppPage };
