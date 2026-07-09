require('dotenv').config({ path: '.env' });
const { getClient } = require('./supabase');

const JOB_QUEUE_TABLE = process.env.SUPABASE_JOB_QUEUE_TABLE || 'job_queue';
const STALE_RUNNING_SECONDS = Number(process.env.JOB_QUEUE_STALE_SECONDS || 300);

async function reenqueueStaleRunning(staleSeconds = STALE_RUNNING_SECONDS) {
  const client = getClient();
  try {
    const { data, error } = await client.rpc('reenqueue_stale_running', {
      p_stale_after_seconds: staleSeconds
    });
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error('[jobQueue.reenqueueStaleRunning] error:', err && err.message);
    throw err;
  }
}

async function enqueueJob(options = {}) {
  const client = getClient();
  const payload = {
    status: 'pending',
    triggered_by: String(options.triggered_by || 'cron').slice(0, 120),
    options: options.options || {}
  };
  const { data, error } = await client
    .from(JOB_QUEUE_TABLE)
    .insert([payload])
    .select('id,status,enqueued_at,triggered_by,options')
    .single();
  if (error) throw error;
  return data;
}

async function claimNextPending() {
  const client = getClient();
  // Pega o pending mais antigo
  const { data: pending, error: selError } = await client
    .from(JOB_QUEUE_TABLE)
    .select('id,status,enqueued_at,triggered_by,options,attempts')
    .eq('status', 'pending')
    .order('enqueued_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (selError) throw selError;
  if (!pending) return null;

  // Marca como running (claim atômico; se outro worker pegar antes, o .eq('status','pending') falha e retorna 0 linhas)
  const { data: claimed, error: updError } = await client
    .from(JOB_QUEUE_TABLE)
    .update({
      status: 'running',
      started_at: new Date().toISOString(),
      attempts: (pending.attempts || 0) + 1
    })
    .eq('id', pending.id)
    .eq('status', 'pending')
    .select('id,status,triggered_by,options,attempts,enqueued_at,started_at')
    .maybeSingle();

  if (updError) throw updError;
  if (!claimed) {
    // Outro worker pegou antes — retorna null para o caller tentar de novo no próximo tick
    return null;
  }
  return claimed;
}

async function completeJob(jobId, result = null) {
  const client = getClient();
  const { data, error } = await client
    .from(JOB_QUEUE_TABLE)
    .update({
      status: 'completed',
      finished_at: new Date().toISOString(),
      result: result || null
    })
    .eq('id', jobId)
    .select('id,status,finished_at,result')
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function failJob(jobId, errorMessage) {
  const client = getClient();
  const { data, error } = await client
    .from(JOB_QUEUE_TABLE)
    .update({
      status: 'failed',
      finished_at: new Date().toISOString(),
      error: String(errorMessage || '').slice(0, 500)
    })
    .eq('id', jobId)
    .select('id,status,finished_at,error')
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function reenqueueJob(jobId, reason = 'time_budget_reached') {
  const client = getClient();
  const { data, error } = await client
    .from(JOB_QUEUE_TABLE)
    .update({
      status: 'pending',
      started_at: null,
      error: String(reason || '').slice(0, 500)
    })
    .eq('id', jobId)
    .select('id,status,enqueued_at,attempts')
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getQueueStats() {
  const client = getClient();
  const { data, error } = await client
    .from(JOB_QUEUE_TABLE)
    .select('id,status,triggered_by,enqueued_at,started_at,finished_at,attempts,error');
  if (error) throw error;
  const rows = data || [];
  return {
    pending: rows.filter(r => r.status === 'pending').length,
    running: rows.filter(r => r.status === 'running').length,
    completed: rows.filter(r => r.status === 'completed').length,
    failed: rows.filter(r => r.status === 'failed').length,
    recent: rows.slice(-10)
  };
}

module.exports = {
  JOB_QUEUE_TABLE,
  STALE_RUNNING_SECONDS,
  reenqueueStaleRunning,
  enqueueJob,
  claimNextPending,
  completeJob,
  failJob,
  reenqueueJob,
  getQueueStats
};
