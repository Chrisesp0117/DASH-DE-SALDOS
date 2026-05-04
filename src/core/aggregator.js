function formatCurrencyBRL(value) {
  const n = Number(value || 0);
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(n);
}

function parseNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function ensureSheet(sheets, spreadsheetId, title) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets(properties(sheetId,title))' });
  const existing = (meta.data.sheets || []).find(s => s.properties && s.properties.title === title);
  if (existing) return existing.properties.sheetId;

  const resp = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        { addSheet: { properties: { title } } }
      ]
    }
  });

  const added = resp.data.replies && resp.data.replies[0] && resp.data.replies[0].addSheet;
  return added && added.properties && added.properties.sheetId;
}

async function generateSupervisorAgg(sheets, spreadsheetId) {
  // Read DATABASE rows
  const range = 'DATABASE!A2:O';
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const rows = res.data.values || [];

  const map = new Map();

  for (const r of rows) {
    const supervisor = (r[8] || '').trim() || 'Sem Supervisor'; // col I (0-based 8)
    const gestor = (r[7] || '').trim() || '';
    const saldo = parseNum(r[10]);
    const gasto7d = parseNum(r[11]);
    const media = parseNum(r[12]);
    const dias = parseNum(r[13]);
    const updated = r[14] || '';

    if (!map.has(supervisor)) map.set(supervisor, { supervisor, gestores: new Set(), clientes: 0, totalSaldo: 0, totalGasto7d: 0, sumMedia: 0, sumDias: 0, lastUpdate: '' });

    const entry = map.get(supervisor);
    entry.gestores.add(gestor);
    entry.clientes += 1;
    entry.totalSaldo += saldo;
    entry.totalGasto7d += gasto7d;
    entry.sumMedia += media;
    entry.sumDias += dias;
    if (updated && (!entry.lastUpdate || updated > entry.lastUpdate)) entry.lastUpdate = updated;
  }

  const rowsOut = [];
  for (const [, v] of map) {
    const avgMedia = v.clientes ? v.sumMedia / v.clientes : 0;
    const avgDias = v.clientes ? v.sumDias / v.clientes : 0;
    rowsOut.push([
      v.supervisor,
      Array.from(v.gestores).join(', '),
      v.clientes,
      formatCurrencyBRL(v.totalSaldo),
      formatCurrencyBRL(v.totalGasto7d),
      formatCurrencyBRL(avgMedia),
      `${Math.round(avgDias*100)/100}`,
      v.lastUpdate,
      v.totalSaldo,
      v.totalGasto7d,
      avgMedia,
      avgDias
    ]);
  }

  const sheetId = await ensureSheet(sheets, spreadsheetId, 'AGG_SUPERVISOR');

  const HEADERS = ['Supervisor', 'Gestores', 'Clientes', 'TotalSaldo', 'TotalGasto7d', 'MediaDia', 'MediaDiasRestantes', 'LastUpdate', 'TotalSaldo_num', 'TotalGasto7d_num', 'MediaDia_num', 'MediaDias_num'];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'AGG_SUPERVISOR!A1',
    valueInputOption: 'RAW',
    requestBody: { values: [HEADERS] }
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'AGG_SUPERVISOR!A2',
    valueInputOption: 'RAW',
    requestBody: { values: rowsOut }
  });

  // Bold headers
  if (sheetId !== undefined) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: HEADERS.length },
              cell: { userEnteredFormat: { textFormat: { bold: true } } },
              fields: 'userEnteredFormat.textFormat.bold'
            }
          }
        ]
      }
    });
  }

  return { rows: rowsOut.length };
}

module.exports = { generateSupervisorAgg };
