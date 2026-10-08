const { readDatabaseRows } = require('../services/supabase');
const { getRowSeverity, SEVERITY_STYLES } = require('./severity');

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
    // Destaques de severidade (amarelo/laranja/vermelho) vêm de ./severity.js
    separator: { red: 0.78, green: 0.78, blue: 0.78 },
    border: { red: 0.55, green: 0.55, blue: 0.55 },
    textDark: { red: 0, green: 0, blue: 0 },
    textLight: { red: 1, green: 1, blue: 1 }
  };
  // Agrupa por gestor e plataforma
  const map = new Map();
  for (const r of rows) {
    // Ignora linhas residuais sem cliente (ex.: sobras antigas na DATABASE).
    // Sem isso, elas criam um bloco "Sem Gestor" fantasma no SUPERVISOR
    // e, consequentemente, a aba DASH-Sem Gestor a cada atualização.
    if (!String(r[1] || '').trim()) continue;
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

      // Severidade compartilhada com as abas DASH (amarelo/laranja/vermelho)
      const gSeverity = getRowSeverity({ dias: g.dias, gastoOntem: g.gastoOntem });
      const mSeverity = getRowSeverity({ dias: m.dias, gastoOntem: m.gastoOntem });
      // Cores base por plataforma (zebra)
      const googleBaseColor = (i % 2 === 0) ? theme.googleRowLight : theme.googleRowDark;
      const metaBaseColor = (i % 2 === 0) ? theme.metaRowLight : theme.metaRowDark;
      // Bordas padrão
      const borders = {
        top: { style: 'SOLID', color: theme.border },
        bottom: { style: 'SOLID', color: theme.border },
        left: { style: 'SOLID', color: theme.border },
        right: { style: 'SOLID', color: theme.border }
      };
      // Aplica severidade (ou zebra da plataforma): Google colunas 0-3, Meta colunas 5-8
      const applyRowStyle = (severity, baseColor, startColumnIndex) => {
        const style = severity ? SEVERITY_STYLES[severity] : null;
        formatRequests.push({
          repeatCell: {
            range: { sheetId: null, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex, endColumnIndex: startColumnIndex + 4 },
            cell: {
              userEnteredFormat: {
                backgroundColor: style ? style.background : baseColor,
                borders,
                textFormat: style
                  ? { foregroundColor: style.foreground, bold: true }
                  : { foregroundColor: theme.textDark, bold: false }
              }
            },
            fields: 'userEnteredFormat(backgroundColor,borders,textFormat.foregroundColor,textFormat.bold)'
          }
        });
      };
      applyRowStyle(gSeverity, googleBaseColor, 0); // Google
      applyRowStyle(mSeverity, metaBaseColor, 5);  // Meta
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