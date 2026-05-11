function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Atualizar')
    .addItem('Abrir Atualização', 'openUpdateDialog')
    .addToUi();
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
        html,body{height:100%;margin:0;padding:0;font-family:Arial,Helvetica,sans-serif}
        .wrap{display:flex;flex-direction:column;height:100%}
        .frame{flex:1;border:0}
        .footer{padding:8px;background:#f6f6f6;border-top:1px solid #e0e0e0;text-align:right}
        button{background:#0b63d7;color:#fff;padding:6px 10px;border:none;border-radius:4px;cursor:pointer}
      </style>
    </head>
    <body>
      <div class="wrap">
        <iframe id="updFrame" class="frame" src="${url}?secret=${encodeURIComponent(secret)}"></iframe>
        <div class="footer">
          <button id="openNew">Abrir em nova aba</button>
        </div>
      </div>
      <script>
        const frame = document.getElementById('updFrame');
        function checkFrame() {
          try {
            const doc = frame.contentDocument || frame.contentWindow.document;
            if (!doc || doc.body.innerHTML.length < 5) {
              // probably blocked
            }
          } catch (e) {
            frame.style.display = 'none';
          }
        }
        setTimeout(checkFrame, 1000);
        document.getElementById('openNew').addEventListener('click', function(){
          const u = '${url}?secret=' + encodeURIComponent('${secret}');
          window.open(u, '_blank');
        });
      </script>
    </body>
    </html>
  `).setWidth(720).setHeight(560);

  SpreadsheetApp.getUi().showModalDialog(html, 'Atualização de Saldos');
}
