require('dotenv').config({ path: '.env' });
const axios = require('axios');
const { getGoogleRefreshToken, getMetaAccessToken, getConnectionsSummary } = require('./services/connections');
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
    console.error('Google: sem refresh token — conecte a conta em /api/settings-ui ou defina REFRESH_TOKEN no .env');
    return false;
  }
  const source = String(process.env.REFRESH_TOKEN || '').trim() === refreshToken ? 'env' : 'web';

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
      console.log(`Google refresh token OK (fonte: ${source}).`);
      return true;
    }
    console.error('Google token endpoint returned unexpected response:', res.data);
    return false;
  } catch (err) {
    const info = err.response?.data || err.message;
    console.error(`Google refresh token validation failed (fonte: ${source}):`, info);
    return false;
  }
}

async function checkMetaToken() {
  const token = await getMetaAccessToken();
  if (!token) {
    console.error('Meta: sem access token — conecte a conta em /api/settings-ui ou defina META_TOKEN no .env');
    return false;
  }
  const source = String(process.env.META_TOKEN || '').trim() === token ? 'env' : 'web';

  const url = 'https://graph.facebook.com/v18.0/me';
  try {
    const res = await axios.get(url, {
      params: { access_token: token },
      timeout: 10000
    });
    if (res.data && res.data.id) {
      console.log(`Meta token OK (fonte: ${source}, id: ${res.data.id}).`);
      return true;
    }
    console.error('Meta token check returned unexpected response:', res.data);
    return false;
  } catch (err) {
    const info = err.response?.data || err.message;
    console.error(`Meta token validation failed (fonte: ${source}):`, info);
    return false;
  }
}

async function printConnectionsSummary() {
  try {
    const summary = await getConnectionsSummary();
    const g = summary.google;
    const m = summary.meta;
    console.log('\nConexões web (app_connections):');
    console.log(`  Google: ${g.connected ? 'conectada (' + (g.email || 'sem e-mail') + ')' : 'não conectada'}${summary.envFallback.google ? ' — fallback REFRESH_TOKEN do .env ativo' : ''}`);
    console.log(`  Meta:   ${m.connected ? 'conectada (' + (m.name || m.userId || 'sem nome') + ')' : 'não conectada'}${summary.envFallback.meta ? ' — fallback META_TOKEN do .env ativo' : ''}`);
  } catch (e) {
    console.warn('Não foi possível ler as conexões web:', e && e.message);
  }
}

async function printAccountsConfig() {
  try {
    const accounts = await listAccounts();
    const google = accounts.filter(a => a.plataforma === 'GOOGLE').length;
    const meta = accounts.filter(a => a.plataforma === 'META').length;
    console.log(`\nContas configuradas (accounts_config): ${accounts.length} (${google} Google, ${meta} Meta)`);
    if (!accounts.length) {
      console.warn('  ⚠️ Nenhuma conta na accounts_config — o job usará a aba CONFIGS da planilha (fallback).');
      console.warn('     Configure as contas em /api/settings-ui (ou importe a CONFIGS por lá).');
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

  await printConnectionsSummary();
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
