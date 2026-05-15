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

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Atualização de Saldos</title>
  <style>
    :root{--bg:#f4f7fb;--card:#fff;--ink:#162236;--muted:#61708a;--line:#e5ebf3;--primary:#2563eb;--success:#16a34a;--warn:#d97706;--error:#dc2626}
    *{box-sizing:border-box}
    body{margin:0;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink)}
    .wrap{max-width:760px;margin:24px auto;padding:0 14px}
    .card{background:var(--card);border:1px solid var(--line);border-radius:14px;box-shadow:0 8px 24px rgba(15,23,42,.06);padding:18px}
    .head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px}
    h1{font-size:20px;line-height:1.2;margin:0}
    .pill{font-size:12px;padding:6px 10px;border-radius:999px;border:1px solid var(--line);color:var(--muted);background:#f8fbff}
    .pill.running{color:#7c2d12;background:#fffbeb;border-color:#fed7aa}
    .pill.idle{color:#065f46;background:#ecfdf5;border-color:#bbf7d0}
    .meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:12px}
    .kpi{border:1px solid var(--line);border-radius:10px;padding:10px;background:#fcfdff}
    .k{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px}
    .v{font-size:18px;font-weight:700;margin-top:2px}
    .bar{height:10px;background:#edf2f8;border-radius:999px;overflow:hidden;border:1px solid #e2e8f0}
    .fill{height:100%;width:0;background:linear-gradient(90deg,#2563eb,#10b981);transition:width .25s ease}
    .msg{margin-top:10px;padding:10px 12px;border-radius:10px;border:1px solid var(--line);font-size:13px;color:#334155;background:#f8fafc;min-height:38px}
    .msg.error{color:#991b1b;background:#fef2f2;border-color:#fecaca}
    .msg.warn{color:#92400e;background:#fffbeb;border-color:#fed7aa}
    .msg.ok{color:#065f46;background:#ecfdf5;border-color:#bbf7d0}
    .actions{display:flex;gap:10px;margin-top:14px}
    button{border:0;border-radius:10px;padding:10px 14px;background:var(--primary);color:#fff;font-weight:600;cursor:pointer}
    button[disabled]{opacity:.55;cursor:not-allowed}
    .ghost{background:#0f172a0d;color:#1e293b}
    .foot{margin-top:10px;font-size:12px;color:var(--muted)}
    @media (max-width:640px){.meta{grid-template-columns:1fr 1fr}.wrap{margin:14px auto}}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="head">
        <h1>Atualização de Saldos</h1>
        <span id="statusPill" class="pill idle">Sem atualização ativa</span>
      </div>

      <div class="meta">
        <div class="kpi"><div class="k">Progresso</div><div id="progressText" class="v">0%</div></div>
        <div class="kpi"><div class="k">Cursor</div><div id="cursorText" class="v">0/0</div></div>
        <div class="kpi"><div class="k">Etapa</div><div id="stageText" class="v">idle</div></div>
      </div>

      <div class="bar"><div id="progressFill" class="fill"></div></div>
      <div id="messageBox" class="msg">Pronto para iniciar.</div>

      <div class="actions">
        <button id="startBtn" type="button">Iniciar atualização</button>
        <button id="refreshBtn" class="ghost" type="button">Atualizar status</button>
        <button id="forceBtn" class="ghost" type="button">Forçar retomada</button>
      </div>

      <div class="foot">Página multiusuário: detecta execução ativa e bloqueia novos disparos automaticamente.</div>
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

      const startBtn = document.getElementById('startBtn');
      const refreshBtn = document.getElementById('refreshBtn');
      const forceBtn = document.getElementById('forceBtn');
      const statusPill = document.getElementById('statusPill');
      const messageBox = document.getElementById('messageBox');
      const progressFill = document.getElementById('progressFill');
      const progressText = document.getElementById('progressText');
      const cursorText = document.getElementById('cursorText');
      const stageText = document.getElementById('stageText');

      let lockUi = false;
      const ownerId = 'ui|' + Math.random().toString(36).slice(2, 10) + '|' + Date.now().toString(36);
      let lastStartedByMe = false;
      let manualRunActive = false;
      let autoResumeTimer = null;
      let autoResumeAttempts = 0;
      let lastAutoResumeCursor = -1;

      function clearAutoResumeTimer() {
        if (autoResumeTimer) {
          clearTimeout(autoResumeTimer);
          autoResumeTimer = null;
        }
      }

      function scheduleAutoResume(payload) {
        const running = !!(payload && payload.running);
        const total = Number((payload && payload.totalClients) || (payload && payload.state && payload.state.totalClients) || 0);
        const cursor = Number((payload && payload.displayCursor) || (payload && payload.cursor) || 0);

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
          setMessage('A atualização pausou várias vezes no mesmo ponto. Tente atualizar novamente.', 'error');
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

          setMessage('A atualização pausou no meio do caminho. Retomando automaticamente...', 'warn');
          await startUpdate(true);
        }, 2500);
      }

      function setMessage(text, type) {
        messageBox.textContent = text;
        messageBox.className = 'msg' + (type ? ' ' + type : '');
      }

      function applyState(payload) {
        const running = !!payload.running;
        const total = Number(payload.totalClients || (payload.state && payload.state.totalClients) || 0);
        const cursor = Number(payload.displayCursor || payload.cursor || 0);
        const stage = String(payload.stage || (payload.state && payload.state.stage) || 'idle');
        const owner = String((payload.state && payload.state.owner) || '');
        const isMine = owner && owner === ownerId;
        const staleByHeartbeat = !!payload.staleByHeartbeat;
        const heartbeatAgeMs = Number(payload.heartbeatAgeMs || 0);
        const pct = total > 0 ? Math.min(100, Math.max(0, Math.round((cursor / total) * 100))) : 0;

        progressFill.style.width = pct + '%';
        progressText.textContent = pct + '%';
        cursorText.textContent = cursor + '/' + total;
        stageText.textContent = stage;

        if (running) {
          statusPill.textContent = 'Atualização em andamento';
          statusPill.className = 'pill running';
          if (!lockUi) {
            if (staleByHeartbeat) {
              setMessage('⚠️ Possível travamento detectado. Heartbeat há ' + Math.round(heartbeatAgeMs / 1000) + 's.', 'error');
            } else if (isMine || lastStartedByMe) {
              setMessage('Atualização em andamento (iniciada por você).', 'warn');
            } else {
              setMessage('Atualização em andamento por outro usuário/processo. Ação bloqueada.', 'warn');
            }
          }
        } else {
          statusPill.textContent = 'Sem atualização ativa';
          statusPill.className = 'pill idle';

          if (total > 0 && cursor >= total) {
            manualRunActive = false;
            lastStartedByMe = false;
          }
        }

        startBtn.disabled = running || lockUi;
        forceBtn.disabled = !staleByHeartbeat || lockUi;
      }

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
          const data = await res.json();
          if (!data || data.ok === false) {
            setMessage((data && data.error) ? data.error : 'Falha ao ler status.', 'error');
            return null;
          }
          applyState(data);

          const total = Number(data.totalClients || (data.state && data.state.totalClients) || 0);
          const cursor = Number(data.displayCursor || data.cursor || 0);

          if (!data.running && !lockUi) {
            if (manualRunActive && total > 0 && cursor < total) {
              setMessage('Atualização pausada em ' + cursor + '/' + total + '. Retomando automaticamente...', 'warn');
              scheduleAutoResume(data);
            } else if (total > 0 && cursor >= total) {
              setMessage('Atualização concluída com sucesso.', 'ok');
            } else {
              setMessage('Pronto para iniciar.', 'ok');
            }
          } else {
            clearAutoResumeTimer();
          }
          return data;
        } catch (e) {
          setMessage('Erro ao consultar status: ' + (e && e.message ? e.message : e), 'error');
          return null;
        }
      }

      async function startUpdate(forceRestart = false) {
        clearAutoResumeTimer();
        autoResumeAttempts = 0;
        lastAutoResumeCursor = -1;
        manualRunActive = true;
        lockUi = true;
        startBtn.disabled = true;
        setMessage('Iniciando atualização...', 'warn');

        try {
          const statusData = await fetchStatus();
          if (statusData && statusData.running) {
            setMessage('Já existe atualização em andamento. Aguarde concluir.', 'warn');
            lockUi = false;
            return;
          }

          const query = new URLSearchParams({
            batchSize,
            force: forceRestart ? '1' : force,
            reset,
            databaseOnly,
            owner: ownerId
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
            setMessage('Já existe atualização em andamento por outro usuário/processo. Aguarde concluir.', 'warn');
            await fetchStatus();
            return;
          }

          if (!res.ok || !data || data.ok === false) {
            setMessage((data && data.error) ? data.error : 'Falha ao iniciar atualização.', 'error');
            return;
          }

          lastStartedByMe = true;
          setMessage(data.message || 'Atualização iniciada com sucesso.', 'ok');
          await fetchStatus();
        } catch (e) {
          setMessage('Erro ao iniciar atualização: ' + (e && e.message ? e.message : e), 'error');
        } finally {
          lockUi = false;
          await fetchStatus();
        }
      }

      startBtn.addEventListener('click', startUpdate);
      refreshBtn.addEventListener('click', fetchStatus);
      forceBtn.addEventListener('click', () => startUpdate(true));

      applyState(initialState);
      if (initialState && initialState.running) {
        manualRunActive = true;
      }
      fetchStatus();
      setInterval(fetchStatus, 2000);
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

      const maxMs = Math.max(10000, Number(process.env.CRON_MAX_RUNTIME_MS || 25000));
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
        refreshInterval: 2000,
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
