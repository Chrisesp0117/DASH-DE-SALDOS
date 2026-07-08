/**
 * Config.gs — VARIÁVEIS e configuração
 * Edite apenas o bloco "SUAS VARIÁVEIS" abaixo.
 */

// =============================================================================
// SUAS VARIÁVEIS — edite aqui
// =============================================================================

const FINANCE_DASH_HOST = 'https://dash-de-saldos.vercel.app';

const CRON_SECRET = 'crs_8f3d7a9c1e4b6f2d9a0c7e5b1f3d8a6c4e2f9b1d7a0c5';

const URL_UPDATE_FULL = FINANCE_DASH_HOST + '/api/cron/update-full';
const URL_UPDATE_NOW = FINANCE_DASH_HOST + '/api/update-now';
const URL_UPDATE_STATUS = FINANCE_DASH_HOST + '/api/update-status';

/** Largura e altura da janela popup (manual) */
const POPUP_LARGURA = 680;
const POPUP_ALTURA = 720;

/** Intervalo sugerido do acionador: a cada 5–10 min (configure no painel Acionadores) */

// =============================================================================
// Compatibilidade interna (não precisa editar)
// =============================================================================

const DEFAULT_HOST = FINANCE_DASH_HOST;
const DEFAULT_CRON_SECRET = CRON_SECRET;
const DEFAULT_UPDATE_URL = URL_UPDATE_FULL;

const UPDATE_URL_PROP = 'UPDATE_URL';
const CRON_SECRET_PROP = 'CRON_SECRET';
const BATCH_SIZE_PROP = 'BATCH_SIZE';
const MAX_CALLS_PROP = 'MAX_CALLS_PER_RUN';
const MAX_RUNTIME_MS_PROP = 'MAX_RUNTIME_MS';
const SAFETY_MARGIN_MS_PROP = 'SAFETY_MARGIN_MS';
const PAUSE_MS_PROP = 'PAUSE_BETWEEN_CALLS_MS';
const START_CURSOR_PROP = 'START_CURSOR';
const AUTO_LOG_SHEET = 'AUTO_LOG';

function getUpdateNowUrl_() {
  const secret = getEffectiveConfig_().secret;
  return URL_UPDATE_NOW + '?secret=' + encodeURIComponent(secret);
}

function getUpdateFullUrl_() {
  return URL_UPDATE_FULL;
}

function getStatusUrl_() {
  return URL_UPDATE_STATUS;
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

function getEffectiveConfig_() {
  const cfg = getConfig_();
  return {
    secret: cfg.secret || CRON_SECRET,
    updateUrl: cfg.updateUrl || URL_UPDATE_FULL,
    batchSize: cfg.batchSize,
    maxCalls: cfg.maxCalls,
    maxRuntimeMs: cfg.maxRuntimeMs,
    safetyMarginMs: cfg.safetyMarginMs,
    pauseMs: cfg.pauseMs
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

function debugConfigRead() {
  return {
    host: FINANCE_DASH_HOST,
    secret: getEffectiveConfig_().secret,
    urlUpdateFull: URL_UPDATE_FULL,
    urlUpdateNow: URL_UPDATE_NOW,
    urlUpdateStatus: URL_UPDATE_STATUS,
    script: PropertiesService.getScriptProperties().getProperties(),
    effective: getEffectiveConfig_()
  };
}
