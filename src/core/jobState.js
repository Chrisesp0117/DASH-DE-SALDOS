require('dotenv').config({ path: '.env' });
const { randomUUID } = require('crypto');

const JOB_STATE_RANGE = 'JOB_STATE!A1:P1';
const JOB_STATE_LEGACY_CURSOR_RANGE = 'JOB_STATE!A1';

const DEFAULT_HEARTBEAT_INTERVAL_MS = Number(process.env.HEARTBEAT_INTERVAL_MS || 20 * 1000);
const DEFAULT_MAX_MISSED_HEARTBEATS = Number(process.env.HEARTBEAT_MISSED_COUNT || 3);
const HEARTBEAT_STALE_THRESHOLD_MS = DEFAULT_HEARTBEAT_INTERVAL_MS * DEFAULT_MAX_MISSED_HEARTBEATS;

function createDefaultJobState() {
  return {
    status: 'idle',
    jobId: '',
    generation: 0,
    cursor: 0,
    progressCursor: 0,
    totalClients: 0,
    leaseUntil: 0,
    updatedAt: '',
    stage: 'idle'
  };
}

function toIsoNow() {
  return new Date().toISOString();
}

function parseJobStateRow(values) {
  const row = Array.isArray(values) && values.length ? values[0] : [];

  if (row.length === 1 && Number.isFinite(Number(row[0]))) {
    return {
      ...createDefaultJobState(),
      cursor: Math.max(0, Number(row[0]))
    };
  }

  if (row.length >= 6) {
    const generation = Number(row[2]);
    const cursor = Number(row[3]);
    const leaseUntil = Number(row[4]);

    if (row.length >= 16) {
      return {
        status: String(row[0] || 'idle').trim() || 'idle',
        jobId: String(row[1] || '').trim(),
        generation: Number.isFinite(generation) && generation >= 0 ? generation : 0,
        cursor: Number.isFinite(cursor) && cursor >= 0 ? cursor : 0,
        leaseUntil: Number.isFinite(leaseUntil) && leaseUntil >= 0 ? leaseUntil : 0,
        updatedAt: String(row[5] || '').trim(),
        owner: String(row[6] || '').trim(),
        heartbeatAt: String(row[7] || '').trim(),
        attempts: Number.isFinite(Number(row[8])) ? Number(row[8]) : 0,
        lastError: String(row[9] || '').trim(),
        lastAction: String(row[10] || '').trim(),
        takeoverBy: String(row[11] || '').trim(),
        auditPointer: String(row[12] || '').trim(),
        stage: String(row[13] || row[10] || 'idle').trim() || 'idle',
        progressCursor: Number.isFinite(Number(row[14])) && Number(row[14]) >= 0 ? Number(row[14]) : 0,
        totalClients: Number.isFinite(Number(row[15])) && Number(row[15]) >= 0 ? Number(row[15]) : 0
      };
    }

    return {
      status: String(row[0] || 'idle').trim() || 'idle',
      jobId: String(row[1] || '').trim(),
      generation: Number.isFinite(generation) && generation >= 0 ? generation : 0,
      cursor: Number.isFinite(cursor) && cursor >= 0 ? cursor : 0,
      leaseUntil: Number.isFinite(leaseUntil) && leaseUntil >= 0 ? leaseUntil : 0,
      updatedAt: String(row[5] || '').trim(),
      progressCursor: 0,
      totalClients: 0,
      stage: 'idle'
    };
  }

  return createDefaultJobState();
}

function serializeJobState(state) {
  const n = state || createDefaultJobState();
  return [[
    String(n.status || 'idle'),
    String(n.jobId || ''),
    String(Number.isFinite(Number(n.generation)) ? Number(n.generation) : 0),
    String(Math.max(0, Number(n.cursor || 0))),
    String(Math.max(0, Number(n.leaseUntil || 0))),
    String(n.updatedAt || toIsoNow()),
    String(n.owner || ''),
    String(n.heartbeatAt || ''),
    String(Number.isFinite(Number(n.attempts)) ? Number(n.attempts) : 0),
    String(n.lastError || ''),
    String(n.lastAction || ''),
    String(n.takeoverBy || ''),
    String(n.auditPointer || ''),
    String(n.stage || 'idle'),
    String(Number.isFinite(Number(n.progressCursor)) ? Math.max(0, Number(n.progressCursor)) : 0),
    String(Number.isFinite(Number(n.totalClients)) ? Math.max(0, Number(n.totalClients)) : 0)
  ]];
}

async function readJobState(sheets, spreadsheetId) {
  try {
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: JOB_STATE_RANGE });
    return parseJobStateRow(response.data.values || []);
  } catch (error) {
    try {
      const cursorResponse = await sheets.spreadsheets.values.get({ spreadsheetId, range: JOB_STATE_LEGACY_CURSOR_RANGE });
      const value = cursorResponse.data.values && cursorResponse.data.values[0] && cursorResponse.data.values[0][0];
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed >= 0) {
        return { ...createDefaultJobState(), cursor: parsed };
      }
    } catch (_) {
      // ignore legacy read errors
    }

    return createDefaultJobState();
  }
}

async function writeJobState(sheets, spreadsheetId, state) {
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: JOB_STATE_RANGE,
    valueInputOption: 'RAW',
    requestBody: { values: serializeJobState(state) }
  });
}

async function getOwnerId() {
  try {
    return `${process.env.HOSTNAME || 'local'}|pid:${process.pid}|uid:${randomUUID().slice(0, 8)}`;
  } catch (_) {
    return `local|pid:${process.pid}`;
  }
}

async function appendJobHistory(sheets, spreadsheetId, entry) {
  try {
    const values = [[
      String(entry.timestamp || new Date().toISOString()),
      String(entry.jobId || ''),
      String(Number.isFinite(Number(entry.generation)) ? Number(entry.generation) : 0),
      String(entry.action || ''),
      String(entry.owner || ''),
      String(Number.isFinite(Number(entry.cursor)) ? Number(entry.cursor) : 0),
      String(Number.isFinite(Number(entry.leaseUntil)) ? Number(entry.leaseUntil) : 0),
      String(entry.reason || ''),
      String(entry.lastError || '')
    ]];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'JOB_HISTORY!A1',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values }
    });
  } catch (err) {
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: 'JOB_HISTORY' } } }] }
      });

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'JOB_HISTORY!A1',
        valueInputOption: 'RAW',
        requestBody: { values: [[ 'timestamp','jobId','generation','action','owner','cursor','leaseUntil','reason','lastError' ]] }
      });

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'JOB_HISTORY!A1',
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values }
      });
    } catch (e) {
      console.warn('Falha ao gravar JOB_HISTORY:', e && e.message ? e.message : e);
    }
  }
}

function isSameJobState(current, control) {
  if (!control) return true;
  return String(current.jobId || '') === String(control.jobId || '')
    && Number(current.generation || 0) === Number(control.generation || 0);
}

async function assertJobStateActive(sheets, spreadsheetId, control) {
  if (!control) return { active: true, state: createDefaultJobState() };
  const current = await readJobState(sheets, spreadsheetId);
  return { active: isSameJobState(current, control), state: current };
}

async function touchJobState(sheets, spreadsheetId, control, updates = {}) {
  if (!control) return;
  const current = await readJobState(sheets, spreadsheetId);
  if (!isSameJobState(current, control)) {
    const err = new Error('Job interrompido por uma atualização mais recente.');
    err.code = 'JOB_INTERRUPTED';
    throw err;
  }

  const leaseMs = Math.max(60000, Number(updates.leaseMs || process.env.JOB_LEASE_MS || 60 * 1000));
  const isHeartbeat = String(updates.lastAction || '').includes('heartbeat');
  const nextLease = Date.now() + leaseMs;
  const nextCursor = Number.isFinite(Number(updates.cursor)) ? Number(updates.cursor) : current.cursor;
  const nextProgressCursor = Number.isFinite(Number(updates.progressCursor))
    ? Number(updates.progressCursor)
    : (Number.isFinite(Number(current.progressCursor)) ? Number(current.progressCursor) : nextCursor);
  const nextTotalClients = Number.isFinite(Number(updates.totalClients))
    ? Number(updates.totalClients)
    : (Number.isFinite(Number(current.totalClients)) ? Number(current.totalClients) : 0);
  const nextAttempts = Number.isFinite(Number(updates.attempts)) ? Number(updates.attempts) : (Number.isFinite(Number(current.attempts)) ? Number(current.attempts) : 0);

  const newState = {
    status: updates.status || current.status || 'running',
    jobId: control.jobId,
    generation: control.generation,
    cursor: nextCursor,
    leaseUntil: nextLease,
    updatedAt: toIsoNow(),
    owner: current.owner || (await getOwnerId()),
    heartbeatAt: toIsoNow(),
    attempts: isHeartbeat ? nextAttempts : (nextAttempts + 1),
    lastError: updates.lastError || current.lastError || '',
    lastAction: updates.lastAction || 'touch',
    takeoverBy: current.takeoverBy || '',
    auditPointer: current.auditPointer || 'JOB_HISTORY',
    stage: updates.stage || current.stage || 'running',
    progressCursor: nextProgressCursor,
    totalClients: nextTotalClients
  };

  await writeJobState(sheets, spreadsheetId, newState);
  await appendJobHistory(sheets, spreadsheetId, {
    timestamp: newState.updatedAt,
    jobId: newState.jobId,
    generation: newState.generation,
    action: newState.lastAction || 'touch',
    owner: newState.owner,
    cursor: newState.cursor,
    leaseUntil: newState.leaseUntil,
    reason: updates.reason || ''
  });
}

async function finishJobState(sheets, spreadsheetId, control, status = 'idle') {
  if (!control) return;
  const current = await readJobState(sheets, spreadsheetId);
  if (!isSameJobState(current, control)) return;

  const newState = {
    status,
    jobId: control.jobId,
    generation: control.generation,
    cursor: Number.isFinite(Number(current.cursor)) && Number(current.cursor) >= 0 ? Number(current.cursor) : 0,
    progressCursor: Number.isFinite(Number(current.progressCursor)) && Number(current.progressCursor) >= 0 ? Number(current.progressCursor) : (Number.isFinite(Number(current.cursor)) ? Number(current.cursor) : 0),
    totalClients: Number.isFinite(Number(current.totalClients)) && Number(current.totalClients) >= 0 ? Number(current.totalClients) : 0,
    leaseUntil: 0,
    updatedAt: toIsoNow(),
    owner: current.owner || '',
    heartbeatAt: '',
    attempts: current.attempts || 0,
    lastError: '',
    lastAction: 'finish',
    takeoverBy: current.takeoverBy || '',
    auditPointer: current.auditPointer || 'JOB_HISTORY',
    stage: 'done'
  };

  await writeJobState(sheets, spreadsheetId, newState);
  await appendJobHistory(sheets, spreadsheetId, {
    timestamp: newState.updatedAt,
    jobId: newState.jobId,
    generation: newState.generation,
    action: 'finish',
    owner: newState.owner,
    cursor: newState.cursor,
    leaseUntil: newState.leaseUntil,
    reason: ''
  });
}

async function releaseJobState(sheets, spreadsheetId, control, status = 'idle') {
  if (!control) return;
  const current = await readJobState(sheets, spreadsheetId);
  if (!isSameJobState(current, control)) return;

  const newState = {
    status,
    jobId: control.jobId,
    generation: control.generation,
    cursor: Number.isFinite(Number(current.cursor)) && Number(current.cursor) >= 0 ? Number(current.cursor) : 0,
    progressCursor: Number.isFinite(Number(current.progressCursor)) && Number(current.progressCursor) >= 0 ? Number(current.progressCursor) : (Number.isFinite(Number(current.cursor)) ? Number(current.cursor) : 0),
    totalClients: Number.isFinite(Number(current.totalClients)) && Number(current.totalClients) >= 0 ? Number(current.totalClients) : 0,
    leaseUntil: 0,
    updatedAt: toIsoNow(),
    owner: current.owner || '',
    heartbeatAt: '',
    attempts: current.attempts || 0,
    lastError: '',
    lastAction: 'release',
    takeoverBy: current.takeoverBy || '',
    auditPointer: current.auditPointer || 'JOB_HISTORY',
    stage: String(current.stage || 'paused').trim() || 'paused'
  };

  await writeJobState(sheets, spreadsheetId, newState);
  await appendJobHistory(sheets, spreadsheetId, {
    timestamp: newState.updatedAt,
    jobId: newState.jobId,
    generation: newState.generation,
    action: 'release',
    owner: newState.owner,
    cursor: newState.cursor,
    leaseUntil: newState.leaseUntil,
    reason: ''
  });
}

function getJobLockMeta(state) {
  const now = Date.now();
  const leaseUntil = Number(state && state.leaseUntil || 0);
  const heartbeatAt = state && state.heartbeatAt ? Date.parse(state.heartbeatAt) : 0;
  const heartbeatAgeMs = heartbeatAt > 0 ? Math.max(0, now - heartbeatAt) : null;
  const staleByHeartbeat = heartbeatAgeMs !== null && heartbeatAgeMs > HEARTBEAT_STALE_THRESHOLD_MS;
  const status = String(state && state.status || '').trim();
  const leaseActive = leaseUntil > now;
  const running = status === 'running' && leaseActive && !staleByHeartbeat;

  return {
    running,
    leaseActive,
    staleByHeartbeat,
    heartbeatAgeMs,
    leaseRemainingMs: Math.max(0, leaseUntil - now)
  };
}

module.exports = {
  JOB_STATE_RANGE,
  JOB_STATE_LEGACY_CURSOR_RANGE,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_MAX_MISSED_HEARTBEATS,
  HEARTBEAT_STALE_THRESHOLD_MS,
  createDefaultJobState,
  toIsoNow,
  parseJobStateRow,
  serializeJobState,
  readJobState,
  writeJobState,
  getOwnerId,
  appendJobHistory,
  isSameJobState,
  assertJobStateActive,
  touchJobState,
  finishJobState,
  releaseJobState,
  getJobLockMeta
};
