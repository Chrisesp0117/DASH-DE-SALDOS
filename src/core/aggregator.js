function formatCurrencyBRL(value) {
  const n = Number(value || 0);
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(n);
}

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
  if (!text || text === '-') return 0;
  const diasMatch = text.match(/(\d+)\s*dias?/i);
  const horasMatch = text.match(/(\d+)\s*horas?/i);
  if (diasMatch || horasMatch) {
    const dias = diasMatch ? Number(diasMatch[1]) : 0;
    const horas = horasMatch ? Number(horasMatch[1]) : 0;
    return dias + horas / 24;
  }
  return parseLocaleNumber(text);
}

async function ensureSheet(sheets, spreadsheetId, title) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets(properties(sheetId,title))' });
  const existing = (meta.data.sheets || []).find(s => s.properties && s.properties.title === title);
  if (existing) return existing.properties.sheetId;

  const maxAttempts = 4;
  let attempt = 0;
  while (attempt < maxAttempts) {
    try {
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
    } catch (err) {
      const msg = String(err && (err.message || err.code || err.status) || '').toLowerCase();
      const isQuota = msg.includes('quota exceeded') || msg.includes('resource_exhausted') || String(err && err.status) === '429' || String(err && err.code) === '429';
      attempt += 1;
      if (isQuota && attempt < maxAttempts) {
        const wait = Math.pow(2, attempt) * 1000;
        console.warn(`[ensureSheet] Quota 429 recebido, retry em ${wait}ms (tentativa ${attempt}/${maxAttempts})`);
        await new Promise(resolve => setTimeout(resolve, wait));
        continue;
      }
      throw err;
    }
  }
}

async function generateSupervisorAgg(sheets, spreadsheetId) {
  // Read DATABASE rows
  const range = 'DATABASE!A2:M';
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const rows = res.data.values || [];

  const map = new Map();

  for (const r of rows) {
    const supervisor = (r[8] || '').trim() || 'Sem Supervisor'; // col I (0-based 8)
    const gestor = (r[7] || '').trim() || '';
    const saldo = parseLocaleNumber(r[3]);
    const gasto7d = parseLocaleNumber(r[4]);
    const media = parseLocaleNumber(r[5]);
    const dias = parseDias(r[6]);
    const updated = r[11] || r[0] || '';

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
    const maxAttempts = 4;
    let attempt = 0;
    while (attempt < maxAttempts) {
      try {
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
              },
              {
                autoResizeDimensions: {
                  dimensions: {
                    sheetId,
                    dimension: 'COLUMNS',
                    startIndex: 0,
                    endIndex: HEADERS.length
                  }
                }
              }
            ]
          }
        });
        break;
      } catch (err) {
        const msg = String(err && (err.message || err.code || err.status) || '').toLowerCase();
        const isQuota = msg.includes('quota exceeded') || msg.includes('resource_exhausted') || String(err && err.status) === '429' || String(err && err.code) === '429';
        attempt += 1;
        if (isQuota && attempt < maxAttempts) {
          const wait = Math.pow(2, attempt) * 1000;
          console.warn(`[generateSupervisorAgg-format] Quota 429 recebido, retry em ${wait}ms (tentativa ${attempt}/${maxAttempts})`);
          await new Promise(resolve => setTimeout(resolve, wait));
          continue;
        }
        throw err;
      }
    }
  }

  return { rows: rowsOut.length };
}

module.exports = { generateSupervisorAgg };
