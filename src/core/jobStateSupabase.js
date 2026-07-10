require('dotenv').config({ path: '.env' });
const { createClient } = require('@supabase/supabase-js');
const { randomUUID } = require('crypto');

// Inicializar Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('SUPABASE_URL e SUPABASE_KEY não definidas em .env');
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ==================== CONSTANTES ====================
const JOB_STATE_TABLE = 'job_state';
const JOB_HISTORY_TABLE = 'job_history';
const DEFAULT_HEARTBEAT_INTERVAL_MS = Number(process.env.HEARTBEAT_INTERVAL_MS || 20 * 1000);
const DEFAULT_MAX_MISSED_HEARTBEATS = Number(process.env.HEARTBEAT_MISSED_COUNT || 3);
const HEARTBEAT_STALE_THRESHOLD_MS = DEFAULT_HEARTBEAT_INTERVAL_MS * DEFAULT_MAX_MISSED_HEARTBEATS;

// ==================== TIPOS ====================
function createDefaultJobState() {
  return {
    id: 1,
    status: 'idle',
    jobId: '',
    generation: 0,
    cursor: 0,
    progressCursor: 0,
    totalClients: 0,
    leaseUntil: 0,
    updatedAt: new Date().toISOString(),
    owner: '',
    heartbeatAt: null,
    attempts: 0,
    lastError: '',
    lastAction: '',
    takeoverBy: '',
    auditPointer: 'JOB_HISTORY',
    stage: 'idle',
    cliente_atual: ''
  };
}

function toIsoNow() {
  return new Date().toISOString();
}

// ==================== READ ====================
async function readJobState() {
  try {
    const { data, error } = await supabase
      .from(JOB_STATE_TABLE)
      .select('*')
      .eq('id', 1)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // Row not found - create default
        console.log('[readJobState] Tabela vazia, criando estado padrão');
        const defaultState = createDefaultJobState();
        const { data: created, error: createError } = await supabase
          .from(JOB_STATE_TABLE)
          .insert([defaultState])
          .select()
          .single();
        
        if (createError) throw createError;
        return created;
      }
      throw error;
    }

    console.log('[readJobState-supabase] Lido: status=' + data.status + ', generation=' + data.generation + ', totalClients=' + data.totalClients);
    return data;
  } catch (err) {
    console.error('[readJobState-error]', err.message);
    throw err;
  }
}

// ==================== WRITE ====================
async function writeJobState(state) {
  try {
    const payload = {
      id: 1,
      status: state.status || 'idle',
      jobId: state.jobId || '',
      generation: Number.isFinite(Number(state.generation)) ? Number(state.generation) : 0,
      cursor: Math.max(0, Number(state.cursor || 0)),
      progressCursor: Math.max(0, Number(state.progressCursor || 0)),
      totalClients: Math.max(0, Number(state.totalClients || 0)),
      leaseUntil: Math.max(0, Number(state.leaseUntil || 0)),
      updatedAt: state.updatedAt || toIsoNow(),
      owner: state.owner || '',
      heartbeatAt: state.heartbeatAt || null,
      attempts: Number.isFinite(Number(state.attempts)) ? Number(state.attempts) : 0,
      lastError: state.lastError || '',
      lastAction: state.lastAction || '',
      takeoverBy: state.takeoverBy || '',
      auditPointer: state.auditPointer || 'JOB_HISTORY',
      stage: state.stage || 'idle',
      cliente_atual: state.cliente_atual || ''
    };

    const { data, error } = await supabase
      .from(JOB_STATE_TABLE)
      .upsert([payload], { onConflict: 'id' })
      .select()
      .single();

    if (error) throw error;

    console.log('[writeJobState-supabase] Escrito: generation=' + data.generation + ', totalClients=' + data.totalClients);
    return data;
  } catch (err) {
    console.error('[writeJobState-error]', err.message);
    throw err;
  }
}

// ==================== TOUCH (UPDATE CAMPOS) ====================
async function touchJobState(state, updates = {}) {
  try {
    const current = await readJobState();
    
    // Validar generation
    if (!isSameJobState(current, state)) {
      console.error('[touchJobState-INTERRUPTED] Generation mismatch! state.generation=' + state.generation + ', current.generation=' + current.generation);
      throw new Error('JOB_INTERRUPTED');
    }

    const nextCursor = updates.cursor !== undefined && Number.isFinite(Number(updates.cursor)) ? Number(updates.cursor) : current.cursor;

    let nextProgressCursor;
    if (updates.hasOwnProperty('progressCursor') && Number.isFinite(Number(updates.progressCursor))) {
      nextProgressCursor = Number(updates.progressCursor);
    } else if (!updates.hasOwnProperty('progressCursor') && Number.isFinite(Number(current.progressCursor))) {
      nextProgressCursor = Number(current.progressCursor);
    } else {
      nextProgressCursor = nextCursor;
    }

    const nextTotalClients = updates.totalClients !== undefined && Number.isFinite(Number(updates.totalClients))
      ? Number(updates.totalClients)
      : (Number.isFinite(Number(current.totalClients)) ? Number(current.totalClients) : 0);

    const payload = {
      id: 1,
      status: updates.status || current.status || 'running',
      jobId: current.jobId,
      generation: current.generation,
      cursor: nextCursor,
      progressCursor: nextProgressCursor,
      totalClients: nextTotalClients,
      leaseUntil: current.leaseUntil,
      updatedAt: toIsoNow(),
      owner: current.owner,
      heartbeatAt: current.heartbeatAt,
      attempts: Number.isFinite(Number(updates.attempts)) ? Number(updates.attempts) : (Number.isFinite(Number(current.attempts)) ? Number(current.attempts) : 0),
      lastError: updates.lastError || current.lastError || '',
      lastAction: updates.lastAction || current.lastAction || '',
      takeoverBy: current.takeoverBy || '',
      auditPointer: current.auditPointer || 'JOB_HISTORY',
      stage: updates.stage || current.stage || 'idle',
      cliente_atual: updates.cliente_atual !== undefined ? updates.cliente_atual : (current.cliente_atual || '')
    };

    const { data, error } = await supabase
      .from(JOB_STATE_TABLE)
      .upsert([payload], { onConflict: 'id' })
      .select()
      .single();

    if (error) throw error;

    console.log('[touchJobState-supabase] Atualizado: progressCursor=' + nextProgressCursor + ', totalClients=' + nextTotalClients);
    return data;
  } catch (err) {
    console.error('[touchJobState-error]', err.message);
    throw err;
  }
}

// ==================== LOCK MANAGEMENT ====================
async function acquireJobStateLock(options = {}) {
  try {
    const current = await readJobState();
    const lockMeta = getJobLockMeta(current);
    
    if (lockMeta.running && !options.force) {
      const err = new Error('Job already running by another worker');
      err.code = 'JOB_ALREADY_RUNNING';
      err.state = current;
      throw err;
    }

    const shouldResetCursor = !!options.resetCursor;
    const nextGeneration = (current.generation || 0) + 1;
    const now = Date.now();
    const leaseMs = Math.max(60000, Number(options.leaseMs || process.env.JOB_LEASE_MS || 60 * 1000));
    const jobId = String(options.jobId || randomUUID());

    const state = {
      id: 1,
      status: 'running',
      jobId,
      generation: nextGeneration,
      cursor: shouldResetCursor ? 0 : (current.cursor || 0),
      progressCursor: shouldResetCursor ? 0 : (current.progressCursor || 0),
      totalClients: shouldResetCursor ? 0 : (Number.isFinite(Number(current.totalClients)) && Number(current.totalClients) >= 0 ? Number(current.totalClients) : 0),
      leaseUntil: now + leaseMs,
      updatedAt: toIsoNow(),
      owner: options.owner || await getOwnerId(),
      heartbeatAt: toIsoNow(),
      attempts: 0,
      lastError: '',
      lastAction: 'acquire',
      takeoverBy: '',
      auditPointer: 'JOB_HISTORY',
      stage: 'database',
      cliente_atual: shouldResetCursor ? '' : (current.cliente_atual || '')
    };

    const { data, error } = await supabase
      .from(JOB_STATE_TABLE)
      .upsert([state], { onConflict: 'id' })
      .select()
      .single();

    if (error) throw error;

    console.log('[acquireJobStateLock-supabase] Lock adquirido. generation=' + data.generation + ', jobId=' + data.jobId.slice(0, 8) + '...');

    // Append to history
    await appendJobHistory({
      timestamp: toIsoNow(),
      jobId: state.jobId,
      generation: state.generation,
      action: 'acquire',
      owner: state.owner,
      cursor: state.cursor,
      leaseUntil: state.leaseUntil,
      reason: options.reason || ''
    });

    return state;
  } catch (err) {
    console.error('[acquireJobStateLock-error]', err.message);
    throw err;
  }
}

async function releaseJobState(state, nextStatus = 'idle') {
  try {
    const current = await readJobState();
    
    if (!isSameJobState(current, state)) {
      console.warn('[releaseJobState] Generation mismatch, mas continua');
    }

    const pausedCursor = Number.isFinite(Number(current.cursor)) ? Number(current.cursor) : 0;
    const pausedProgress = Number.isFinite(Number(current.progressCursor)) ? Number(current.progressCursor) : 0;
    const maxProgress = Math.max(pausedCursor, pausedProgress);
    const pausedTotal = Number.isFinite(Number(current.totalClients)) ? Number(current.totalClients) : 0;

    const { data, error } = await supabase
      .from(JOB_STATE_TABLE)
      .upsert([{
        id: 1,
        status: nextStatus,
        jobId: state.jobId,
        generation: current.generation,
        cursor: maxProgress,
        progressCursor: maxProgress,
        totalClients: pausedTotal,
        leaseUntil: 0,
        updatedAt: toIsoNow(),
        owner: current.owner,
        heartbeatAt: null,
        attempts: current.attempts,
        lastError: current.lastError,
        lastAction: 'release',
        takeoverBy: '',
        auditPointer: current.auditPointer,
        stage: nextStatus === 'done' ? 'done' : (String(current.stage || 'paused').trim() || 'paused'),
        cliente_atual: ''
      }], { onConflict: 'id' })
      .select()
      .single();

    if (error) throw error;

    await appendJobHistory({
      timestamp: toIsoNow(),
      jobId: state.jobId,
      generation: current.generation,
      action: 'release',
      owner: current.owner,
      cursor: maxProgress,
      leaseUntil: 0,
      reason: nextStatus
    });

    console.log('[releaseJobState-supabase] Lock liberado. status=' + nextStatus);
    return data;
  } catch (err) {
    console.error('[releaseJobState-error]', err.message);
    throw err;
  }
}

async function assertJobStateActive(control) {
  if (!control) return { active: true, state: createDefaultJobState() };
  const current = await readJobState();
  const isSame = isSameJobState(current, control);
  if (!isSame) {
    console.error('[assertJobStateActive-supabase] Mismatch! control.generation=' + control.generation + ', current.generation=' + current.generation);
  }
  return { active: isSame, state: current };
}

async function finishJobState(state, status = 'idle') {
  try {
    const current = await readJobState();
    if (!isSameJobState(current, state)) return current;

    const finalProgress = Number.isFinite(Number(current.progressCursor)) ? Number(current.progressCursor) : 0;
    const finalCursor = Number.isFinite(Number(current.cursor)) ? Number(current.cursor) : 0;
    const finalTotal = Number.isFinite(Number(current.totalClients)) ? Number(current.totalClients) : 0;
    const finalCursorMax = Math.max(finalCursor, finalProgress);

    const { data, error } = await supabase
      .from(JOB_STATE_TABLE)
      .upsert([{
        id: 1,
        status,
        jobId: state.jobId,
        generation: state.generation,
        cursor: finalCursorMax,
        progressCursor: finalCursorMax,
        totalClients: finalTotal,
        leaseUntil: 0,
        updatedAt: toIsoNow(),
        owner: current.owner || '',
        heartbeatAt: null,
        attempts: current.attempts || 0,
        lastError: '',
        lastAction: 'finish',
        takeoverBy: current.takeoverBy || '',
        auditPointer: current.auditPointer || 'JOB_HISTORY',
        stage: 'done',
        cliente_atual: ''
      }], { onConflict: 'id' })
      .select()
      .single();

    if (error) throw error;

    await appendJobHistory({
      timestamp: toIsoNow(),
      jobId: state.jobId,
      generation: state.generation,
      action: 'finish',
      owner: current.owner || '',
      cursor: finalCursorMax,
      leaseUntil: 0,
      reason: ''
    });

    console.log('[finishJobState-supabase] Job finalizado. stage=done');
    return data;
  } catch (err) {
    console.error('[finishJobState-error]', err.message);
    throw err;
  }
}

async function startHeartbeatTimer(jobControl, intervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS) {
  if (!jobControl) return null;
  const interval = Math.max(5000, Number(intervalMs));
  const heartbeatTimer = setInterval(async () => {
    try {
      const still = await heartbeatJobState(jobControl, 60000);
      if (still === false) {
        clearInterval(heartbeatTimer);
        return;
      }
      console.log('[heartbeat-supabase] lease refreshed for jobId=' + jobControl.jobId);
    } catch (e) {
      console.warn('[heartbeat-supabase] error: ' + (e && e.message ? e.message : e));
    }
  }, interval);
  return heartbeatTimer;
}

// ==================== HEARTBEAT ====================
async function heartbeatJobState(jobControl, leaseMs = 60000) {
  if (!jobControl) return false;

  try {
    const current = await readJobState();
    if (!isSameJobState(current, jobControl)) {
      return false;
    }

    const { data, error } = await supabase
      .from(JOB_STATE_TABLE)
      .upsert([{
        id: 1,
        status: current.status,
        jobId: current.jobId,
        generation: current.generation,
        cursor: current.cursor,
        progressCursor: current.progressCursor,
        totalClients: current.totalClients,
        leaseUntil: Date.now() + leaseMs,
        updatedAt: current.updatedAt,
        owner: current.owner,
        heartbeatAt: toIsoNow(),
        attempts: current.attempts,
        lastError: current.lastError,
        lastAction: 'heartbeat',
        takeoverBy: current.takeoverBy,
        auditPointer: current.auditPointer,
        stage: current.stage,
        cliente_atual: current.cliente_atual || ''
      }], { onConflict: 'id' })
      .select()
      .single();

    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[heartbeatJobState-error]', err.message);
    return false;
  }
}

// ==================== HISTORY ====================
async function appendJobHistory(entry) {
  try {
    const { error } = await supabase
      .from(JOB_HISTORY_TABLE)
      .insert([{
        timestamp: entry.timestamp,
        jobId: entry.jobId,
        generation: entry.generation,
        action: entry.action,
        owner: entry.owner,
        cursor: entry.cursor,
        leaseUntil: entry.leaseUntil,
        reason: entry.reason || ''
      }]);

    if (error) throw error;
  } catch (err) {
    console.error('[appendJobHistory-error]', err.message);
  }
}

// ==================== HELPERS ====================
function isSameJobState(current, control) {
  if (!control) return true;
  return String(current.jobId || '') === String(control.jobId || '')
    && Number(current.generation || 0) === Number(control.generation || 0);
}

function getJobLockMeta(state) {
  const now = Date.now();
  const leaseUntil = Number(state?.leaseUntil || 0);
  const heartbeatAtRaw = state?.heartbeatAt ? String(state.heartbeatAt).trim() : '';
  const heartbeatAt = heartbeatAtRaw ? Date.parse(heartbeatAtRaw) : 0;
  const hasValidHeartbeat = Number.isFinite(heartbeatAt) && heartbeatAt > 0;
  const heartbeatAgeMs = hasValidHeartbeat ? Math.max(0, now - heartbeatAt) : null;
  const status = String(state?.status || '').trim();
  const leaseActive = leaseUntil > now;
  const staleByHeartbeat = status === 'running' && leaseActive
    ? (!hasValidHeartbeat || (heartbeatAgeMs !== null && heartbeatAgeMs > HEARTBEAT_STALE_THRESHOLD_MS))
    : false;
  const running = status === 'running' && leaseActive && !staleByHeartbeat;

  return {
    running,
    leaseActive,
    staleByHeartbeat,
    heartbeatAgeMs,
    leaseRemainingMs: Math.max(0, leaseUntil - now)
  };
}

async function getOwnerId() {
  try {
    return `${process.env.HOSTNAME || 'local'}|pid:${process.pid}|uid:${randomUUID().slice(0, 8)}`;
  } catch (_) {
    return `local|pid:${process.pid}`;
  }
}

// ==================== EXPORTS ====================
module.exports = {
  JOB_STATE_TABLE,
  JOB_HISTORY_TABLE,
  readJobState,
  writeJobState,
  touchJobState,
  acquireJobStateLock,
  releaseJobState,
  assertJobStateActive,
  finishJobState,
  heartbeatJobState,
  startHeartbeatTimer,
  appendJobHistory,
  getJobLockMeta,
  isSameJobState,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_MAX_MISSED_HEARTBEATS,
  HEARTBEAT_STALE_THRESHOLD_MS,
  createDefaultJobState
};
