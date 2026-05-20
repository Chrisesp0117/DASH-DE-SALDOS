require('dotenv').config({ path: '.env' });
const fs = require('fs');
const { google } = require('googleapis');

async function resetJobState() {
  const creds = JSON.parse(fs.readFileSync('credentials.json','utf8'));
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets({ version: 'v4', auth });
  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: 'JOB_STATE!A1:P1',
    valueInputOption: 'RAW',
    requestBody: { values: [[ 'idle', '', '0', '0', '0', '0', '0', '0', '', '', '', '', '', '', '', '' ]] }
  });
  console.log('[RESET] JOB_STATE resetado para idle/0');
}

async function main(){
  try{
    await resetJobState();
    const { run } = require('./src/run');
    
    console.log('\n=== BATCH 1: Processar 30 clientes ===\n');
    let stopAt = 30;
    const result1 = await run({
      batchSize: 10,
      skipDashboards: true,
      onProgress: (cursor, total, cliente) => {
        console.log(`[progress] ${cursor}/${total} - ${cliente}`);
        if (cursor >= stopAt) {
          throw new Error('stop-for-test');
        }
      }
    });
    console.log('[BATCH1-END]', result1);

    console.log('\n=== PAUSA 2 segundos ===\n');
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('\n=== BATCH 2: Retomar de 30 até 60 clientes ===\n');
    stopAt = 60;
    const result2 = await run({
      batchSize: 10,
      skipDashboards: true,
      onProgress: (cursor, total, cliente) => {
        console.log(`[progress] ${cursor}/${total} - ${cliente}`);
        if (cursor >= stopAt) {
          throw new Error('stop-for-test');
        }
      }
    });
    console.log('[BATCH2-END]', result2);

    console.log('\n✅ Teste completado com sucesso!');
  }catch(e){
    console.error('[ERROR]', e && e.message ? e.message : e);
    if (e && e.message && e.message.includes('stop-for-test')) {
      console.log('[INFO] Parada normal no teste');
      process.exit(0);
    }
    process.exit(1);
  }
}

main();
