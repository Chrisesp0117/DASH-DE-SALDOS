const { google } = require('googleapis');

async function getSheets(){
  let keyData;

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    try {
      keyData = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
    } catch (e) {
      console.error('Failed to parse GOOGLE_APPLICATION_CREDENTIALS_JSON:', e.message);
      throw new Error('Invalid GOOGLE_APPLICATION_CREDENTIALS_JSON environment variable');
    }
  } else {
    try {
      const fs = require('fs');
      const credContent = fs.readFileSync('credentials.json', 'utf-8');
      keyData = JSON.parse(credContent);
    } catch (e) {
      console.error('Failed to read credentials.json:', e.message);
      throw new Error('credentials.json not found and GOOGLE_APPLICATION_CREDENTIALS_JSON not set');
    }
  }

  const auth = new google.auth.GoogleAuth({
    credentials: keyData,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets'
    ]
  });

  return google.sheets({
    version: 'v4',
    auth
  });
}

module.exports = {
getSheets
};