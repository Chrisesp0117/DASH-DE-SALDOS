/**
 * Config.gs — configuração do Apps Script para o FINANCE DASH
 *
 * Edite apenas o bloco "SUAS VARIÁVEIS" abaixo.
 * Estas variáveis precisam bater com o seu deploy da Vercel e o CRON_SECRET
 * configurado lá nas variáveis de ambiente.
 */

// =============================================================================
// SUAS VARIÁVEIS — edite aqui
// =============================================================================

const FINANCE_DASH_HOST = 'https://dash-de-saldos.vercel.app';

const CRON_SECRET = 'crs_8f3d7a9c1e4b6f2d9a0c7e5b1f3d8a6c4e2f9b1d7a0c5';

// Endpoints do novo fluxo de fila (recomendado)
const URL_ENQUEUE       = FINANCE_DASH_HOST + '/api/cron/enqueue';
const URL_ADVANCE_QUEUE = FINANCE_DASH_HOST + '/api/cron/advance-queue';

// Endpoints legacy (mantidos para compatibilidade)
const URL_UPDATE_NOW   = FINANCE_DASH_HOST + '/api/update-now';
const URL_UPDATE_STATUS = FINANCE_DASH_HOST + '/api/update-status';

/** Intervalo do acionador do worker: a cada 1 minuto (configure no painel Acionadores) */
/** Intervalo sugerido do enfileirador automático: a cada 2 horas */

// =============================================================================
// Compatibilidade interna (não precisa editar)
// =============================================================================

const DEFAULT_HOST = FINANCE_DASH_HOST;
const DEFAULT_CRON_SECRET = CRON_SECRET;

const UPDATE_URL_PROP = 'UPDATE_URL';
const CRON_SECRET_PROP = 'CRON_SECRET';
const BATCH_SIZE_PROP = 'BATCH_SIZE';

function getUpdateNowUrl_() {
  const secret = getEffectiveConfig_().secret;
  return URL_UPDATE_NOW + '?secret=' + encodeURIComponent(secret);
}

function getEnqueueUrl_() {
  return URL_ENQUEUE;
}

function getAdvanceQueueUrl_() {
  return URL_ADVANCE_QUEUE;
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
    secret: readFirstProp_([CRON_SECRET_PROP, 'CRON_SECRET', 'CRON_TOKEN', 'SECRET']),
    batchSize: Number(readProp_(BATCH_SIZE_PROP) || 20)
  };
}

function getEffectiveConfig_() {
  const cfg = getConfig_();
  return {
    secret: cfg.secret || CRON_SECRET,
    batchSize: cfg.batchSize
  };
}

function setConfig(cronSecret, batchSize) {
  const props = PropertiesService.getScriptProperties();
  if (cronSecret !== undefined) props.setProperty(CRON_SECRET_PROP, String(cronSecret || ''));
  if (batchSize !== undefined) props.setProperty(BATCH_SIZE_PROP, String(batchSize || ''));
  return getConfig_();
}

function debugConfigRead() {
  return {
    host: FINANCE_DASH_HOST,
    secret: getEffectiveConfig_().secret,
    urlEnqueue: URL_ENQUEUE,
    urlAdvanceQueue: URL_ADVANCE_QUEUE,
    urlUpdateNow: URL_UPDATE_NOW,
    urlUpdateStatus: URL_UPDATE_STATUS,
    script: PropertiesService.getScriptProperties().getProperties(),
    effective: getEffectiveConfig_()
  };
}
