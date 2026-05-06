/**
 * Gestor Dashboards Generator
 * Automatically creates and updates DASH-{Gestor} sheets for each active gestor
 */

async function listGestoresAtivos(sheets, spreadsheetId) {
  try {
    const clientesRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Clientes!A1:H1000'
    });

    const values = clientesRes.data.values || [];
    const headers = values[0] || [];
    const gestorIndex = headers.findIndex(h => String(h || '').trim().toLowerCase() === 'gestor');

    if (gestorIndex < 0) {
      return [];
    }

    const gestores = new Set();
    for (let i = 1; i < values.length; i++) {
      const row = values[i] || [];
      const gestor = String(row[gestorIndex] || '').trim();
      if (gestor && gestor.length > 0) {
        gestores.add(gestor);
      }
    }

    return Array.from(gestores).sort();
  } catch (error) {
    console.error('Erro ao listar gestores ativos:', error.message || error);
    return [];
  }
}

async function getSheetTitles(sheets, spreadsheetId) {
  try {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets(properties(title))'
    });

    return (meta.data.sheets || []).map(s => s.properties && s.properties.title).filter(Boolean);
  } catch (error) {
    console.error('Erro ao obter títulos de abas:', error.message || error);
    return [];
  }
}

async function getDashFilipeTemplate(sheets, spreadsheetId) {
  try {
    const contentRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'DASH-Felipe!A1:Z'
    });

    return contentRes.data.values || [];
  } catch (error) {
    console.error('Erro ao obter template DASH-Felipe:', error.message || error);
    return [];
  }
}

async function createDashboardForGestor(sheets, spreadsheetId, gestor, templateRows) {
  const sheetTitle = `DASH-${gestor}`;

  try {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets(properties(sheetId,title))'
    });

    const existing = (meta.data.sheets || []).find(
      s => s.properties && s.properties.title === sheetTitle
    );

    if (existing) {
      console.log(`ℹ️ Aba ${sheetTitle} já existe, pulando criação`);
      return { created: false, message: 'Já existe' };
    }

    const addSheetResponse = await sheets.spreadsheets.batchUpdate({
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

    const newSheetId = addSheetResponse.data.replies[0].addSheet.properties.sheetId;

    const safeGestor = String(gestor || '').replace(/'/g, "''");
    const filterRows = [];

    for (const row of templateRows) {
      const rowCopy = [...row];
      const nameCell = rowCopy[0] || '';

      if (typeof nameCell === 'string' && nameCell.includes('=FILTER')) {
        const updatedFormula = nameCell.replace(/DASH-Felipe/g, sheetTitle);
        rowCopy[0] = updatedFormula;
      }

      filterRows.push(rowCopy);
    }

    if (filterRows.length > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${sheetTitle}'!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: filterRows
        }
      });
    }

    console.log(`✅ Aba ${sheetTitle} criada com sucesso`);
    return { created: true, message: 'Criada', sheetId: newSheetId };
  } catch (error) {
    console.error(`❌ Erro ao criar ${sheetTitle}:`, error.message || error);
    return { created: false, error: error.message || 'Erro desconhecido' };
  }
}

async function ensureDashboardsForAllGestores(sheets, spreadsheetId) {
  try {
    const gestores = await listGestoresAtivos(sheets, spreadsheetId);
    const existingTitles = await getSheetTitles(sheets, spreadsheetId);
    const templateRows = await getDashFilipeTemplate(sheets, spreadsheetId);

    const gestoresComDash = new Set();
    for (const title of existingTitles) {
      if (title.startsWith('DASH-')) {
        const gestor = title.substring(5);
        gestoresComDash.add(gestor);
      }
    }

    const resultados = [];
    for (const gestor of gestores) {
      if (gestoresComDash.has(gestor)) {
        resultados.push({ gestor, status: 'já_existe' });
      } else {
        const result = await createDashboardForGestor(sheets, spreadsheetId, gestor, templateRows);
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
  getSheetTitles,
  getDashFilipeTemplate,
  createDashboardForGestor,
  ensureDashboardsForAllGestores
};
