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
  console.log('JOB_STATE resetado para idle/0');
}

async function main(){
  try{
    await resetJobState();
    const { run } = require('./src/run');
    console.log('Iniciando run() local com batchSize=10 e onProgress...');

    const result = await run({
      batchSize: 10,
      skipDashboards: true,
      onProgress: (cursor, total, cliente) => {
        try{
          console.log(`[progress] ${cursor}/${total} - ${cliente}`);
          // Stop the job early for test purposes after 10 clients
          if (cursor >= 10) {
            throw new Error('test-stop');
          }
        }catch(e){
          throw e;
        }
      }
    });

    console.log('run() finalizou:', result);
  }catch(e){
    console.error('Erro no teste local:', e && e.message ? e.message : e);
    process.exit(1);
  }
}

main();
