require('dotenv').config({ path: '.env' });

const { getSheets } = require('./services/sheets');
const { getGoogleData } = require('./services/googleAds');
const { getMetaData } = require('./services/meta');
const { buildRow } = require('./core/calculator');
const { generateBlocosPorGestor } = require('./core/visualBlocks');
const { initTelegramBot } = require('./services/telegram');
const { scheduleAlerts } = require('./core/scheduler');
const { runChecks } = require('./validateKeys');

const DATABASE_HEADERS = [
  'Data', 'Cliente', 'Plataforma', 'Saldo', 'Gasto 7d', 'Média/dia', 'Dias restantes',
  'Gestor', 'Supervisor', 'Status', 'Obs', 'DataISO', 'Identificador'
];

function isValidGoogleCustomerId(value) {
  return /^\d{10}$/.test(String(value || '').trim());
}

function formatLastUpdatePTBR(date = new Date()) {
  const datePart = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(date);

  const timePart = new Intl.DateTimeFormat('pt-BR', {
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

async function updateWelcomeLastRun(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties(title))'
  });

  const targetSheet = (meta.data.sheets || []).find((sheet) => {
    const title = String(sheet && sheet.properties && sheet.properties.title ? sheet.properties.title : '').trim().toLowerCase();
    return title === 'bem vindo' || title === 'bem vindo!';
  });

  if (!targetSheet || !targetSheet.properties || !targetSheet.properties.title) {
    console.warn('Aba BEM VINDO não encontrada; pulando atualização de J5.');
    return false;
  }

  const safeSheetTitle = targetSheet.properties.title.replace(/'/g, "''");

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${safeSheetTitle}'!J5`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [[formatLastUpdatePTBR()]]
    }
  });

  return true;
}

async function run(options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

  const sheets = await getSheets();

  // Lê Clientes com base no cabeçalho para encontrar Revisão corretamente
  const clientesRes = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: 'Clientes!A1:Z'
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

  let output = [];

  for (let i = 0; i < clientes.length; i++) {
    const row = clientes[i];
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
        // Usar buildRow para garantir campos formatados
        data = data;
      }
    }

    // Usar buildRow para garantir campos formatados
    const rowData = data ? buildRow(cliente, plataforma, data) : null;
    output.push([
      rowData ? rowData.data : new Date().toISOString(),
      cliente,
      plataforma,
      rowData ? rowData.saldoFormatado : '-',
      rowData ? rowData.gasto7dFormatado : '-',
      rowData ? rowData.mediaFormatado : '-',
      rowData ? rowData.diasFormatado : '-',
      gestor,
      supervisor,
      processStatus,
      obs,
      new Date().toISOString(),
      rowData ? rowData.identificador : ''
    ]);

    console.log(`${cliente} processado`);

    if (onProgress) {
      await onProgress(i + 1, totalClientes, cliente);
    }
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: 'DATABASE!A1',
    valueInputOption: 'RAW',
    requestBody: {
      values: [DATABASE_HEADERS]
    }
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: 'DATABASE!A2',
    valueInputOption: 'RAW',
    requestBody: {
      values: output
    }
  });

  try {
    await updateWelcomeLastRun(sheets, process.env.SPREADSHEET_ID);
  } catch (e) {
    console.warn('Não foi possível atualizar a última execução em BEM VINDO:', e.message || e);
  }

  const spreadsheetMeta = await sheets.spreadsheets.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    fields: 'sheets(properties(sheetId,title))'
  });

  const databaseSheet = (spreadsheetMeta.data.sheets || []).find(
    s => s.properties && s.properties.title === 'DATABASE'
  );

  if (databaseSheet && databaseSheet.properties && databaseSheet.properties.sheetId !== undefined) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: process.env.SPREADSHEET_ID,
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: {
                sheetId: databaseSheet.properties.sheetId,
                startRowIndex: 0,
                endRowIndex: 1,
                startColumnIndex: 0,
                endColumnIndex: DATABASE_HEADERS.length
              },
              cell: {
                userEnteredFormat: {
                  textFormat: {
                    bold: true
                  }
                }
              },
              fields: 'userEnteredFormat.textFormat.bold'
            }
          },
          {
            repeatCell: {
              range: {
                sheetId: databaseSheet.properties.sheetId,
                startRowIndex: 1,
                endRowIndex: output.length + 1,
                startColumnIndex: 9,
                endColumnIndex: 10
              },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 0.85, green: 1, blue: 0.85 },
                  textFormat: { bold: true }
                }
              },
              fields: 'userEnteredFormat(backgroundColor,textFormat.bold)'
            }
          }
        ]
      }
    });

    const formatRequests = [];
    for (let i = 0; i < output.length; i++) {
      const statusValue = output[i][9];
      const isError = String(statusValue).toLowerCase() === 'erro';
      formatRequests.push({
        repeatCell: {
          range: {
            sheetId: databaseSheet.properties.sheetId,
            startRowIndex: i + 1,
            endRowIndex: i + 2,
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
        spreadsheetId: process.env.SPREADSHEET_ID,
        requestBody: { requests: formatRequests }
      });
    }
  }
  console.log('DATABASE atualizada');

  try {
    const removed = await deleteSheetIfExists(sheets, process.env.SPREADSHEET_ID, 'AGG_SUPERVISOR');
    if (removed) {
      console.log('AGG_SUPERVISOR removido');
    }
  } catch (e) {
    console.error('Erro ao remover AGG_SUPERVISOR:', e);
  }

  // Removido TOP10_MENOR_SALDO

  // Gerar blocos por gestor
  try {
    await generateBlocosPorGestor(sheets, process.env.SPREADSHEET_ID);
    console.log('BLOCOS_GESTOR atualizado');
  } catch (e) {
    console.error('Erro ao gerar BLOCOS_GESTOR:', e);
  }

}

async function start() {
  try {
    const checks = await runChecks();
    console.log('\n🔐 Verificação de chaves:');
    console.log(`  Env vars: ${checks.okEnv ? '✅' : '❌'}`);
    console.log(`  Google refresh token: ${checks.okGoogle ? '✅' : '❌'}`);
    console.log(`  Meta token: ${checks.okMeta ? '✅' : '❌'}`);

    if (!checks.ok) {
      console.error('\n❗ Falha na validação das chaves. Corrija as variáveis de ambiente e tente novamente.');
      process.exit(1);
    }

    console.log('\n▶️  Iniciando processamento...');
    await run();
    
    // Iniciar bot Telegram e scheduler
    const spreadsheetId = process.env.SPREADSHEET_ID;
    const botSheets = await getSheets();
    const bot = initTelegramBot(botSheets, spreadsheetId);
    if (bot) {
      // Passar a função de atualização para o scheduler
      scheduleAlerts(botSheets, spreadsheetId, () => run());
      console.log('\n🤖 Sistema de alertas Telegram ativo');
      console.log('   • Atualização de dados: a cada 2 horas');
      console.log('   • Relatórios: 8h e 17h');
    }
    
    console.log('\n✅ Execução finalizada. Aguardando próximos agendamentos...');
  } catch (e) {
    console.error('Erro na execução:', e);
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}

module.exports = {
  run,
  start
};