/**
 * Menu.gs — menu da planilha FINANCE DASH
 *
 * Cria no menu da planilha:
 *   FINANCE DASH
 *     ├─ Abrir painel web (atualizações)   ← abre NOVA GUIA do navegador
 *     ├─ Abrir configurações (contas)     ← abre NOVA GUIA (aba Configurações)
 *     ├─ Enfileirar atualização completa
 *     ├─ Enfileirar só DATABASE
 *     ├─ Enfileirar com reset de cursor
 *     └─ Ver status do job
 *
 * A função abrirConfiguracoesWeb também pode ser atribuída a um botão
 * desenhado na aba CONFIGS (Atribuir script → abrirConfiguracoesWeb).
 */


function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('FINANCE DASH')
    .addItem('Abrir painel web (atualizações)', 'abrirPainelWeb')
    .addSeparator()
    .addItem('Abrir configurações (contas de anúncio)', 'abrirConfiguracoesWeb')
    .addItem('Enfileirar atualização completa', 'menuEnfileirarCompleta')
    .addItem('Enfileirar só DATABASE', 'menuEnfileirarDatabaseOnly')
    .addItem('Enfileirar com reset de cursor', 'menuEnfileirarReset')
    .addSeparator()
    .addItem('Ver status do job', 'menuVerStatus')
    .addToUi();
}

/**
 * Abre uma URL em uma NOVA GUIA da janela atual do navegador.
 * (O mini-modal é só o trampolim do Apps Script — fecha sozinho em seguida.)
 */
function abrirNovaGuia_(url) {
  const htmlContent = `
    <html>
      <head>
        <script>
          function abrirNovaGuia() {
            window.open('${url}', '_blank');
            google.script.host.close();
          }
        </script>
      </head>
      <body onload="abrirNovaGuia()" style="font-family: sans-serif; text-align: center; padding-top: 20px;">
        <p>Abrindo FINANCE DASH...</p>
        <a href="${url}" target="_blank">Clique aqui se não abrir</a>
      </body>
    </html>
  `;

  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(htmlContent).setWidth(380).setHeight(130),
    'Abrindo...'
  );
}

/**
 * Abre a página única (aba Atualizações) em uma nova guia do navegador.
 */
function abrirPainelWeb() {
  abrirNovaGuia_(getUpdateNowUrl_());
}

/**
 * Abre a página única na aba de Configurações, em uma nova guia do navegador.
 * (Atribua este script ao botão da aba CONFIGS.)
 */
function abrirConfiguracoesWeb() {
  abrirNovaGuia_(getSettingsUiUrl_());
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
