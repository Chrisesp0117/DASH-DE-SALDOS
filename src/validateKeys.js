require('dotenv').config({ path: '.env' });
const axios = require('axios');

async function checkEnvVars() {
  const required = [
    'CLIENT_ID',
    'CLIENT_SECRET',
    'REFRESH_TOKEN',
    'DEVELOPER_TOKEN',
    'SPREADSHEET_ID',
    'META_TOKEN'
  ];

  const missing = required.filter(k => !process.env[k] || process.env[k].trim() === '');
  if (missing.length) {
    console.error('Missing env vars:', missing.join(', '));
    return false;
  }
  console.log('All required env vars present.');
  return true;
}

async function checkGoogleRefresh() {
  const url = 'https://oauth2.googleapis.com/token';
  const params = new URLSearchParams();
  params.append('client_id', process.env.CLIENT_ID);
  params.append('client_secret', process.env.CLIENT_SECRET);
  params.append('refresh_token', process.env.REFRESH_TOKEN);
  params.append('grant_type', 'refresh_token');

  try {
    const res = await axios.post(url, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000
    });
    if (res.data && res.data.access_token) {
      console.log('Google refresh token OK (access token acquired).');
      return true;
    }
    console.error('Google token endpoint returned unexpected response:', res.data);
    return false;
  } catch (err) {
    const info = err.response?.data || err.message;
    console.error('Google refresh token validation failed:', info);
    return false;
  }
}

async function checkMetaToken() {
  const url = 'https://graph.facebook.com/v18.0/me';
  try {
    const res = await axios.get(url, {
      params: { access_token: process.env.META_TOKEN },
      timeout: 10000
    });
    if (res.data && res.data.id) {
      console.log('Meta token OK (id:', res.data.id + ').');
      return true;
    }
    console.error('Meta token check returned unexpected response:', res.data);
    return false;
  } catch (err) {
    const info = err.response?.data || err.message;
    console.error('Meta token validation failed:', info);
    return false;
  }
}

async function runChecks() {
  console.log('Starting key validation...');
  const okEnv = await checkEnvVars();
  let okGoogle = false;
  let okMeta = false;

  if (okEnv) {
    okGoogle = await checkGoogleRefresh();
    okMeta = await checkMetaToken();
  }

  const ok = okEnv && okGoogle && okMeta;
  const result = { okEnv, okGoogle, okMeta, ok };
  return result;
}

if (require.main === module) {
  (async () => {
    const r = await runChecks();
    console.log('\nSummary:');
    console.log(`  Env vars: ${r.okEnv ? '✅ OK' : '❌ MISSING'}`);
    console.log(`  Google refresh token: ${r.okGoogle ? '✅ OK' : '❌ FAIL'}`);
    console.log(`  Meta token: ${r.okMeta ? '✅ OK' : '❌ FAIL'}`);
    process.exit(r.ok ? 0 : 1);
  })();
} else {
  module.exports = { runChecks };
}
