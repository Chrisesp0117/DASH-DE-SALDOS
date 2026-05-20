/**
 * Job State Adapter
 * 
 * Permite trocar entre Sheets e Supabase via variável de ambiente
 * Com fallback automático e logging
 */

require('dotenv').config({ path: '.env' });

const jobStateSheets = require('./jobState');
const jobStateSupabase = require('./jobStateSupabase');

const USE_SUPABASE = process.env.USE_SUPABASE === 'true';
const FALLBACK_ENABLED = process.env.SUPABASE_FALLBACK !== 'false';

console.log('[jobStateAdapter] Inicializando com USE_SUPABASE=' + USE_SUPABASE + ', FALLBACK_ENABLED=' + FALLBACK_ENABLED);

// ==================== WRAPPER COM FALLBACK ====================
async function withFallback(operation, method, args) {
  if (!USE_SUPABASE) {
    // Usar Sheets direto
    return await jobStateSheets[method](...args);
  }

  try {
    // Tentar Supabase
    const result = await jobStateSupabase[method](...args);
    return result;
  } catch (err) {
    if (!FALLBACK_ENABLED) throw err;

    console.warn('[jobStateAdapter-fallback] ' + operation + ' falhou em Supabase. Usando Sheets. Erro: ' + err.message);
    try {
      return await jobStateSheets[method](...args);
    } catch (fallbackErr) {
      console.error('[jobStateAdapter-both-failed] Fallback também falhou!', fallbackErr.message);
      throw fallbackErr;
    }
  }
}

// ==================== EXPORTS (mesma interface) ====================

async function readJobState(sheets, spreadsheetId) {
  return await withFallback('readJobState', 'readJobState', [sheets, spreadsheetId]);
}

async function writeJobState(sheets, spreadsheetId, state) {
  return await withFallback('writeJobState', 'writeJobState', [sheets, spreadsheetId, state]);
}

async function touchJobState(sheets, spreadsheetId, jobControl, updates) {
  return await withFallback('touchJobState', 'touchJobState', [sheets, spreadsheetId, jobControl, updates]);
}

async function acquireJobStateLock(sheets, spreadsheetId, options) {
  return await withFallback('acquireJobStateLock', 'acquireJobStateLock', [sheets, spreadsheetId, options]);
}

async function releaseJobState(sheets, spreadsheetId, jobControl, nextStatus) {
  return await withFallback('releaseJobState', 'releaseJobState', [sheets, spreadsheetId, jobControl, nextStatus]);
}

async function heartbeatJobState(sheets, spreadsheetId, jobControl, intervalMs) {
  return await withFallback('heartbeatJobState', 'heartbeatJobState', [sheets, spreadsheetId, jobControl, intervalMs]);
}

function getJobLockMeta(state) {
  // Esta função é pura, não precisa de fallback
  if (USE_SUPABASE) {
    return jobStateSupabase.getJobLockMeta(state);
  } else {
    return jobStateSheets.getJobLockMeta(state);
  }
}

// ==================== EXPORTS ====================
module.exports = {
  readJobState,
  writeJobState,
  touchJobState,
  acquireJobStateLock,
  releaseJobState,
  heartbeatJobState,
  getJobLockMeta,
  // Re-export constantes
  DEFAULT_HEARTBEAT_INTERVAL_MS: jobStateSheets.DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_MAX_MISSED_HEARTBEATS: jobStateSheets.DEFAULT_MAX_MISSED_HEARTBEATS,
  HEARTBEAT_STALE_THRESHOLD_MS: jobStateSheets.HEARTBEAT_STALE_THRESHOLD_MS
};
