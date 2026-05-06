require('dotenv').config({ path: '.env' });

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
      range: 'JOB_STATE!A1'
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
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'JOB_STATE!A1'
    });

    const value = response.data.values && response.data.values[0] && response.data.values[0][0];
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  } catch (error) {
    return 0;
  }
}

async function writeJobCursor(sheets, spreadsheetId, cursor) {
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'JOB_STATE!A1',
    valueInputOption: 'RAW',
    requestBody: {
      values: [[String(cursor)]]
    }
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

  const sheets = await getSheets();

  await ensureJobStateSheetExists(sheets, process.env.SPREADSHEET_ID);

  // Nota: chamada a atualização automática de 'welcome' removida (legacy)

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
  }

  if (!batchClientes.length) {
    await writeJobCursor(sheets, process.env.SPREADSHEET_ID, 0);
    console.log('Nenhum cliente pendente; cursor reiniciado.');
    return { ok: true, processed: 0, total: totalClientes, cursor: 0, nextCursor: 0, finished: true };
  }

  const batchRows = await Promise.all(
    batchClientes.map(async (row, batchIndex) => {
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

  const nextCursor = cursor + batchRows.length;
  const finished = nextCursor >= totalClientes;

  if (!finished) {
    await writeJobCursor(sheets, process.env.SPREADSHEET_ID, nextCursor);
    console.log(`Lote concluído. Próximo cursor: ${nextCursor}/${totalClientes}`);
    return { ok: true, processed: batchRows.length, total: totalClientes, cursor, nextCursor, finished: false };
  }

  await writeJobCursor(sheets, process.env.SPREADSHEET_ID, 0);

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

  // Atualiza timestamps de "Última Atualização" em abas DASH-* e em BEM VINDO (se existir)
  async function sanitizeTitleForRange(title) {
    return String(title || '').trim().replace(/'/g, "''");
  }

  async function updateLastRunTimestamps(sheets, spreadsheetId) {
    try {
      const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets(properties(title))' });
      const sheetsList = (meta.data.sheets || []).map(s => s.properties && s.properties.title).filter(Boolean);
      const nowFmt = formatLastUpdatePTBR();

      const updates = [];

      for (const title of sheetsList) {
        if (String(title || '').startsWith('DASH-')) {
          const safe = await sanitizeTitleForRange(title);
          updates.push({ range: `'${safe}'!D2`, values: [[nowFmt]] });
        }
      }

      // Atualiza BEM VINDO caso exista
      if (sheetsList.includes('BEM VINDO')) {
        updates.push({ range: 'BEM VINDO!A2', values: [[nowFmt]] });
      }

      for (const u of updates) {
        try {
          await sheets.spreadsheets.values.update({ spreadsheetId, range: u.range, valueInputOption: 'RAW', requestBody: { values: u.values } });
        } catch (err) {
          console.warn('Falha ao atualizar timestamp em', u.range, err && err.message ? err.message : err);
        }
      }
    } catch (err) {
      console.error('Erro ao atualizar timestamps de última execução:', err && err.message ? err.message : err);
    }
  }

  try {
    await updateLastRunTimestamps(sheets, process.env.SPREADSHEET_ID);
    console.log('Timestamps de última atualização aplicados nas abas DASH-* e BEM VINDO (se existirem)');
  } catch (e) {
    console.error('Erro ao aplicar timestamps finais:', e);
  }

  console.log('DATABASE atualizada');

  return { ok: true, processed: batchRows.length, total: totalClientes, cursor, nextCursor: 0, finished: true };
}

module.exports = {
  run
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
