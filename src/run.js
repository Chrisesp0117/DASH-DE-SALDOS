require('dotenv').config({ path: '.env' });

const { getSheets } = require('./services/sheets');
const { getGoogleData } = require('./services/googleAds');
const { getMetaData } = require('./services/meta');
const { buildRow } = require('./core/calculator');
const { generateBlocosPorGestor } = require('./core/visualBlocks');
const { generateSupervisorAgg } = require('./core/aggregator');
const { ensureDashboardsForAllGestores } = require('./core/gestorDashboards');
const {
  JOB_STATE_RANGE,
  readJobState,
  writeJobState,
  acquireJobStateLock,
  assertJobStateActive,
  touchJobState,
  finishJobState,
  releaseJobState,
  appendJobHistory,
  getOwnerId,
  startHeartbeatTimer,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_MAX_MISSED_HEARTBEATS,
  HEARTBEAT_STALE_THRESHOLD_MS
} = require('./core/jobState');

const DATABASE_HEADERS = [
  'Data', 'Cliente', 'Plataforma', 'Saldo', 'Gasto Ontem', 'Média Diária', 'Dias restantes',
  'Gestor', 'Supervisor', 'Status', 'Obs', 'DataISO', 'Identificador'
];

function isValidGoogleCustomerId(value) {
  return /^\d{10}$/.test(String(value || '').trim());
}

function formatLastUpdatePTBR(date = new Date()) {
  const datePart = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Manaus',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(date);

  const timePart = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Manaus',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);

  return `${datePart} às ${timePart}`;
}

async function updateWelcomeStatus(sheets, spreadsheetId, text) {
  try {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets(properties(title))'
    });
    const sheetsList = (meta.data.sheets || []).map(s => s.properties && s.properties.title).filter(Boolean);
    const welcomeTitle = sheetsList.find(t => /^bem\s*vind/i.test(String(t || '')));
    if (!welcomeTitle) {
      return;
    }
    const safe = String(welcomeTitle || '').trim().replace(/'/g, "''");
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${safe}'!J5`,
      valueInputOption: 'RAW',
      requestBody: { values: [[text]] }
    });
  } catch (error) {
    console.warn('Falha ao atualizar status da aba de boas-vindas:', error && error.message ? error.message : error);
  }
}

async function deleteSheetIfExists(sheets, spreadsheetId, title) {
  const maxAttempts = 4;
  let attempt = 0;
  
  while (attempt < maxAttempts) {
    try {
      const meta = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets(properties(sheetId,title))'
      });

      const target = (meta.data.sheets || []).find(
        s => s.properties && s.properties.title === title
      );

      if (!target || target.properties.sheetId === undefined) {
        return false;
      }

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              deleteSheet: {
                sheetId: target.properties.sheetId
              }
            }
          ]
        }
      });

      return true;
    } catch (err) {
      const msg = String(err && (err.message || err.code || err.status) || '').toLowerCase();
      const isQuota = msg.includes('quota exceeded') || msg.includes('resource_exhausted') || String(err && err.status) === '429' || String(err && err.code) === '429';
      attempt += 1;
      if (isQuota && attempt < maxAttempts) {
        const wait = Math.pow(2, attempt) * 1000;
        console.warn(`[deleteSheetIfExists] Quota 429 recebido, retry em ${wait}ms (tentativa ${attempt}/${maxAttempts})`);
        await new Promise(resolve => setTimeout(resolve, wait));
        continue;
      }
      throw err;
    }
  }
}

async function ensureSheetExists(sheets, spreadsheetId, title) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties(sheetId,title))'
  });

  const existing = (meta.data.sheets || []).find(
    s => s.properties && s.properties.title === title
  );

  if (existing && existing.properties && existing.properties.sheetId !== undefined) {
    return existing.properties.sheetId;
  }

  const response = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              title
            }
          }
        }
      ]
    }
  });

  const created = response.data.replies && response.data.replies[0] && response.data.replies[0].addSheet;
  return created && created.properties ? created.properties.sheetId : null;
}

function isQuotaExceededError(error) {
  const msg = String((error && (error.message || error.code || error.status)) || '').toLowerCase();
  return msg.includes('quota exceeded') || msg.includes('resource_exhausted') || String(error && error.status) === '429' || String(error && error.code) === '429';
}

function isMissingSheetRangeError(error) {
  const msg = String((error && (error.message || error.code || error.status)) || '').toLowerCase();
  return msg.includes('unable to parse range') || msg.includes('not found') || msg.includes('bad request');
}

async function ensureJobStateSheetExists(sheets, spreadsheetId) {
  try {
    await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: JOB_STATE_RANGE
    });
    return;
  } catch (error) {
    if (isQuotaExceededError(error)) {
      throw error;
    }

    if (!isMissingSheetRangeError(error)) {
      return;
    }
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              title: 'JOB_STATE'
            }
          }
        }
      ]
    }
  });
}

async function clearDatabaseTail(sheets, spreadsheetId, totalRows, maxRows = 10000) {
  const startRow = Math.max(2, Number(totalRows || 0) + 2);
  if (!Number.isFinite(startRow) || startRow > maxRows) {
    return;
  }

  const maxAttempts = 4;
  let attempt = 0;
  while (attempt < maxAttempts) {
    try {
      return await sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: `DATABASE!A${startRow}:M${maxRows}`
      });
    } catch (err) {
      const msg = String(err && (err.message || err.code || err.status) || '').toLowerCase();
      const isQuota = msg.includes('quota exceeded') || msg.includes('resource_exhausted') || String(err && err.status) === '429' || String(err && err.code) === '429';
      attempt += 1;
      if (isQuota && attempt < maxAttempts) {
        const wait = Math.pow(2, attempt) * 1000;
        console.warn(`[clearDatabaseTail] Quota 429 recebido, retry em ${wait}ms (tentativa ${attempt}/${maxAttempts})`);
        await new Promise(resolve => setTimeout(resolve, wait));
        continue;
      }
      throw err;
    }
  }
}

async function readJobCursor(sheets, spreadsheetId) {
  const state = await readJobState(sheets, spreadsheetId);
  // Priorizar progressCursor se o job está em execução
  // progressCursor é atualizado em tempo real durante processamento
  // cursor é apenas atualizado no final de cada lote
  const stage = String(state.stage || 'idle');
  const status = String(state.status || 'idle');
  const progressCursor = Number.isFinite(Number(state.progressCursor)) && Number(state.progressCursor) >= 0 ? Number(state.progressCursor) : 0;
  const cursor = Number.isFinite(Number(state.cursor)) && Number(state.cursor) >= 0 ? Number(state.cursor) : 0;
  
  // Se job está em execução (status running) ou em pausado (stage paused/database), usar progressCursor
  // Se job está finalizado, usar cursor
  if (status === 'running' || (stage !== 'done' && stage !== 'idle')) {
    return Math.max(progressCursor, cursor);
  }
  
  return cursor;
}

async function applyDatabaseFormatting(sheets, spreadsheetId, totalRows) {
  const maxAttempts = 4;
  let attempt = 0;
  let databaseRowsRes = null;
  
  // Retry para leitura de dados
  while (attempt < maxAttempts) {
    try {
      databaseRowsRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `DATABASE!A1:M${Math.max(totalRows + 1, 2)}`
      });
      break;
    } catch (err) {
      const msg = String(err && (err.message || err.code || err.status) || '').toLowerCase();
      const isQuota = msg.includes('quota exceeded') || msg.includes('resource_exhausted') || String(err && err.status) === '429' || String(err && err.code) === '429';
      attempt += 1;
      if (isQuota && attempt < maxAttempts) {
        const wait = Math.pow(2, attempt) * 1000;
        console.warn(`[applyDatabaseFormatting-read] Quota 429 recebido, retry em ${wait}ms (tentativa ${attempt}/${maxAttempts})`);
        await new Promise(resolve => setTimeout(resolve, wait));
        continue;
      }
      throw err;
    }
  }

  const databaseRows = databaseRowsRes.data.values || [];

  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties(sheetId,title))'
  });

  const databaseSheet = (meta.data.sheets || []).find(
    s => s.properties && s.properties.title === 'DATABASE'
  );

  if (!databaseSheet || databaseSheet.properties.sheetId === undefined) {
    return;
  }

  const formatRequests = [];

  for (let i = 1; i < databaseRows.length; i++) {
    const statusValue = databaseRows[i] && databaseRows[i][9];
    const isError = String(statusValue).toLowerCase() === 'erro';
    formatRequests.push({
      repeatCell: {
        range: {
          sheetId: databaseSheet.properties.sheetId,
          startRowIndex: i,
          endRowIndex: i + 1,
          startColumnIndex: 9,
          endColumnIndex: 10
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: isError
              ? { red: 0.85, green: 0.2, blue: 0.2 }
              : { red: 0.75, green: 0.9, blue: 0.75 },
            textFormat: {
              bold: true,
              foregroundColor: isError
                ? { red: 1, green: 1, blue: 1 }
                : { red: 0, green: 0.35, blue: 0 }
            }
          }
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat.foregroundColor,textFormat.bold)'
      }
    });
  }

  for (let col = 0; col < DATABASE_HEADERS.length; col++) {
    formatRequests.push({
      autoResizeDimensions: {
        dimensions: {
          sheetId: databaseSheet.properties.sheetId,
          dimension: 'COLUMNS',
          startIndex: col,
          endIndex: col + 1
        }
      }
    });
  }

  if (formatRequests.length) {
    const maxAttempts = 4;
    let attempt = 0;
    while (attempt < maxAttempts) {
      try {
        return await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests: formatRequests }
        });
      } catch (err) {
        const msg = String(err && (err.message || err.code || err.status) || '').toLowerCase();
        const isQuota = msg.includes('quota exceeded') || msg.includes('resource_exhausted') || String(err && err.status) === '429' || String(err && err.code) === '429';
        attempt += 1;
        if (isQuota && attempt < maxAttempts) {
          const wait = Math.pow(2, attempt) * 1000;
          console.warn(`[applyDatabaseFormatting] Quota 429 recebido, retry em ${wait}ms (tentativa ${attempt}/${maxAttempts})`);
          await new Promise(resolve => setTimeout(resolve, wait));
          continue;
        }
        throw err;
      }
    }
  }
}

async function processClienteRow(row, indices) {
  const {
    idxCliente,
    idxPlataforma,
    idxCustomerId,
    idxGestor,
    idxSupervisor,
    idxRevisao
  } = indices;

  const cliente = (row[idxCliente] || '').trim();
  const plataforma = (row[idxPlataforma] || '').trim().toUpperCase();
  const id = String(row[idxCustomerId] || '').trim();
  const gestor = (row[idxGestor] || '').trim();
  const supervisor = idxSupervisor >= 0 ? (row[idxSupervisor] || '').trim() : '';
  const revisao = String(idxRevisao >= 0 ? (row[idxRevisao] || '') : '').trim();

  const customerIdNormalized = id.replace(/\D/g, '');

  let data;
  let obs = '';
  let processStatus = 'Atualizada';

  const shouldProcess = revisao.toLowerCase() === 'ok';

  if (!shouldProcess) {
    processStatus = 'Erro';
    obs = 'Pulado por revisão';
    console.log(`⏭️ Pulado por revisão | cliente="${cliente}" | revisão="${revisao}"`);
  } else {
    if (plataforma === 'GOOGLE') {
      if (!isValidGoogleCustomerId(customerIdNormalized)) {
        console.error(`❌ Linha inválida para GOOGLE (cliente: ${cliente}). CustomerID deve ter 10 dígitos.`);
        processStatus = 'Erro';
        obs = 'Customer ID inválido (esperado 10 dígitos)';
      } else {
        data = await getGoogleData(
          customerIdNormalized,
          process.env.REFRESH_TOKEN,
          { cliente, plataforma, id: customerIdNormalized }
        );
      }
    }

    if (plataforma === 'META') {
      data = await getMetaData(
        id,
        process.env.META_TOKEN,
        { cliente, plataforma, id }
      );
    }

    if (!data || data.ok === false) {
      const err = data && data.error ? data.error : null;
      processStatus = 'Erro';
      obs = (err && err.message) ? err.message : `Erro ao consultar ${plataforma}`;
      console.warn(`⚠️ ${plataforma} | cliente="${cliente}" | id="${id}" | status=erro | obs="${obs}"`);
      data = null;
    } else {
      data = data;
    }
  }

  const rowData = data ? buildRow(cliente, plataforma, data) : null;

  return [
    rowData ? rowData.data : new Date().toISOString(),
    cliente,
    plataforma,
    rowData ? rowData.saldoFormatado : '-',
    rowData ? rowData.gastoOntemFormatado : '-',
    rowData ? rowData.mediaFormatado : '-',
    rowData ? rowData.diasFormatado : '-',
    gestor,
    supervisor,
    processStatus,
    obs,
    new Date().toISOString(),
    rowData ? rowData.identificador : ''
  ];
}

async function run(options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const batchSize = Math.max(1, Number(options.batchSize || process.env.UPDATE_BATCH_SIZE || 10));
  const processConcurrency = Math.max(1, Number(options.processConcurrency || process.env.PROCESS_CONCURRENCY || 6));
  // reduzir o intervalo padrão para 2000ms para reportar progresso com mais frequência
  const progressUpdateIntervalMs = Math.max(1000, Number(options.progressUpdateIntervalMs || process.env.PROGRESS_UPDATE_INTERVAL_MS || 2000));
  const includeSupervisorAgg = options.includeSupervisorAgg !== false;
  const skipDashboards = options.skipDashboards === true;
  const ownsJobControl = !options.jobControl;
  let jobControl = options.jobControl || null;

  const sheets = await getSheets();

  await ensureJobStateSheetExists(sheets, process.env.SPREADSHEET_ID);

  if (!jobControl) {
    jobControl = await acquireJobStateLock(sheets, process.env.SPREADSHEET_ID, {
      leaseMs: Number(process.env.JOB_LEASE_MS || 10 * 60 * 1000)
    });
  } else {
    const active = await assertJobStateActive(sheets, process.env.SPREADSHEET_ID, jobControl);
    if (!active.active) {
      const err = new Error('Job interrompido por uma atualização mais recente.');
      err.code = 'JOB_INTERRUPTED';
      throw err;
    }
  }

  // helper: sleep
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // helper: batch update values with retry/backoff on 429
  async function batchUpdateValues(sheets, spreadsheetId, data) {
    const maxAttempts = 4;
    let attempt = 0;
    while (attempt < maxAttempts) {
      try {
        return await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: {
            valueInputOption: 'RAW',
            data
          }
        });
      } catch (err) {
        const msg = String(err && (err.message || err.code || err.status) || '').toLowerCase();
        const isQuota = msg.includes('quota exceeded') || msg.includes('resource_exhausted') || String(err && err.status) === '429' || String(err && err.code) === '429';
        attempt += 1;
        if (isQuota && attempt < maxAttempts) {
          const wait = Math.pow(2, attempt) * 1000;
          console.warn(`Quota 429 recebido, retry em ${wait}ms (tentativa ${attempt}/${maxAttempts})`);
          await sleep(wait);
          continue;
        }
        throw err;
      }
    }
  }

  const clientesRes = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: 'CONFIGS!A1:Z5000'
  });

  const clientesValues = clientesRes.data.values || [];
  const headerRow = clientesValues[0] || [];
  const clientes = clientesValues.slice(1);

  console.log('[DEBUG] clientesValues.length=' + clientesValues.length + ', clientes.length=' + clientes.length + ', batchSize=' + batchSize);

  const headerMap = new Map(
    headerRow.map((header, index) => [String(header || '').trim().toLowerCase(), index])
  );

  const getIndex = (name, fallback) => headerMap.has(name.toLowerCase()) ? headerMap.get(name.toLowerCase()) : fallback;

  const idxCliente = getIndex('Cliente', 0);
  const idxPlataforma = getIndex('Plataforma', 1);
  const idxCustomerId = getIndex('CustomerID', 2);
  const idxGestor = getIndex('Gestor', 3);
  const idxRevisao = getIndex('Revisão', 4);
  const idxSupervisor = getIndex('Supervisor', -1);
  const totalClientes = clientes.length;

  let cursor = Number.isFinite(Number(options.cursor)) ? Math.max(0, Number(options.cursor)) : await readJobCursor(sheets, process.env.SPREADSHEET_ID);
  // Permite cursor === totalClientes para retomar jobs em que a fase DATABASE
  // já terminou e faltam apenas etapas finais (supervisor/dashboards).
  if (totalClientes <= 0) {
    cursor = 0;
  } else if (!Number.isFinite(cursor) || cursor < 0 || cursor > totalClientes) {
    cursor = 0;
  }

  console.log(`[init] totalClientes=${totalClientes}, cursor=${cursor}, ownsJobControl=${ownsJobControl}`);

  try {
    await touchJobState(sheets, process.env.SPREADSHEET_ID, jobControl, {
      totalClients: totalClientes,
      progressCursor: cursor === 0 ? 0 : undefined, // Se iniciando, zera; se retomando, preserva
      stage: cursor === 0 ? 'database' : (jobControl && jobControl.stage) || 'database',
      lastAction: 'set_total_clients'
    });
  } catch (e) {
    console.warn('[run] Erro ao definir totalClients:', e && e.message);
  }

  const batchClientes = clientes.slice(cursor, cursor + batchSize);

  console.log(`[batch] cursor=${cursor}, batchSize=${batchSize}, batchClientes.length=${batchClientes.length}, totalClientes=${totalClientes}`);

  if (cursor === 0) {
    await touchJobState(sheets, process.env.SPREADSHEET_ID, jobControl, {
      totalClients: totalClientes,
      stage: 'database',
      lastAction: 'start_database'
    });
    await batchUpdateValues(sheets, process.env.SPREADSHEET_ID, [
      {
        range: 'DATABASE!A1',
        values: [DATABASE_HEADERS]
      }
    ]);
  }

  if (!batchClientes.length) {
    // Nenhum cliente neste lote... mas ainda há clientes para processar?
    if (cursor < totalClientes) {
      // Ainda há clientes! Não marca como finished.
      console.log('Lote vazio em cursor=' + cursor + ' mas totalClientes=' + totalClientes + '; continuar processando');
      await touchJobState(sheets, process.env.SPREADSHEET_ID, jobControl, { cursor, totalClients: totalClientes });
      if (ownsJobControl) {
        await releaseJobState(sheets, process.env.SPREADSHEET_ID, jobControl, 'idle');
      }
      return { ok: true, processed: 0, total: totalClientes, cursor, nextCursor: cursor, finished: false };
    }
    
    // Todos foram processados
    await finishJobState(sheets, process.env.SPREADSHEET_ID, jobControl, 'idle');
    console.log('Nenhum cliente pendente; todos foram processados.');
    return { ok: true, processed: 0, total: totalClientes, cursor, nextCursor: cursor, finished: true };
  }

  const batchRows = new Array(batchClientes.length);
  let processedCount = 0;
  let lastProgressTouchAt = 0;

  for (let start = 0; start < batchClientes.length; start += processConcurrency) {
    const active = await assertJobStateActive(sheets, process.env.SPREADSHEET_ID, jobControl);
    if (!active.active) {
      const err = new Error('Job interrompido por uma atualização mais recente.');
      err.code = 'JOB_INTERRUPTED';
      throw err;
    }

    const chunk = batchClientes.slice(start, start + processConcurrency);
    const chunkResults = await Promise.all(chunk.map(async (row, offset) => {
      const batchIndex = start + offset;
      const index = cursor + batchIndex;
      const cliente = (row[idxCliente] || '').trim();
      
      try {
        const values = await processClienteRow(row, {
          idxCliente,
          idxPlataforma,
          idxCustomerId,
          idxGestor,
          idxSupervisor,
          idxRevisao
        });
        return { batchIndex, index, values, cliente, error: null };
      } catch (error) {
        console.error(`❌ ERRO ao processar cliente "${cliente}":`, error && error.message);
        // Retornar linha de erro em vez de falhar o lote inteiro
        return { 
          batchIndex, 
          index, 
          values: [
            new Date().toISOString(),
            cliente,
            '',
            '-',
            '-',
            '-',
            '-',
            '',
            '',
            'Erro',
            `Erro ao processar: ${error && error.message ? error.message : 'desconhecido'}`,
            new Date().toISOString(),
            ''
          ],
          cliente,
          error: error && error.message ? error.message : String(error)
        };
      }
    }));

    chunkResults.sort((a, b) => a.batchIndex - b.batchIndex);

    for (const item of chunkResults) {
      if (item.error) {
        console.warn(`⚠️ Cliente falhado (continuando lote): "${item.cliente}" | erro: ${item.error}`);
      } else {
        console.log(`${item.cliente} processado`);
      }
      try { console.log('[diagnostic] processed client', { cliente: item.cliente, index: item.index, error: item.error || null }); } catch (e) { }

      if (onProgress) {
        await onProgress(item.index + 1, totalClientes, item.cliente);
      }

      processedCount += 1;
      const now = Date.now();
      const shouldTouchProgress = processedCount === batchClientes.length || (now - lastProgressTouchAt) >= progressUpdateIntervalMs;
      if (shouldTouchProgress) {
        try {
          await touchJobState(sheets, process.env.SPREADSHEET_ID, jobControl, {
            stage: 'database',
            progressCursor: item.index + 1,
            totalClients: totalClientes,
            lastAction: 'progress'
          });
          lastProgressTouchAt = now;
          console.log(`[progress] progressCursor atualizado para ${item.index + 1}/${totalClientes}`);
        } catch (e) {
          console.error('[progress-error] Erro ao atualizar progressCursor:', e && e.message);
        }
      }

      batchRows[item.batchIndex] = { index: item.index, values: item.values };
    }
  }

  const firstRowIndex = cursor + 2;
  // Filtrar undefined e pegar apenas as linhas que foram realmente processadas
  const validBatchRows = batchRows.filter(item => item !== undefined);
  const valuesToWrite = validBatchRows.map(item => item.values);

  await batchUpdateValues(sheets, process.env.SPREADSHEET_ID, [
    {
      range: `DATABASE!A${firstRowIndex}`,
      values: valuesToWrite
    }
  ]);

  // O número de clientes processados é sempre o número de itens no batchRows
  // (não o número de itens válidos, porque cada cliente produz uma linha, seja sucesso ou erro)
  const actualProcessed = batchClientes.length;
  const nextCursor = cursor + actualProcessed;
  
  // SEGURANÇA: Se totalClientes é 0 mas cursor > 0, algo deu errado. Não marcar como finished.
  // Isso previne que a job termine prematuramente se totalClientes foi perdido no job state.
  let finalTotalClientes = totalClientes;
  if (totalClientes === 0 && cursor > 0) {
    console.error(`[SAFETY] totalClientes é 0 mas cursor=${cursor}! Não marcando como finished. Força releitura de totalClientes.`);
    finalTotalClientes = clientes.length;
  }
  
  const finished = nextCursor >= finalTotalClientes;
  const percentComplete = finalTotalClientes > 0 ? Math.round((nextCursor / finalTotalClientes) * 100) : 0;

  console.log(`[batch-end] cursor=${cursor}, batchClientes.length=${batchClientes.length}, validBatchRows.length=${validBatchRows.length}, nextCursor=${nextCursor}, totalClientes=${finalTotalClientes}, finished=${finished}, percent=${percentComplete}%`);

  try {
    await touchJobState(sheets, process.env.SPREADSHEET_ID, jobControl, {
      stage: finished ? 'database_complete' : 'database',
      cursor: nextCursor,
      totalClients: finalTotalClientes,
      lastAction: finished ? 'database_complete' : 'database_progress'
    });
    console.log('[diagnostic] touched job state', { jobId: jobControl.jobId, generation: jobControl.generation, nextCursor, finished });
  } catch (e) {
    if (e && e.code === 'JOB_INTERRUPTED') throw e;
    console.warn('[run] touchJobState after batch failed (non-fatal):', e && e.message);
  }

  if (!finished) {
    const batchTime = new Date().toISOString();
    console.log(`Lote concluído | processed=${actualProcessed} | nextCursor=${nextCursor}/${totalClientes} | time=${batchTime}`);
    // NÃO liberar o lock aqui - apenas quem o adquiriu deve liberá-lo
    // O jobControl foi passado por runFullUpdateJob que cuidará da liberação
    return { ok: true, processed: actualProcessed, total: totalClientes, cursor, nextCursor, finished: false };
  }

  if (!options.jobControl) {
    await finishJobState(sheets, process.env.SPREADSHEET_ID, jobControl, 'idle');
  }

  try {
    await clearDatabaseTail(sheets, process.env.SPREADSHEET_ID, totalClientes);
  } catch (e) {
    console.error('Erro ao limpar cauda da DATABASE:', e);
  }

  try {
    await applyDatabaseFormatting(sheets, process.env.SPREADSHEET_ID, totalClientes);
  } catch (e) {
    console.error('Erro ao formatar DATABASE:', e);
  }

  try {
    const removed = await deleteSheetIfExists(sheets, process.env.SPREADSHEET_ID, 'AGG_SUPERVISOR');
    if (removed) {
      console.log('AGG_SUPERVISOR removido');
    }
  } catch (e) {
    console.error('Erro ao remover AGG_SUPERVISOR:', e);
  }

  if (includeSupervisorAgg) {
    try {
      try {
        await touchJobState(sheets, process.env.SPREADSHEET_ID, jobControl, { stage: 'supervisor', lastAction: 'pre_generate_supervisor', totalClients: totalClientes });
      } catch (e) { }
      await generateBlocosPorGestor(sheets, process.env.SPREADSHEET_ID);
      console.log('SUPERVISOR atualizado');
    } catch (e) {
      console.error('Erro ao gerar SUPERVISOR:', e);
    }

    try {
      try {
        await touchJobState(sheets, process.env.SPREADSHEET_ID, jobControl, { stage: 'aggregating', lastAction: 'pre_generate_agg', totalClients: totalClientes });
      } catch (e) { }
      await generateSupervisorAgg(sheets, process.env.SPREADSHEET_ID);
      console.log('AGG_SUPERVISOR atualizado');
    } catch (e) {
      console.error('Erro ao gerar AGG_SUPERVISOR:', e);
    }
  }

  if (!skipDashboards) {
    try {
      await touchJobState(sheets, process.env.SPREADSHEET_ID, jobControl, { stage: 'dashboards', lastAction: 'pre_dashboards', totalClients: totalClientes });
      const dashResult = await ensureDashboardsForAllGestores(sheets, process.env.SPREADSHEET_ID);
      if (dashResult.ok) {
        const criadas = dashResult.resultados.filter(r => r.status === 'criada').length;
        const recriadas = dashResult.resultados.filter(r => r.status === 'recriada').length;
        console.log(`📊 Dashboards de gestor gerados: ${dashResult.totalGestores} gestor(es), ${criadas} nova(s) e ${recriadas} recriada(s)`);
      } else {
        console.warn('Erro ao garantir dashboards de gestor:', dashResult.error);
      }
    } catch (e) {
      console.error('Erro ao assegurar dashboards de gestor:', e);
    }
  } else {
    console.log('Atualização de dashboards adiada para o cron dedicado.');
  }

  try {
    await updateWelcomeStatus(
      sheets,
      process.env.SPREADSHEET_ID,
      `Atualizado em ${formatLastUpdatePTBR()}`
    );
  } catch (e) {
    console.warn('Falha ao atualizar status final na aba de boas-vindas:', e && e.message ? e.message : e);
  }

  console.log('DATABASE atualizada');

  return { ok: true, processed: actualProcessed, total: totalClientes, cursor, nextCursor: cursor + actualProcessed, finished: true };
}

module.exports = {
  run,
  readJobState,
  writeJobState,
  acquireJobStateLock,
  assertJobStateActive,
  touchJobState,
  finishJobState,
  releaseJobState,
  appendJobHistory,
  getOwnerId,
  startHeartbeatTimer,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_MAX_MISSED_HEARTBEATS,
  HEARTBEAT_STALE_THRESHOLD_MS
};

if (require.main === module) {
  run()
    .then(() => {
      console.log('✅ Execução concluída.');
    })
    .catch((error) => {
      console.error('❌ Erro na execução:', error);
      process.exit(1);
    });
}
