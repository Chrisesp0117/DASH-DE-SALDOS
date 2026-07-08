/**
 * Cron.gs — atualização automática (acionador de tempo)
 * Acionadores → atualizarPlanilhaAutomaticamente → a cada 5–10 min
 */

function atualizarPlanilhaAutomaticamente() {
  const cfg = getEffectiveConfig_();
  const cronSecret = cfg.secret;
  const urlVercel = getUpdateFullUrl_();
  const statusUrl = getStatusUrl_();

  try {
    const statusRes = UrlFetchApp.fetch(statusUrl, {
      method: 'get',
      headers: {
        'x-cron-secret': cronSecret,
        accept: 'application/json'
      },
      muteHttpExceptions: true
    });

    if (statusRes.getResponseCode() >= 200 && statusRes.getResponseCode() < 300) {
      const status = JSON.parse(statusRes.getContentText() || '{}');
      if (status.running) {
        Logger.log('Job já em andamento — pulando ciclo em: ' + new Date());
        return;
      }
    }
  } catch (e) {
    Logger.log('Aviso ao consultar status: ' + (e && e.message ? e.message : String(e)));
  }

  try {
    const resposta = UrlFetchApp.fetch(urlVercel, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-secret': cronSecret
      },
      payload: JSON.stringify({ timestamp: new Date().toISOString() }),
      muteHttpExceptions: true
    });

    const statusCode = resposta.getResponseCode();
    if (statusCode >= 200 && statusCode < 300) {
      Logger.log('Atualização disparada com sucesso em: ' + new Date());
    } else if (statusCode === 409) {
      Logger.log('Atualização já em andamento — nenhuma ação necessária.');
    } else {
      Logger.log('Erro ao chamar API: ' + statusCode + ' - ' + resposta.getContentText());
    }
  } catch (erro) {
    Logger.log('Erro na execução: ' + (erro && erro.message ? erro.message : String(erro)));
  }
}
