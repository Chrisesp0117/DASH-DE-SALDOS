require('dotenv').config({ path: '.env' });
const { getSheets } = require('../../src/services/sheets');
const { GoogleAdsApi } = require('google-ads-api');

// Auth helper
function getQueryValue(req, key) {
  try {
    const host = String(req && req.headers && (req.headers.host || req.headers.Host) || '');
    const base = host ? `https://${host}` : 'https://example.invalid';
    const url = new URL(String(req && req.url || '/'), base);
    return url.searchParams.get(key) || '';
  } catch (_) {
    return '';
  }
}

function sendText(res, text, statusCode = 200) {
  if (res && typeof res.status === 'function' && typeof res.send === 'function') {
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    return res.status(statusCode).send(text);
  }
  if (res && typeof res.setHeader === 'function' && typeof res.end === 'function') {
    res.statusCode = statusCode;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end(text);
    return;
  }
  return { statusCode, body: text };
}

function maskString(str) {
  if (!str) return 'NOT_SET';
  if (str.length <= 8) return '********';
  return `${str.substring(0, 4)}...${str.substring(str.length - 4)}`;
}

function normalizeDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

module.exports = async (req, res) => {
  const expected = process.env.CRON_SECRET || '';
  const secret = req.query?.secret || getQueryValue(req, 'secret') || (req.headers && req.headers['x-cron-secret']);
  if (!expected || String(secret || '') !== expected) {
    res.setHeader('content-type', 'application/json');
    res.statusCode = 401;
    res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
    return;
  }

  let logs = [];
  const log = (msg) => {
    logs.push(msg);
    console.log(msg);
  };

  log('==================================================');
  log('🔍 GOOGLE ADS API DIAGNOSTIC (VERCEL SERVERLESS)');
  log('==================================================\n');

  // 1. Check environment variables
  log('📋 Environment variables check:');
  log(`  CLIENT_ID:        ${maskString(process.env.CLIENT_ID)}`);
  log(`  CLIENT_SECRET:    ${maskString(process.env.CLIENT_SECRET)}`);
  log(`  REFRESH_TOKEN:    ${maskString(process.env.REFRESH_TOKEN)}`);
  log(`  DEVELOPER_TOKEN:  ${maskString(process.env.DEVELOPER_TOKEN)}`);
  log(`  MCC_ID:           ${process.env.MCC_ID ? normalizeDigits(process.env.MCC_ID) : 'NOT_SET'}`);
  log(`  MCC_FALLBACK_1:   ${process.env.MCC_FALLBACK_1 ? normalizeDigits(process.env.MCC_FALLBACK_1) : 'NOT_SET'}`);
  log(`  MCC_FALLBACK_2:   ${process.env.MCC_FALLBACK_2 ? normalizeDigits(process.env.MCC_FALLBACK_2) : 'NOT_SET'}`);
  log(`  SPREADSHEET_ID:   ${process.env.SPREADSHEET_ID ? process.env.SPREADSHEET_ID : 'NOT_SET'}`);
  log('');

  const required = ['CLIENT_ID', 'CLIENT_SECRET', 'REFRESH_TOKEN', 'DEVELOPER_TOKEN'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    log(`❌ Missing critical environment variables: ${missing.join(', ')}`);
    return sendText(res, logs.join('\n'));
  }

  // 2. Validate refresh token
  log('🔑 Validating OAuth Credentials with Google API...');
  const axios = require('axios');
  let accessToken = null;
  let tokenOwnerEmail = 'Unknown';
  try {
    const params = new URLSearchParams();
    params.append('client_id', process.env.CLIENT_ID);
    params.append('client_secret', process.env.CLIENT_SECRET);
    params.append('refresh_token', process.env.REFRESH_TOKEN);
    params.append('grant_type', 'refresh_token');

    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    accessToken = tokenRes.data.access_token;
    log('  ✅ Refresh Token is VALID. Successfully generated Access Token.');

    try {
      const infoRes = await axios.get(`https://oauth2.googleapis.com/tokeninfo?access_token=${accessToken}`);
      tokenOwnerEmail = infoRes.data.email || 'Unknown';
      log(`  👤 Authenticated Account Email: ${tokenOwnerEmail}`);
      log(`  🌐 Scopes Granted: ${infoRes.data.scope || 'None'}`);
    } catch (e) {
      log('  ⚠️ Could not fetch token email owner info.');
    }
  } catch (err) {
    const info = err.response?.data || err.message;
    log('  ❌ Google refresh token validation failed!');
    log(`  Details: ${JSON.stringify(info)}`);
    return sendText(res, logs.join('\n'));
  }
  log('');

  // 3. Google Ads connection
  log('🔌 Testing Google Ads API connectivity...');
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
    log('  ✅ Successfully called listAccessibleCustomers.');
    log(`  🔍 Customers directly accessible by this Refresh Token (${accessibleIds.length} found):`);
    if (accessibleIds.length > 0) {
      accessibleIds.forEach(id => log(`     - Customer ID: ${id}`));
    } else {
      log('     (No direct customer links. This token only has access through manager linkages or needs setup)');
    }
  } catch (err) {
    const rawErr = err.response?.errors || err.message || err;
    log('  ❌ Failed to list accessible customers!');
    log(`  Details: ${JSON.stringify(rawErr)}`);
    return sendText(res, logs.join('\n'));
  }
  log('');

  // 4. Target Customer IDs
  let targetClients = [];
  const queryId = req.query?.customerId || getQueryValue(req, 'customerId');
  const targetId = queryId ? normalizeDigits(queryId) : null;

  if (targetId) {
    if (targetId.length === 10) {
      targetClients.push({ cliente: 'Query Parameter', customerId: targetId });
    } else {
      log(`❌ Invalid Customer ID passed in query: ${queryId} (must be 10 digits)`);
      return sendText(res, logs.join('\n'));
    }
  } else {
    // Read from sheet
    const spreadsheetId = process.env.SPREADSHEET_ID;
    if (spreadsheetId) {
      try {
        const sheets = await getSheets();
        log(`📖 Reading clients from spreadsheet: ${spreadsheetId}...`);
        const resSheet = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: 'CONFIGS!A1:Z500'
        });

        const rows = resSheet.data.values || [];
        if (rows.length > 1) {
          const headers = rows[0].map(h => String(h || '').trim().toLowerCase());
          const idxCliente = headers.findIndex(h => ['cliente', 'client'].includes(String(h || '').trim().toLowerCase()));
          const idxPlataforma = headers.findIndex(h => ['plataforma', 'platform'].includes(String(h || '').trim().toLowerCase()));
          const idxCustomerId = headers.findIndex(h => ['customerid', 'customer id', 'customer id ', 'googlecustomerid', 'google customer id'].includes(String(h || '').trim().toLowerCase()));

          if (idxCliente !== -1 && idxPlataforma !== -1 && idxCustomerId !== -1) {
            for (let i = 1; i < rows.length; i++) {
              const row = rows[i];
              const plataforma = String(row[idxPlataforma] || '').trim().toUpperCase();
              if (plataforma === 'GOOGLE') {
                const cliente = String(row[idxCliente] || '').trim();
                const customerId = normalizeDigits(row[idxCustomerId]);
                if (customerId.length === 10) {
                  targetClients.push({ cliente, customerId });
                }
              }
            }
            log(`✅ Found ${targetClients.length} Google clients in CONFIGS.`);
          } else {
            log('⚠️ Required columns (Cliente, Plataforma, CustomerID) not found in CONFIGS headers.');
          }
        } else {
          log('⚠️ CONFIGS sheet is empty.');
        }
      } catch (err) {
        log(`⚠️ Failed to load sheet CONFIGS: ${err.message}`);
      }
    }
  }

  if (targetClients.length === 0) {
    log('❓ No Customer IDs to test. You can pass a specific customer ID in the query:');
    log('   &customerId=1234567890\n');
    return sendText(res, logs.join('\n'));
  }

  // 5. Query tests
  log('🧪 Testing access for each Customer ID:\n');
  const mccCandidates = [
    process.env.MCC_ID,
    process.env.MCC_FALLBACK_1,
    process.env.MCC_FALLBACK_2
  ]
    .map(normalizeDigits)
    .filter(Boolean);
  
  const mccList = [...new Set(mccCandidates)];
  log(`Available login-customer-ids (MCC IDs) to try: [${mccList.join(', ')}] and Direct (no MCC ID)`);
  log('--------------------------------------------------');

  for (const client of targetClients) {
    log(`\n👤 Client: "${client.cliente}" | Customer ID: ${client.customerId}`);
    
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
        await customer.query(`
          SELECT customer.id, customer.descriptive_name 
          FROM customer 
          LIMIT 1
        `);
        log(`  🟢 [SUCCESS] Authenticated via ${attempt.name}`);
        hasSuccess = true;
        successfulMcc = attempt.name;
        break;
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
        log(`  🔴 [FAILED]  Via ${attempt.name.padEnd(16)} | Error: ${reason}`);
      }
    }

    if (hasSuccess) {
      log(`  🎉 Result: ACCESS GRANTED via ${successfulMcc}`);
    } else {
      log('  ❌ Result: ACCESS DENIED under all configurations.');
    }
  }

  log('\n==================================================');
  log('📋 DIAGNOSIS SUMMARY & HOW TO RESOLVE');
  log('==================================================');
  log(`1. Your OAuth Refresh Token belongs to: ${tokenOwnerEmail}`);
  log('2. This user directly owns or has been granted direct access to:');
  if (accessibleIds.length > 0) {
    accessibleIds.forEach(id => log(`   - Customer: ${id}`));
  } else {
    log('   - No direct customer accounts. (This is normal if the user only has access through a Manager Account (MCC) link)');
  }
  log('\n3. COMMON PROBLEMS & RESOLUTIONS:');
  log('   A. "User does not have permission to access the customer"');
  log(`      -> The user "${tokenOwnerEmail}" does not have access to either the Client ID or the MCC ID configured.`);
  log('      -> Fix: log into Google Ads with the owner of the MCC account, go to Tools > Access & Security,');
  log(`         and invite "${tokenOwnerEmail}" with Standard or Administrative access.`);
  log('         Accept the email invitation and generate a new refresh token under this user.');
  log('');
  log('   B. "login-customer-id required" / missing MCC');
  log('      -> If you access a child account using standard OAuth, you must provide the Manager Account (MCC) ID.');
  log('      -> Fix: Check that the MCC_ID environment variable in Vercel/local .env contains the correct manager ID');
  log('         that directly or indirectly manages the failing customer account.');
  log('');
  log('   C. Credentials changed but not deployed');
  log('      -> If you updated Vercel environment variables, make sure you redeployed the project.');
  log('      -> In Vercel, env variables DO NOT take effect on running serverless functions until you trigger a redeploy!');
  log('==================================================\n');

  return sendText(res, logs.join('\n'));
};
