/**
 * Legacy.gs — OPCIONAL (não usar no dia a dia)
 * Loop local antigo com aba AUTO_LOG. O cron server-side (Cron.gs) substitui isso.
 * Pode apagar este arquivo se não precisar.
 */

function parseJson_(text) {
  try {
    return JSON.parse(text || '{}');
  } catch (_) {
    return null;
  }
}

function buildUpdateUrl_(baseUrl, cursor, batchSize) {
  const query = [];
  if (batchSize !== undefined && batchSize !== null && String(batchSize).trim() !== '') {
    query.push('batchSize=' + encodeURIComponent(String(batchSize)));
  }
  if (cursor !== undefined && cursor !== null && String(cursor).trim() !== '') {
    query.push('cursor=' + encodeURIComponent(String(cursor)));
  }
  if (!query.length) return baseUrl;
  return baseUrl + (String(baseUrl).indexOf('?') === -1 ? '?' : '&') + query.join('&');
}

function ensureLogSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(AUTO_LOG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(AUTO_LOG_SHEET);
    sheet.appendRow(['timestamp', 'attempt', 'url', 'httpCode', 'cursor', 'nextCursor', 'more', 'finished', 'reason', 'processed', 'total']);
  }
  return sheet;
}

function clearStoredCursor() {
  PropertiesService.getScriptProperties().deleteProperty(START_CURSOR_PROP);
  return 'ok';
}

function orchestrateVercelUpdate() {
  const cfg = getConfig_();
  if (!cfg.updateUrl || !cfg.secret) {
    throw new Error('Defina UPDATE_URL e CRON_SECRET em Script properties.');
  }

  const props = PropertiesService.getScriptProperties();
  const sheet = ensureLogSheet_();
  let cursor = String(props.getProperty(START_CURSOR_PROP) || '').trim();
  let finished = false;
  let lastResponse = null;
  let calls = 0;

  const maxCalls = Math.max(1, Number(cfg.maxCalls || 1));
  const pauseMs = Math.max(0, Number(cfg.pauseMs || 0));
  const batchSize = Math.max(1, Number(cfg.batchSize || 1));
  const maxRuntimeMs = Math.max(60000, Number(cfg.maxRuntimeMs || 300000));
  const safetyMarginMs = Math.max(5000, Math.min(maxRuntimeMs - 1000, Number(cfg.safetyMarginMs || 15000)));
  const startedAt = Date.now();

  for (let attempt = 1; attempt <= maxCalls; attempt++) {
    if (Date.now() - startedAt >= maxRuntimeMs - safetyMarginMs) break;

    calls = attempt;
    const timestamp = new Date().toISOString();
    const targetUrl = buildUpdateUrl_(cfg.updateUrl, cursor, batchSize);

    try {
      const response = UrlFetchApp.fetch(targetUrl, {
        method: 'post',
        contentType: 'application/json',
        headers: { 'x-cron-secret': cfg.secret },
        payload: JSON.stringify({}),
        muteHttpExceptions: true
      });

      const httpCode = response.getResponseCode();
      const parsed = parseJson_(response.getContentText());
      const nextCursor = parsed && parsed.nextCursor != null ? String(parsed.nextCursor) : '';
      finished = !!(parsed && parsed.finished === true);
      lastResponse = { httpCode: httpCode, parsed: parsed };

      sheet.appendRow([timestamp, attempt, targetUrl, httpCode, cursor, nextCursor, !finished, finished, parsed && parsed.reason || '', '', '']);

      if (httpCode < 200 || httpCode >= 300 || finished) break;
      if (nextCursor) {
        cursor = nextCursor;
        props.setProperty(START_CURSOR_PROP, cursor);
      } else break;
    } catch (err) {
      sheet.appendRow([timestamp, attempt, targetUrl, '', cursor, '', false, false, err.message, '', '']);
      break;
    }

    if (attempt < maxCalls && !finished) Utilities.sleep(pauseMs);
  }

  return { calls: calls, finished: finished, cursor: cursor, lastResponse: lastResponse };
}
