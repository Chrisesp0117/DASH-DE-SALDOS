require('dotenv').config({ path: '.env' });

const fs = require('fs');
const axios = require('axios');
const { google } = require('googleapis');
const { getGoogleData } = require('./src/services/googleAds');

function normalizeDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function loadSheetCredentials() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    try {
      return JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
    } catch (e) {
      throw new Error(`GOOGLE_APPLICATION_CREDENTIALS_JSON inválido: ${e.message}`);
    }
  }

  if (fs.existsSync('credentials.json')) {
    return JSON.parse(fs.readFileSync('credentials.json', 'utf8'));
  }

  return null;
}

async function resetJobStateIfPossible() {
  if (!process.env.SPREADSHEET_ID) {
    console.log('⚠️ SPREADSHEET_ID não definido; pulando reset do JOB_STATE.');
    return false;
  }

  const creds = loadSheetCredentials();
  if (!creds) {
    console.log('⚠️ Sem credenciais de Sheets (credentials.json ou GOOGLE_APPLICATION_CREDENTIALS_JSON); pulando reset do JOB_STATE.');
    return false;
  }

  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  const sheets = google.sheets({ version: 'v4', auth });

  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: 'JOB_STATE!A1:P1',
    valueInputOption: 'RAW',
    requestBody: { values: [[ 'idle', '', '0', '0', '0', '0', '0', '0', '', '', '', '', '', '', '', '' ]] }
  });

  console.log('JOB_STATE resetado para idle/0');
  return true;
}

async function runGoogleSmokeTest() {
  const explicitCustomerId = normalizeDigits(process.env.GOOGLE_TEST_CUSTOMER_ID || process.env.GOOGLE_CUSTOMER_ID);

  if (explicitCustomerId.length === 10) {
    console.log(`Iniciando teste local do Google Ads para customerId=${explicitCustomerId}...`);
    const result = await getGoogleData(explicitCustomerId, process.env.REFRESH_TOKEN, {
      cliente: 'LOCAL_TEST',
      plataforma: 'GOOGLE',
      id: explicitCustomerId
    });

    console.log('Resultado do teste Google Ads:');
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const candidateCustomerIds = [];
  {
    const tokenResponse = await axios.post(
      'https://oauth2.googleapis.com/token',
      new URLSearchParams({
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        refresh_token: process.env.REFRESH_TOKEN,
        grant_type: 'refresh_token'
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const accessToken = tokenResponse.data && tokenResponse.data.access_token;
    if (!accessToken) {
      throw new Error('Não foi possível obter access_token para o Google Ads');
    }

    const accessibleResponse = await axios.get(
      'https://googleads.googleapis.com/v24/customers:listAccessibleCustomers',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'developer-token': process.env.DEVELOPER_TOKEN
        }
      }
    );

    const accessibleIds = (accessibleResponse.data && accessibleResponse.data.resourceNames ? accessibleResponse.data.resourceNames : [])
      .map(resourceName => normalizeDigits(resourceName))
      .filter(Boolean);

    const mccIds = [
      process.env.MCC_ID,
      process.env.MCC_FALLBACK_1,
      process.env.MCC_FALLBACK_2
    ]
      .map(normalizeDigits)
      .filter(Boolean);

    const clientIds = accessibleIds.filter(id => !mccIds.includes(id));
    candidateCustomerIds.push(...clientIds, ...accessibleIds);
  }

  if (!candidateCustomerIds.length) {
    console.log('⚠️ Nenhum Customer ID disponível para teste. Defina GOOGLE_TEST_CUSTOMER_ID ou GOOGLE_CUSTOMER_ID.');
    return;
  }

  const tokenResponse = await axios.post(
    'https://oauth2.googleapis.com/token',
    new URLSearchParams({
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.CLIENT_SECRET,
      refresh_token: process.env.REFRESH_TOKEN,
      grant_type: 'refresh_token'
    }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  const accessToken = tokenResponse.data && tokenResponse.data.access_token;
  if (!accessToken) {
    throw new Error('Não foi possível obter access_token para o Google Ads');
  }

  const clientOnlyIds = [];
  for (const customerId of candidateCustomerIds) {
    try {
      const response = await axios.post(
        `https://googleads.googleapis.com/v24/customers/${customerId}/googleAds:search`,
        { query: 'SELECT customer.manager, customer.id FROM customer LIMIT 1' },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'developer-token': process.env.DEVELOPER_TOKEN,
            'login-customer-id': customerId
          }
        }
      );

      const row = response.data && response.data.results ? response.data.results[0] : null;
      if (row && row.customer && row.customer.manager === false) {
        clientOnlyIds.push(customerId);
      }
    } catch (e) {
      const details = e.response && e.response.data ? JSON.stringify(e.response.data) : (e.message || String(e));
      console.log(`⚠️ Ignorando customerId=${customerId} ao identificar contas de cliente: ${details}`);
    }
  }

  if (!clientOnlyIds.length) {
    console.log('⚠️ Nenhuma conta de cliente acessível foi encontrada. As contas retornadas pelo token são MCC/manager ou estão desativadas.');
    return;
  }

  console.log(`Iniciando teste local do Google Ads. Contas de cliente: ${clientOnlyIds.join(', ')}`);

  let lastResult = null;
  for (const customerId of clientOnlyIds) {
    console.log(`- Testando customerId=${customerId}...`);
    const result = await getGoogleData(customerId, process.env.REFRESH_TOKEN, {
      cliente: 'LOCAL_TEST',
      plataforma: 'GOOGLE',
      id: customerId
    });

    lastResult = { customerId, result };

    if (result && result.ok) {
      console.log(`✅ Google Ads respondeu com sucesso para customerId=${customerId}`);
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const errorCategory = result && result.error ? result.error.category : 'unknown';
    console.log(`⚠️ customerId=${customerId} falhou com category=${errorCategory}`);
  }

  console.log('Resultado final do teste Google Ads:');
  console.log(JSON.stringify(lastResult, null, 2));
}

async function main() {
  try {
    await resetJobStateIfPossible();
    await runGoogleSmokeTest();
  } catch (e) {
    console.error('Erro no teste local:', e && e.message ? e.message : e);
    process.exit(1);
  }
}

main();
