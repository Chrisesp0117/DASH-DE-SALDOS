require('dotenv').config({ path: '.env' });

const { assertCronAuth, sendJson, runQueuedUpdateJob, getSafeMaxMs } = require('../../src/core/serverlessJobs');
const {
  reenqueueStaleRunning,
  claimNextPending,
  completeJob,
  failJob,
  reenqueueJob,
  getQueueStats
} = require('../../src/services/jobQueue');
const { readJobState, getJobLockMeta } = require('../../src/core/jobStateSupabase');

/**
 * /api/cron/advance-queue
 *
 * Worker endpoint: chamado pelo Apps Script a cada 1 min.
 * Passos:
 *  1. Re-enfileira jobs 'running' que estão estourados (worker morreu).
 *  2. Tenta claimNextPending().
 *  3. Se não há pending → 200 OK ("idle").
 *  4. Se há pending:
 *       - Roda runQueuedUpdateJob(options do job_queue.options).
 *       - Se shouldReenqueue=true → reenqueueJob.
 *       - Se finished → completeJob.
 *       - Se error → failJob.
 */
module.exports = async (req, res) => {
  const authResponse = assertCronAuth(req, res);
  if (authResponse) {
    return authResponse;
  }

  try {
    // 1. Limpa running stale
    let reenqueuedStale = 0;
    try {
      const stale = await reenqueueStaleRunning();
      reenqueuedStale = Array.isArray(stale) ? stale.length : 0;
      if (reenqueuedStale > 0) {
        console.log('[advance-queue] re-enfileirados ' + reenqueuedStale + ' job(s) running stale');
      }
    } catch (e) {
      console.warn('[advance-queue] falha ao re-enfileirar stale:', e && e.message);
    }

    // 2. Tenta claim
    const claimed = await claimNextPending();
    if (!claimed) {
      return sendJson(res, {
        ok: true,
        idle: true,
        message: 'Fila vazia; nenhum job pendente.',
        reenqueuedStale,
        stats: await getQueueStats().catch(() => null)
      }, 200);
    }

    const jobOptions = claimed.options || {};
    const batchSize = Math.max(5, Number(jobOptions.batchSize || process.env.UPDATE_BATCH_SIZE || 20));
    const maxMs = getSafeMaxMs(process.env.CRON_MAX_RUNTIME_MS);

    console.log('[advance-queue] claimed job_queue.id=' + claimed.id + ' options=' + JSON.stringify(jobOptions) + ' attempts=' + claimed.attempts);

    // Decide se força o lock do job_state. Em retries (attempts>1), assumimos que o worker anterior morreu.
    // Caso o job_state anterior esteja com lease ativa e heartbeat fresco (job realmente rodando em outro worker),
    // preferimos não forçar e sim re-enfileirar para tentar depois, evitando interromper um job em andamento.
    let forceLock = claimed.attempts > 1;
    try {
      if (forceLock) {
        const st = await readJobState();
        const meta = getJobLockMeta(st);
        // Se ainda há lease ativa e heartbeat fresco, um job legítimo pode estar em andamento — não forçar
        if (meta.running) {
          console.log('[advance-queue] retry com lease ativa e heartbeat fresco; não forçando lock (job_state.generation=' + st.generation + ')');
          forceLock = false;
        } else {
          console.log('[advance-queue] retry com lock obsoleto (stale=' + meta.staleByHeartbeat + ', leaseActive=' + meta.leaseActive + '); forçando lock');
        }
      }
    } catch (e) {
      console.warn('[advance-queue] falha ao ler job_state antes de forçar lock:', e && e.message);
    }

    // 3. Executa (sem auto-chain; se esgotar, re-enfileira e o próximo tick continua)
    const result = await runQueuedUpdateJob({
      jobQueueId: claimed.id,
      batchSize,
      maxMs,
      includeSupervisor: jobOptions.includeSupervisor !== false,
      includeDashboards: jobOptions.includeDashboards !== false,
      resetCursor: jobOptions.resetCursor === true,
      triggeredBy: claimed.triggered_by || 'cron',
      force: forceLock  // em retries com lock obsoleto, força o lock (já sabemos que o worker anterior morreu)
    });

    // 4. Atualiza a fila conforme resultado
    if (!result || result.ok === false) {
      // Falha de verdade (não quota, não running) — marca failed
      if (result && result.shouldReenqueue) {
        const MAX_REENQUEUE_ATTEMPTS = Number(process.env.JOB_QUEUE_MAX_ATTEMPTS || 5);
        const currentAttempts = Number(claimed.attempts) || 1;
        if (currentAttempts >= MAX_REENQUEUE_ATTEMPTS) {
          console.warn('[advance-queue] job ' + claimed.id + ' atingiu maxAttempts=' + MAX_REENQUEUE_ATTEMPTS + ' — marcando failed para não prender a fila');
          await failJob(claimed.id, 'max_attempts_reached: ' + (result.reason || 'needs_retry'));
          return sendJson(res, {
            ok: false,
            message: 'Job atingiu máximo de tentativas e foi marcado failed.',
            jobId: claimed.id,
            result
          }, 500);
        }
        await reenqueueJob(claimed.id, result.reason || 'needs_retry');
        return sendJson(res, {
          ok: true,
          message: 'Job re-enfileirado para próximo tick.',
          reason: result.reason || 'needs_retry',
          jobId: claimed.id,
          attempts: currentAttempts,
          result
        }, 202);
      }
      await failJob(claimed.id, result && result.error ? result.error : result && result.reason || 'fail');
      return sendJson(res, {
        ok: false,
        message: 'Job falhou.',
        jobId: claimed.id,
        result
      }, 500);
    }

    if (result.finished === true) {
      await completeJob(claimed.id, {
        iterations: result.iterations,
        totalProcessed: result.totalProcessed,
        dashboardResult: result.dashboardResult || null
      });
      return sendJson(res, {
        ok: true,
        message: 'Job concluído com sucesso.',
        finished: true,
        jobId: claimed.id,
        iterations: result.iterations,
        totalProcessed: result.totalProcessed,
        reenqueuedStale
      }, 200);
    }

    // Não terminou (time_budget_reached, insufficient_time_for_dashboards, restarted_by_newer_job, quota_exceeded) — re-enfileira
    if (result.shouldReenqueue) {
      const MAX_REENQUEUE_ATTEMPTS = Number(process.env.JOB_QUEUE_MAX_ATTEMPTS || 5);
      const currentAttempts = Number(claimed.attempts) || 1;
      if (currentAttempts >= MAX_REENQUEUE_ATTEMPTS && result.reason !== 'time_budget_reached' && result.reason !== 'quota_exceeded' && result.reason !== 'insufficient_time_for_dashboards') {
        console.warn('[advance-queue] job ' + claimed.id + ' atingiu maxAttempts=' + MAX_REENQUEUE_ATTEMPTS + ' em reason=' + result.reason + ' — marcando failed');
        await failJob(claimed.id, 'max_attempts_reached: ' + (result.reason || 'time_budget_reached'));
        return sendJson(res, {
          ok: false,
          message: 'Job atingiu máximo de tentativas e foi marcado failed.',
          jobId: claimed.id,
          result
        }, 500);
      }
      await reenqueueJob(claimed.id, result.reason || 'time_budget_reached');
      return sendJson(res, {
        ok: true,
        message: 'Atualização parcial; continua no próximo tick do cron.',
        finished: false,
        reason: result.reason || 'time_budget_reached',
        jobId: claimed.id,
        attempts: currentAttempts,
        iterations: result.iterations,
        totalProcessed: result.totalProcessed,
        reenqueuedStale
      }, 202);
    }

    // shouldReenqueue=false e não finished → trato como concluído (sem dashboards) para não prender a fila
    await completeJob(claimed.id, {
      iterations: result.iterations,
      totalProcessed: result.totalProcessed,
      dashboardResult: result.dashboardResult || null,
      reason: result.reason
    });
    return sendJson(res, {
      ok: true,
      finished: true,
      reason: result.reason || 'completed_with_pending',
      jobId: claimed.id,
      iterations: result.iterations,
      totalProcessed: result.totalProcessed,
      reenqueuedStale
    }, 200);
  } catch (error) {
    console.error('❌ Erro no advance-queue:', error);
    return sendJson(res, { ok: false, error: error && error.message ? error.message : 'Erro desconhecido' }, 500);
  }
};
