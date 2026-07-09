/**
 * Cron.gs — gatilhos de tempo do novo fluxo de fila.
 *
 * Configure DOIS acionadores no painel Acionadores:
 *
 *   1) Worker (consome a fila):
 *      função: avancarFilaAutomaticamente
 *      tipo:   Minuto(a) → a cada 1 minuto
 *
 *   2) Enfileirador (cria jobs periódicos):
 *      função: enfileirarAtualizacaoAutomatica
 *      tipo:   Hora(a) → a cada 2 horas
 *
 * Como funciona o fluxo (Formato A):
 *   - enfileirarAtualizacaoAutomatica cria uma linha "pending" em job_queue (no
 *     Supabase) chamando POST /api/cron/enqueue.
 *   - avancarFilaAutomaticamente chama POST /api/cron/advance-queue, que pega o
 *     "pending" mais antigo, marca "running" e processa até esgotar ~150s. Se
 *     não terminar, re-enfileira e o próximo tick (1min depois) continua do
 *     cursor salvo no job_state. Não há fetch recursivo (auto-chain).
 */

/**
 * WORKER — chamar a cada 1 minuto.
 * Não enfileira nada; apenas avança a fila existente.
 */
function avancarFilaAutomaticamente() {
  const cfg = getEffectiveConfig_();
  const cronSecret = cfg.secret;
  const url = getAdvanceQueueUrl_();

  try {
    const resposta = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'x-cron-secret': cronSecret
      },
      payload: JSON.stringify({ tick: new Date().toISOString() }),
      muteHttpExceptions: true,
      followRedirects: true
    });

    const statusCode = resposta.getResponseCode();
    const body = resposta.getContentText() || '';

    if (statusCode >= 200 && statusCode < 300) {
      Logger.log('[advance-queue] OK ' + statusCode + ' em ' + new Date() + ' — ' + body.substring(0, 200));
    } else if (statusCode === 202) {
      Logger.log('[advance-queue] parcial ' + statusCode + ' em ' + new Date() + ' — ' + body.substring(0, 200));
    } else {
      Logger.log('[advance-queue] HTTP ' + statusCode + ' em ' + new Date() + ' — ' + body.substring(0, 200));
    }
  } catch (erro) {
    Logger.log('[advance-queue] erro: ' + (erro && erro.message ? erro.message : String(erro)));
  }
}

/**
 * ENFILEIRADOR AUTOMÁTICO — chamar a cada 2 horas (ou frequência desejada).
 * Cria um job "pending" na fila. O worker de 1 min vai processá-lo no próximo tick.
 */
function enfileirarAtualizacaoAutomatica() {
  const cfg = getEffectiveConfig_();
  const batchSize = cfg.batchSize || 20;
  criarJobAtualizacao({ batchSize: batchSize, triggeredByValue: 'cron-auto-2h' });
}

/**
 * Enfileira um job de atualização completa.
 * @param {Object} opts { batchSize, reset, databaseOnly, triggeredByValue }
 * @return {Object} resposta JSON do endpoint
 */
function criarJobAtualizacao(opts) {
  opts = opts || {};
  const cfg = getEffectiveConfig_();
  const cronSecret = cfg.secret;
  const baseUrl = (FINANCE_DASH_HOST || '').replace(/\/$/, '');
  const urlBase = baseUrl + '/api/cron/enqueue';

  const batchSize = opts.batchSize || cfg.batchSize || 20;
  const triggeredBy = opts.triggeredByValue || 'manual';

  const params = ['secret=' + encodeURIComponent(cronSecret)];
  params.push('batchSize=' + encodeURIComponent(batchSize));
  if (opts.reset) params.push('reset=1');
  if (opts.databaseOnly) params.push('databaseOnly=1');
  params.push('triggered_by=' + encodeURIComponent(triggeredBy));

  const url = urlBase + '?' + params.join('&');

  try {
    const resposta = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-cron-secret': cronSecret },
      payload: JSON.stringify({ timestamp: new Date().toISOString() }),
      muteHttpExceptions: true
    });
    const code = resposta.getResponseCode();
    const body = resposta.getContentText();
    if (code >= 200 && code < 300) {
      Logger.log('[enqueue] Job enfileirado (' + triggeredBy + '): ' + body.substring(0, 200));
      try { return JSON.parse(body || '{}'); } catch (_) { return { ok: true, raw: body }; }
    } else {
      Logger.log('[enqueue] HTTP ' + code + ' — ' + body.substring(0, 200));
      return { ok: false, error: body };
    }
  } catch (erro) {
    Logger.log('[enqueue] erro: ' + (erro && erro.message ? erro.message : String(erro)));
    return { ok: false, error: String(erro) };
  }
}

/**
 * Enfileira um job de atualização manualmente (chamado pelo menu).
 * @param {number} batchSize
 * @param {boolean} resetCursor
 * @param {boolean} databaseOnly
 * @return {Object} resposta JSON do endpoint
 */
function enfileirarAtualizacaoManual(batchSize, resetCursor, databaseOnly) {
  return criarJobAtualizacao({
    batchSize: batchSize,
    reset: !!resetCursor,
    databaseOnly: !!databaseOnly,
    triggeredByValue: 'manual'
  });
}
