require('dotenv').config({ path: '.env' });

const { assertCronAuth, sendJson } = require('../src/core/serverlessJobs');
const { getSheets } = require('../src/services/sheets');
const { readJobState } = require('../src/run');

module.exports = async (req, res) => {
  const authResponse = assertCronAuth(req, res);
  if (authResponse) {
    return authResponse;
  }

  try {
    const sheets = await getSheets();
    const spreadsheetId = process.env.SPREADSHEET_ID;
    const state = await readJobState(sheets, spreadsheetId);

    const configs = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'CONFIGS!A2:A'
    });

    const totalClients = (configs.data.values || []).length;
    const running = String(state.status || '') === 'running' && Number(state.leaseUntil || 0) > Date.now();

    return sendJson(res, {
      ok: true,
      running,
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