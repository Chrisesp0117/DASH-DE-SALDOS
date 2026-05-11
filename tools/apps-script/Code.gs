function onOpen(e) {
  createUpdateMenu_();
}

function onInstall(e) {
  onOpen(e);
}

function createUpdateMenu_() {
  SpreadsheetApp.getUi()
    .createMenu('Atualizar')
    .addItem('Abrir Atualização', 'openUpdateDialog')
    .addSeparator()
    .addItem('Instalar gatilho', 'installOpenTrigger')
    .addItem('Recriar gatilho', 'resetOpenTriggers')
    .addToUi();
}

function installOpenTrigger() {
  const ss = SpreadsheetApp.getActive();
  ScriptApp.newTrigger('onOpen')
    .forSpreadsheet(ss)
    .onOpen()
    .create();
  SpreadsheetApp.getUi().alert('Gatilho instalado. Recarregue a planilha.');
}

function resetOpenTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'onOpen') {
      ScriptApp.deleteTrigger(trigger);
    }
  }
  installOpenTrigger();
}

function setScriptProps() {
  // Helper to set properties programmatically if needed. Prefer using Project Properties UI.
  const props = PropertiesService.getScriptProperties();
  // Uncomment and edit the lines below if you want to set properties via code (not recommended to commit secrets)
  // props.setProperty('UPDATE_URL', 'https://dash-de-saldos.vercel.app/api/update-now');
  // props.setProperty('CRON_SECRET', 'crs_xxx');
  return 'ok';
}

function getScriptProps() {
  const props = PropertiesService.getScriptProperties();
  return {
    updateUrl: props.getProperty('UPDATE_URL') || '',
    secret: props.getProperty('CRON_SECRET') || ''
  };
}

function openUpdateDialog() {
  const cfg = getScriptProps();
  const url = cfg.updateUrl || '';
  const secret = cfg.secret || '';

  const html = HtmlService.createHtmlOutput(`
    <!doctype html>
    <html lang="pt-BR">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Atualização de Saldos</title>
      <style>
        html,body{height:100%;margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f3f6fb;color:#1f2937}
        .wrap{display:flex;flex-direction:column;height:100%}
        .header{padding:14px 16px;background:#0b63d7;color:#fff}
        .content{padding:16px;display:flex;flex-direction:column;gap:12px;flex:1}
        .card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:14px;box-shadow:0 8px 24px rgba(15,23,42,.06)}
        .status{font-size:15px;line-height:1.5}
        .status strong{color:#0b63d7}
        .row{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
        .counter{font-weight:700;font-size:18px}
        .muted{color:#6b7280;font-size:12px}
        .actions{display:flex;gap:10px;flex-wrap:wrap}
        button{background:#0b63d7;color:#fff;padding:10px 14px;border:none;border-radius:8px;cursor:pointer;font-weight:700}
        button.secondary{background:#e5e7eb;color:#111827}
        button[disabled]{opacity:.5;cursor:not-allowed}
        iframe{width:100%;height:100%;border:0;border-radius:10px;min-height:240px;background:#fff}
        .frameWrap{flex:1;min-height:280px}
      </style>
    </head>
    <body>
      <div class="wrap">
        <div class="header"><strong>Atualização de Saldos</strong></div>
        <div class="content">
          <div class="card">
            <div class="row">
              <div class="status">Status: <strong id="status">carregando...</strong></div>
              <div class="counter" id="counter">0/0</div>
            </div>
            <div class="muted" id="lastUpdate">Última atualização: —</div>
          </div>

          <div class="card actions">
            <button id="openNew" type="button">Atualizar manualmente</button>
            <button id="refresh" class="secondary" type="button">Recarregar status</button>
          </div>

          <div class="card frameWrap" id="frameWrap">
            <iframe id="updFrame" src="${url}?secret=${encodeURIComponent(secret)}"></iframe>
          </div>

          <div class="muted">Se o painel mostrar apenas status e contador, a atualização está em andamento. O botão fica desativado enquanto houver execução ativa.</div>
        </div>
      </div>
      <script>
        const frame = document.getElementById('updFrame');
        const statusEl = document.getElementById('status');
        const counterEl = document.getElementById('counter');
        const lastUpdateEl = document.getElementById('lastUpdate');
        const openBtn = document.getElementById('openNew');
        const refreshBtn = document.getElementById('refresh');
        const statusUrl = '/api/update-status?secret=${encodeURIComponent(secret)}';
        const updateUrl = '${url}?secret=' + encodeURIComponent('${secret}');

        async function loadStatus() {
          try {
            const res = await fetch(statusUrl, { cache: 'no-store' });
            const json = await res.json();
            const state = json && json.state ? json.state : {};
            const total = Number(json && json.totalClients ? json.totalClients : 0);
            const cursor = Number(state.cursor || 0);
            const running = String(state.status || '') === 'running' && Number(state.leaseUntil || 0) > Date.now();

            statusEl.textContent = running ? 'Atualização automática/manual em progresso...' : 'idle';
            counterEl.textContent = cursor + '/' + total;
            lastUpdateEl.textContent = 'Última atualização: ' + (state.updatedAt || '—');
            openBtn.disabled = running;
            refreshBtn.disabled = false;
          } catch (e) {
            statusEl.textContent = 'erro ao ler status';
          }
        }

        async function startUpdate() {
          openBtn.disabled = true;
          try {
            const res = await fetch(updateUrl, { method: 'POST' });
            const json = await res.json().catch(() => ({}));
            if (res.status === 409 && json && json.running) {
              alert('Já existe uma atualização em progresso.');
            } else if (!res.ok) {
              alert((json && json.error) || 'Falha ao iniciar atualização');
            }
          } catch (e) {
            alert('Falha ao iniciar atualização');
          } finally {
            setTimeout(loadStatus, 500);
            setTimeout(loadStatus, 2000);
          }
        }

        function checkFrame() {
          try {
            const doc = frame.contentDocument || frame.contentWindow.document;
            if (!doc || doc.body.innerHTML.length < 5) {
              // probably blocked
            }
          } catch (e) {
            document.getElementById('frameWrap').style.display = 'none';
          }
        }
        setTimeout(checkFrame, 1000);

        openBtn.addEventListener('click', startUpdate);
        refreshBtn.addEventListener('click', loadStatus);
        loadStatus();
        setInterval(loadStatus, 1500);
      </script>
    </body>
    </html>
  `).setWidth(720).setHeight(560);

  SpreadsheetApp.getUi().showModalDialog(html, 'Atualização de Saldos');
}
