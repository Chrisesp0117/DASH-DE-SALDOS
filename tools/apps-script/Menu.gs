/**
 * Menu.gs — menu da planilha + interface manual FINANCE DASH
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('FINANCE DASH')
    .addItem('Abrir atualização manual', 'abrirLinkPopUp')
    .addToUi();
}

function abrirLinkPopUp() {
  const url = getUpdateNowUrl_();
  const htmlContent = `
    <html>
      <head>
        <script>
          function abrirJanela() {
            var largura = ${POPUP_LARGURA};
            var altura = ${POPUP_ALTURA};
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
