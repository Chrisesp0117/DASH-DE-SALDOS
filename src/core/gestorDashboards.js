/**
 * Gestor Dashboards Generator
 *
 * Each DASH-{Gestor} sheet is generated from scratch using DATABASE rows.
 * DASH-Felipe is only a visual reference for the manual layout.
 */

const DASH_PREFIX = 'DASH-';
const DASH_LAST_UPDATE_LABEL_CELL = 'D1';
const DASH_LAST_UPDATE_VALUE_CELL = 'D2';

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

function sanitizeSheetName(title) {
  return String(title || '').trim().replace(/'/g, "''");
}

async function getSheetMeta(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties(sheetId,title,index))'
  });

  const sheetList = meta.data.sheets || [];
  return {
    meta,
    sheets: sheetList,
    titles: sheetList.map(s => s.properties && s.properties.title).filter(Boolean),
    byTitle: new Map(
      sheetList
        .filter(s => s.properties && s.properties.title)
        .map(s => [s.properties.title, s])
    )
  };
}

async function listGestoresAtivos(sheets, spreadsheetId) {
  try {
    const clientesRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'CONFIGS!A1:Z'
    });

    const values = clientesRes.data.values || [];
    const headers = values[0] || [];
    const gestorIndex = headers.findIndex(h => String(h || '').trim().toLowerCase() === 'gestor');

    if (gestorIndex < 0) {
      console.warn('Coluna Gestor não encontrada na aba CONFIGS.');
      return [];
    }

    const gestores = new Set();
    for (let i = 1; i < values.length; i++) {
      const row = values[i] || [];
      const gestor = String(row[gestorIndex] || '').trim();
      if (gestor) {
        gestores.add(gestor);
      }
    }

    return Array.from(gestores).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  } catch (error) {
    console.error('Erro ao listar gestores ativos:', error.message || error);
    return [];
  }
}

function parseDiasRestantes(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const text = String(value || '').trim().toLowerCase();
  if (!text || text === '-') {
    return null;
  }

  const diasMatch = text.match(/(\d+)\s*dias?/i);
  if (diasMatch) {
    return Number(diasMatch[1]);
  }

  const numeric = Number(text.replace(',', '.'));
  return Number.isFinite(numeric) ? numeric : null;
}

function isCriticalRow(row) {
  const dias = parseDiasRestantes(row.duracao);
  return dias !== null && dias < 7;
}

function collectDashboardRows(databaseRows, gestor) {
  const metaRows = [];
  const googleRows = [];

  for (const row of databaseRows) {
    const rowGestor = String(row[7] || '').trim();
    if (rowGestor !== gestor) {
      continue;
    }

    const plataforma = String(row[2] || '').trim().toUpperCase();
    if (plataforma !== 'META' && plataforma !== 'GOOGLE') {
      continue;
    }

    const item = {
      cliente: String(row[1] || '').trim(),
      saldo: String(row[3] || '').trim(),
      gastoMedio: String(row[5] || '').trim(),
      duracao: String(row[6] || '').trim(),
      critical: isCriticalRow({ duracao: row[6] })
    };

    if (plataforma === 'META') {
      metaRows.push(item);
    } else {
      googleRows.push(item);
    }
  }

  return { metaRows, googleRows };
}

function buildDashboardValues(gestor, metaRows, googleRows) {
  const values = [];
  const pushRow = (row) => values.push([row[0] || '', row[1] || '', row[2] || '', row[3] || '']);

  pushRow([`Seja Bem Vindo ${gestor}!`, '', '', 'Última Atualização:']);
  pushRow(['', '', '', formatLastUpdatePTBR()]);
  pushRow(['', '', '', '']);
  pushRow(['Cliente (Meta)', 'Saldo', 'Gasto Ontem', 'Duração']);

  for (const item of metaRows) {
    pushRow([item.cliente, item.saldo, item.gastoMedio, item.duracao]);
  }

  pushRow(['', '', '', '']);
  pushRow(['Cliente (Google)', 'Saldo', 'Gasto Ontem', 'Duração']);

  for (const item of googleRows) {
    pushRow([item.cliente, item.saldo, item.gastoMedio, item.duracao]);
  }

  return values;
}

function getExistingDashboardSheet(sheetMeta, sheetTitle) {
  return sheetMeta.byTitle.get(sheetTitle) || null;
}

async function ensureDashboardSheet(sheets, spreadsheetId, sheetMeta, sheetTitle) {
  const existing = getExistingDashboardSheet(sheetMeta, sheetTitle);

  if (existing && existing.properties && existing.properties.sheetId !== undefined) {
    return {
      sheetId: existing.properties.sheetId,
      created: false,
      sheet: existing
    };
  }

  const response = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              title: sheetTitle
            }
          }
        }
      ]
    }
  });

  const reply = (response.data.replies || []).find(item => item.addSheet && item.addSheet.properties);
  const sheetId = reply && reply.addSheet && reply.addSheet.properties ? reply.addSheet.properties.sheetId : null;

  return {
    sheetId,
    created: true,
    sheet: null
  };
}

function pushRowFormatRequests(requests, sheetId, rowNumber, startColumnIndex, endColumnIndex, format, fields) {
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: rowNumber - 1,
        endRowIndex: rowNumber,
        startColumnIndex,
        endColumnIndex
      },
      cell: {
        userEnteredFormat: format
      },
      fields
    }
  });
}

async function applyDashboardFormatting(sheets, spreadsheetId, sheetId, metaRows, googleRows) {
  const titleBg = { red: 0, green: 0, blue: 0 };
  const titleText = { red: 1, green: 1, blue: 1 };
  const headerMetaBg = { red: 0.09, green: 0.30, blue: 0.64 };
  const headerGoogleBg = { red: 0.13, green: 0.45, blue: 0.20 };
  const rowMetaLight = { red: 0.86, green: 0.93, blue: 1 };
  const rowMetaDark = { red: 0.94, green: 0.97, blue: 1 };
  const rowGoogleLight = { red: 0.88, green: 0.96, blue: 0.88 };
  const rowGoogleDark = { red: 0.95, green: 0.99, blue: 0.95 };
  const rowCritical = { red: 0.82, green: 0.18, blue: 0.18 };
  const rowCriticalText = { red: 1, green: 1, blue: 1 };
  const gridBorder = { style: 'SOLID', color: { red: 0.55, green: 0.55, blue: 0.55 } };

  const requests = [];

  requests.push({
    mergeCells: {
      range: {
        sheetId,
        startRowIndex: 0,
        endRowIndex: 1,
        startColumnIndex: 0,
        endColumnIndex: 3
      },
      mergeType: 'MERGE_ALL'
    }
  });

  pushRowFormatRequests(
    requests,
    sheetId,
    1,
    0,
    3,
    {
      backgroundColor: titleBg,
      textFormat: { bold: true, foregroundColor: titleText, fontSize: 14 },
      horizontalAlignment: 'LEFT',
      verticalAlignment: 'MIDDLE'
    },
    'userEnteredFormat(backgroundColor,textFormat.bold,textFormat.foregroundColor,textFormat.fontSize,horizontalAlignment,verticalAlignment)'
  );

  pushRowFormatRequests(
    requests,
    sheetId,
    1,
    3,
    4,
    {
      backgroundColor: titleBg,
      textFormat: { bold: true, foregroundColor: titleText },
      horizontalAlignment: 'LEFT',
      verticalAlignment: 'MIDDLE'
    },
    'userEnteredFormat(backgroundColor,textFormat.bold,textFormat.foregroundColor,horizontalAlignment,verticalAlignment)'
  );

  pushRowFormatRequests(
    requests,
    sheetId,
    2,
    3,
    4,
    {
      textFormat: { bold: true },
      horizontalAlignment: 'CENTER',
      verticalAlignment: 'MIDDLE'
    },
    'userEnteredFormat(textFormat.bold,horizontalAlignment,verticalAlignment)'
  );

  const metaHeaderRow = 4;
  const metaStartRow = 5;
  const googleHeaderRow = metaStartRow + metaRows.length + 1;
  const googleStartRow = googleHeaderRow + 1;

  pushRowFormatRequests(
    requests,
    sheetId,
    metaHeaderRow,
    0,
    4,
    {
      backgroundColor: headerMetaBg,
      textFormat: { bold: true, foregroundColor: titleText },
      borders: {
        top: gridBorder,
        bottom: gridBorder,
        left: gridBorder,
        right: gridBorder
      }
    },
    'userEnteredFormat(backgroundColor,textFormat.bold,textFormat.foregroundColor,borders)'
  );

  for (let i = 0; i < metaRows.length; i++) {
    const rowNumber = metaStartRow + i;
    const row = metaRows[i];
    const baseColor = row.critical ? rowCritical : (i % 2 === 0 ? rowMetaLight : rowMetaDark);
    const format = {
      backgroundColor: baseColor,
      borders: {
        top: gridBorder,
        bottom: gridBorder,
        left: gridBorder,
        right: gridBorder
      },
      textFormat: { foregroundColor: { red: 0, green: 0, blue: 0 } }
    };

    const fields = 'userEnteredFormat(backgroundColor,borders,textFormat.foregroundColor)';
    if (row.critical) {
      format.textFormat = { bold: true, foregroundColor: rowCriticalText };
    }

    pushRowFormatRequests(requests, sheetId, rowNumber, 0, 4, format, row.critical
      ? 'userEnteredFormat(backgroundColor,borders,textFormat.bold,textFormat.foregroundColor)'
      : fields);
  }

  pushRowFormatRequests(
    requests,
    sheetId,
    googleHeaderRow,
    0,
    4,
    {
      backgroundColor: headerGoogleBg,
      textFormat: { bold: true, foregroundColor: titleText },
      borders: {
        top: gridBorder,
        bottom: gridBorder,
        left: gridBorder,
        right: gridBorder
      }
    },
    'userEnteredFormat(backgroundColor,textFormat.bold,textFormat.foregroundColor,borders)'
  );

  for (let i = 0; i < googleRows.length; i++) {
    const rowNumber = googleStartRow + i;
    const row = googleRows[i];
    const baseColor = row.critical ? rowCritical : (i % 2 === 0 ? rowGoogleLight : rowGoogleDark);
    const format = {
      backgroundColor: baseColor,
      borders: {
        top: gridBorder,
        bottom: gridBorder,
        left: gridBorder,
        right: gridBorder
      },
      textFormat: { foregroundColor: { red: 0, green: 0, blue: 0 } }
    };

    const fields = 'userEnteredFormat(backgroundColor,borders,textFormat.foregroundColor)';
    if (row.critical) {
      format.textFormat = { bold: true, foregroundColor: rowCriticalText };
    }

    pushRowFormatRequests(requests, sheetId, rowNumber, 0, 4, format, row.critical
      ? 'userEnteredFormat(backgroundColor,borders,textFormat.bold,textFormat.foregroundColor)'
      : fields);
  }

  for (let col = 0; col < 4; col++) {
    requests.push({
      autoResizeDimensions: {
        dimensions: {
          sheetId,
          dimension: 'COLUMNS',
          startIndex: col,
          endIndex: col + 1
        }
      }
    });
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests }
  });
}

async function createDashboardForGestor(sheets, spreadsheetId, gestor, options = {}) {
  const sheetTitle = `${DASH_PREFIX}${gestor}`;

  try {
    const databaseRows = Array.isArray(options.databaseRows) ? options.databaseRows : [];
    const sheetMeta = options.sheetMeta || await getSheetMeta(sheets, spreadsheetId);
    const { metaRows, googleRows } = collectDashboardRows(databaseRows, gestor);
    const values = buildDashboardValues(gestor, metaRows, googleRows);

    const ensureResult = await ensureDashboardSheet(sheets, spreadsheetId, sheetMeta, sheetTitle);
    const sheetId = ensureResult.sheetId;
    if (sheetId === null || sheetId === undefined) {
      throw new Error(`Não foi possível criar a aba ${sheetTitle}.`);
    }

    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `'${sanitizeSheetName(sheetTitle)}'!A:D`
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${sanitizeSheetName(sheetTitle)}'!A1:D${values.length}`,
      valueInputOption: 'RAW',
      requestBody: { values }
    });

    await applyDashboardFormatting(sheets, spreadsheetId, sheetId, metaRows, googleRows);

    console.log(`✅ Aba ${sheetTitle} atualizada em A:D com ${metaRows.length + googleRows.length} linha(s).`);

    return {
      created: ensureResult.created,
      rebuilt: !ensureResult.created,
      sheetId,
      sheetTitle,
      metaRows: metaRows.length,
      googleRows: googleRows.length,
      totalRows: metaRows.length + googleRows.length
    };
  } catch (error) {
    console.error(`❌ Erro ao criar ${sheetTitle}:`, error.message || error);
    return { created: false, error: error.message || 'Erro desconhecido' };
  }
}

async function ensureDashboardsForAllGestores(sheets, spreadsheetId) {
  try {
    const [gestores, sheetMeta, databaseRes] = await Promise.all([
      listGestoresAtivos(sheets, spreadsheetId),
      getSheetMeta(sheets, spreadsheetId),
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'DATABASE!A2:M'
      })
    ]);

    const databaseRows = databaseRes.data.values || [];
    const resultados = [];

    for (const gestor of gestores) {
      const result = await createDashboardForGestor(sheets, spreadsheetId, gestor, {
        sheetMeta,
        databaseRows
      });

      resultados.push({
        gestor,
        status: result.error ? 'erro' : (result.rebuilt ? 'recriada' : 'criada'),
        message: result.error || (result.rebuilt ? 'Recriada' : 'Criada')
      });
    }

    return {
      ok: true,
      totalGestores: gestores.length,
      gestoresProcessados: resultados.length,
      resultados
    };
  } catch (error) {
    console.error('Erro ao assegurar dashboards para gestores:', error.message || error);
    return {
      ok: false,
      error: error.message || 'Erro desconhecido'
    };
  }
}

module.exports = {
  listGestoresAtivos,
  createDashboardForGestor,
  ensureDashboardsForAllGestores
};