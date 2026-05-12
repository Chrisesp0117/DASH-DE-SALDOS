/**
 * UPDATE-NOW endpoint:
 * GET /api/update-now?secret=<token>&batchSize=100
 * Dispara atualização no servidor e retorna página com auto-close.
 */

require('dotenv').config({ path: '.env' });

const { runFullUpdateJob } = require('../src/core/serverlessJobs');
const { getSheets } = require('../src/services/sheets');
const { readJobState, getJobLockMeta } = require('../src/core/jobState');

function getQueryValue(req, key) {
  try {
    const host = String(req && req.headers && (req.headers.host || req.headers.Host) || 'dash-de-saldos.vercel.app');
    const base = `https://${host}`;
    const url = new URL(String(req && req.url || '/'), base);
    return url.searchParams.get(key) || '';
  } catch (_) {
    return '';
  }
}

function sendHtml(res, html, statusCode = 200) {
  if (res && typeof res.status === 'function' && typeof res.send === 'function') {
    return res.status(statusCode).send(html);
  }

  if (res && typeof res.setHeader === 'function' && typeof res.end === 'function') {
    res.statusCode = statusCode;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(html);
    return;
  }

  if (typeof Response !== 'undefined') {
    return new Response(html, {
      status: statusCode,
      headers: { 'content-type': 'text/html; charset=utf-8' }
    });
  }

  return { statusCode, body: html };
}

function isQuotaExceededError(error) {
  const msg = String((error && (error.message || error.code || error.status)) || '').toLowerCase();
  return msg.includes('quota exceeded') || msg.includes('resource_exhausted') || String(error && error.status) === '429' || String(error && error.code) === '429';
}

async function isJobActiveNow() {
  const sheets = await getSheets();
  const state = await readJobState(sheets, process.env.SPREADSHEET_ID);
  const lockMeta = getJobLockMeta(state);
  return { running: lockMeta.running, state, lockMeta };
}

function isJsonRequest(req) {
  const method = String(req && req.method || 'GET').toUpperCase();
  if (method === 'POST') return true;
  const accept = String(req && req.headers && (req.headers.accept || req.headers.Accept) || '').toLowerCase();
  return accept.includes('application/json');
}

module.exports = async (req, res) => {
  const secretFromQuery = req && req.query ? String(req.query.secret || '') : getQueryValue(req, 'secret');
  const secretFromHeader = req && req.headers ? String(req.headers['x-cron-secret'] || '') : '';
  const secret = secretFromQuery || secretFromHeader;
  const expectedSecret = process.env.CRON_SECRET || '';

  if (!expectedSecret || !secret || secret !== expectedSecret) {
    return sendHtml(res, '<h1>401 - Unauthorized</h1>', 401);
  }

  const batchSizeParam = req && req.query ? req.query.batchSize : getQueryValue(req, 'batchSize');
  const batchSize = Math.max(10, Number(batchSizeParam || process.env.UPDATE_BATCH_SIZE || 50));
  const forceParam = req && req.query ? req.query.force : getQueryValue(req, 'force');
  const force = String(forceParam || '').toLowerCase() === 'true' || String(forceParam || '') === '1';

  const resetRaw = req && req.query ? req.query.reset : getQueryValue(req && req.url, 'reset');
  const resetCursor = String(resetRaw || '').toLowerCase() === 'true' || String(resetRaw || '') === '1';

  const dbOnlyRaw = req && req.query ? req.query.databaseOnly : getQueryValue(req && req.url, 'databaseOnly');
  const databaseOnly = String(dbOnlyRaw || '').toLowerCase() === 'true' || String(dbOnlyRaw || '') === '1';

  const method = String(req && req.method || 'GET').toUpperCase();

  if (method === 'POST' || isJsonRequest(req)) {
    try {
      const active = await isJobActiveNow();
      if (active.running) {
        return sendJsonResponse(res, {
          ok: false,
          running: true,
          lockState: active.lockMeta && active.lockMeta.staleByHeartbeat ? 'active_stale' : 'active',
          heartbeatAgeMs: active.lockMeta ? active.lockMeta.heartbeatAgeMs : null,
          leaseRemainingMs: active.lockMeta ? active.lockMeta.leaseRemainingMs : 0,
          staleByHeartbeat: active.lockMeta ? active.lockMeta.staleByHeartbeat : false,
          state: active.state
        }, 409);
      }

      // Inicia o job em background (não aguarda conclusão)
      // Isso permite que o cliente veja progresso em tempo real via polling
      const jobPromise = runFullUpdateJob({
        batchSize,
        maxMs: Math.max(60000, Number(process.env.CRON_MAX_RUNTIME_MS || 120000)),
        rejectIfRunning: true,
        force,
        resetCursor,
        includeSupervisor: !databaseOnly,
        includeDashboards: !databaseOnly
      }).catch(err => {
        console.error('Background job error:', err && err.message);
      });

      // Retorna imediatamente ao cliente sem aguardar
      return sendJsonResponse(res, {
        ok: true,
        started: true,
        message: 'Atualização iniciada. Acompanhe o progresso em tempo real.',
        refreshInterval: 2000
      }, 202);

    } catch (error) {
      const payload = {
        ok: false,
        error: isQuotaExceededError(error)
          ? 'Google Sheets com limite de leitura por minuto. Aguarde ~1 minuto e tente novamente.'
          : `Erro ao atualizar: ${error && error.message ? error.message : 'desconhecido'}`
      };
      return sendJsonResponse(res, payload, 500);
    }
  }

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Atualização de Saldos</title><meta name="color-scheme" content="light"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#f5f7fa;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}.container{background:#fff;border-radius:16px;box-shadow:0 4px 30px rgba(0,0,0,.08);padding:40px;text-align:center;max-width:600px;width:100%}.header{margin-bottom:40px}.icon{font-size:56px;margin-bottom:16px;display:inline-block;animation:pulse 2.5s ease-in-out infinite}@keyframes pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.05);opacity:.8}}h1{color:#1a2332;font-size:28px;font-weight:700;margin-bottom:6px}.subtitle{color:#7c8999;font-size:13px;font-weight:500;text-transform:uppercase;letter-spacing:.5px}.status-section{background:linear-gradient(135deg,#f8fafc,#eef2f7);border-radius:12px;padding:24px;margin-bottom:24px;border:1px solid #e1e8f0;text-align:left}.status-indicator{width:12px;height:12px;border-radius:50%;background:#10b981}.status-indicator.running{background:#fbbf24;animation:blink 1s ease-in-out infinite}@keyframes blink{0%,100%{opacity:1}50%{opacity:.5}}.progress-bar{width:100%;height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden;margin:16px 0}.progress-fill{height:100%;background:linear-gradient(90deg,#3b82f6,#10b981);width:0%;transition:width .3s ease-out}.status-text{color:#1a2332;font-size:14px;font-weight:600;margin-bottom:8px}.message-box{padding:16px;border-radius:8px;margin-bottom:16px;font-size:13px;animation:slideIn .3s ease-out}.message-box.show{animation:slideIn .3s ease-out}.message-box.info{background:#dbeafe;color:#1e40af;border:1px solid #93c5fd}.message-box.success{background:#dcfce7;color:#166534;border:1px solid #86efac}.message-box.error{background:#fee2e2;color:#991b1b;border:1px solid #fca5a5}@keyframes slideIn{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:translateY(0)}}.history-list{max-height:200px;overflow-y:auto;border:1px solid #e5e7eb;border-radius:8px;text-align:left}.history-item{padding:8px 12px;border-bottom:1px solid #f3f4f6;font-size:12px;color:#7c8999}.history-item:last-child{border-bottom:none}.button-group{display:flex;gap:12px;justify-content:center;margin-top:24px}.btn{padding:10px 24px;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;transition:all .2s ease}.btn-primary{background:#3b82f6;color:#fff}.btn-primary:hover{background:#2563eb}.btn-primary:disabled{background:#9ca3af;cursor:not-allowed}.checkbox-group{display:flex;align-items:center;gap:8px;margin-bottom:20px}.checkbox-group input{cursor:pointer}.checkbox-group label{cursor:pointer;font-size:13px;color:#7c8999}</style></head><body><div class="container"><div class="header"><div class="icon" id="statusIcon">⏳</div><h1>Atualização de Saldos</h1><p class="subtitle">Monitorando progresso em tempo real</p></div><div class="status-section"><div class="status-text" id="statusLabel">Aguardando...</div><div class="progress-bar"><div class="progress-fill" id="progressFill"></div></div><div class="status-detail" id="statusDetail"></div></div><div class="message-box" id="messageBox"></div><div class="checkbox-group"><input id="forceCheck" type="checkbox"><label for="forceCheck">Forçar atualização (ignorar lock)</label></div><div class="button-group"><button id="startBtn" class="btn btn-primary">Iniciar Atualização</button><button id="refreshBtn" class="btn btn-primary">Atualizar Status</button></div><div class="history-list" id="historyList"></div></div><script defer>(async()=>{const secret="${secret}";const statusUrl='/api/update-status?secret='+encodeURIComponent(secret);const startUrlBase='/api/update-now?secret='+encodeURIComponent(secret)+'&batchSize=50';let manualRunActive=false;const statusLabel=document.getElementById('statusLabel');const statusIcon=document.getElementById('statusIcon');const progressFill=document.getElementById('progressFill');const messageBox=document.getElementById('messageBox');const startBtn=document.getElementById('startBtn');const refreshBtn=document.getElementById('refreshBtn');const forceCheck=document.getElementById('forceCheck');const historyList=document.getElementById('historyList');let executionHistory=[];function addToHistory(type,title,msg){executionHistory.push({type,title,msg,time:new Date().toLocaleTimeString()});const item=document.createElement('div');item.className='history-item';item.textContent=\`[\${executionHistory.length}] \${title}\`;historyList.insertBefore(item,historyList.firstChild);if(historyList.children.length>20){historyList.removeChild(historyList.lastChild)}}function showMessage(msg,type='info'){messageBox.innerHTML=msg;messageBox.className='message-box show '+type;setTimeout(()=>{messageBox.classList.remove('show')},5000)}function getStatusDescription(json,state){const running=state.status==='running';const cursor=Number(state.cursor||0);const totalClients=Number(json.totalClients||state.totalClients||0);const pct=totalClients>0?Math.round((cursor/totalClients)*100):0;const indicator=running?'running':cursor>=totalClients&&totalClients>0?'idle':'stale';return{running,cursor,totalClients,pct,indicator}}async function refresh(){try{const res=await fetch(statusUrl);const json=await res.json().catch(()=>({}));const desc=getStatusDescription(json,json.state||{});const cursor=desc.cursor;const total=desc.totalClients;statusLabel.textContent=cursor+'/'+total+' ('+desc.pct+'%)';progressFill.style.width=desc.pct+'%';if(desc.indicator==='running'){statusIcon.textContent='⏳'}else if(desc.pct===100&&total>0){statusIcon.textContent='✅'}else{statusIcon.textContent='⏸️'}statusDetail.textContent=json.state?.stage||'database';if(manualRunActive&&desc.indicator!=='running'){if(cursor>=total&&total>0){addToHistory('success','Completo','Todos atualizados');manualRunActive=false;showMessage('✅ Conclusão!','success')}else if(total>0){addToHistory('info','Continuando','Próximo lote...');setTimeout(()=>start({internalRetry:true}),300)}}}catch(e){console.error('Erro ao atualizar:',e.message)}}async function start(opts={}){if(!secret){showMessage('❌ Token inválido','error');return}manualRunActive=true;startBtn.disabled=true;messageBox.classList.remove('show');try{const url=startUrlBase+(forceCheck?.checked?'&force=true':'');const res=await fetch(url,{method:'POST'});const json=await res.json().catch(()=>({}));if(res.status===202){const msg=opts.internalRetry?'⏳ Continuando...':'⏳ Iniciado...';addToHistory('info','Iniciado','Background');showMessage(msg,'info');setTimeout(refresh,500)}else{addToHistory('error','Erro','Bloqueado');showMessage('⚠️ Erro ou bloqueado','error');manualRunActive=false}}catch(e){console.error('Erro:',e);manualRunActive=false}finally{startBtn.disabled=false}}startBtn.addEventListener('click',()=>start());refreshBtn.addEventListener('click',refresh);setInterval(refresh,2000);refresh()})();</script></body></html>`;

  return sendHtml(res, html, 200);
};

  return sendHtml(res, html, 200);
};

function sendJsonResponse(res, payload, statusCode = 200) {
  if (res && typeof res.status === 'function' && typeof res.json === 'function') {
    return res.status(statusCode).json(payload);
  }

  if (res && typeof res.setHeader === 'function' && typeof res.end === 'function') {
    res.statusCode = statusCode;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
    return;
  }

  if (typeof Response !== 'undefined') {
    return new Response(JSON.stringify(payload), {
      status: statusCode,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }

  return { statusCode, body: JSON.stringify(payload) };
}
