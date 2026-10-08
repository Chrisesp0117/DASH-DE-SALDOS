require('dotenv').config({ path: '.env' });
const axios = require('axios');
const { getGoogleRefreshToken, getMetaAccessToken } = require('./services/connections');
const { listAccounts } = require('./services/accountsConfig');

async function checkEnvVars() {
  const required = [
    'CLIENT_ID',
    'CLIENT_SECRET',
    'DEVELOPER_TOKEN',
    'SPREADSHEET_ID'
  ];
  // SUPABASE_URL/SUPABASE_KEY são exigidos pelos serviços ao carregar o módulo.

  const missing = required.filter(k => !process.env[k] || process.env[k].trim() === '');
  if (missing.length) {
    console.error('Missing env vars:', missing.join(', '));
    return false;
  }
  console.log('All required env vars present.');
  return true;
}

async function checkGoogleRefresh() {
  const refreshToken = await getGoogleRefreshToken();
  if (!refreshToken) {
    console.error('Google: REFRESH_TOKEN não configurado no .env');
    return false;
  }

  const url = 'https://oauth2.googleapis.com/token';
  const params = new URLSearchParams();
  params.append('client_id', process.env.CLIENT_ID);
  params.append('client_secret', process.env.CLIENT_SECRET);
  params.append('refresh_token', refreshToken);
  params.append('grant_type', 'refresh_token');

  try {
    const res = await axios.post(url, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000
    });
    if (res.data && res.data.access_token) {
      console.log('Google refresh token OK.');
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
  const token = await getMetaAccessToken();
  if (!token) {
    console.error('Meta: META_TOKEN não configurado no .env');
    return false;
  }

  const url = 'https://graph.facebook.com/v18.0/me';
  try {
    const res = await axios.get(url, {
      params: { access_token: token },
      timeout: 10000
    });
    if (res.data && res.data.id) {
      console.log('Meta token OK (id: ' + res.data.id + ').');
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

async function printAccountsConfig() {
  try {
    const accounts = await listAccounts();
    const google = accounts.filter(a => a.plataforma === 'GOOGLE').length;
    const meta = accounts.filter(a => a.plataforma === 'META').length;
    console.log(`\nContas configuradas (accounts_config): ${accounts.length} (${google} Google, ${meta} Meta)`);
    if (!accounts.length) {
      console.warn('  ⚠️ Nenhuma conta na accounts_config — nenhuma atualização terá dados.');
      console.warn('     Configure as contas em /api/update-now?secret=<CRON_SECRET>#configuracoes');
    }
  } catch (e) {
    console.warn('Não foi possível ler a accounts_config:', e && e.message);
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

  await printAccountsConfig();

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
