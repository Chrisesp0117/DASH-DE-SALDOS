require('dotenv').config({ path: '.env' });

const { readJobState, getJobLockMeta } = require('../src/core/jobStateSupabase');
const { renderHtmlPage } = require('./update-now-ui');
const { enqueueJob } = require('../src/services/jobQueue');

function getQueryValue(req, key) {
  try {
    const host = String(req && req.headers && (req.headers.host || req.headers.Host) || 'dash-de-saldos.vercel.app');
    const base = 'https://' + host;
    const url = new URL(String(req && req.url || '/'), base);
    return url.searchParams.get(key) || '';
  } catch (_) {
    return '';
  }
}

function sendHtml(res, html, statusCode = 200) {
  if (res && typeof res.status === 'function' && typeof res.send === 'function') {
    return res.status(statusCode).send(html);
  }
  if (res && typeof res.setHeader === 'function' && typeof res.end === 'function') {
    res.statusCode = statusCode;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(html);
    return;
  }
  if (typeof Response !== 'undefined') {
    return new Response(html, {
      status: statusCode,
      headers: { 'content-type': 'text/html; charset=utf-8' }
    });
  }
  return { statusCode, body: html };
}

function sendJsonResponse(res, payload, statusCode = 200) {
  if (res && typeof res.status === 'function' && typeof res.json === 'function') {
    return res.status(statusCode).json(payload);
  }
  if (res && typeof res.setHeader === 'function' && typeof res.end === 'function') {
    res.statusCode = statusCode;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
    return;
  }
  if (typeof Response !== 'undefined') {
    return new Response(JSON.stringify(payload), {
      status: statusCode,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }
  return { statusCode, body: JSON.stringify(payload) };
}

async function currentState() {
  const state = await readJobState();
  const lockMeta = getJobLockMeta(state);

  if (!lockMeta.running) {
    return {
      running: false,
      stage: 'idle',
      cursor: 0,
      totalClients: 0
    };
  }

  return {
    running: lockMeta.running,
    stage: String(state.stage || 'idle'),
    cursor: Math.max(Number(state.cursor || 0), Number(state.progressCursor || 0)),
    totalClients: Number(state.totalClients || 0)
  };
}

module.exports = async (req, res) => {
  // auth via secret na query ou header
  const secretFromQuery = req && req.query ? String(req.query.secret || '') : getQueryValue(req, 'secret');
  const secretFromHeader = req && req.headers ? String(req.headers['x-cron-secret'] || '') : '';
  const secret = secretFromQuery || secretFromHeader;
  const expectedSecret = process.env.CRON_SECRET || '';

  if (!expectedSecret || !secret || secret !== expectedSecret) {
    return sendHtml(res, '<h1>401 \\u2014 Unauthorized</h1>', 401);
  }

  const method = String(req && req.method || 'GET').toUpperCase();
  const accept = String(req && req.headers && (req.headers.accept || req.headers.Accept) || '').toLowerCase();
  const isJson = method === 'POST' || accept.includes('application/json');

  if (isJson) {
    // POST: enfileira um job na fila (Formato A) e responde 202 na hora.
    // Aceita batchSize, reset, databaseOnly via query.
    try {
      const batchSizeRaw = (req && req.query && req.query.batchSize) || getQueryValue(req, 'batchSize') || process.env.UPDATE_BATCH_SIZE || 20;
      const batchSize = Math.max(5, Number(batchSizeRaw));
      const resetRaw = (req && req.query && req.query.reset) || getQueryValue(req, 'reset');
      const resetCursor = String(resetRaw || '').toLowerCase() === '1' || String(resetRaw || '').toLowerCase() === 'true';
      const dbOnlyRaw = (req && req.query && req.query.databaseOnly) || getQueryValue(req, 'databaseOnly');
      const databaseOnly = String(dbOnlyRaw || '').toLowerCase() === '1' || String(dbOnlyRaw || '').toLowerCase() === 'true';

      const job = await enqueueJob({
        triggered_by: 'manual',
        options: {
          batchSize,
          resetCursor,
          databaseOnly,
          includeSupervisor: !databaseOnly,
          includeDashboards: !databaseOnly
        }
      });

      return sendJsonResponse(res, {
        ok: true,
        enqueued: true,
        message: 'Job enfileirado. O worker do Apps Script processará no próximo tick.',
        jobId: job.id,
        options: job.options
      }, 202);
    } catch (error) {
      return sendJsonResponse(res, {
        ok: false,
        error: error && error.message ? error.message : 'Erro ao enfileirar job'
      }, 500);
    }
  }

  // GET: renderiza a página de monitor de fila
  try {
    const s = await currentState();
    const html = renderHtmlPage({
      secret,
      initialState: {
        running: s.running,
        stage: s.stage,
        cursor: s.cursor,
        totalClients: s.totalClients
      }
    });
    return sendHtml(res, html, 200);
  } catch (error) {
    return sendHtml(res, '<h1>500 \\u2014 Erro</h1><p>' + (error && error.message ? error.message : 'Erro ao carregar') + '</p>', 500);
  }
};
