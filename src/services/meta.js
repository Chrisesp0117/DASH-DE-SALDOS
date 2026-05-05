const axios = require('axios');
const fs = require('fs');

function classifyMetaError(errorInfo) {
  const raw = typeof errorInfo === 'string' ? errorInfo : JSON.stringify(errorInfo || {});
  if (raw.includes('NOT grant ads_management or ads_read permission')) {
    return {
      category: 'permission_denied',
      action: 'reautorizar a conta e verificar permissões ads_read/ads_management',
    };
  }
  if (raw.includes('OAuthException') || raw.includes('token')) {
    return {
      category: 'token_or_auth_error',
      action: 'validar o META_TOKEN e o acesso à conta',
    };
  }
  return {
    category: 'api_error',
    action: 'verificar acesso e tentar novamente',
  };
}

async function getMetaData(accountId, token, context = {}) {
  const accessToken = token || process.env.META_TOKEN;
  const cliente = context.cliente || 'desconhecido';

  if (!accessToken) {
    throw new Error('META token ausente — defina META_TOKEN no ambiente');
  }

  let saldoRes, spend7dRes;

  try {
    [saldoRes, spend7dRes] = await Promise.all([
      axios.get(
        `https://graph.facebook.com/v18.0/${accountId}?fields=spend_cap,amount_spent&access_token=${accessToken}`
        ,
        { timeout: 15000 }
      ),
      axios.get(
        `https://graph.facebook.com/v18.0/${accountId}/insights?level=account&fields=spend&date_preset=last_7d&access_token=${accessToken}`
        ,
        { timeout: 15000 }
      )
    ]);
  } catch (err) {
    const metaInfo = err.response?.data || err.message;
    const classified = classifyMetaError(metaInfo);
    const summary = typeof metaInfo === 'string' ? metaInfo : (metaInfo?.error?.message || metaInfo?.message || 'erro desconhecido');
    const message = `[${new Date().toISOString()}] platform=META cliente="${cliente}" accountId="${accountId}" category="${classified.category}" action="${classified.action}" message="${summary.replace(/"/g, "'")}"`;
    console.error(message);
    try {
      const log = `${message} raw=${JSON.stringify(metaInfo)}\n`;
      fs.appendFileSync('errors.log', log);
    } catch (e) {
      console.error('Failed to write to errors.log:', e.message || e);
    }
    return {
      ok: false,
      error: {
        category: classified.category,
        action: classified.action,
        message: summary
      }
    };
  }

  const data = saldoRes.data;

  const spendCap = data.spend_cap !== undefined && data.spend_cap !== null && data.spend_cap !== ''
    ? parseFloat(data.spend_cap)
    : 0;
  const hasValidSpendCap = Number.isFinite(spendCap) && spendCap > 0;

  let saldo = null;
  const identificador = hasValidSpendCap ? '' : '💳 CARTÃO';
  if (hasValidSpendCap) {
    saldo = (spendCap / 100) - (parseFloat(data.amount_spent || 0) / 100);
  }

  const gasto7d = parseFloat(spend7dRes.data?.data?.[0]?.spend || 0);
  const media = gasto7d / 7;
  const dias = media > 0 ? saldo / media : 0;

  return {
    ok: true,
    saldo: saldo === null ? null : Number(saldo),
    gasto7d: Number(gasto7d),
    media: Number(media),
    dias: Number(dias),
    identificador
  };

}

module.exports = {
  getMetaData
};