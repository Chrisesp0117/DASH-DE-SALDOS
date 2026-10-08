/**
 * settings-ui.js — Endpoint da página web de configurações do FINANCE DASH
 *
 * GET /api/settings-ui?secret=... → HTML da página de configurações.
 *
 * Substitui a aba CONFIGS da planilha como painel de configuração:
 *  - Fonte de dados: tokens fixos do ambiente (REFRESH_TOKEN / META_TOKEN)
 *  - Descoberta de TODAS as contas de anúncio vinculadas a esses tokens
 *  - Seleção de quais contas vão para a planilha + campos por conta
 *    (cliente, gestor, supervisor, MCC e revisão)
 *  - Importação única da aba CONFIGS (transição)
 *
 * Protegida pelo mesmo CRON_SECRET da página de monitor.
 */

require('dotenv').config({ path: '.env' });

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

function renderSettingsPage(params) {
  const secret = String(params && params.secret || '');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>FINANCE DASH — Configurações</title>
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
      --success-soft: rgba(16, 185, 129, 0.10);
      --warn: #f59e0b;
      --error: #ef4444;
      --google: #34a853;
      --google-soft: rgba(52, 168, 83, 0.12);
      --meta: #1877f2;
      --meta-soft: rgba(24, 119, 242, 0.12);
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
      max-width: 960px;
      margin: 0 auto;
      padding: 32px 20px 80px;
    }
    .card {
      background: var(--card);
      border-radius: 14px;
      border: 1px solid var(--line);
      padding: 26px;
      margin-bottom: 18px;
    }
    .header {
      display: flex; align-items: center; justify-content: space-between;
      gap: 12px; margin-bottom: 26px;
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
    .brand-name { font-size: 14px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; line-height: 1.2; }
    .brand-sub { font-size: 11px; color: var(--muted); margin-top: 1px; }
    .badge {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 4px 10px; border-radius: 999px;
      font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
      color: var(--primary); background: var(--primary-soft); flex-shrink: 0;
    }
    .section-title { font-size: 13px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; margin: 0 0 4px; }
    .section-desc { font-size: 12px; color: var(--muted); margin: 0 0 18px; line-height: 1.5; }

    /* CONEXÕES */
    .conn {
      display: flex; align-items: center; justify-content: space-between; gap: 14px;
      padding: 14px 16px; border: 1px solid var(--line); border-radius: 11px;
      margin-bottom: 10px; background: var(--card-2); flex-wrap: wrap;
    }
    .conn-identity { display: flex; align-items: center; gap: 12px; min-width: 0; flex: 1; }
    .conn-logo {
      width: 34px; height: 34px; border-radius: 9px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      font-size: 15px; font-weight: 800;
    }
    .conn-logo.google { background: var(--google-soft); color: var(--google); }
    .conn-logo.meta { background: var(--meta-soft); color: var(--meta); }
    .conn-name { font-size: 13px; font-weight: 600; }
    .conn-status { font-size: 11px; color: var(--muted); margin-top: 2px; word-break: break-all; }
    .conn-status.on { color: var(--success); }
    .conn-status.err { color: var(--error); }

    .btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 8px;
      padding: 9px 16px; border-radius: 9px; border: none; cursor: pointer;
      font-size: 12px; font-weight: 600; letter-spacing: 0.02em;
      transition: all 0.2s ease; white-space: nowrap;
    }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-primary { background: linear-gradient(135deg, var(--primary), #e68400); color: #000; font-weight: 700; box-shadow: 0 2px 12px rgba(255, 149, 0, 0.18); }
    .btn-primary:hover:not([disabled]) { filter: brightness(1.08); }
    .btn-secondary { background: transparent; color: var(--ink); border: 1px solid var(--line); }
    .btn-secondary:hover:not([disabled]) { border-color: var(--primary); color: var(--primary); }
    .btn-danger { background: transparent; color: var(--error); border: 1px solid rgba(239, 68, 68, 0.3); }
    .btn-danger:hover:not([disabled]) { background: rgba(239, 68, 68, 0.08); }
    .btn-sm { padding: 7px 12px; font-size: 11px; }
    .spinner {
      width: 13px; height: 13px;
      border: 2px solid rgba(0, 0, 0, 0.2); border-radius: 50%;
      border-top-color: #000; animation: spin 0.7s linear infinite; display: none;
    }
    .spinner.light { border-color: rgba(255, 255, 255, 0.2); border-top-color: #fff; }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* TOOLBAR */
    .toolbar { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-bottom: 16px; }
    .toolbar .spacer { flex: 1; }
    .filter-input {
      background: var(--card-2); border: 1px solid var(--line); color: var(--ink);
      border-radius: 9px; padding: 8px 12px; font-size: 12px; width: 220px; outline: none;
    }
    .filter-input:focus { border-color: var(--primary); }

    /* TABELA DE CONTAS */
    .acc-table { border: 1px solid var(--line); border-radius: 11px; overflow: hidden; }
    .acc-headrow, .acc-row {
      display: grid;
      grid-template-columns: 40px minmax(180px, 1.4fr) minmax(140px, 1fr) minmax(120px, 1fr) minmax(120px, 1fr) minmax(110px, 0.9fr) 110px;
      gap: 10px; align-items: center;
      padding: 10px 12px;
    }
    .acc-headrow {
      background: #111; font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
      text-transform: uppercase; color: var(--muted); border-bottom: 1px solid var(--line);
    }
    .acc-group-head {
      display: flex; align-items: center; gap: 8px;
      padding: 9px 12px; font-size: 11px; font-weight: 700; letter-spacing: 0.05em;
      text-transform: uppercase; border-bottom: 1px solid var(--line);
    }
    .acc-group-head.google { background: var(--google-soft); color: var(--google); }
    .acc-group-head.meta { background: var(--meta-soft); color: var(--meta); }
    .acc-group-head .group-count { color: var(--muted); font-weight: 600; text-transform: none; letter-spacing: 0; margin-left: auto; }
    .acc-row { border-bottom: 1px solid var(--line); }
    .acc-row:last-child { border-bottom: none; }
    .acc-row.unchecked { opacity: 0.55; }
    .acc-check { width: 16px; height: 16px; accent-color: var(--primary); cursor: pointer; }
    .acc-name { font-size: 12px; font-weight: 600; line-height: 1.3; word-break: break-word; }
    .acc-id { font-size: 10px; color: var(--muted); margin-top: 2px; }
    .acc-flag {
      display: inline-block; margin-top: 4px; padding: 2px 7px; border-radius: 999px;
      font-size: 9px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
    }
    .acc-flag.manager { background: rgba(245, 158, 11, 0.12); color: var(--warn); }
    .acc-flag.inactive { background: rgba(239, 68, 68, 0.12); color: var(--error); }
    .acc-flag.saved { background: var(--primary-soft); color: var(--primary); }
    .acc-input {
      width: 100%; background: var(--card-2); border: 1px solid var(--line);
      color: var(--ink); border-radius: 7px; padding: 7px 9px; font-size: 11px; outline: none;
    }
    .acc-input:focus { border-color: var(--primary); }
    select.acc-input { cursor: pointer; }
    .empty {
      padding: 36px 20px; text-align: center; color: var(--muted); font-size: 12px; line-height: 1.6;
      border: 1px dashed var(--line); border-radius: 11px;
    }
    .savebar {
      display: flex; align-items: center; justify-content: space-between;
      gap: 12px; margin-top: 16px; flex-wrap: wrap;
    }
    .savebar .summary { font-size: 11px; color: var(--muted); }

    /* TOAST */
    .toast-wrap { position: fixed; top: 18px; right: 18px; z-index: 50; display: flex; flex-direction: column; gap: 8px; }
    .toast {
      padding: 12px 16px; border-radius: 10px; font-size: 12px; font-weight: 600;
      background: #1c1c1c; border: 1px solid var(--line); color: var(--ink);
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5); max-width: 340px;
      animation: toastIn 0.25s ease;
    }
    .toast.success { border-color: rgba(16, 185, 129, 0.4); color: var(--success); }
    .toast.error { border-color: rgba(239, 68, 68, 0.4); color: var(--error); }
    .toast.warn { border-color: rgba(245, 158, 11, 0.4); color: var(--warn); }
    @keyframes toastIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }

    .note {
      margin-top: 14px; padding: 12px 14px; border-radius: 9px;
      background: var(--card-2); border: 1px solid var(--line);
      font-size: 11px; color: var(--muted); line-height: 1.6;
    }
    .note b { color: var(--ink); }

    .footer {
      margin-top: 8px; text-align: center; font-size: 10px; color: var(--muted); letter-spacing: 0.04em;
    }
    .link-monitor { color: var(--primary); text-decoration: none; font-weight: 600; }
    .link-monitor:hover { text-decoration: underline; }
    @media (max-width: 760px) {
      .container { padding: 20px 12px 70px; }
      .card { padding: 18px; }
      .acc-headrow { display: none; }
      .acc-row {
        grid-template-columns: 32px 1fr;
        grid-auto-rows: auto;
        row-gap: 8px;
      }
      .acc-row .acc-info { grid-column: 2; }
      .acc-row .f-wrap { grid-column: 1 / -1; }
      .filter-input { width: 100%; }
    }
  </style>
</head>
<body>
  <div class="toast-wrap" id="toasts"></div>
  <div class="container">
    <div class="header">
      <div class="brand">
        <div class="brand-mark">FD</div>
        <div>
          <div class="brand-name">FINANCE DASH</div>
          <div class="brand-sub">Configurações · contas e conexões</div>
        </div>
      </div>
      <div class="badge">Web</div>
    </div>

    <!-- FONTE DE DADOS -->
    <div class="card">
      <h2 class="section-title">Fonte de dados</h2>
      <p class="section-desc">As contas são buscadas com os tokens fixos das variáveis de ambiente: <b>REFRESH_TOKEN</b> (Google Ads) e <b>META_TOKEN</b> (Meta Ads). Toda conta vinculada a esses tokens aparece na lista abaixo.</p>

      <div class="conn" id="conn-google">
        <div class="conn-identity">
          <div class="conn-logo google">G</div>
          <div>
            <div class="conn-name">Google Ads</div>
            <div class="conn-status" id="google-status">Carregando…</div>
          </div>
        </div>
      </div>

      <div class="conn" id="conn-meta">
        <div class="conn-identity">
          <div class="conn-logo meta">M</div>
          <div>
            <div class="conn-name">Meta Ads</div>
            <div class="conn-status" id="meta-status">Carregando…</div>
          </div>
        </div>
      </div>
    </div>

    <!-- CONTAS -->
    <div class="card">
      <h2 class="section-title">Contas de anúncio</h2>
      <p class="section-desc">Busque as contas vinculadas aos tokens acima, marque quais devem entrar na planilha e preencha os campos. A ordem de salvamento define a ordem nas abas DASH.</p>

      <div class="toolbar">
        <button id="btn-discover" class="btn btn-primary">
          <span class="spinner" id="discover-spinner"></span>
          <span id="discover-text">Buscar contas nas APIs</span>
        </button>
        <button id="btn-import" class="btn btn-secondary">
          <span class="spinner light" id="import-spinner"></span>
          <span id="import-text">Importar da planilha (CONFIGS)</span>
        </button>
        <div class="spacer"></div>
        <input class="filter-input" id="filter" placeholder="Filtrar por nome ou ID…" style="display:none" />
      </div>

      <div id="accounts-area">
        <div class="empty">
          Nenhuma conta carregada ainda.<br />
          Clique em <b>Buscar contas nas APIs</b> para listar as contas dos perfis conectados,<br />
          ou em <b>Importar da planilha (CONFIGS)</b> para trazer a configuração atual.
        </div>
      </div>

      <div class="savebar" id="savebar" style="display:none">
        <div class="summary" id="save-summary">0 contas selecionadas</div>
        <button id="btn-save" class="btn btn-primary">
          <span class="spinner" id="save-spinner"></span>
          <span id="save-text">Salvar contas selecionadas</span>
        </button>
      </div>

      <div class="note">
        <b>Revisão:</b> contas com revisão <b>ok</b> são processadas pelo job; <b>pausada</b> é pulada (aparece como erro "Pulado por revisão").<br />
        <b>MCC / Login:</b> opcional, apenas Google — preencha quando a conta só for acessível via conta gerenciadora (ex.: 1234567890).
      </div>
    </div>

    <div class="footer">
      DASH-DE-SALDOS · configuração web ·
      <a class="link-monitor" id="monitor-link" href="#">abrir painel de monitor</a>
    </div>
  </div>

  <script>
    (() => {
      const secret = ${JSON.stringify(secret)};
      const HEADERS = { 'x-cron-secret': secret, 'Content-Type': 'application/json' };

      // ---------- helpers ----------
      function $(id) { return document.getElementById(id); }
      function toast(text, type) {
        const el = document.createElement('div');
        el.className = 'toast ' + (type || '');
        el.textContent = text;
        $('toasts').appendChild(el);
        setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; }, 4200);
        setTimeout(() => { el.remove(); }, 4600);
      }
      function setBusy(btn, spinner, busy, labelIdle, labelBusy) {
        btn.disabled = busy;
        spinner.style.display = busy ? 'inline-block' : 'none';
        if (labelBusy) btn.querySelector('span:last-child').textContent = busy ? labelBusy : labelIdle;
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

      // ---------- estado ----------
      let state = { tokens: null, accounts: [] };
      let rows = []; // [{platform, id, name, manager, status, currency, existing, fromSaved, checked}]

      function renderTokens() {
        const t = state.tokens || {};
        const g = t.google || { configured: false };
        const m = t.meta || { configured: false };

        const gs = $('google-status');
        gs.textContent = g.configured
          ? 'Token configurado (REFRESH_TOKEN no ambiente)'
          : 'Token ausente — defina REFRESH_TOKEN na Vercel';
        gs.className = 'conn-status ' + (g.configured ? 'on' : 'err');

        const ms = $('meta-status');
        ms.textContent = m.configured
          ? 'Token configurado (META_TOKEN no ambiente)'
          : 'Token ausente — defina META_TOKEN na Vercel';
        ms.className = 'conn-status ' + (m.configured ? 'on' : 'err');
      }

      // ---------- tabela de contas ----------
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
            status: acc.status,
            currency: acc.currency || '',
            fromSaved: false,
            existing: existing
          });
        };

        if (data.google && data.google.ok) {
          for (const acc of data.google.accounts || []) push('GOOGLE', acc);
        }
        if (data.meta && data.meta.ok) {
          for (const acc of data.meta.accounts || []) push('META', acc);
        }

        // Contas salvas que não vieram na descoberta — mantém pra não perder nada
        for (const [key, a] of saved.entries()) {
          if (!found.has(key)) {
            out.push({
              platform: a.plataforma,
              id: a.customer_id,
              name: a.cliente,
              idFormatted: a.customer_id,
              manager: false,
              status: null,
              currency: '',
              fromSaved: true,
              existing: a
            });
          }
        }

        const order = { GOOGLE: 0, META: 1 };
        out.sort((x, y) => (order[x.platform] - order[y.platform]) || String(x.name || x.id).localeCompare(String(y.name || y.id)));
        rows = out;
      }

      function rowsFromSavedOnly() {
        rows = (state.accounts || []).map(a => ({
          platform: a.plataforma,
          id: a.customer_id,
          name: a.cliente,
          idFormatted: a.customer_id,
          manager: false,
          status: null,
          currency: '',
          fromSaved: true,
          existing: a
        }));
      }

      function fieldValues(row) {
        const e = row.existing || {};
        return {
          cliente: e.cliente || row.name || row.idFormatted || row.id,
          gestor: e.gestor || '',
          supervisor: e.supervisor || '',
          loginCustomerId: e.login_customer_id || '',
          revisao: e.revisao || 'ok'
        };
      }

      function renderRows() {
        const area = $('accounts-area');
        const savebar = $('savebar');
        const filter = $('filter');

        if (!rows.length) {
          area.innerHTML = '<div class="empty">Nenhuma conta encontrada.<br />Verifique as conexões e clique em <b>Buscar contas nas APIs</b>.</div>';
          savebar.style.display = 'none';
          filter.style.display = 'none';
          return;
        }

        filter.style.display = 'block';
        savebar.style.display = 'flex';

        const groups = [
          { platform: 'GOOGLE', label: 'Google Ads', cls: 'google' },
          { platform: 'META', label: 'Meta Ads', cls: 'meta' }
        ];

        let html = '<div class="acc-table">';
        html += '<div class="acc-headrow"><div></div><div>Conta</div><div>Cliente</div><div>Gestor</div><div>Supervisor</div><div>MCC / Login (Google)</div><div>Revisão</div></div>';

        for (const g of groups) {
          const groupRows = rows.filter(r => r.platform === g.platform);
          if (!groupRows.length) continue;
          html += '<div class="acc-group-head ' + g.cls + '"><span>' + g.label + '</span>'
            + '<span style="display:flex;align-items:center;gap:6px;font-weight:600;text-transform:none;letter-spacing:0;color:var(--muted);cursor:pointer;" data-selectall="' + g.platform + '"><input type="checkbox" class="group-check" data-group="' + g.platform + '" style="width:14px;height:14px;accent-color:var(--primary);">marcar todas</span>'
            + '<span class="group-count">' + groupRows.length + '</span></div>';

          for (const row of groupRows) {
            const idx = rows.indexOf(row);
            const v = fieldValues(row);
            html += '<div class="acc-row unchecked" data-idx="' + idx + '" data-platform="' + row.platform + '" data-id="' + esc(row.id) + '" data-search="' + esc(String(row.name || '') + ' ' + row.id).toLowerCase() + '">'
              + '<div><input type="checkbox" class="acc-check"></div>'
              + '<div class="acc-info"><div class="acc-name">' + esc(row.name || ('Conta ' + row.id)) + '</div>'
              + '<div class="acc-id">' + esc(row.idFormatted || row.id) + (row.currency ? ' · ' + esc(row.currency) : '') + '</div>'
              + (row.manager ? '<span class="acc-flag manager">Manager / MCC</span>' : '')
              + (row.platform === 'META' && row.status != null && row.status !== 1 ? '<span class="acc-flag inactive">Não ativa</span>' : '')
              + (row.fromSaved ? '<span class="acc-flag saved">Salva (fora da API)</span>' : '')
              + '</div>'
              + '<div class="f-wrap"><input class="acc-input f-cliente" placeholder="Cliente" value="' + esc(v.cliente) + '"></div>'
              + '<div class="f-wrap"><input class="acc-input f-gestor" placeholder="Gestor" value="' + esc(v.gestor) + '"></div>'
              + '<div class="f-wrap"><input class="acc-input f-supervisor" placeholder="Supervisor" value="' + esc(v.supervisor) + '"></div>'
              + '<div class="f-wrap">' + (row.platform === 'GOOGLE'
                ? '<input class="acc-input f-mcc" placeholder="Opcional" value="' + esc(v.loginCustomerId) + '">'
                : '<input class="acc-input" value="—" disabled>') + '</div>'
              + '<div class="f-wrap"><select class="acc-input f-revisao">'
              + '<option value="ok"' + (v.revisao === 'ok' ? ' selected' : '') + '>ok</option>'
              + '<option value="revisar"' + (v.revisao !== 'ok' ? ' selected' : '') + '>pausada</option>'
              + '</select></div>'
              + '</div>';
          }
        }
        html += '</div>';
        area.innerHTML = html;

        // estado inicial dos checkboxes: marcadas = contas com existing (já salvas)
        area.querySelectorAll('.acc-row').forEach(rowEl => {
          const row = rows[Number(rowEl.dataset.idx)];
          const cb = rowEl.querySelector('.acc-check');
          cb.checked = Boolean(row.existing);
          rowEl.classList.toggle('unchecked', !cb.checked);
          cb.addEventListener('change', () => {
            rowEl.classList.toggle('unchecked', !cb.checked);
            updateSummary();
          });
        });

        area.querySelectorAll('[data-selectall]').forEach(el => {
          const platform = el.dataset.selectall;
          const gc = el.querySelector('.group-check');
          gc.addEventListener('change', () => {
            area.querySelectorAll('.acc-row[data-platform="' + platform + '"] .acc-check').forEach(cb => {
              cb.checked = gc.checked;
              cb.dispatchEvent(new Event('change'));
            });
          });
        });

        filter.oninput = () => {
          const q = filter.value.trim().toLowerCase();
          area.querySelectorAll('.acc-row').forEach(rowEl => {
            rowEl.style.display = !q || (rowEl.dataset.search || '').indexOf(q) !== -1 ? '' : 'none';
          });
        };

        updateSummary();
      }

      function updateSummary() {
        const sel = $('accounts-area').querySelectorAll('.acc-row .acc-check:checked').length;
        $('save-summary').textContent = sel + ' conta(s) selecionada(s)';
      }

      function collectSelected() {
        const out = [];
        $('accounts-area').querySelectorAll('.acc-row').forEach(rowEl => {
          const cb = rowEl.querySelector('.acc-check');
          if (!cb.checked) return;
          const platform = rowEl.dataset.platform;
          const id = rowEl.dataset.id;
          const cliente = rowEl.querySelector('.f-cliente').value.trim();
          const gestor = rowEl.querySelector('.f-gestor').value.trim();
          const supervisor = rowEl.querySelector('.f-supervisor').value.trim();
          const mcc = rowEl.querySelector('.f-mcc') ? rowEl.querySelector('.f-mcc').value.trim() : '';
          const revisao = rowEl.querySelector('.f-revisao').value;
          out.push({
            plataforma: platform,
            customer_id: id,
            cliente: cliente,
            gestor: gestor,
            supervisor: supervisor,
            revisao: revisao,
            login_customer_id: mcc
          });
        });
        return out;
      }

      // ---------- ações ----------
      async function loadState() {
        try {
          const data = await apiGet('/api/settings?secret=' + encodeURIComponent(secret));
          state = { tokens: data.tokens, accounts: data.accounts || [] };
          renderTokens();
          if (!rows.length && state.accounts.length) {
            rowsFromSavedOnly();
            renderRows();
          } else if (!rows.length && !state.accounts.length) {
            $('accounts-area').innerHTML = '<div class="empty">Nenhuma conta configurada ainda.<br />Clique em <b>Buscar contas nas APIs</b> para listar as contas vinculadas aos tokens,<br />ou em <b>Importar da planilha (CONFIGS)</b> para trazer a configuração atual.</div>';
          }
        } catch (e) {
          toast('Falha ao carregar configurações: ' + e.message, 'error');
        }
      }

      async function discover() {
        const btn = $('btn-discover');
        setBusy(btn, $('discover-spinner'), true);
        try {
          const data = await apiGet('/api/accounts/discover?secret=' + encodeURIComponent(secret));
          const errs = [];
          if (data.google && !data.google.ok) errs.push('Google: ' + data.google.error);
          if (data.meta && !data.meta.ok) errs.push('Meta: ' + data.meta.error);
          mergeDiscovered(data);
          renderRows();
          if (errs.length) {
            toast(errs.join(' · '), 'warn');
          } else {
            const total = ((data.google && data.google.accounts || []).length) + ((data.meta && data.meta.accounts || []).length);
            toast(total + ' conta(s) encontradas', 'success');
          }
        } catch (e) {
          toast('Falha ao buscar contas: ' + e.message, 'error');
        } finally {
          setBusy(btn, $('discover-spinner'), false);
        }
      }

      async function importConfigs() {
        const btn = $('btn-import');
        setBusy(btn, $('import-spinner'), true);
        try {
          const data = await apiPost('/api/settings/import-configs?secret=' + encodeURIComponent(secret), {});
          toast(data.message || 'Importado da CONFIGS', 'success');
          rows = [];
          await loadState();
          rowsFromSavedOnly();
          renderRows();
        } catch (e) {
          toast('Falha ao importar: ' + e.message, 'error');
        } finally {
          setBusy(btn, $('import-spinner'), false);
        }
      }

      async function save() {
        const selected = collectSelected();
        if (!selected.length) {
          toast('Selecione pelo menos uma conta', 'warn');
          return;
        }
        const btn = $('btn-save');
        setBusy(btn, $('save-spinner'), true);
        try {
          const data = await apiPost('/api/settings/accounts?secret=' + encodeURIComponent(secret), { accounts: selected });
          toast(data.saved + ' conta(s) salva(s) — ' + (data.byPlataforma ? data.byPlataforma.GOOGLE + ' Google, ' + data.byPlataforma.META + ' Meta' : ''), 'success');
          await loadState(); // atualiza state.accounts
          if (rows.length) {
            // mantém as contas descobertas na tela, apenas atualiza o estado "salva"
            const saved = savedByKey();
            rows.forEach(r => { r.existing = saved.get(r.platform + '|' + r.id) || null; });
            renderRows();
          } else {
            rowsFromSavedOnly();
            renderRows();
          }
        } catch (e) {
          toast('Falha ao salvar: ' + e.message, 'error');
        } finally {
          setBusy(btn, $('save-spinner'), false);
        }
      }

      // ---------- inicialização ----------
      $('monitor-link').href = '/api/update-now?secret=' + encodeURIComponent(secret);
      $('btn-discover').onclick = discover;
      $('btn-import').onclick = importConfigs;
      $('btn-save').onclick = save;

      loadState();
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
    return sendHtml(res, '<h1>401 — Unauthorized</h1>', 401);
  }

  try {
    const html = renderSettingsPage({ secret });
    return sendHtml(res, html, 200);
  } catch (error) {
    return sendHtml(res, '<h1>500 — Erro</h1><p>' + (error && error.message ? error.message : 'Erro ao carregar') + '</p>', 500);
  }
};

module.exports.renderSettingsPage = renderSettingsPage;
