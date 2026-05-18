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
    const stage = String(state.stage || 'idle');
    const status = String(state.status || 'idle');
    
    // Lógica corrigida de priorização de cursor:
    // 1. Se job está em execução (status='running'), usar progressCursor (atualizado em tempo real)
    // 2. Se job está pausado ou parou (stage='paused'/'database'), usar maior entre cursor e progressCursor
    // 3. Se job finalizou (stage='done'), usar cursor (já sincronizado com progressCursor)
    // 4. Se stage é idle, usar maior entre os dois para segurança
    let cursor = storedCursor;
    if (status === 'running') {
      // Job em execução: usar progressCursor atualizado em tempo real
      cursor = Math.max(progressCursor, storedCursor);
    } else if (stage === 'done') {
      // Job finalizado: usar cursor (que já recebeu o valor de progressCursor em finishJobState)
      cursor = Math.max(storedCursor, progressCursor);
    } else {
      // Job pausado ou outro estado: usar maior para segurança
      cursor = Math.max(storedCursor, progressCursor);
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