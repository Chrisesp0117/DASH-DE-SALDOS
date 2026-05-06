function formatCurrencyBRL(value) {
  const n = Number(value || 0);
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(n);
}

function formatDiasHoras(diasValue) {
  const totalDias = Math.max(0, Number(diasValue || 0));
  const diasInteiros = Math.floor(totalDias);
  const horas = Math.floor((totalDias - diasInteiros) * 24);
  const dd = String(diasInteiros).padStart(2, '0');
  const hh = String(horas).padStart(2, '0');
  return `${dd} dias e ${hh} horas`;
}

async function generateTop10MenorSaldo(sheets, spreadsheetId) {
    // Descobrir sheetId para autoajuste
    const metaTop10Only = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets(properties(sheetId,title))' });
    const sheetTop10Only = (metaTop10Only.data.sheets || []).find(s => s.properties && s.properties.title === 'TOP10_MENOR_SALDO');
    const sheetIdTop10 = sheetTop10Only && sheetTop10Only.properties && sheetTop10Only.properties.sheetId;
  // Read DATABASE rows
  const range = 'DATABASE!A2:N';
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const rows = res.data.values || [];
  // saldo está na coluna K (índice 10)
  const sorted = rows
    .map(r => ({
      cliente: r[1] || '',
      gestor: r[7] || '',
      supervisor: r[8] || '',
      saldo: Number(r[10] || 0),
      saldoFmt: formatCurrencyBRL(r[10]),
      gastoMedio: Number(r[12] || 0),
      gastoMedioFmt: formatCurrencyBRL(r[12]),
      dias: Number(r[13] || 0),
      diasFmt: formatDiasHoras(r[13])
    }))
    .sort((a, b) => a.saldo - b.saldo)
    .slice(0, 10);

  const HEADERS = ['Cliente', 'Gestor', 'Supervisor', 'Saldo', 'Gasto Médio', 'Duração Estimada'];
  const values = sorted.map(r => [r.cliente, r.gestor, r.supervisor, r.saldoFmt, r.gastoMedioFmt, r.diasFmt]);

  // Cria/atualiza aba TOP10_MENOR_SALDO
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        addSheet: { properties: { title: 'TOP10_MENOR_SALDO' } }
      }]
    }
  }).catch(() => {}); // ignora erro se já existe

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'TOP10_MENOR_SALDO!A1',
    valueInputOption: 'RAW',
    requestBody: { values: [HEADERS] }
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'TOP10_MENOR_SALDO!A2',
    valueInputOption: 'RAW',
    requestBody: { values }
  });

  // Formatação visual: bordas e cores alternadas em vermelho
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets(properties(sheetId,title))' });
  const sheet = (meta.data.sheets || []).find(s => s.properties && s.properties.title === 'TOP10_MENOR_SALDO');
  const sheetId = sheet && sheet.properties && sheet.properties.sheetId;
  if (sheetIdTop10 !== undefined) {
    let formatRequests = [];
    // Cabeçalho
    formatRequests.push({
      repeatCell: {
        range: { sheetId: sheetIdTop10, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: HEADERS.length },
        cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 0.8, blue: 0.8 }, textFormat: { bold: true } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat.bold)'
      }
    });
    // Linhas de dados
    for (let i = 0; i < values.length; i++) {
      const baseColor = (i % 2 === 0)
        ? { red: 1, green: 0.95, blue: 0.95 }
        : { red: 1, green: 1, blue: 1 };
      const borders = {
        top: { style: 'SOLID', color: { red: 0.7, green: 0.7, blue: 0.7 } },
        bottom: { style: 'SOLID', color: { red: 0.7, green: 0.7, blue: 0.7 } },
        left: { style: 'SOLID', color: { red: 0.7, green: 0.7, blue: 0.7 } },
        right: { style: 'SOLID', color: { red: 0.7, green: 0.7, blue: 0.7 } }
      };
      formatRequests.push({
        repeatCell: {
          range: { sheetId: sheetIdTop10, startRowIndex: i + 1, endRowIndex: i + 2, startColumnIndex: 0, endColumnIndex: HEADERS.length },
          cell: { userEnteredFormat: { backgroundColor: baseColor, borders } },
          fields: 'userEnteredFormat(backgroundColor,borders)'
        }
      });
    }
    // Autoajuste de colunas
    for (let col = 0; col < HEADERS.length; col++) {
      formatRequests.push({
        autoResizeDimensions: {
          dimensions: {
            sheetId: sheetIdTop10,
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
}

async function generateBlocosPorGestor(sheets, spreadsheetId) {
  // Read DATABASE rows
  const range = 'DATABASE!A2:L';
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const rows = res.data.values || [];
  const theme = {
    titleBg: { red: 0.08, green: 0.08, blue: 0.08 },
    googleHeaderBg: { red: 0.10, green: 0.28, blue: 0.62 },
    metaHeaderBg: { red: 0.12, green: 0.46, blue: 0.20 },
    googleRowLight: { red: 0.88, green: 0.94, blue: 1 },
    googleRowDark: { red: 0.78, green: 0.88, blue: 0.98 },
    metaRowLight: { red: 0.88, green: 0.97, blue: 0.88 },
    metaRowDark: { red: 0.78, green: 0.92, blue: 0.78 },
    // Critical low-saldo highlight
    rowCritical: { red: 1, green: 0.9, blue: 0.9 },
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
    // Novos índices: 1=Cliente, 3=Saldo, 5=Média/dia, 6=Dias restantes
    if (plataforma === 'GOOGLE' || plataforma === 'META') {
      map.get(gestor)[plataforma].push({
        cliente: r[1] || '-',
        saldo: r[3] || '-',
        gastoMedio: r[5] || '-',
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
  for (const [gestor, plataformas] of map.entries()) {
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
    values.push(['Cliente (Google)', 'Saldo', 'Gasto Médio', 'Duração', '', 'Cliente (Meta)', 'Saldo', 'Gasto Médio', 'Duração']);
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
      const g = plataformas.GOOGLE[i] || { cliente: '-', saldo: '-', gastoMedio: '-', dias: '-' };
      const m = plataformas.META[i] || { cliente: '-', saldo: '-', gastoMedio: '-', dias: '-' };
      values.push([
        g.cliente, g.saldo, g.gastoMedio, g.dias, '',
        m.cliente, m.saldo, m.gastoMedio, m.dias
      ]);

      // Função para checar se deve destacar
      function isCritical(diasStr) {
        if (!diasStr || diasStr === '-') return false;
        const diasNum = Number((diasStr + '').split(' ')[0].replace(/\D/g, ''));
        return diasNum <= 7;
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
      if (isCritical(g.dias)) {
        formatRequests.push({
          repeatCell: {
            range: { sheetId: null, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 0, endColumnIndex: 4 },
            cell: { userEnteredFormat: { backgroundColor: theme.rowCritical, borders, textFormat: { foregroundColor: theme.textDark, bold: true } } },
            fields: 'userEnteredFormat(backgroundColor,borders,textFormat.foregroundColor,textFormat.bold)'
          }
        });
      } else {
        formatRequests.push({
          repeatCell: {
            range: { sheetId: null, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 0, endColumnIndex: 4 },
            cell: { userEnteredFormat: { backgroundColor: googleBaseColor, borders } },
            fields: 'userEnteredFormat(backgroundColor,borders)'
          }
        });
      }
      // Meta: colunas 5-8
      if (isCritical(m.dias)) {
        formatRequests.push({
          repeatCell: {
            range: { sheetId: null, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 5, endColumnIndex: 9 },
            cell: { userEnteredFormat: { backgroundColor: theme.rowCritical, borders, textFormat: { foregroundColor: theme.textDark, bold: true } } },
            fields: 'userEnteredFormat(backgroundColor,borders,textFormat.foregroundColor,textFormat.bold)'
          }
        });
      } else {
        formatRequests.push({
          repeatCell: {
            range: { sheetId: null, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 5, endColumnIndex: 9 },
            cell: { userEnteredFormat: { backgroundColor: metaBaseColor, borders } },
            fields: 'userEnteredFormat(backgroundColor,borders)'
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
  }

  // Descobrir sheetId
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets(properties(sheetId,title))' });
  const sheet = (meta.data.sheets || []).find(s => s.properties && s.properties.title === 'SUPERVISOR');
  const sheetId = sheet && sheet.properties && sheet.properties.sheetId;

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
      req.repeatCell.range.sheetId = sheetId;
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
}

module.exports = { generateTop10MenorSaldo, generateBlocosPorGestor };