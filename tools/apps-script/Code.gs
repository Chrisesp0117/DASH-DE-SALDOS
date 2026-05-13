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
  const fullUrl = url ? `${url}?secret=${encodeURIComponent(secret)}` : '';

  if (!fullUrl) {
    SpreadsheetApp.getUi().alert('Defina UPDATE_URL e CRON_SECRET em Script properties.');
    return;
  }

  const html = HtmlService.createHtmlOutput(`
    <!doctype html>
    <html lang="pt-BR">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Abrir atualização</title>
      <style>
        body{font-family:Arial,Helvetica,sans-serif;padding:16px;margin:0;color:#1f2937}
        .box{display:flex;flex-direction:column;gap:12px}
        .url{word-break:break-all;background:#f3f4f6;border:1px solid #e5e7eb;border-radius:8px;padding:10px;font-size:12px}
        button{background:#0b63d7;color:#fff;padding:10px 14px;border:none;border-radius:8px;cursor:pointer;font-weight:700}
      </style>
    </head>
    <body>
      <div class="box">
        <button id="open" type="button">Abrir atualização em nova aba</button>
        <div class="url" id="url">${fullUrl}</div>
      </div>
      <script>
        const url = ${JSON.stringify(fullUrl)};
        document.getElementById('open').addEventListener('click', () => {
          window.open(url, '_blank');
        });
      </script>
    </body>
    </html>
  `).setWidth(560).setHeight(220);

  SpreadsheetApp.getUi().showModalDialog(html, 'Abrir atualização');
}
