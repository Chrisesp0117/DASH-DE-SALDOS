require('dotenv').config({ path: '.env' });
const { randomUUID } = require('crypto');

const { getSheets } = require('./services/sheets');
const { getGoogleData } = require('./services/googleAds');
const { getMetaData } = require('./services/meta');
const { buildRow } = require('./core/calculator');
const { generateBlocosPorGestor } = require('./core/visualBlocks');
const { ensureDashboardsForAllGestores } = require('./core/gestorDashboards');

const DATABASE_HEADERS = [
  'Data', 'Cliente', 'Plataforma', 'Saldo', 'Gasto Ontem', 'Gasto Ontem', 'Dias restantes',
  'Gestor', 'Supervisor', 'Status', 'Obs', 'DataISO', 'Identificador'
];

const JOB_STATE_RANGE = 'JOB_STATE!A1:F1';
const JOB_STATE_LEGACY_CURSOR_RANGE = 'JOB_STATE!A1';

function createDefaultJobState() {
  return {
    status: 'idle',
    jobId: '',
    generation: 0,
    cursor: 0,
    leaseUntil: 0,
    updatedAt: ''
  };
}

function toIsoNow() {
  return new Date().toISOString();
}

function parseJobStateRow(values) {
  const row = Array.isArray(values) && values.length ? values[0] : [];
  const first = row[0];

  if (row.length === 1 && Number.isFinite(Number(first))) {
    return {
      ...createDefaultJobState(),
      cursor: Math.max(0, Number(first))
    };
  }

  const generation = Number(row[2]);
  const cursor = Number(row[3]);
  const leaseUntil = Number(row[4]);

  return {
    status: String(row[0] || 'idle').trim() || 'idle',
    jobId: String(row[1] || '').trim(),
    generation: Number.isFinite(generation) && generation >= 0 ? generation : 0,
    cursor: Number.isFinite(cursor) && cursor >= 0 ? cursor : 0,
    leaseUntil: Number.isFinite(leaseUntil) && leaseUntil >= 0 ? leaseUntil : 0,
    updatedAt: String(row[5] || '').trim()
  };
}

function serializeJobState(state) {
  const normalized = state || createDefaultJobState();
  return [[
    String(normalized.status || 'idle'),
    String(normalized.jobId || ''),
    String(Number.isFinite(Number(normalized.generation)) ? Number(normalized.generation) : 0),
    String(Math.max(0, Number(normalized.cursor || 0))),
    String(Math.max(0, Number(normalized.leaseUntil || 0))),
    String(normalized.updatedAt || toIsoNow())
  ]];
}

async function readJobState(sheets, spreadsheetId) {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: JOB_STATE_RANGE
    });

    return parseJobStateRow(response.data.values || []);
  } catch (error) {
    try {
      const cursorResponse = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: JOB_STATE_LEGACY_CURSOR_RANGE
      });
      const value = cursorResponse.data.values && cursorResponse.data.values[0] && cursorResponse.data.values[0][0];
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed >= 0) {
        return {
          ...createDefaultJobState(),
          cursor: parsed
        };
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
    requestBody: {
      values: serializeJobState(state)
    }
  });
}

async function acquireJobStateLock(sheets, spreadsheetId, options = {}) {
  const current = await readJobState(sheets, spreadsheetId);
  const nextGeneration = Math.max(0, Number(current.generation || 0)) + 1;
  const jobId = String(options.jobId || randomUUID());
  const leaseMs = Math.max(30000, Number(options.leaseMs || process.env.JOB_LEASE_MS || 10 * 60 * 1000));
  const now = Date.now();
  const state = {
    status: 'running',
    jobId,
    generation: nextGeneration,
    cursor: 0,
    leaseUntil: now + leaseMs,
    updatedAt: toIsoNow()
  };

  await writeJobState(sheets, spreadsheetId, state);

  return state;
}

function isSameJobState(current, control) {
  if (!control) {
    return true;
  }

  return String(current.jobId || '') === String(control.jobId || '')
    && Number(current.generation || 0) === Number(control.generation || 0);
}

async function assertJobStateActive(sheets, spreadsheetId, control) {
  if (!control) {
    return { active: true, state: createDefaultJobState() };
  }

  const current = await readJobState(sheets, spreadsheetId);
  const active = isSameJobState(current, control);
  return { active, state: current };
}

async function touchJobState(sheets, spreadsheetId, control, updates = {}) {
  if (!control) {
    return;
  }

  const current = await readJobState(sheets, spreadsheetId);
  if (!isSameJobState(current, control)) {
    const err = new Error('Job interrompido por uma atualização mais recente.');
    err.code = 'JOB_INTERRUPTED';
    throw err;
  }

  await writeJobState(sheets, spreadsheetId, {
    status: updates.status || current.status || 'running',
    jobId: control.jobId,
    generation: control.generation,
    cursor: Number.isFinite(Number(updates.cursor)) ? Number(updates.cursor) : current.cursor,
    leaseUntil: Date.now() + Math.max(30000, Number(updates.leaseMs || process.env.JOB_LEASE_MS || 10 * 60 * 1000)),
    updatedAt: toIsoNow()
  });
}

async function finishJobState(sheets, spreadsheetId, control, status = 'idle') {
  if (!control) {
    return;
  }

  const current = await readJobState(sheets, spreadsheetId);
  if (!isSameJobState(current, control)) {
    return;
  }

  await writeJobState(sheets, spreadsheetId, {
    status,
    jobId: control.jobId,
    generation: control.generation,
    cursor: 0,
    leaseUntil: 0,
    updatedAt: toIsoNow()
  });
}

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

async function clearDatabaseData(sheets, spreadsheetId) {
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: 'DATABASE!A2:M10000'
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
  const batchSize = Math.max(1, Number(options.batchSize || process.env.UPDATE_BATCH_SIZE || 1));
  const enableStartStatus = options.enableStartStatus !== false;
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

  // Helper: atualiza status (texto) em BEM VINDO!J5 e em D2 de todas as abas DASH-*
  async function updateStatusOnSheets(sheets, spreadsheetId, statusText, options = {}) {
    try {
      const includeDashboards = options.includeDashboards !== false;
      const includeWelcome = options.includeWelcome !== false;
      const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets(properties(title))' });
      const sheetsList = (meta.data.sheets || []).map(s => s.properties && s.properties.title).filter(Boolean);

      const updates = [];
      for (const title of sheetsList) {
        if (includeDashboards && String(title || '').startsWith('DASH-')) {
          const safe = String(title || '').trim().replace(/'/g, "''");
          updates.push({ range: `'${safe}'!D2`, values: [[statusText]] });
        }
      }

      const welcomeTitle = includeWelcome ? sheetsList.find(t => /^bem\s*vind/i.test(String(t || ''))) : null;
      if (welcomeTitle) {
        const safeWelcome = String(welcomeTitle || '').trim().replace(/'/g, "''");
        updates.push({ range: `'${safeWelcome}'!J5`, values: [[statusText]] });
      }

      if (updates.length === 0) return;

      try {
        await batchUpdateValues(sheets, spreadsheetId, updates);
      } catch (err) {
        const errMsg = err && err.message ? err.message : String(err);
        // If protected cell or quota, log and continue
        if (errMsg.toLowerCase().includes('protected')) {
          console.warn('Células protegidas ou não editáveis; ignorando atualizações de status.');
        } else {
          console.warn('Falha ao atualizar status em lote:', errMsg);
        }
      }
    } catch (err) {
      console.error('Erro em updateStatusOnSheets:', err && err.message ? err.message : err);
    }
  }

  // Marca como "Atualizando..." no início (welcome + DASH-*)
  if (enableStartStatus) {
    try {
      await updateStatusOnSheets(
        sheets,
        process.env.SPREADSHEET_ID,
        'Atualizando...',
        { includeDashboards: false, includeWelcome: true }
      );
      console.log('Início da atualização: Atualizando...');
    } catch (e) {
      console.warn('Não foi possível marcar como "Atualizando...":', e && e.message ? e.message : e);
    }
  }

  const clientesRes = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: 'CONFIGS!A1:Z'
  });

  const clientesValues = clientesRes.data.values || [];
  const headerRow = clientesValues[0] || [];
  const clientes = clientesValues.slice(1);

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

  const batchClientes = clientes.slice(cursor, cursor + batchSize);

  if (cursor === 0) {
    await clearDatabaseData(sheets, process.env.SPREADSHEET_ID);
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: 'DATABASE!A1',
      valueInputOption: 'RAW',
      requestBody: {
        values: [DATABASE_HEADERS]
      }
    });

    await touchJobState(sheets, process.env.SPREADSHEET_ID, jobControl, { cursor: 0 });
  }

  if (!batchClientes.length) {
    await writeJobCursor(sheets, process.env.SPREADSHEET_ID, 0);
    console.log('Nenhum cliente pendente; cursor reiniciado.');
    return { ok: true, processed: 0, total: totalClientes, cursor: 0, nextCursor: 0, finished: true };
  }

  const batchRows = await Promise.all(
    batchClientes.map(async (row, batchIndex) => {
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

      if (onProgress) {
        await onProgress(index + 1, totalClientes, cliente);
      }

      return { index, values };
    })
  );

  const firstRowIndex = cursor + 2;
  const valuesToWrite = batchRows.map(item => item.values);

  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `DATABASE!A${firstRowIndex}`,
    valueInputOption: 'RAW',
    requestBody: {
      values: valuesToWrite
    }
  });

  await touchJobState(sheets, process.env.SPREADSHEET_ID, jobControl, { cursor: cursor + batchRows.length });

  const nextCursor = cursor + batchRows.length;
  const finished = nextCursor >= totalClientes;

  if (!finished) {
    await writeJobCursor(sheets, process.env.SPREADSHEET_ID, nextCursor);
    const batchTime = new Date().toISOString();
    console.log(`Lote concluído | processed=${batchRows.length} | nextCursor=${nextCursor}/${totalClientes} | time=${batchTime}`);
    return { ok: true, processed: batchRows.length, total: totalClientes, cursor, nextCursor, finished: false };
  }

  await finishJobState(sheets, process.env.SPREADSHEET_ID, jobControl, 'idle');

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
    await generateBlocosPorGestor(sheets, process.env.SPREADSHEET_ID);
    console.log('SUPERVISOR atualizado');
  } catch (e) {
    console.error('Erro ao gerar SUPERVISOR:', e);
  }

  if (!skipDashboards) {
    try {
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

  // Atualiza timestamps de "Última Atualização" em abas DASH-* e em BEM VINDO (se existir)
  function sanitizeTitleForRange(title) {
    return String(title || '').trim().replace(/'/g, "''");
  }

  async function updateLastRunTimestamps(sheets, spreadsheetId, options = {}) {
    try {
      const includeDashboards = options.includeDashboards !== false;
      const includeWelcome = options.includeWelcome !== false;
      const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets(properties(title))' });
      const sheetsList = (meta.data.sheets || []).map(s => s.properties && s.properties.title).filter(Boolean);
      const nowFmt = formatLastUpdatePTBR();

      const updates = [];

      for (const title of sheetsList) {
        if (includeDashboards && String(title || '').startsWith('DASH-')) {
          const safe = sanitizeTitleForRange(title);
          updates.push({ range: `'${safe}'!D2`, values: [[nowFmt]] });
        }
      }

      // Atualiza a aba de boas-vindas caso exista (aceita variações: BEM VINDO / BEM VINDOS)
      const welcomeTitle = includeWelcome ? sheetsList.find(t => /^bem\s*vind/i.test(String(t || ''))) : null;
      if (welcomeTitle) {
        const safeWelcome = sanitizeTitleForRange(welcomeTitle);
        updates.push({ range: `'${safeWelcome}'!J5`, values: [[nowFmt]] });
      }
      if (updates.length === 0) return;
      console.log(`Atualizando timestamps em ${updates.length} célula(s)`);
      try {
        await batchUpdateValues(sheets, spreadsheetId, updates);
        console.log('✓ Timestamps atualizados em lote');
      } catch (err) {
        const errMsg = err && err.message ? err.message : String(err);
        if (errMsg.toLowerCase().includes('protected')) {
          console.warn('Células protegidas, ignorando timestamps.');
        } else {
          console.warn('Falha ao atualizar timestamps em lote:', errMsg);
        }
      }
    } catch (err) {
      console.error('Erro ao atualizar timestamps de última execução:', err && err.message ? err.message : err);
    }
  }

  try {
    await updateLastRunTimestamps(
      sheets,
      process.env.SPREADSHEET_ID,
      { includeDashboards: false, includeWelcome: true }
    );
    console.log('Timestamps de última atualização aplicados nas abas de destino (se existirem)');
  } catch (e) {
    console.error('Erro ao aplicar timestamps finais:', e);
  }

  console.log('DATABASE atualizada');

  return { ok: true, processed: batchRows.length, total: totalClientes, cursor, nextCursor: 0, finished: true };
}

module.exports = {
  run,
  readJobState,
  writeJobState,
  acquireJobStateLock,
  assertJobStateActive,
  touchJobState,
  finishJobState
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
