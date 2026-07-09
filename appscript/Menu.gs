/**
 * Menu.gs — menu da planilha + interface manual FINANCE DASH
 *
 * Cria no menu da planilha:
 *   FINANCE DASH
 *     ├─ Abrir painel manual (legado)
 *     ├─ Enfileirar atualização completa   ← novo (fila)
 *     ├─ Enfileirar só DATABASE             ← novo (fila, databaseOnly)
 *     ├─ Enfileirar com reset de cursor     ← novo (fila, reset=1)
 *     └─ Ver status do job
 */


function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('FINANCE DASH')
    .addItem('Abrir painel manual', 'abrirLinkPopUp')
    .addSeparator()
    .addItem('Enfileirar atualização completa', 'menuEnfileirarCompleta')
    .addItem('Enfileirar só DATABASE', 'menuEnfileirarDatabaseOnly')
    .addItem('Enfileirar com reset de cursor', 'menuEnfileirarReset')
    .addSeparator()
    .addItem('Ver status do job', 'menuVerStatus')
    .addToUi();
}

/**
 * Painel manual legado (abre /api/update-now no popup).
 */
function abrirLinkPopUp() {
  const url = getUpdateNowUrl_();
  const htmlContent = `
    <html>
      <head>
        <script>
          function abrirJanela() {
            var largura = 680;
            var altura = 720;
            var esquerda = (screen.width - largura) / 2;
            var topo = (screen.height - altura) / 2;

            window.open('${url}', 'FINANCE DASH',
              'width=' + largura + ', height=' + altura +
              ', top=' + topo + ', left=' + esquerda +
              ', scrollbars=yes, resizable=yes');

            setTimeout(function() {
              google.script.host.close();
            }, 1000);
          }
        </script>
      </head>
      <body onload="abrirJanela()" style="font-family: sans-serif; text-align: center; padding-top: 20px;">
        <p>Abrindo FINANCE DASH...</p>
        <button onclick="abrirJanela()">Clique aqui se não abrir</button>
      </body>
    </html>
  `;

  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(htmlContent).setWidth(380).setHeight(160),
    'FINANCE DASH'
  );
}

function menuEnfileirarCompleta() {
  const ui = SpreadsheetApp.getUi();
  const resp = enfileirarAtualizacaoManual();
  if (resp && resp.ok) {
    ui.alert('✅ Job enfileirado!\n\nO worker (Apps Script a cada 1 min) processará em breve.\n\nID: ' + (resp.jobId || '-') + '\nOptions: ' + JSON.stringify(resp.options || {}));
  } else {
    ui.alert('❌ Falha ao enfileirar:\n' + JSON.stringify(resp));
  }
}

function menuEnfileirarDatabaseOnly() {
  const ui = SpreadsheetApp.getUi();
  const resp = enfileirarAtualizacaoManual(null, false, true);
  if (resp && resp.ok) {
    ui.alert('✅ Job DATABASE enfileirado!\n\nID: ' + (resp.jobId || '-'));
  } else {
    ui.alert('❌ Falha ao enfileirar:\n' + JSON.stringify(resp));
  }
}

function menuEnfileirarReset() {
  const ui = SpreadsheetApp.getUi();
  const confirmar = ui.alert(
    'Reset de cursor',
    'Isso vai zerar o cursor e iniciar um ciclo novo do zero. Continuar?',
    ui.ButtonSet.YES_NO
  );
  if (confirmar !== ui.Button.YES) return;

  const resp = enfileirarAtualizacaoManual(null, true, false);
  if (resp && resp.ok) {
    ui.alert('✅ Job com reset enfileirado!\n\nID: ' + (resp.jobId || '-'));
  } else {
    ui.alert('❌ Falha ao enfileirar:\n' + JSON.stringify(resp));
  }
}

function menuVerStatus() {
  const ui = SpreadsheetApp.getUi();
  const cfg = getEffectiveConfig_();
  const url = getStatusUrl_();

  try {
    const resposta = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { 'x-cron-secret': cfg.secret, accept: 'application/json' },
      muteHttpExceptions: true
    });
    const code = resposta.getResponseCode();
    const body = resposta.getContentText();
    if (code >= 200 && code < 300) {
      const s = JSON.parse(body || '{}');
      const lines = [
        'Status do job (Supabase):',
        '',
        'running: ' + (s.running ? 'sim' : 'não'),
        'stage: ' + (s.stage || 'idle'),
        'cursor: ' + (s.cursor || 0) + '/' + (s.totalClients || 0),
        'leaseRemainingMs: ' + (s.leaseRemainingMs || 0),
        'heartbeatAgeMs: ' + (s.heartbeatAgeMs || 'n/a'),
        'staleByHeartbeat: ' + (s.staleByHeartbeat ? 'sim' : 'não')
      ];
      ui.alert(lines.join('\n'));
    } else {
      ui.alert('HTTP ' + code + '\n' + body);
    }
  } catch (e) {
    ui.alert('Erro ao consultar status: ' + (e && e.message ? e.message : String(e)));
  }
}
