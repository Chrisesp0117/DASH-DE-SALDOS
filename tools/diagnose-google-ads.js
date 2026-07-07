const fs = require('fs');
const path = require('path');

// Try loading dotenv
try {
  require('dotenv').config({ path: '.env' });
} catch (e) {
  // Ignore
}

const { GoogleAdsApi } = require('google-ads-api');
const { google } = require('googleapis');

function maskString(str) {
  if (!str) return 'NOT_SET';
  if (str.length <= 8) return '********';
  return `${str.substring(0, 4)}...${str.substring(str.length - 4)}`;
}

function normalizeDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

async function getSheetsInstance() {
  let keyData;
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    keyData = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
  } else if (fs.existsSync('credentials.json')) {
    keyData = JSON.parse(fs.readFileSync('credentials.json', 'utf-8'));
  } else {
    return null;
  }
  const auth = new google.auth.GoogleAuth({
    credentials: keyData,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });
  return google.sheets({ version: 'v4', auth });
}

async function getClientsFromSheet() {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  if (!spreadsheetId) {
    console.log('⚠️ SPREADSHEET_ID not set, skipping spreadsheet parsing.');
    return [];
  }

  try {
    const sheets = await getSheetsInstance();
    if (!sheets) {
      console.log('⚠️ Could not load Google Sheets credentials (credentials.json / GOOGLE_APPLICATION_CREDENTIALS_JSON not found). Skipping spreadsheet parsing.');
      return [];
    }

    console.log(`📖 Reading clients from spreadsheet: ${spreadsheetId}...`);
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'CONFIGS!A1:Z500'
    });

    const rows = res.data.values || [];
    if (rows.length <= 1) {
      console.log('⚠️ CONFIGS sheet is empty or contains only header.');
      return [];
    }

    const headers = rows[0].map(h => String(h || '').trim().toLowerCase());
    const idxCliente = headers.findIndex(h => ['cliente', 'client'].includes(String(h || '').trim().toLowerCase()));
    const idxPlataforma = headers.findIndex(h => ['plataforma', 'platform'].includes(String(h || '').trim().toLowerCase()));
    const idxCustomerId = headers.findIndex(h => ['customerid', 'customer id', 'customer id ', 'customer id', 'googlecustomerid', 'google customer id'].includes(String(h || '').trim().toLowerCase()));

    if (idxCliente === -1 || idxPlataforma === -1 || idxCustomerId === -1) {
      console.log('⚠️ Could not find required columns (Cliente, Plataforma, CustomerID) in CONFIGS sheet headers.');
      return [];
    }

    const googleClients = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const plataforma = String(row[idxPlataforma] || '').trim().toUpperCase();
      if (plataforma === 'GOOGLE') {
        const cliente = String(row[idxCliente] || '').trim();
        const customerId = normalizeDigits(row[idxCustomerId]);
        if (customerId.length === 10) {
          googleClients.push({ cliente, customerId });
        }
      }
    }
    console.log(`✅ Found ${googleClients.length} Google clients in CONFIGS sheet.`);
    return googleClients;
  } catch (error) {
    console.log(`⚠️ Failed to read Google Sheets: ${error.message}`);
    return [];
  }
}

async function diagnose() {
  console.log('==================================================');
  console.log('🔍 GOOGLE ADS API DIAGNOSTIC TOOL');
  console.log('==================================================\n');

  // 1. Check environment variables
  console.log('📋 Checking Environment Variables:');
  console.log(`  CLIENT_ID:        ${maskString(process.env.CLIENT_ID)}`);
  console.log(`  CLIENT_SECRET:    ${maskString(process.env.CLIENT_SECRET)}`);
  console.log(`  REFRESH_TOKEN:    ${maskString(process.env.REFRESH_TOKEN)}`);
  console.log(`  DEVELOPER_TOKEN:  ${maskString(process.env.DEVELOPER_TOKEN)}`);
  console.log(`  MCC_ID:           ${process.env.MCC_ID ? normalizeDigits(process.env.MCC_ID) : 'NOT_SET'}`);
  console.log(`  MCC_FALLBACK_1:   ${process.env.MCC_FALLBACK_1 ? normalizeDigits(process.env.MCC_FALLBACK_1) : 'NOT_SET'}`);
  console.log(`  MCC_FALLBACK_2:   ${process.env.MCC_FALLBACK_2 ? normalizeDigits(process.env.MCC_FALLBACK_2) : 'NOT_SET'}`);
  console.log(`  SPREADSHEET_ID:   ${process.env.SPREADSHEET_ID ? process.env.SPREADSHEET_ID : 'NOT_SET'}`);
  console.log('');

  const required = ['CLIENT_ID', 'CLIENT_SECRET', 'REFRESH_TOKEN', 'DEVELOPER_TOKEN'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error(`❌ Missing critical environment variables: ${missing.join(', ')}`);
    console.error('Please configure them in your .env file or Vercel dashboard.');
    return;
  }

  // 2. Validate refresh token & get OAuth token info
  console.log('🔑 Validating OAuth Credentials with Google API...');
  const axios = require('axios');
  let accessToken = null;
  let tokenOwnerEmail = 'Unknown';
  try {
    const params = new URLSearchParams();
    params.append('client_id', process.env.CLIENT_ID);
    params.append('client_secret', process.env.CLIENT_SECRET);
    params.append('refresh_token', process.env.REFRESH_TOKEN);
    params.append('grant_type', 'refresh_token');

    const res = await axios.post('https://oauth2.googleapis.com/token', params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    accessToken = res.data.access_token;
    console.log('  ✅ Refresh Token is VALID. Successfully generated Access Token.');

    // Try to get token info/email
    try {
      const infoRes = await axios.get(`https://oauth2.googleapis.com/tokeninfo?access_token=${accessToken}`);
      tokenOwnerEmail = infoRes.data.email || 'Unknown';
      console.log(`  👤 Authenticated Account Email: ${tokenOwnerEmail}`);
      console.log(`  🌐 Scopes Granted: ${infoRes.data.scope || 'None'}`);
    } catch (e) {
      console.log('  ⚠️ Could not fetch token email owner info.');
    }
  } catch (err) {
    const info = err.response?.data || err.message;
    console.error('  ❌ Google refresh token validation failed!');
    console.error('  Details:', JSON.stringify(info));
    console.log('\n💡 Recommendation: Generate a new Refresh Token using the correct Client ID and Client Secret.');
    return;
  }
  console.log('');

  // 3. Initialize Google Ads Client & Fetch Accessible Customers
  console.log('🔌 Testing Google Ads API connectivity...');
  const ads = new GoogleAdsApi({
    client_id: process.env.CLIENT_ID,
    client_secret: process.env.CLIENT_SECRET,
    developer_token: process.env.DEVELOPER_TOKEN
  });

  let accessibleIds = [];
  try {
    const list = await ads.listAccessibleCustomers({
      refresh_token: process.env.REFRESH_TOKEN
    });
    accessibleIds = (list.resource_names || []).map(r => r.replace('customers/', ''));
    console.log(`  ✅ Successfully called listAccessibleCustomers.`);
    console.log(`  🔍 Customers directly accessible by this Refresh Token (${accessibleIds.length} found):`);
    if (accessibleIds.length > 0) {
      accessibleIds.forEach(id => console.log(`     - Customer ID: ${id}`));
    } else {
      console.log('     (No direct customer links. This token only has access through manager linkages or needs setup)');
    }
  } catch (err) {
    const rawErr = err.response?.errors || err.message || err;
    console.error('  ❌ Failed to list accessible customers!');
    console.error('  Details:', JSON.stringify(rawErr));
    console.log('\n💡 Recommendation: Check if your Developer Token is valid, active, and approved for use.');
    return;
  }
  console.log('');

  // 4. Determine which client IDs to test
  let targetClients = [];
  const argId = process.argv[2] ? normalizeDigits(process.argv[2]) : null;

  if (argId) {
    if (argId.length === 10) {
      targetClients.push({ cliente: 'Command Line Argument', customerId: argId });
    } else {
      console.error(`❌ Invalid Customer ID passed: ${process.argv[2]} (must be 10 digits)`);
      return;
    }
  } else {
    targetClients = await getClientsFromSheet();
  }

  if (targetClients.length === 0) {
    console.log('❓ No Customer IDs to test. You can pass a specific customer ID as an argument:');
    console.log('   node tools/diagnose-google-ads.js 1234567890\n');
    return;
  }

  // 5. Query testing
  console.log('🧪 Testing access for each Customer ID:\n');

  const mccCandidates = [
    process.env.MCC_ID,
    process.env.MCC_FALLBACK_1,
    process.env.MCC_FALLBACK_2
  ]
    .map(normalizeDigits)
    .filter(Boolean);
  
  const mccList = [...new Set(mccCandidates)];

  console.log(`Available login-customer-ids (MCC IDs) to try: [${mccList.join(', ')}] and Direct (no MCC ID)`);
  console.log('--------------------------------------------------');

  for (const client of targetClients) {
    console.log(`\n👤 Client: "${client.cliente}" | Customer ID: ${client.customerId}`);
    
    // We try each MCC ID, then Direct
    const attempts = mccList.map(mcc => ({ name: `MCC ${mcc}`, id: mcc }));
    attempts.push({ name: 'Direct (No MCC)', id: null });

    let hasSuccess = false;
    let successfulMcc = null;

    for (const attempt of attempts) {
      const config = {
        customer_id: client.customerId,
        refresh_token: process.env.REFRESH_TOKEN
      };
      if (attempt.id) {
        config.login_customer_id = attempt.id;
      }

      try {
        const customer = ads.Customer(config);
        // Execute a very lightweight query
        await customer.query(`
          SELECT customer.id, customer.descriptive_name 
          FROM customer 
          LIMIT 1
        `);
        console.log(`  🟢 [SUCCESS] Authenticated via ${attempt.name}`);
        hasSuccess = true;
        successfulMcc = attempt.name;
        break; // Stop trying other MCCs if we succeed
      } catch (err) {
        const raw = JSON.stringify(err.response?.errors || err.message || err);
        let reason = 'Unknown Error';
        if (raw.includes('USER_PERMISSION_DENIED')) {
          reason = 'USER_PERMISSION_DENIED (User has no access)';
        } else if (raw.includes('DEVELOPER_TOKEN_INVALID')) {
          reason = 'DEVELOPER_TOKEN_INVALID';
        } else if (raw.includes('CUSTOMER_NOT_FOUND')) {
          reason = 'CUSTOMER_NOT_FOUND (ID does not exist)';
        } else if (raw.includes('CUSTOMER_NOT_ENABLED')) {
          reason = 'CUSTOMER_NOT_ENABLED (Account deactivated)';
        } else {
          reason = raw.substring(0, 80);
        }
        console.log(`  🔴 [FAILED]  Via ${attempt.name.padEnd(16)} | Error: ${reason}`);
      }
    }

    if (hasSuccess) {
      console.log(`  🎉 Result: ACCESS GRANTED via ${successfulMcc}`);
    } else {
      console.log('  ❌ Result: ACCESS DENIED under all configurations.');
    }
  }

  console.log('\n==================================================');
  console.log('📋 DIAGNOSIS SUMMARY & HOW TO RESOLVE');
  console.log('==================================================');
  console.log(`1. Your OAuth Refresh Token belongs to: ${tokenOwnerEmail}`);
  console.log('2. This user directly owns or has been granted direct access to:');
  if (accessibleIds.length > 0) {
    accessibleIds.forEach(id => console.log(`   - Customer: ${id}`));
  } else {
    console.log('   - No direct customer accounts. (This is normal if the user only has access through a Manager Account (MCC) link)');
  }
  console.log('\n3. COMMON PROBLEMS & RESOLUTIONS:');
  console.log('   A. "User does not have permission to access the customer"');
  console.log(`      -> The user "${tokenOwnerEmail}" does not have access to either the Client ID or the MCC ID configured.`);
  console.log('      -> Fix: log into Google Ads with the owner of the MCC account, go to Tools > Access & Security,');
  console.log(`         and invite "${tokenOwnerEmail}" with Standard or Administrative access.`);
  console.log('         Accept the email invitation and generate a new refresh token under this user.');
  console.log('');
  console.log('   B. "login-customer-id required" / missing MCC');
  console.log('      -> If you access a child account using standard OAuth, you must provide the Manager Account (MCC) ID.');
  console.log('      -> Fix: Check that the MCC_ID environment variable in Vercel/local .env contains the correct manager ID');
  console.log('         that directly or indirectly manages the failing customer account.');
  console.log('');
  console.log('   C. Credentials changed but not deployed');
  console.log('      -> If you updated Vercel environment variables, make sure you redeployed the project.');
  console.log('      -> In Vercel, env variables DO NOT take effect on running serverless functions until you trigger a redeploy!');
  console.log('==================================================\n');
}

diagnose().catch(console.error);
