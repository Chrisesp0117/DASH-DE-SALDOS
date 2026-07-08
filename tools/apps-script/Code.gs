// =============================================================================
// SUAS VARIÁVEIS — edite aqui (preferir Config.gs se usar arquivos separados)
// =============================================================================

const FINANCE_DASH_HOST = 'https://dash-de-saldos.vercel.app';
const CRON_SECRET = 'crs_8f3d7a9c1e4b6f2d9a0c7e5b1f3d8a6c4e2f9b1d7a0c5';
const URL_UPDATE_FULL = FINANCE_DASH_HOST + '/api/cron/update-full';
const URL_UPDATE_NOW = FINANCE_DASH_HOST + '/api/update-now';
const URL_UPDATE_STATUS = FINANCE_DASH_HOST + '/api/update-status';
const POPUP_LARGURA = 680;
const POPUP_ALTURA = 720;

const UPDATE_URL_PROP = 'UPDATE_URL';
const CRON_SECRET_PROP = 'CRON_SECRET';
const BATCH_SIZE_PROP = 'BATCH_SIZE';
const MAX_CALLS_PROP = 'MAX_CALLS_PER_RUN';
const MAX_RUNTIME_MS_PROP = 'MAX_RUNTIME_MS';
const SAFETY_MARGIN_MS_PROP = 'SAFETY_MARGIN_MS';
const PAUSE_MS_PROP = 'PAUSE_BETWEEN_CALLS_MS';
const START_CURSOR_PROP = 'START_CURSOR';
const AUTO_LOG_SHEET = 'AUTO_LOG';

const DEFAULT_HOST = FINANCE_DASH_HOST;
const DEFAULT_CRON_SECRET = CRON_SECRET;
const DEFAULT_UPDATE_URL = URL_UPDATE_FULL;

function getEffectiveConfig_() {
  const cfg = getConfig_();
  return {
    secret: cfg.secret || DEFAULT_CRON_SECRET,
    updateUrl: cfg.updateUrl || DEFAULT_UPDATE_URL,
    batchSize: cfg.batchSize,
    maxCalls: cfg.maxCalls,
    maxRuntimeMs: cfg.maxRuntimeMs,
    safetyMarginMs: cfg.safetyMarginMs,
    pauseMs: cfg.pauseMs
  };
}

function getUpdateNowUrl_() {
  const cfg = getEffectiveConfig_();
  return URL_UPDATE_NOW + '?secret=' + encodeURIComponent(cfg.secret);
}

function readFirstProp_(keys) {
  const keyList = Array.isArray(keys) ? keys : [keys];
  for (const key of keyList) {
    const value = readProp_(key);
    if (String(value || '').trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
}

function readProp_(key) {
  const scriptProps = PropertiesService.getScriptProperties();
  const userProps = PropertiesService.getUserProperties();
  const docProps = PropertiesService.getDocumentProperties();

  const fromScript = scriptProps.getProperty(key);
  if (fromScript !== null && fromScript !== undefined && String(fromScript).trim() !== '') {
    return String(fromScript).trim();
  }

  const fromUser = userProps.getProperty(key);
  if (fromUser !== null && fromUser !== undefined && String(fromUser).trim() !== '') {
    return String(fromUser).trim();
  }

  const fromDoc = docProps.getProperty(key);
  if (fromDoc !== null && fromDoc !== undefined && String(fromDoc).trim() !== '') {
    return String(fromDoc).trim();
  }

  return '';
}

function getConfig_() {
  return {
    updateUrl: readFirstProp_([UPDATE_URL_PROP, 'UPDATE_URL', 'UPDATEURL', 'URL_UPDATE']),
    secret: readFirstProp_([CRON_SECRET_PROP, 'CRON_SECRET', 'CRON_TOKEN', 'SECRET']),
    batchSize: Number(readProp_(BATCH_SIZE_PROP) || 20),
    maxCalls: Number(readProp_(MAX_CALLS_PROP) || 5),
    maxRuntimeMs: Number(readProp_(MAX_RUNTIME_MS_PROP) || 300000),
    safetyMarginMs: Number(readProp_(SAFETY_MARGIN_MS_PROP) || 15000),
    pauseMs: Number(readProp_(PAUSE_MS_PROP) || 500)
  };
}

function setConfig(updateUrl, cronSecret, batchSize, maxCallsPerRun, pauseBetweenCallsMs) {
  const props = PropertiesService.getScriptProperties();
  if (updateUrl !== undefined) props.setProperty(UPDATE_URL_PROP, String(updateUrl || ''));
  if (cronSecret !== undefined) props.setProperty(CRON_SECRET_PROP, String(cronSecret || ''));
  if (batchSize !== undefined) props.setProperty(BATCH_SIZE_PROP, String(batchSize || ''));
  if (maxCallsPerRun !== undefined) props.setProperty(MAX_CALLS_PROP, String(maxCallsPerRun || ''));
  if (pauseBetweenCallsMs !== undefined) props.setProperty(PAUSE_MS_PROP, String(pauseBetweenCallsMs || ''));
  return getConfig_();
}

function setConfigFull(updateUrl, cronSecret, batchSize, maxCallsPerRun, pauseBetweenCallsMs, maxRuntimeMs, safetyMarginMs) {
  const props = PropertiesService.getScriptProperties();
  if (updateUrl !== undefined) props.setProperty(UPDATE_URL_PROP, String(updateUrl || ''));
  if (cronSecret !== undefined) props.setProperty(CRON_SECRET_PROP, String(cronSecret || ''));
  if (batchSize !== undefined) props.setProperty(BATCH_SIZE_PROP, String(batchSize || ''));
  if (maxCallsPerRun !== undefined) props.setProperty(MAX_CALLS_PROP, String(maxCallsPerRun || ''));
  if (pauseBetweenCallsMs !== undefined) props.setProperty(PAUSE_MS_PROP, String(pauseBetweenCallsMs || ''));
  if (maxRuntimeMs !== undefined) props.setProperty(MAX_RUNTIME_MS_PROP, String(maxRuntimeMs || ''));
  if (safetyMarginMs !== undefined) props.setProperty(SAFETY_MARGIN_MS_PROP, String(safetyMarginMs || ''));
  return debugConfigRead();
}

function debugConfigRead() {
  return {
    script: PropertiesService.getScriptProperties().getProperties(),
    user: PropertiesService.getUserProperties().getProperties(),
    document: PropertiesService.getDocumentProperties().getProperties(),
    effective: getConfig_()
  };
}

function clearStoredCursor() {
  PropertiesService.getScriptProperties().deleteProperty(START_CURSOR_PROP);
  return 'ok';
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

function buildUpdateUrl_(baseUrl, cursor, batchSize) {
  const query = [];
  if (batchSize !== undefined && batchSize !== null && String(batchSize).trim() !== '') {
    query.push('batchSize=' + encodeURIComponent(String(batchSize)));
  }
  if (cursor !== undefined && cursor !== null && String(cursor).trim() !== '') {
    query.push('cursor=' + encodeURIComponent(String(cursor)));
  }
  if (!query.length) {
    return baseUrl;
  }
  return baseUrl + (String(baseUrl).indexOf('?') === -1 ? '?' : '&') + query.join('&');
}

function parseJson_(text) {
  try {
    return JSON.parse(text || '{}');
  } catch (_) {
    return null;
  }
}

function buildStatusUrl_(baseUrl) {
  const normalized = String(baseUrl || '').trim();
  if (!normalized) return '';
  return normalized
    .replace(/\/api\/update-now(\?.*)?$/i, '/api/update-status')
    .replace(/\/api\/update(\?.*)?$/i, '/api/update-status')
    .replace(/\/api\/cron\/update-full(\?.*)?$/i, '/api/update-status');
}

function buildUpdateFullUrl_(baseUrl) {
  const normalized = String(baseUrl || '').trim();
  if (!normalized) return '';
  try {
    const match = normalized.match(/^(https?:\/\/[^/?#]+)/i);
    if (match && match[1]) {
      return match[1] + '/api/cron/update-full';
    }
  } catch (_) {}
  return normalized
    .replace(/\/api\/update-now(\?.*)?$/i, '/api/cron/update-full')
    .replace(/\/api\/update(\?.*)?$/i, '/api/cron/update-full');
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
        <p>Abrindo janela de atualizacao...</p>
        <button onclick="abrirJanela()">Clique aqui se nao abrir</button>
      </body>
    </html>
  `;

  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(htmlContent).setWidth(380).setHeight(160),
    'FINANCE DASH'
  );
}

function atualizarPlanilhaAutomaticamente() {
  const cfg = getEffectiveConfig_();
  const cronSecret = cfg.secret;
  const urlVercel = URL_UPDATE_FULL;
  const statusUrl = URL_UPDATE_STATUS;

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
        Logger.log('Job ja em andamento — pulando ciclo em: ' + new Date());
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
      Logger.log('Atualizacao disparada com sucesso em: ' + new Date());
    } else if (statusCode === 409) {
      Logger.log('Atualizacao ja em andamento — nenhuma acao necessaria.');
    } else {
      Logger.log('Erro ao chamar API: ' + statusCode + ' - ' + resposta.getContentText());
    }
  } catch (erro) {
    Logger.log('Erro na execucao: ' + (erro && erro.message ? erro.message : String(erro)));
  }
}

function orchestrateVercelUpdate() {
  const cfg = getConfig_();
  if (!cfg.updateUrl || !cfg.secret) {
    const debug = debugConfigRead();
    const scriptKeys = Object.keys(debug.script || {});
    const userKeys = Object.keys(debug.user || {});
    const documentKeys = Object.keys(debug.document || {});
    throw new Error(
      'Defina UPDATE_URL e CRON_SECRET em Script properties. ' +
      `effective.updateUrl=${cfg.updateUrl ? 'ok' : 'vazio'}; ` +
      `effective.secret=${cfg.secret ? 'ok' : 'vazio'}; ` +
      `scriptKeys=[${scriptKeys.join(',')}]; ` +
      `userKeys=[${userKeys.join(',')}]; ` +
      `documentKeys=[${documentKeys.join(',')}]`
    );
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
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= maxRuntimeMs - safetyMarginMs) {
      break;
    }

    calls = attempt;
    const timestamp = new Date().toISOString();
    const targetUrl = buildUpdateUrl_(cfg.updateUrl, cursor, batchSize);

    try {
      const response = UrlFetchApp.fetch(targetUrl, {
        method: 'post',
        contentType: 'application/json',
        headers: {
          'x-cron-secret': cfg.secret
        },
        payload: JSON.stringify({}),
        muteHttpExceptions: true
      });

      const httpCode = response.getResponseCode();
      const bodyText = response.getContentText();
      const parsed = parseJson_(bodyText);
      const nextCursor = parsed && parsed.nextCursor !== undefined && parsed.nextCursor !== null && String(parsed.nextCursor).trim() !== ''
        ? String(parsed.nextCursor)
        : '';
      const responseCursor = parsed && parsed.cursor !== undefined && parsed.cursor !== null
        ? String(parsed.cursor)
        : cursor;
      const more = !!(parsed && (parsed.more === true || parsed.finished === false || nextCursor));

      finished = !!(parsed && parsed.finished === true);
      lastResponse = {
        httpCode: httpCode,
        body: bodyText,
        parsed: parsed
      };

      sheet.appendRow([
        timestamp,
        attempt,
        targetUrl,
        httpCode,
        responseCursor,
        nextCursor,
        more,
        finished,
        parsed && parsed.reason ? String(parsed.reason) : '',
        parsed && parsed.processed !== undefined ? Number(parsed.processed) : '',
        parsed && parsed.total !== undefined ? Number(parsed.total) : ''
      ]);

      if (httpCode < 200 || httpCode >= 300) {
        break;
      }

      if (finished) {
        props.deleteProperty(START_CURSOR_PROP);
        break;
      }

      if (nextCursor) {
        cursor = nextCursor;
        props.setProperty(START_CURSOR_PROP, cursor);
      } else if (!more) {
        break;
      }
    } catch (err) {
      const errMsg = err && err.message ? err.message : String(err);
      sheet.appendRow([timestamp, attempt, targetUrl, '', cursor, '', false, false, errMsg, '', '']);
      lastResponse = { error: errMsg };
      break;
    }

    if (attempt < maxCalls && !finished) {
      Utilities.sleep(pauseMs);
    }
  }

  return {
    calls: calls,
    finished: finished,
    cursor: cursor,
    lastResponse: lastResponse
  };
}
