require('dotenv').config({ path: '.env' });

const { assertCronAuth, sendJson } = require('../src/core/serverlessJobs');
const { getSheets } = require('../src/services/sheets');
const { readJobState, getJobLockMeta } = require('../src/core/jobState');

module.exports = async (req, res) => {
  const authResponse = assertCronAuth(req, res);
  if (authResponse) {
    return authResponse;
  }

  try {
    const sheets = await getSheets();
    const spreadsheetId = process.env.SPREADSHEET_ID;
    const state = await readJobState(sheets, spreadsheetId);
    const lockMeta = getJobLockMeta(state);

    const totalClients = Number.isFinite(Number(state.totalClients))
      ? Number(state.totalClients)
      : 0;

    const progressCursor = Number.isFinite(Number(state.progressCursor)) ? Number(state.progressCursor) : 0;
    const storedCursor = Number.isFinite(Number(state.cursor)) ? Number(state.cursor) : 0;
    const cursor = lockMeta.running ? progressCursor : storedCursor;

    return sendJson(res, {
      ok: true,
      running: lockMeta.running,
      lockState: lockMeta.lockState,
      stage: String(state.stage || 'idle'),
      cursor,
      displayCursor: cursor,
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