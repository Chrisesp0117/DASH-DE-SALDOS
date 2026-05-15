require('dotenv').config({ path: '.env' });

const { assertCronAuth, sendJson, runUpdateJob } = require('../../src/core/serverlessJobs');

function getQueryValue(urlValue, key) {
  try {
    const rawUrl = String(urlValue || '/');
    // Handle both full URLs and paths
    if (rawUrl.startsWith('http')) {
      const url = new URL(rawUrl);
      return url.searchParams.get(key) || '';
    } else {
      // For paths, use the query string parsing directly
      const qIdx = rawUrl.indexOf('?');
      if (qIdx === -1) return '';
      const queryString = rawUrl.substring(qIdx + 1);
      const params = new URLSearchParams(queryString);
      return params.get(key) || '';
    }
  } catch (_) {
    return '';
  }
}

function readRequestBody(req) {
  const body = req && req.body;

  if (!body) {
    return {};
  }

  if (typeof body === 'object') {
    return body;
  }

  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch (_) {
      return {};
    }
  }

  return {};
}

function parseCursorValue(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.max(0, parsed) : undefined;
}

module.exports = async (req, res) => {
  const authResponse = assertCronAuth(req, res);
  if (authResponse) {
    return authResponse;
  }

  try {
    const body = readRequestBody(req);
    const rawBatchSize = req.query?.batchSize || body.batchSize || getQueryValue(req && req.url, 'batchSize') || process.env.UPDATE_BATCH_SIZE || 3;
    const rawCursor = req.query?.cursor || body.cursor || getQueryValue(req && req.url, 'cursor');
    const batchSize = Math.max(1, Number(rawBatchSize));
    const cursor = parseCursorValue(rawCursor);

    const result = await runUpdateJob({ batchSize, cursor });

    if (!result || result.ok === false) {
      return sendJson(res, {
        ok: false,
        error: result && result.error ? result.error : 'Execução falhou',
        result
      }, 500);
    }

    const nextCursor = result.nextCursor !== undefined && result.nextCursor !== null
      ? Number(result.nextCursor)
      : null;

    return sendJson(res, {
      ok: true,
      message: result.finished ? 'Lote finalizado' : 'Lote processado; continuação disponível',
      batchSize,
      cursor: result.cursor !== undefined ? Number(result.cursor) : (cursor !== undefined ? cursor : null),
      nextCursor: Number.isFinite(nextCursor) ? nextCursor : null,
      processed: Number(result.processed || 0),
      total: Number(result.total || 0),
      finished: result.finished === true,
      more: result.finished !== true,
      result
    }, 200);
  } catch (error) {
    console.error('❌ Erro no cron de atualização:', error);
    return sendJson(res, { ok: false, error: error.message }, 500);
  }
};
