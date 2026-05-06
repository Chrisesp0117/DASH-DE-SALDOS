/**
 * Gestor Dashboards Generator
 *
 * The DASH-Felipe sheet is the visual reference/template.
 * New dashboards are created by duplicating it so formatting,
 * borders, colors, merged cells, widths and layout are preserved.
 */

const DASH_TEMPLATE_TITLE = 'DASH-Felipe';
const DASH_PREFIX = 'DASH-';
const DASH_LAST_UPDATE_CELL = 'J5';

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

async function getSheetMeta(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties(sheetId,title))'
  });

  const sheetList = meta.data.sheets || [];
  return {
    meta,
    sheets: sheetList,
    titles: sheetList.map(s => s.properties && s.properties.title).filter(Boolean)
  };
}

async function listGestoresAtivos(sheets, spreadsheetId) {
  try {
    const clientesRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Clientes!A1:Z'
    });

    const values = clientesRes.data.values || [];
    const headers = values[0] || [];
    const gestorIndex = headers.findIndex(h => String(h || '').trim().toLowerCase() === 'gestor');

    if (gestorIndex < 0) {
      console.warn('Coluna Gestor não encontrada na aba Clientes.');
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

function sanitizeSheetName(title) {
  return String(title || '').trim().replace(/'/g, "''");
}

async function getReferenceSheetId(sheets, spreadsheetId) {
  const { sheets: sheetList } = await getSheetMeta(sheets, spreadsheetId);
  const reference = sheetList.find(s => s.properties && s.properties.title === DASH_TEMPLATE_TITLE);
  return reference && reference.properties ? reference.properties.sheetId : null;
}

async function duplicateReferenceSheet(sheets, spreadsheetId, gestor) {
  const newSheetTitle = `${DASH_PREFIX}${gestor}`;
  const { sheets: sheetList } = await getSheetMeta(sheets, spreadsheetId);
  const existing = sheetList.find(s => s.properties && s.properties.title === newSheetTitle);

  if (existing && existing.properties && existing.properties.sheetId !== undefined) {
    return {
      created: false,
      sheetId: existing.properties.sheetId,
      sheetTitle: newSheetTitle
    };
  }

  const sourceSheetId = await getReferenceSheetId(sheets, spreadsheetId);
  if (sourceSheetId === null) {
    throw new Error(`Aba referência ${DASH_TEMPLATE_TITLE} não encontrada.`);
  }

  const response = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          duplicateSheet: {
            sourceSheetId,
            newSheetName: newSheetTitle
          }
        }
      ]
    }
  });

  const duplicated = response.data.replies && response.data.replies[0] && response.data.replies[0].duplicateSheet;
  const newSheetId = duplicated && duplicated.properties ? duplicated.properties.sheetId : null;

  return {
    created: true,
    sheetId: newSheetId,
    sheetTitle: newSheetTitle
  };
}

async function patchDuplicatedSheet(sheets, spreadsheetId, sheetId, gestor) {
  const sheetTitle = `${DASH_PREFIX}${gestor}`;
  const safeGestor = sanitizeSheetName(gestor);

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          findReplace: {
            find: DASH_TEMPLATE_TITLE,
            replacement: sheetTitle,
            sheetId,
            allSheets: false,
            includeFormulas: true,
            matchCase: false,
            matchEntireCell: false
          }
        },
        {
          findReplace: {
            find: 'Felipe',
            replacement: safeGestor,
            sheetId,
            allSheets: false,
            includeFormulas: true,
            matchCase: false,
            matchEntireCell: false
          }
        }
      ]
    }
  });
}

async function updateDashboardLastRun(sheets, spreadsheetId, sheetTitle) {
  const value = formatLastUpdatePTBR();

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${sanitizeSheetName(sheetTitle)}'!${DASH_LAST_UPDATE_CELL}`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [[value]]
    }
  });
}

async function createDashboardForGestor(sheets, spreadsheetId, gestor) {
  const sheetTitle = `${DASH_PREFIX}${gestor}`;

  try {
    const result = await duplicateReferenceSheet(sheets, spreadsheetId, gestor);

    if (result.created) {
      await patchDuplicatedSheet(sheets, spreadsheetId, result.sheetId, gestor);
      await updateDashboardLastRun(sheets, spreadsheetId, result.sheetTitle);
      console.log(`✅ Aba ${sheetTitle} criada a partir da referência ${DASH_TEMPLATE_TITLE}`);
      return { created: true, message: 'Criada', sheetId: result.sheetId };
    }

    await updateDashboardLastRun(sheets, spreadsheetId, result.sheetTitle);
    console.log(`ℹ️ Aba ${sheetTitle} já existia; última atualização ajustada.`);
    return { created: false, message: 'Já existe', sheetId: result.sheetId };
  } catch (error) {
    console.error(`❌ Erro ao criar ${sheetTitle}:`, error.message || error);
    return { created: false, error: error.message || 'Erro desconhecido' };
  }
}

async function ensureDashboardsForAllGestores(sheets, spreadsheetId) {
  try {
    const gestores = await listGestoresAtivos(sheets, spreadsheetId);
    const { titles: existingTitles } = await getSheetMeta(sheets, spreadsheetId);

    const gestoresComDash = new Set();
    for (const title of existingTitles) {
      if (title.startsWith(DASH_PREFIX)) {
        gestoresComDash.add(title.substring(DASH_PREFIX.length));
      }
    }

    const resultados = [];
    for (const gestor of gestores) {
      const sheetTitle = `${DASH_PREFIX}${gestor}`;

      if (gestoresComDash.has(gestor)) {
        await updateDashboardLastRun(sheets, spreadsheetId, sheetTitle);
        resultados.push({ gestor, status: 'já_existe' });
      } else {
        const result = await createDashboardForGestor(sheets, spreadsheetId, gestor);
        resultados.push({ gestor, status: result.created ? 'criada' : 'erro', message: result.message || result.error });
      }
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