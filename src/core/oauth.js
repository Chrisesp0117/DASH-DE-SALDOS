/**
 * oauth.js — helpers do fluxo OAuth 2.0 para Google Ads e Meta Ads.
 *
 * Usado pelos endpoints /api/auth/* da página de configurações web.
 * Os tokens resultantes são salvos em app_connections (Supabase) pelo
 * serviço connections.js.
 */
const axios = require('axios');

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/adwords',
  'https://www.googleapis.com/auth/userinfo.email'
].join(' ');

const META_DIALOG_VERSION = process.env.META_GRAPH_VERSION || 'v18.0';
const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v18.0';
const META_SCOPES = 'ads_read,business_management';

/**
 * Base URL pública da request (Vercel: x-forwarded-proto + host).
 */
function getBaseUrl(req) {
  const headers = (req && req.headers) || {};
  const host = String(headers.host || headers.Host || 'localhost:3000');
  const proto = String(headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  return proto + '://' + host;
}

function getGoogleRedirectUri(req) {
  return process.env.GOOGLE_OAUTH_REDIRECT_URI || (getBaseUrl(req) + '/api/auth/google/callback');
}

function getMetaRedirectUri(req) {
  return process.env.META_OAUTH_REDIRECT_URI || (getBaseUrl(req) + '/api/auth/meta/callback');
}

function buildGoogleAuthUrl(redirectUri, state) {
  const params = new URLSearchParams({
    client_id: process.env.CLIENT_ID || '',
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state
  });
  return GOOGLE_AUTH_URL + '?' + params.toString();
}

function buildMetaAuthUrl(redirectUri, state) {
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID || '',
    redirect_uri: redirectUri,
    state,
    scope: META_SCOPES
  });
  return `https://www.facebook.com/${META_DIALOG_VERSION}/dialog/oauth?` + params.toString();
}

/**
 * Troca o code do Google por tokens (inclui refresh_token quando
 * access_type=offline + prompt=consent).
 */
async function exchangeGoogleCode(code, redirectUri) {
  if (!process.env.CLIENT_ID || !process.env.CLIENT_SECRET) {
    throw new Error('CLIENT_ID/CLIENT_SECRET não configurados no ambiente');
  }
  const res = await axios.post(
    GOOGLE_TOKEN_URL,
    new URLSearchParams({
      code,
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    }).toString(),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000
    }
  );
  return res.data || {};
}

/**
 * Troca o code do Meta por um access token de curta duração.
 */
async function exchangeMetaCode(code, redirectUri) {
  if (!process.env.META_APP_ID || !process.env.META_APP_SECRET) {
    throw new Error('META_APP_ID/META_APP_SECRET não configurados no ambiente');
  }
  const res = await axios.get(
    `https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`,
    {
      params: {
        client_id: process.env.META_APP_ID,
        client_secret: process.env.META_APP_SECRET,
        redirect_uri: redirectUri,
        code
      },
      timeout: 15000
    }
  );
  return res.data || {};
}

/**
 * Identidade da conta Google conectada (e-mail) via userinfo.
 * Fallback: decodifica o payload do id_token (se o escopo openid/email vier).
 */
async function getGoogleUserEmail(accessToken, idToken) {
  try {
    const res = await axios.get(GOOGLE_USERINFO_URL, {
      headers: { Authorization: 'Bearer ' + accessToken },
      timeout: 10000
    });
    if (res.data && res.data.email) return String(res.data.email);
  } catch (e) {
    console.warn('[getGoogleUserEmail] userinfo falhou:', e && e.message);
  }
  if (idToken) {
    try {
      const payload = idToken.split('.')[1];
      if (payload) {
        const json = JSON.parse(Buffer.from(payload, 'base64').toString('utf-8'));
        if (json && json.email) return String(json.email);
      }
    } catch (e) {
      console.warn('[getGoogleUserEmail] id_token decode falhou:', e && e.message);
    }
  }
  return '';
}

/**
 * Identidade do usuário Meta conectado (id + nome).
 */
async function getMetaUser(accessToken) {
  const res = await axios.get(
    `https://graph.facebook.com/${META_GRAPH_VERSION}/me`,
    {
      params: { fields: 'id,name', access_token: accessToken },
      timeout: 10000
    }
  );
  return res.data || {};
}

/**
 * Lê o body JSON de uma request serverless (Vercel costuma entregar req.body
 * já parseado; trata string/buffer como fallback).
 */
async function readJsonBody(req) {
  if (req && req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch (_) {
      return {};
    }
  }
  if (req && typeof req.on === 'function') {
    return new Promise((resolve) => {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        try {
          resolve(raw ? JSON.parse(raw) : {});
        } catch (_) {
          resolve({});
        }
      });
      req.on('error', () => resolve({}));
    });
  }
  return {};
}

function sendRedirect(res, location) {
  if (res && typeof res.setHeader === 'function' && typeof res.end === 'function') {
    res.statusCode = 302;
    res.setHeader('Location', location);
    res.end('');
    return;
  }
  if (typeof Response !== 'undefined') {
    return new Response(null, { status: 302, headers: { Location: location } });
  }
  return { statusCode: 302, headers: { Location: location }, body: '' };
}

module.exports = {
  GOOGLE_SCOPES,
  META_SCOPES,
  getBaseUrl,
  getGoogleRedirectUri,
  getMetaRedirectUri,
  buildGoogleAuthUrl,
  buildMetaAuthUrl,
  exchangeGoogleCode,
  exchangeMetaCode,
  getGoogleUserEmail,
  getMetaUser,
  readJsonBody,
  sendRedirect
};
