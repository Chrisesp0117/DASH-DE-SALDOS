/**
 * Gestor Dashboards Generator
 *
 * Each DASH-{Gestor} sheet is generated from scratch using DATABASE rows.
 * DASH-Felipe is only a visual reference for the manual layout.
 */

const { generateBlocosPorGestor } = require('./visualBlocks');
const { readDatabaseRows } = require('../services/supabase');

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

function origemLabel(triggeredBy) {
  const raw = String(triggeredBy || '').trim().toLowerCase();
  if (raw === 'manual' || raw.startsWith('manual')) return 'Manual';
  return 'Automático';
}

function formatLastUpdateWithOrigem(triggeredBy, date = new Date()) {
  return `${formatLastUpdatePTBR(date)} (${origemLabel(triggeredBy)})`;
}

// Helper para retry com backoff em operações do Google Sheets
async function retryWithBackoff(operation, maxAttempts = 4, name = 'operation') {
  let attempt = 0;
  while (attempt < maxAttempts) {
    try {
      return await operation();
    } catch (err) {
      const msg = String(err && (err.message || err.code || err.status) || '').toLowerCase();
      const isQuota = msg.includes('quota exceeded') || msg.includes('resource_exhausted') || String(err && err.status) === '429' || String(err && err.code) === '429';
      attempt += 1;
      if (isQuota && attempt < maxAttempts) {
        const wait = Math.pow(2, attempt) * 1000;
        console.warn(`[${name}] Quota 429 recebido, retry em ${wait}ms (tentativa ${attempt}/${maxAttempts})`);
        await new Promise(resolve => setTimeout(resolve, wait));
        continue;
      }
      throw err;
    }
  }
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

    return Array.from(gestores);
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

function parseLocaleNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const raw = String(value || '').trim();
  if (!raw) {
    return null;
  }

  let cleaned = raw.replace(/[^\d,.-]/g, '');
  if (!cleaned) {
    return null;
  }

  if (cleaned.includes(',') && cleaned.includes('.')) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (cleaned.includes(',')) {
    cleaned = cleaned.replace(',', '.');
  }

  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : null;
}

function isCriticalRow(row) {
  const dias = parseDiasRestantes(row.duracao);
  const gastoOntem = parseLocaleNumber(row.gastoOntem);
  return (dias !== null && dias <= 7) || (gastoOntem !== null && gastoOntem <= 0);
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
      gastoOntem: parseLocaleNumber(row[5]),
      critical: isCriticalRow({ duracao: row[6], gastoOntem: row[5] })
    };

    if (plataforma === 'META') {
      metaRows.push(item);
    } else {
      googleRows.push(item);
    }
  }

  return { metaRows, googleRows };
}

function buildDashboardValues(gestor, metaRows, googleRows, triggeredBy) {
  const values = [];
  const pushRow = (row) => values.push([row[0] || '', row[1] || '', row[2] || '', row[3] || '']);

  pushRow([`Gestor: ${gestor}`, '', '', 'Última Atualização:']);
  pushRow(['', '', '', formatLastUpdateWithOrigem(triggeredBy)]);
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

  const response = await retryWithBackoff(
    () => sheets.spreadsheets.batchUpdate({
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
    }),
    4,
    'ensureDashboardSheet'
  );

  const reply = (response.data.replies || []).find(item => item.addSheet && item.addSheet.properties);
  const sheetId = reply && reply.addSheet && reply.addSheet.properties ? reply.addSheet.properties.sheetId : null;

  return {
    sheetId,
    created: true,
    sheet: null
  };
}

async function mirrorSupervisorBlockToDashboard(sheets, spreadsheetId, sheetMeta, sourceSheetId, sourceBlock, sheetTitle) {
  const ensureResult = await ensureDashboardSheet(sheets, spreadsheetId, sheetMeta, sheetTitle);
  const targetSheetId = ensureResult.sheetId;

  if (targetSheetId === null || targetSheetId === undefined) {
    throw new Error(`Não foi possível criar a aba ${sheetTitle}.`);
  }

  if (!sourceBlock || !Number.isFinite(sourceBlock.startRowIndex) || !Number.isFinite(sourceBlock.endRowIndex)) {
    throw new Error(`Bloco de origem inválido para ${sheetTitle}.`);
  }

  const height = Math.max(1, sourceBlock.endRowIndex - sourceBlock.startRowIndex);

  // Only clear columns A-D in DASH sheets to preserve other columns
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `'${sanitizeSheetName(sheetTitle)}'!A:D`
  });

  await retryWithBackoff(
    () => sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            copyPaste: {
              source: {
                sheetId: sourceSheetId,
                startRowIndex: sourceBlock.startRowIndex,
                endRowIndex: sourceBlock.endRowIndex,
                startColumnIndex: 0,
                endColumnIndex: 4
              },
              destination: {
                sheetId: targetSheetId,
                startRowIndex: 0,
                startColumnIndex: 0
              },
              pasteType: 'PASTE_NORMAL',
              pasteOrientation: 'NORMAL'
            }
          }
        ]
      }
    }),
    4,
    'mirrorSupervisorBlockToDashboard'
  );

  return {
    created: ensureResult.created,
    rebuilt: !ensureResult.created,
    sheetId: targetSheetId,
    sheetTitle,
    totalRows: height,
    mirrored: true
  };
}

/**
 * Clears all data from DASH-{Gestor} sheets to ensure clean state before atomic rewrite.
 * IMPORTANT: Clears the full dashboard writing area (A:I) so old mirrored blocks
 * do not survive when the layout changes or a previous write was interrupted.
 * NOTE: SUPERVISOR is intentionally NOT cleared here — it must remain intact so that
 * mirrorSupervisorBlockToDashboard can copy from it in the same atomic refresh cycle.
 */
async function clearAllDashboardData(sheets, spreadsheetId, gestores = []) {
  const sheetMeta = await getSheetMeta(sheets, spreadsheetId);
  const clearRequests = [];

  // Clear only columns A-D in all DASH-{Gestor} sheets (preserve other columns)
  for (const gestor of gestores) {
    const sheetTitle = `${DASH_PREFIX}${gestor}`;
    const sheet = sheetMeta.byTitle.get(sheetTitle);
    if (sheet && sheet.properties && sheet.properties.sheetId !== null) {
      clearRequests.push({
        sheetId: sheet.properties.sheetId,
        range: `'${sanitizeSheetName(sheetTitle)}'!A:D`
      });
    }
  }

  // Execute all clear operations in parallel
  if (clearRequests.length > 0) {
    for (const clearReq of clearRequests) {
      await sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: clearReq.range
      });
    }
  }

  return { ok: true, cleared: clearRequests.length };
}

/**
 * Atomic refresh: clear all dashboards, regenerate SUPERVISOR, rewrite all DASH sheets
 * Prevents partial write errors by doing delete + full rewrite as a single operation
 */
async function atomicRefreshAllDashboards(sheets, spreadsheetId, options = {}) {
  try {
    // Step 1: Generate supervisor with all blocks, unless a fresh result was already provided
    const supervisorResult = options.supervisorResult || await generateBlocosPorGestor(sheets, spreadsheetId);
    
    // SAFETY CHECK: If SUPERVISOR generation was skipped (database empty), don't update DASH sheets
    if (supervisorResult.skipped) {
      console.warn('⚠️ Pulando atualização atômica de dashboards - DATABASE está vazia');
      return {
        ok: true,
        skipped: true,
        reason: supervisorResult.reason || 'database_empty',
        totalGestores: 0,
        gestoresProcessados: 0
      };
    }
    
    if (!supervisorResult || supervisorResult.ok === false) {
      return {
        ok: false,
        error: 'Não foi possível gerar o bloco do SUPERVISOR.'
      };
    }

    // Step 2: Get all gestores
    const gestores = (supervisorResult.blocks || []).map(b => b.gestor);

    // Step 3: Clear all dashboards at once
    await clearAllDashboardData(sheets, spreadsheetId, gestores);

    // Step 4: Read DATABASE rows from Supabase to build DASH sheets with both Meta and Google
    const databaseRows = await readDatabaseRows();

    // Step 5: Rebuild each DASH sheet from DATABASE rows (vertical Meta+Google layout)
    const sheetMeta = await getSheetMeta(sheets, spreadsheetId);

    const resultados = [];
    for (const gestor of gestores) {
      const result = await createDashboardForGestor(sheets, spreadsheetId, gestor, {
        sheetMeta,
        databaseRows,
        triggeredBy: options.triggeredBy
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
      resultados,
      atomic: true
    };
  } catch (error) {
    console.error('Erro ao fazer refresh atômico dos dashboards:', error.message || error);
    return {
      ok: false,
      error: error.message || 'Erro desconhecido',
      atomic: true
    };
  }
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
      textFormat: { foregroundColor: { red: 0, green: 0, blue: 0 }, bold: false }
    };

    const fields = 'userEnteredFormat(backgroundColor,borders,textFormat.foregroundColor,textFormat.bold)';
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
      textFormat: { foregroundColor: { red: 0, green: 0, blue: 0 }, bold: false }
    };

    const fields = 'userEnteredFormat(backgroundColor,borders,textFormat.foregroundColor,textFormat.bold)';
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

  await retryWithBackoff(
    () => sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests }
    }),
    4,
    'updateDashboardFormatting'
  );
}

async function createDashboardForGestor(sheets, spreadsheetId, gestor, options = {}) {
  const sheetTitle = `${DASH_PREFIX}${gestor}`;

  try {
    const sheetMeta = options.sheetMeta || await getSheetMeta(sheets, spreadsheetId);
    const sourceSheet = sheetMeta.byTitle.get('SUPERVISOR') || null;

    if (options.sourceSheetId && options.sourceBlock) {
      const mirrored = await mirrorSupervisorBlockToDashboard(
        sheets,
        spreadsheetId,
        sheetMeta,
        options.sourceSheetId,
        options.sourceBlock,
        sheetTitle
      );

      console.log(`✅ Aba ${sheetTitle} espelhada a partir do SUPERVISOR.`);

      return {
        created: mirrored.created,
        rebuilt: mirrored.rebuilt,
        sheetId: mirrored.sheetId,
        sheetTitle,
        totalRows: mirrored.totalRows,
        mirrored: true
      };
    }

    const databaseRows = Array.isArray(options.databaseRows) ? options.databaseRows : [];
    const { metaRows, googleRows } = collectDashboardRows(databaseRows, gestor);
    const values = buildDashboardValues(gestor, metaRows, googleRows, options.triggeredBy);

    const ensureResult = await ensureDashboardSheet(sheets, spreadsheetId, sheetMeta, sheetTitle);
    const sheetId = ensureResult.sheetId;
    if (sheetId === null || sheetId === undefined) {
      throw new Error(`Não foi possível criar a aba ${sheetTitle}.`);
    }

    console.log(`[gestorDashboards] preparando atualização do DASH para gestor=${gestor} | metaRows=${metaRows.length} googleRows=${googleRows.length} values=${values.length} created=${ensureResult.created}`);

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

async function ensureDashboardsForAllGestores(sheets, spreadsheetId, options = {}) {
  try {
    const supervisorResult = options.supervisorResult || await generateBlocosPorGestor(sheets, spreadsheetId);
    
    // SAFETY CHECK: If SUPERVISOR generation was skipped (database empty), don't update DASH sheets
    if (supervisorResult.skipped) {
      console.warn('⚠️ Pulando atualização de dashboards - DATABASE está vazia');
      return {
        ok: true,
        skipped: true,
        reason: supervisorResult.reason || 'database_empty',
        totalGestores: 0,
        gestoresProcessados: 0,
        resultados: []
      };
    }
    
    if (!supervisorResult || supervisorResult.ok === false) {
      return {
        ok: false,
        error: 'Não foi possível gerar o bloco do SUPERVISOR.'
      };
    }

    const sheetMeta = await getSheetMeta(sheets, spreadsheetId);
    const blocksByGestor = new Map((supervisorResult.blocks || []).map(block => [block.gestor, block]));
    const gestores = Array.from(blocksByGestor.keys());

    // Clear all dashboards BEFORE rewriting to avoid stale duplicated blocks
    await clearAllDashboardData(sheets, spreadsheetId, gestores);

    const databaseRows = await readDatabaseRows();

    const resultados = [];

    for (const gestor of gestores) {
      console.log(`[gestorDashboards] criando dashboard para gestor=${gestor} (atomic)`);
      const result = await createDashboardForGestor(sheets, spreadsheetId, gestor, {
        sheetMeta,
        databaseRows,
        triggeredBy: options.triggeredBy
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
  ensureDashboardsForAllGestores,
  clearAllDashboardData,
  atomicRefreshAllDashboards
};
