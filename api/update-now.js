require('dotenv').config({ path: '.env' });

const { runFullUpdateJob, triggerNextCycle, getSafeMaxMs } = require('../src/core/serverlessJobs');
const { getSheets } = require('../src/services/sheets');
const { readJobState, getJobLockMeta } = require('../src/core/jobState');
const { renderHtmlPage } = require('./update-now-ui');

function getQueryValue(req, key) {
  try {
    const host = String(req && req.headers && (req.headers.host || req.headers.Host) || 'dash-de-saldos.vercel.app');
    const base = `https://${host}`;
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

function isQuotaExceededError(error) {
  const msg = String((error && (error.message || error.code || error.status)) || '').toLowerCase();
  return msg.includes('quota exceeded') || msg.includes('resource_exhausted') || String(error && error.status) === '429' || String(error && error.code) === '429';
}

async function isJobActiveNow() {
  const sheets = await getSheets();
  const state = await readJobState(sheets, process.env.SPREADSHEET_ID);
  const lockMeta = getJobLockMeta(state);
  return { running: lockMeta.running, state, lockMeta };
}

function isJsonRequest(req) {
  const method = String(req && req.method || 'GET').toUpperCase();
  if (method === 'POST') return true;
  const accept = String(req && req.headers && (req.headers.accept || req.headers.Accept) || '').toLowerCase();
  return accept.includes('application/json');
}

module.exports = async (req, res) => {
  const secretFromQuery = req && req.query ? String(req.query.secret || '') : getQueryValue(req, 'secret');
  const secretFromHeader = req && req.headers ? String(req.headers['x-cron-secret'] || '') : '';
  const secret = secretFromQuery || secretFromHeader;
  const expectedSecret = process.env.CRON_SECRET || '';

  if (!expectedSecret || !secret || secret !== expectedSecret) {
    return sendHtml(res, '<h1>401 - Unauthorized</h1>', 401);
  }

  const batchSizeParam = req && req.query ? req.query.batchSize : getQueryValue(req, 'batchSize');
  const batchSize = Math.max(5, Number(batchSizeParam || process.env.UPDATE_BATCH_SIZE || 10));
  const forceParam = req && req.query ? req.query.force : getQueryValue(req, 'force');
  const force = String(forceParam || '').toLowerCase() === 'true' || String(forceParam || '') === '1';

  const resetRaw = req && req.query ? req.query.reset : getQueryValue(req, 'reset');
  const resetCursor = String(resetRaw || '').toLowerCase() === 'true' || String(resetRaw || '') === '1';

  const dbOnlyRaw = req && req.query ? req.query.databaseOnly : getQueryValue(req, 'databaseOnly');
  const databaseOnly = String(dbOnlyRaw || '').toLowerCase() === 'true' || String(dbOnlyRaw || '') === '1';
  const ownerParam = req && req.query ? req.query.owner : getQueryValue(req, 'owner');
  const owner = String(ownerParam || '').trim().slice(0, 120);

  const method = String(req && req.method || 'GET').toUpperCase();

  if (method === 'POST' || isJsonRequest(req)) {
    try {
      const active = await isJobActiveNow();
      if (active.running && !(force && active.lockMeta && active.lockMeta.staleByHeartbeat)) {
        return sendJsonResponse(res, {
          ok: false,
          running: true,
          lockState: active.lockMeta && active.lockMeta.staleByHeartbeat ? 'active_stale' : 'active',
          heartbeatAgeMs: active.lockMeta ? active.lockMeta.heartbeatAgeMs : null,
          leaseRemainingMs: active.lockMeta ? active.lockMeta.leaseRemainingMs : 0,
          staleByHeartbeat: active.lockMeta ? active.lockMeta.staleByHeartbeat : false,
          state: active.state,
          message: 'Atualização já em progresso no servidor. Aguarde conclusão antes de iniciar nova.'
        }, 409);
      }

      const maxMsParam = req.query?.maxMs || getQueryValue(req, 'maxMs');
      const maxMs = getSafeMaxMs(maxMsParam || process.env.CRON_MAX_RUNTIME_MS);

      const result = await runFullUpdateJob({
        batchSize,
        maxMs,
        rejectIfRunning: true,
        force,
        resetCursor,
        owner,
        includeSupervisor: !databaseOnly,
        includeDashboards: !databaseOnly
      });

      if (!result || !result.ok) {
        if (result && result.running) {
          const retryAfterMs = 2000 + Math.random() * 3000; // 2-5s de retry recomendado
          console.warn('[update-now-fallback-409] Job estava rodando no fallback check. Retornar 409. retryAfterMs=' + Math.round(retryAfterMs));
          return sendJsonResponse(res, {
            ok: false,
            running: true,
            reason: result.reason || 'job_already_running',
            state: result.state,
            retryAfterMs: Math.round(retryAfterMs),
            message: 'Atualização em andamento. Tentaremos novamente em ' + Math.round(retryAfterMs / 1000) + 's.'
          }, 409);
        }
        return sendJsonResponse(res, {
          ok: false,
          error: result && result.error ? result.error : 'Execução falhou'
        }, 500);
      }

      let continuation = null;
      const shouldAutoContinue = result.reason === 'time_budget_reached' || result.reason === 'insufficient_time_for_dashboards';
      if (shouldAutoContinue) {
        continuation = await triggerNextCycle(req, {
          path: '/api/cron/update-full',
          query: {
            batchSize,
            reset: '0',
            databaseOnly: databaseOnly ? '1' : '0'
          }
        });
      }

      return sendJsonResponse(res, {
        ok: true,
        started: true,
        finished: result.finished,
        message: result.finished
          ? 'Atualização concluída com sucesso.'
          : 'Atualização parcial concluída. O restante será processado no próximo ciclo.',
        iterations: result.iterations,
        totalProcessed: result.totalProcessed,
        refreshInterval: 1500,
        continuation
      }, result.finished ? 200 : 202);
    } catch (error) {
      const payload = {
        ok: false,
        error: isQuotaExceededError(error)
          ? 'Google Sheets com limite de leitura por minuto. Aguarde ~1 minuto e tente novamente.'
          : `Erro ao atualizar: ${error && error.message ? error.message : 'desconhecido'}`
      };
      return sendJsonResponse(res, payload, 500);
    }
  }

  try {
    const active = await isJobActiveNow();
    if (active && active.running) {
      console.log('[update-now-GET] Job já em execução. Estado: generation=' + (active.state?.generation) + ', cursor=' + (active.state?.progressCursor || active.state?.cursor) + ', stage=' + active.state?.stage);
    } else {
      console.log('[update-now-GET] Job inativo/ocioso. Pronto para nova execução.');
    }
    const html = renderHtmlPage({
      secret,
      batchSize,
      force,
      resetCursor,
      databaseOnly,
      maxMs: getSafeMaxMs(process.env.CRON_MAX_RUNTIME_MS),
      initialState: {
        running: active.running,
        stage: active && active.state ? active.state.stage : 'idle',
        cursor: active && active.state ? active.state.progressCursor || active.state.cursor || 0 : 0,
        totalClients: active && active.state ? active.state.totalClients || 0 : 0
      }
    });
    return sendHtml(res, html, 200);
  } catch (error) {
    return sendHtml(res, `<h1>500 - Erro</h1><p>${error && error.message ? error.message : 'Erro ao carregar página'}</p>`, 500);
  }
};



