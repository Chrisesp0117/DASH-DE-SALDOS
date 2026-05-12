require('dotenv').config({ path: '.env' });

const { getSheets } = require('./services/sheets');
const { getGoogleData } = require('./services/googleAds');
const { getMetaData } = require('./services/meta');
const { buildRow } = require('./core/calculator');
const { generateBlocosPorGestor } = require('./core/visualBlocks');
const { generateSupervisorAgg } = require('./core/aggregator');
const { ensureDashboardsForAllGestores } = require('./core/gestorDashboards');
const {
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

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `DATABASE!A${startRow}:M${maxRows}`
  });
}

async function readJobCursor(sheets, spreadsheetId) {
  const state = await readJobState(sheets, spreadsheetId);
  return Number.isFinite(Number(state.cursor)) && Number(state.cursor) >= 0 ? Number(state.cursor) : 0;
}

async function writeJobCursor(sheets, spreadsheetId, cursor) {
  const current = await readJobState(sheets, spreadsheetId);
  await writeJobState(sheets, spreadsheetId, {
    ...current,
    cursor
  });
}

async function applyDatabaseFormatting(sheets, spreadsheetId, totalRows) {
  const databaseRowsRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `DATABASE!A1:M${Math.max(totalRows + 1, 2)}`
  });

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
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: formatRequests }
    });
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
  const skipDashboards = options.skipDashboards === true;
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
  if (!Number.isFinite(cursor) || cursor < 0 || cursor >= totalClientes) {
    cursor = 0;
  }

  try {
    await touchJobState(sheets, process.env.SPREADSHEET_ID, jobControl, {
      totalClients: totalClientes,
      stage: cursor === 0 ? 'database' : (jobControl && jobControl.stage) || 'database',
      lastAction: 'set_total_clients'
    });
  } catch (e) {
    // best-effort telemetry only
  }

  const batchClientes = clientes.slice(cursor, cursor + batchSize);

  if (cursor === 0) {
    await touchJobState(sheets, process.env.SPREADSHEET_ID, jobControl, {
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
      await touchJobState(sheets, process.env.SPREADSHEET_ID, jobControl, { cursor });
      return { ok: true, processed: 0, total: totalClientes, cursor, nextCursor: cursor, finished: false };
    }
    
    // Todos foram processados
    await finishJobState(sheets, process.env.SPREADSHEET_ID, jobControl, 'idle');
    console.log('Nenhum cliente pendente; todos foram processados.');
    return { ok: true, processed: 0, total: totalClientes, cursor, nextCursor: cursor, finished: true };
  }

  const batchRows = [];
  for (let batchIndex = 0; batchIndex < batchClientes.length; batchIndex += 1) {
    const row = batchClientes[batchIndex];
    const active = await assertJobStateActive(sheets, process.env.SPREADSHEET_ID, jobControl);
    if (!active.active) {
      const err = new Error('Job interrompido por uma atualização mais recente.');
      err.code = 'JOB_INTERRUPTED';
      throw err;
    }

    const index = cursor + batchIndex;
    const values = await processClienteRow(row, {
      idxCliente,
      idxPlataforma,
      idxCustomerId,
      idxGestor,
      idxSupervisor,
      idxRevisao
    });

    const cliente = (row[idxCliente] || '').trim();
    console.log(`${cliente} processado`);

    // diagnostic
    try { console.log('[diagnostic] processed client', { cliente, index }); } catch (e) { }

    if (onProgress) {
      await onProgress(index + 1, totalClientes, cliente);
    }

    // Atualiza o cursor durante o processamento para a UI mostrar progresso real em tempo quase real.
    // Fazemos isso a cada 2 clientes para reduzir escrita excessiva na planilha.
    if (((batchIndex + 1) % 2 === 0) || batchIndex === batchClientes.length - 1) {
      try {
        await touchJobState(sheets, process.env.SPREADSHEET_ID, jobControl, {
          stage: 'database',
          progressCursor: index + 1,
          lastAction: 'progress'
        });
      } catch (e) {
        // best-effort: não interrompe o processamento por falha de telemetria
      }
    }

    batchRows.push({ index, values });
  }

  const firstRowIndex = cursor + 2;
  const valuesToWrite = batchRows.map(item => item.values);

  await batchUpdateValues(sheets, process.env.SPREADSHEET_ID, [
    {
      range: `DATABASE!A${firstRowIndex}`,
      values: valuesToWrite
    }
  ]);

  await touchJobState(sheets, process.env.SPREADSHEET_ID, jobControl, { cursor: cursor + batchRows.length });
  console.log('[diagnostic] touched job state', { jobId: jobControl.jobId, generation: jobControl.generation, nextCursor: cursor + batchRows.length });

  const nextCursor = cursor + batchRows.length;
  const finished = nextCursor >= totalClientes;

  if (!finished) {
    // Cursor already persisted via touchJobState above; no need to writeJobCursor separately
    await touchJobState(sheets, process.env.SPREADSHEET_ID, jobControl, {
      stage: 'database',
      cursor: nextCursor,
      lastAction: 'database_progress'
    });
    const batchTime = new Date().toISOString();
    console.log(`Lote concluído | processed=${batchRows.length} | nextCursor=${nextCursor}/${totalClientes} | time=${batchTime}`);
    return { ok: true, processed: batchRows.length, total: totalClientes, cursor, nextCursor, finished: false };
  }

  await touchJobState(sheets, process.env.SPREADSHEET_ID, jobControl, {
    stage: 'database_complete',
    lastAction: 'database_complete'
  });
  await finishJobState(sheets, process.env.SPREADSHEET_ID, jobControl, 'idle');

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

  try {
    try {
      await touchJobState(sheets, process.env.SPREADSHEET_ID, jobControl, { stage: 'supervisor', lastAction: 'pre_generate_supervisor' });
    } catch (e) { /* best-effort */ }
    await generateBlocosPorGestor(sheets, process.env.SPREADSHEET_ID);
    console.log('SUPERVISOR atualizado');
  } catch (e) {
    console.error('Erro ao gerar SUPERVISOR:', e);
  }

  try {
    try {
      await touchJobState(sheets, process.env.SPREADSHEET_ID, jobControl, { stage: 'aggregating', lastAction: 'pre_generate_agg' });
    } catch (e) { /* best-effort */ }
    await generateSupervisorAgg(sheets, process.env.SPREADSHEET_ID);
    console.log('AGG_SUPERVISOR atualizado');
  } catch (e) {
    console.error('Erro ao gerar AGG_SUPERVISOR:', e);
  }

  if (!skipDashboards) {
    try {
      await touchJobState(sheets, process.env.SPREADSHEET_ID, jobControl, { stage: 'dashboards', lastAction: 'pre_dashboards' });
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

  return { ok: true, processed: batchRows.length, total: totalClientes, cursor, nextCursor: cursor + batchRows.length, finished: true };
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
