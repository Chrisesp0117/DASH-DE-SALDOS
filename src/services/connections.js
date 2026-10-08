/**
 * connections.js — conexões OAuth Google/Meta salvas no Supabase (app_connections).
 *
 * A página de configurações web (/api/settings-ui) conecta as contas via OAuth
 * e salva os tokens aqui. O job (run.js) usa esses tokens quando existem,
 * com fallback para as variáveis de ambiente (REFRESH_TOKEN / META_TOKEN).
 */
require('dotenv').config({ path: '.env' });
const axios = require('axios');
const { getClient, describeSupabaseError } = require('./supabase');

const CONNECTIONS_TABLE = process.env.SUPABASE_CONNECTIONS_TABLE || 'app_connections';
const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v18.0';

// Cache dos tokens efetivos (evita 1 query Supabase por conta processada no job).
// TTL curto: o job lê uma vez por lote; a página web sempre lê do banco.
const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000;
const _tokenCache = {
  google: { value: undefined, at: 0 },
  meta: { value: undefined, at: 0 }
};

async function getConnection(provider) {
  const client = getClient();
  const { data, error } = await client
    .from(CONNECTIONS_TABLE)
    .select('*')
    .eq('provider', provider)
    .maybeSingle();
  if (error) {
    throw new Error('Falha ao ler ' + CONNECTIONS_TABLE + ': ' + describeSupabaseError(error));
  }
  return data || null;
}

async function listConnections() {
  const client = getClient();
  const { data, error } = await client
    .from(CONNECTIONS_TABLE)
    .select('*')
    .order('provider', { ascending: true });
  if (error) {
    throw new Error('Falha ao ler ' + CONNECTIONS_TABLE + ': ' + describeSupabaseError(error));
  }
  return data || [];
}

async function upsertConnection(provider, fields) {
  const client = getClient();
  const payload = {
    provider,
    ...fields,
    status: fields.status || 'connected',
    updated_at: new Date().toISOString()
  };
  const { data, error } = await client
    .from(CONNECTIONS_TABLE)
    .upsert(payload, { onConflict: 'provider' });
  if (error) {
    throw new Error('Falha ao salvar conexão ' + provider + ': ' + describeSupabaseError(error));
  }
  return data;
}

async function deleteConnection(provider) {
  const client = getClient();
  const { error } = await client
    .from(CONNECTIONS_TABLE)
    .delete()
    .eq('provider', provider);
  if (error) {
    throw new Error('Falha ao remover conexão ' + provider + ': ' + describeSupabaseError(error));
  }
  return { ok: true };
}

async function markConnectionError(provider, message) {
  try {
    await upsertConnection(provider, { status: 'error', error_message: String(message || '').slice(0, 500) });
  } catch (e) {
    console.warn('[markConnectionError] falha ao marcar erro da conexão ' + provider + ':', e && e.message);
  }
}

/**
 * Refresh token do Google: usa a conexão OAuth da web quando existir,
 * com fallback para o REFRESH_TOKEN do .env. (cache de 5 min)
 */
async function getGoogleRefreshToken() {
  const cached = _tokenCache.google;
  if (cached.value !== undefined && (Date.now() - cached.at) < TOKEN_CACHE_TTL_MS) {
    return cached.value;
  }
  let value = null;
  try {
    const conn = await getConnection('google');
    if (conn && String(conn.refresh_token || '').trim()) {
      value = String(conn.refresh_token).trim();
    }
  } catch (e) {
    console.warn('[getGoogleRefreshToken] erro ao ler conexão google (usando env):', e && e.message);
  }
  if (!value) {
    value = process.env.REFRESH_TOKEN || null;
  }
  cached.value = value;
  cached.at = Date.now();
  return value;
}

/**
 * Token Meta (longa duração). Quando a conexão OAuth da web existir:
 *  - renova o token se o último save foi há mais de 24h (o long-lived dura ~60 dias
 *    e só pode ser renovado enquanto ainda é válido);
 *  - com fallback para o META_TOKEN do .env se não houver conexão. (cache de 5 min)
 */
async function getMetaAccessToken() {
  const cached = _tokenCache.meta;
  if (cached.value !== undefined && (Date.now() - cached.at) < TOKEN_CACHE_TTL_MS) {
    return cached.value;
  }
  let value = null;
  let conn = null;
  try {
    conn = await getConnection('meta');
  } catch (e) {
    console.warn('[getMetaAccessToken] erro ao ler conexão meta (usando env):', e && e.message);
  }

  if (conn && String(conn.access_token || '').trim()) {
    value = String(conn.access_token).trim();
    const updatedAt = conn.updated_at ? new Date(conn.updated_at).getTime() : 0;
    const ageMs = Date.now() - updatedAt;

    if (Number.isFinite(updatedAt) && ageMs > 24 * 60 * 60 * 1000) {
      try {
        const renewed = await exchangeMetaLongLived(value);
        if (renewed && renewed.access_token) {
          value = String(renewed.access_token);
          await upsertConnection('meta', {
            access_token: value,
            token_expires_at: renewed.expires_in
              ? new Date(Date.now() + Number(renewed.expires_in) * 1000).toISOString()
              : null,
            status: 'connected',
            error_message: null
          });
        }
      } catch (e) {
        console.warn('[getMetaAccessToken] renovação do token Meta falhou (usando o atual):', e && e.message);
      }
    }
  }

  if (!value) {
    value = process.env.META_TOKEN || null;
  }
  cached.value = value;
  cached.at = Date.now();
  return value;
}

/**
 * Troca um token curto (ou long-lived ainda válido) por um token de longa
 * duração (~60 dias) via endpoint fb_exchange_token do Meta.
 */
async function exchangeMetaLongLived(shortLivedToken) {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret || !shortLivedToken) {
    throw new Error('META_APP_ID/META_APP_SECRET não configurados para renovar o token Meta');
  }
  const res = await axios.get(
    `https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`,
    {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: shortLivedToken
      },
      timeout: 15000
    }
  );
  return res.data || null;
}

/**
 * Resumo das conexões para a UI (nunca expõe os tokens).
 */
async function getConnectionsSummary() {
  const conns = await listConnections();
  const byProvider = new Map(conns.map(c => [c.provider, c]));
  const google = byProvider.get('google') || null;
  const meta = byProvider.get('meta') || null;
  return {
    google: google
      ? {
        connected: true,
        email: google.email || '',
        status: google.status || 'connected',
        errorMessage: google.error_message || '',
        updatedAt: google.updated_at || null
      }
      : { connected: false },
    meta: meta
      ? {
        connected: true,
        name: meta.account_name || '',
        userId: meta.meta_user_id || '',
        status: meta.status || 'connected',
        errorMessage: meta.error_message || '',
        updatedAt: meta.updated_at || null
      }
      : { connected: false },
    envFallback: {
      google: Boolean(String(process.env.REFRESH_TOKEN || '').trim()),
      meta: Boolean(String(process.env.META_TOKEN || '').trim())
    }
  };
}

module.exports = {
  CONNECTIONS_TABLE,
  getConnection,
  listConnections,
  upsertConnection,
  deleteConnection,
  markConnectionError,
  getGoogleRefreshToken,
  getMetaAccessToken,
  exchangeMetaLongLived,
  getConnectionsSummary
};
