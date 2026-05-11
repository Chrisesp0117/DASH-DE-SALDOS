require('dotenv').config({ path: '.env' });

const { assertCronAuth, sendJson } = require('../src/core/serverlessJobs');
const { getSheets } = require('../src/services/sheets');
const { readJobState } = require('../src/run');

function classifyLockState(state) {
  const now = Date.now();
  const leaseUntil = Number(state && state.leaseUntil || 0);
  const heartbeatAt = state && state.heartbeatAt ? Date.parse(state.heartbeatAt) : 0;
  const status = String(state && state.status || '').trim();

  const running = status === 'running' && leaseUntil > now;
  const leaseRemainingMs = Math.max(0, leaseUntil - now);
  const heartbeatAgeMs = heartbeatAt > 0 ? Math.max(0, now - heartbeatAt) : null;
  const staleByHeartbeat = heartbeatAgeMs !== null && heartbeatAgeMs > 60 * 1000;

  if (running) {
    return {
      lockState: staleByHeartbeat ? 'active_stale' : 'active',
      running: true,
      leaseRemainingMs,
      heartbeatAgeMs,
      staleByHeartbeat
    };
  }

  if (status === 'running' && leaseUntil <= now) {
    return {
      lockState: 'expired',
      running: false,
      leaseRemainingMs: 0,
      heartbeatAgeMs,
      staleByHeartbeat
    };
  }

  return {
    lockState: 'idle',
    running: false,
    leaseRemainingMs: 0,
    heartbeatAgeMs,
    staleByHeartbeat: false
  };
}

module.exports = async (req, res) => {
  const authResponse = assertCronAuth(req, res);
  if (authResponse) {
    return authResponse;
  }

  try {
    const sheets = await getSheets();
    const spreadsheetId = process.env.SPREADSHEET_ID;
    const state = await readJobState(sheets, spreadsheetId);
    const lockMeta = classifyLockState(state);

    const configs = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'CONFIGS!A2:A'
    });

    const totalClients = (configs.data.values || []).length;

    return sendJson(res, {
      ok: true,
      running: lockMeta.running,
      lockState: lockMeta.lockState,
      leaseRemainingMs: lockMeta.leaseRemainingMs,
      heartbeatAgeMs: lockMeta.heartbeatAgeMs,
      staleByHeartbeat: lockMeta.staleByHeartbeat,
      state,
      totalClients
    }, 200);
  } catch (error) {
    console.error('❌ Erro no update-status:', error);
    return sendJson(res, {
      ok: false,
      error: error && error.message ? error.message : 'Erro desconhecido'
    }, 500);
  }
};