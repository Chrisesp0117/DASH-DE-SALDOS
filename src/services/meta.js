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

function parseMetaAmount(value, assumeMinorWhenInteger = false) {
  if (value === null || value === undefined || value === '') return 0;
  const raw = String(value).trim();
  if (!raw) return 0;
  const normalized = raw.replace(/\s/g, '').replace(',', '.');
  const cleaned = normalized.replace(/[^\d.-]/g, '');
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return 0;
  if (assumeMinorWhenInteger && !/[.,]/.test(raw)) {
    return n / 100;
  }
  return n;
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
        `https://graph.facebook.com/v18.0/${accountId}/insights?level=account&fields=spend&date_preset=yesterday&access_token=${accessToken}`
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

  const spendCapMajor = parseMetaAmount(data.spend_cap, true);
  const amountSpentMajor = parseMetaAmount(data.amount_spent, true);
  const hasValidSpendCap = Number.isFinite(spendCapMajor) && spendCapMajor > 0;

  let saldo = null;
  const identificador = hasValidSpendCap ? '' : '💳 CARTÃO';
  if (hasValidSpendCap) {
    const rawSaldo = Math.max(0, spendCapMajor - amountSpentMajor);
    // Ajuste global baseado na média histórica entre API e painel do Meta
    const globalAdjPct = Number(process.env.META_GLOBAL_ADJUST_PCT) || 13.85;
    saldo = Number((rawSaldo * (1 + globalAdjPct / 100)).toFixed(2));
  }

  const gastoOntem = parseMetaAmount(spend7dRes.data?.data?.[0]?.spend, false);
  const media = gastoOntem;
  const dias = media > 0 && saldo !== null ? saldo / media : 0;

  return {
    ok: true,
    saldo: saldo === null ? null : Number(saldo),
    spendCap: hasValidSpendCap ? Number(spendCapMajor) : null,
    amountSpent: hasValidSpendCap ? Number(amountSpentMajor) : null,
    gastoOntem: Number(gastoOntem),
    gasto7d: Number(gastoOntem),
    media: Number(media),
    dias: Number(dias),
    identificador
  };

}

module.exports = {
  getMetaData
};