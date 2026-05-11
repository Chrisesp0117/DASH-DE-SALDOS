require('dotenv').config({ path: '.env' });

const { getSheets } = require('../../src/services/sheets');
const { readJobState, writeJobState, appendJobHistory } = require('../../src/run');

function getQueryValue(req, key) {
  try {
    const host = String(req && req.headers && (req.headers.host || req.headers.Host) || '');
    const base = host ? `https://${host}` : 'https://example.invalid';
    const url = new URL(String(req && req.url || '/'), base);
    return url.searchParams.get(key) || '';
  } catch (_) {
    return '';
  }
}

function sendJson(res, payload, statusCode = 200) {
  if (res && typeof res.status === 'function' && typeof res.json === 'function') {
    return res.status(statusCode).json(payload);
  }
  if (res && typeof res.setHeader === 'function' && typeof res.end === 'function') {
    res.statusCode = statusCode;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
    return;
  }
  return { statusCode, body: JSON.stringify(payload) };
}

module.exports = async (req, res) => {
  const expected = process.env.CRON_SECRET || '';
  const secret = req.query?.secret || getQueryValue(req, 'secret') || (req.headers && req.headers['x-cron-secret']);
  if (!expected || String(secret || '') !== expected) {
    return sendJson(res, { ok: false, error: 'Unauthorized' }, 401);
  }

  try {
    const sheets = await getSheets();
    const spreadsheetId = process.env.SPREADSHEET_ID;
    const current = await readJobState(sheets, spreadsheetId);

    const newState = {
      status: 'idle',
      jobId: '',
      generation: current.generation || 0,
      cursor: current.cursor || 0,
      leaseUntil: 0,
      updatedAt: new Date().toISOString(),
      owner: '',
      heartbeatAt: '',
      attempts: current.attempts || 0,
      lastError: 'admin_cleared',
      lastAction: 'admin_clear',
      takeoverBy: '',
      auditPointer: 'JOB_HISTORY'
    };

    await writeJobState(sheets, spreadsheetId, newState);
    // append history
    try {
      await appendJobHistory(sheets, spreadsheetId, {
        timestamp: newState.updatedAt,
        jobId: newState.jobId,
        generation: newState.generation,
        action: 'admin_clear',
        owner: 'admin',
        cursor: newState.cursor,
        leaseUntil: newState.leaseUntil,
        reason: 'manual_clear'
      });
    } catch (e) {
      // best-effort
    }

    return sendJson(res, { ok: true, cleared: true });
  } catch (error) {
    console.error('Erro admin clear-job-state:', error);
    return sendJson(res, { ok: false, error: error && error.message ? error.message : 'Erro' }, 500);
  }
};
