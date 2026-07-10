require('dotenv').config({ path: '.env' });

const { assertCronAuth, sendJson } = require('../src/core/serverlessJobs');
const { readJobState, getJobLockMeta } = require('../src/core/jobStateSupabase');

module.exports = async (req, res) => {
  const authResponse = assertCronAuth(req, res);
  if (authResponse) {
    return authResponse;
  }

  try {
    const state = await readJobState();
    const lockMeta = getJobLockMeta(state);

    // Quando não há job em execução, não mostramos dados residuais da última atualização.
    // A interface deve aparecer "disponível" (zerada), pronta para iniciar nova atualização.
    if (!lockMeta.running) {
      return sendJson(res, {
        ok: true,
        running: false,
        lockState: lockMeta.lockState,
        stage: 'idle',
        cursor: 0,
        displayCursor: 0,
        overallPercent: 0,
        stagePercent: 0,
        clienteAtual: '',
        stageDescription: 'Disponível',
        phaseLabel: 'Inativo',
        leaseRemainingMs: lockMeta.leaseRemainingMs,
        heartbeatAgeMs: lockMeta.heartbeatAgeMs,
        staleByHeartbeat: lockMeta.staleByHeartbeat,
        state,
        totalClients: 0
      }, 200);
    }

    const totalClients = Number.isFinite(Number(state.totalClients))
      ? Number(state.totalClients)
      : 0;

    const progressCursor = Number.isFinite(Number(state.progressCursor)) ? Number(state.progressCursor) : 0;
    const storedCursor = Number.isFinite(Number(state.cursor)) ? Number(state.cursor) : 0;
    const stage = String(state.stage || 'idle');
    const status = String(state.status || 'idle');
    
    if (totalClients === 0 && status === 'running') {
      console.error('[update-status-BUG] CRITICAL! totalClients=0 mas status=running! state.totalClients=' + state.totalClients + ', raw state=' + JSON.stringify(state).substring(0, 200));
    }
    
    console.log('[update-status] status=' + status + ', stage=' + stage + ', progressCursor=' + progressCursor + ', storedCursor=' + storedCursor + ', totalClients=' + totalClients);
    
    let cursor = storedCursor;
    if (status === 'running') {
      cursor = Math.max(progressCursor, storedCursor);
      console.log('[update-status-running] cursor=' + cursor + ' (status=running)');
    } else if (stage === 'done') {
      cursor = Math.max(storedCursor, progressCursor);
      console.log('[update-status-done] cursor=' + cursor + ' (stage=done)');
    } else {
      cursor = Math.max(storedCursor, progressCursor);
      console.log('[update-status-other] cursor=' + cursor + ' (stage=' + stage + ')');
    }

    const clienteAtual = String(state.cliente_atual || '');

    let overallPercent = 0;
    let stagePercent = 0;
    if (stage === 'done') {
      overallPercent = 100;
      stagePercent = 100;
    } else if (stage === 'dashboards' || stage === 'dashboards_pending') {
      overallPercent = 90;
      stagePercent = 90;
    } else if (stage === 'supervisor') {
      overallPercent = 85;
      stagePercent = 85;
    } else if (stage === 'database' || stage === 'database_complete' || stage === 'paused') {
      const dbPct = totalClients > 0 ? Math.min(80, Math.max(0, (cursor / totalClients) * 80)) : 0;
      stagePercent = totalClients > 0 ? Math.min(100, Math.max(0, Math.round((cursor / totalClients) * 100))) : 0;
      overallPercent = dbPct;
      if (stage === 'database_complete') {
        overallPercent = 80;
        stagePercent = 100;
      }
    } else {
      overallPercent = 0;
      stagePercent = 0;
    }

    const overallRounded = Math.round(overallPercent);
    const stageRounded = Math.round(stagePercent);

    const stageDescription = (() => {
      if (stage === 'done') return 'Concluído';
      if (stage === 'dashboards') return clienteAtual ? ('Atualizando painéis') : 'Atualizando painéis';
      if (stage === 'dashboards_pending') return 'Painéis pendentes';
      if (stage === 'supervisor') return 'Processando supervisor';
      if (stage === 'database_complete') return 'Base de dados processada';
      if (stage === 'database' || stage === 'paused') {
        if (clienteAtual) {
          return 'Atualizando cliente: ' + clienteAtual;
        }
        return 'Processando base de dados';
      }
      return 'Inativo';
    })();

    const phaseLabel = (() => {
      if (stage === 'done') return 'Concluído';
      if (stage === 'dashboards' || stage === 'dashboards_pending') return 'Painéis';
      if (stage === 'supervisor') return 'Supervisor';
      if (stage === 'database' || stage === 'database_complete' || stage === 'paused') return 'Base de Dados';
      return 'Inativo';
    })();

    return sendJson(res, {
      ok: true,
      running: lockMeta.running,
      lockState: lockMeta.lockState,
      stage: String(state.stage || 'idle'),
      cursor,
      displayCursor: cursor,
      overallPercent: overallRounded,
      stagePercent: stageRounded,
      clienteAtual,
      stageDescription,
      phaseLabel,
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