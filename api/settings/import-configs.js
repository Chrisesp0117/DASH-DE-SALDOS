/**
 * POST /api/settings/import-configs
 * Importa (uma última vez) a aba CONFIGS da planilha para a tabela
 * accounts_config — preserva gestor/supervisor/revisão já preenchidos e
 * permite aposentar a aba CONFIGS.
 */
require('dotenv').config({ path: '.env' });

const { assertCronAuth, sendJson } = require('../../src/core/serverlessJobs');
const { getSheets } = require('../../src/services/sheets');
const { importFromConfigsSheet } = require('../../src/services/accountsConfig');

module.exports = async (req, res) => {
  const authResponse = assertCronAuth(req, res);
  if (authResponse) return authResponse;

  if (!process.env.SPREADSHEET_ID) {
    return sendJson(res, { ok: false, error: 'SPREADSHEET_ID não configurado no ambiente' }, 500);
  }

  try {
    const sheets = await getSheets();
    const result = await importFromConfigsSheet(sheets, process.env.SPREADSHEET_ID);
    console.log('[settings/import-configs]', result.message);
    return sendJson(res, { ok: true, ...result }, 200);
  } catch (error) {
    console.error('[settings/import-configs] erro:', error && error.message);
    return sendJson(res, { ok: false, error: error && error.message ? error.message : 'Erro ao importar da planilha' }, 500);
  }
};
