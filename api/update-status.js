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
    // Priorizar progressCursor (atualizações em tempo real) sobre cursor final
    // Exceto quando totalClients=0 ou ambos são 0 (job não iniciado)
    let cursor = storedCursor;
    if ((progressCursor > 0 || storedCursor === 0) && totalClients > 0) {
      cursor = Math.max(progressCursor, 0);
    }

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