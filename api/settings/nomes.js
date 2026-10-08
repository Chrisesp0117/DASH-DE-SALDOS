/**
 * /api/settings/nomes
 *  - GET (?secret=...): catálogos de gestores e supervisores.
 *  - POST (header x-cron-secret): manipula as listas.
 *    Body: { action: 'add' | 'delete', type: 'gestor' | 'supervisor', nome }
 */
require('dotenv').config({ path: '.env' });

const { assertCronAuth, sendJson, readJsonBody } = require('../../src/core/serverlessJobs');
const { getNomeLists, addNome, deleteNome } = require('../../src/services/nomes');

module.exports = async (req, res) => {
  const authResponse = assertCronAuth(req, res);
  if (authResponse) return authResponse;

  const method = String(req && req.method || 'GET').toUpperCase();

  try {
    if (method === 'GET') {
      const lists = await getNomeLists();
      return sendJson(res, { ok: true, ...lists }, 200);
    }

    if (method === 'POST') {
      const body = await readJsonBody(req);
      const action = String(body && body.action || '').trim().toLowerCase();
      const type = String(body && body.type || '').trim().toLowerCase();
      const nome = String(body && body.nome || '').trim();

      if (action !== 'add' && action !== 'delete') {
        return sendJson(res, { ok: false, error: "action deve ser 'add' ou 'delete'" }, 400);
      }
      if (!nome) {
        return sendJson(res, { ok: false, error: 'nome é obrigatório' }, 400);
      }

      let lists;
      if (action === 'add') {
        lists = await addNome(type, nome);
      } else {
        lists = await deleteNome(type, nome);
      }
      return sendJson(res, { ok: true, action, type, nome, ...lists }, 200);
    }

    return sendJson(res, { ok: false, error: 'Método não suportado: ' + method }, 405);
  } catch (error) {
    console.error('[settings/nomes] erro:', error && error.message);
    return sendJson(res, { ok: false, error: error && error.message ? error.message : 'Erro ao manipular nomes' }, 500);
  }
};
