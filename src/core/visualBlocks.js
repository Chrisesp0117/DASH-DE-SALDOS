const { readDatabaseRows } = require('../services/supabase');

function parseLocaleNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const raw = String(value || '').trim();
  if (!raw) return 0;
  let cleaned = raw.replace(/[^\d,.-]/g, '');
  if (!cleaned) return 0;
  if (cleaned.includes(',') && cleaned.includes('.')) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (cleaned.includes(',')) {
    cleaned = cleaned.replace(',', '.');
  }
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function parseDias(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const text = String(value || '').trim().toLowerCase();
  if (!text || text === '-') return null;
  const diasMatch = text.match(/(\d+)\s*dias?/i);
  const horasMatch = text.match(/(\d+)\s*horas?/i);
  if (diasMatch || horasMatch) {
    const dias = diasMatch ? Number(diasMatch[1]) : 0;
    const horas = horasMatch ? Number(horasMatch[1]) : 0;
    return dias + horas / 24;
  }
  const numeric = parseLocaleNumber(text);
  return Number.isFinite(numeric) ? numeric : null;
}

async function generateBlocosPorGestor(sheets, spreadsheetId) {
  // Read DATABASE rows from Supabase
  const rows = await readDatabaseRows();
  
  // SAFETY CHECK: If DATABASE is empty, don't overwrite SUPERVISOR/DASH with empty data
  if (!rows || rows.length === 0) {
    console.warn('⚠️ DATABASE está vazia - pulando geração de SUPERVISOR para evitar apagar dados');
    return {
      ok: true,
      skipped: true,
      reason: 'database_empty',
      blocks: [],
      totalGestores: 0
    };
  }
  
  const theme = {
    titleBg: { red: 0.08, green: 0.08, blue: 0.08 },
    metaHeaderBg: { red: 0.10, green: 0.28, blue: 0.62 },
    googleHeaderBg: { red: 0.12, green: 0.46, blue: 0.20 },
    metaRowLight: { red: 0.88, green: 0.94, blue: 1 },
    metaRowDark: { red: 0.78, green: 0.88, blue: 0.98 },
    googleRowLight: { red: 0.88, green: 0.97, blue: 0.88 },
    googleRowDark: { red: 0.78, green: 0.92, blue: 0.78 },
    // Critical low-saldo highlight
    rowCritical: { red: 0.82, green: 0.18, blue: 0.18 },
    separator: { red: 0.78, green: 0.78, blue: 0.78 },
    border: { red: 0.55, green: 0.55, blue: 0.55 },
    textDark: { red: 0, green: 0, blue: 0 },
    textLight: { red: 1, green: 1, blue: 1 }
  };
  // Agrupa por gestor e plataforma
  const map = new Map();
  for (const r of rows) {
    const gestor = (r[7] || '').trim() || 'Sem Gestor';
    const plataforma = (r[2] || '').trim().toUpperCase();
    if (!map.has(gestor)) map.set(gestor, { GOOGLE: [], META: [] });
    // Novos índices: 1=Cliente, 3=Saldo, 4=Gasto Ontem, 6=Dias restantes
    if (plataforma === 'GOOGLE' || plataforma === 'META') {
      map.get(gestor)[plataforma].push({
        cliente: r[1] || '-',
        saldo: r[3] || '-',
        gastoOntem: r[4] || '-',
        dias: r[6] || '-'
      });
    }
  }

  // Cria/atualiza aba SUPERVISOR
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        addSheet: { properties: { title: 'SUPERVISOR' } }
      }]
    }
  }).catch(() => {});

  // Monta saída visual: um bloco por gestor, duas colunas (Google/Meta)
  let values = [];
  let formatRequests = [];
  let rowIdx = 0;
  const blocks = [];
  for (const [gestor, plataformas] of map.entries()) {
    const blockStartRowIndex = rowIdx;
    // Bloco do gestor
    values.push([`Gestor: ${gestor}`]);
    formatRequests.push({
      repeatCell: {
        range: { sheetId: null, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 0, endColumnIndex: 9 },
        cell: { userEnteredFormat: { backgroundColor: theme.titleBg, textFormat: { bold: true, foregroundColor: theme.textLight } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat.bold,textFormat.foregroundColor)'
      }
    });
    rowIdx++;
    // Cabeçalho
    values.push(['Cliente (Google)', 'Saldo', 'Gasto Ontem', 'Duração', '', 'Cliente (Meta)', 'Saldo', 'Gasto Ontem', 'Duração']);
    formatRequests.push(
      {
        repeatCell: {
          range: { sheetId: null, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 0, endColumnIndex: 4 },
          cell: { userEnteredFormat: { backgroundColor: theme.googleHeaderBg, textFormat: { bold: true, foregroundColor: theme.textLight } } },
          fields: 'userEnteredFormat(backgroundColor,textFormat.bold,textFormat.foregroundColor)'
        }
      },
      {
        repeatCell: {
          range: { sheetId: null, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 5, endColumnIndex: 9 },
          cell: { userEnteredFormat: { backgroundColor: theme.metaHeaderBg, textFormat: { bold: true, foregroundColor: theme.textLight } } },
          fields: 'userEnteredFormat(backgroundColor,textFormat.bold,textFormat.foregroundColor)'
        }
      }
    );
    rowIdx++;
    // Dados com cores alternadas e bordas
    const maxLen = Math.max(plataformas.GOOGLE.length, plataformas.META.length);
    for (let i = 0; i < maxLen; i++) {
      const g = plataformas.GOOGLE[i] || { cliente: '-', saldo: '-', gastoOntem: '-', dias: '-' };
      const m = plataformas.META[i] || { cliente: '-', saldo: '-', gastoOntem: '-', dias: '-' };
      values.push([
        g.cliente, g.saldo, g.gastoOntem, g.dias, '',
        m.cliente, m.saldo, m.gastoOntem, m.dias
      ]);

      // Função para checar se deve destacar
      function isCritical(diasValue, gastoOntemValue) {
        if ((!diasValue || diasValue === '-') && (!gastoOntemValue || gastoOntemValue === '-')) return false;
        const diasNum = parseDias(diasValue);
        const gastoOntemNum = parseLocaleNumber(gastoOntemValue);
        return (diasNum !== null && diasNum <= 7) || (gastoOntemNum !== null && gastoOntemNum <= 0);
      }
      // Cores base por plataforma
      const googleBaseColor = (i % 2 === 0) ? theme.googleRowLight : theme.googleRowDark;
      const metaBaseColor = (i % 2 === 0) ? theme.metaRowLight : theme.metaRowDark;
      // Bordas padrão
      const borders = {
        top: { style: 'SOLID', color: theme.border },
        bottom: { style: 'SOLID', color: theme.border },
        left: { style: 'SOLID', color: theme.border },
        right: { style: 'SOLID', color: theme.border }
      };
      // Google: colunas 0-3
      if (isCritical(g.dias, g.gastoOntem)) {
        formatRequests.push({
          repeatCell: {
            range: { sheetId: null, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 0, endColumnIndex: 4 },
            cell: { userEnteredFormat: { backgroundColor: theme.rowCritical, borders, textFormat: { foregroundColor: theme.textLight, bold: true } } },
            fields: 'userEnteredFormat(backgroundColor,borders,textFormat.foregroundColor,textFormat.bold)'
          }
        });
      } else {
        formatRequests.push({
          repeatCell: {
            range: { sheetId: null, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 0, endColumnIndex: 4 },
            cell: { userEnteredFormat: { backgroundColor: googleBaseColor, borders, textFormat: { foregroundColor: theme.textDark, bold: false } } },
            fields: 'userEnteredFormat(backgroundColor,borders,textFormat.foregroundColor,textFormat.bold)'
          }
        });
      }
      // Meta: colunas 5-8
      if (isCritical(m.dias, m.gastoOntem)) {
        formatRequests.push({
          repeatCell: {
            range: { sheetId: null, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 5, endColumnIndex: 9 },
            cell: { userEnteredFormat: { backgroundColor: theme.rowCritical, borders, textFormat: { foregroundColor: theme.textLight, bold: true } } },
            fields: 'userEnteredFormat(backgroundColor,borders,textFormat.foregroundColor,textFormat.bold)'
          }
        });
      } else {
        formatRequests.push({
          repeatCell: {
            range: { sheetId: null, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 5, endColumnIndex: 9 },
            cell: { userEnteredFormat: { backgroundColor: metaBaseColor, borders, textFormat: { foregroundColor: theme.textDark, bold: false } } },
            fields: 'userEnteredFormat(backgroundColor,borders,textFormat.foregroundColor,textFormat.bold)'
          }
        });
      }
      // Coluna separadora
      formatRequests.push({
        repeatCell: {
          range: { sheetId: null, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 4, endColumnIndex: 5 },
          cell: { userEnteredFormat: { backgroundColor: theme.separator, borders } },
          fields: 'userEnteredFormat(backgroundColor,borders)'
        }
      });
      rowIdx++;
    }
    // Linha em branco entre blocos
    values.push(['']);
    rowIdx++;

    blocks.push({
      gestor,
      startRowIndex: blockStartRowIndex,
      endRowIndex: rowIdx,
      rowCount: rowIdx - blockStartRowIndex
    });
  }

  // Descobrir sheetId
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets(properties(sheetId,title))' });
  const sheet = (meta.data.sheets || []).find(s => s.properties && s.properties.title === 'SUPERVISOR');
  const sheetId = sheet && sheet.properties && sheet.properties.sheetId;

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: 'SUPERVISOR!A1:Z'
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'SUPERVISOR!A1',
    valueInputOption: 'RAW',
    requestBody: { values }
  });

  // Aplicar formatação visual
  if (sheetId !== undefined) {
    // Atualiza sheetId nos requests
    for (const req of formatRequests) {
      if (req.repeatCell && req.repeatCell.range && (req.repeatCell.range.sheetId === null || req.repeatCell.range.sheetId === undefined)) {
        req.repeatCell.range.sheetId = sheetId;
      }
    }
    // Autoajuste de colunas (9 colunas)
    for (let col = 0; col < 9; col++) {
      formatRequests.push({
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
      requestBody: { requests: formatRequests }
    });
  }

  return {
    ok: true,
    sheetId,
    sheetTitle: 'SUPERVISOR',
    blocks,
    totalGestores: blocks.length
  };
}

module.exports = { generateBlocosPorGestor };