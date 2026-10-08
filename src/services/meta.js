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

function getActionValue(actions, actionType) {
  const entry = (actions || []).find(a => a && a.action_type === actionType);
  if (!entry) return null;
  return parseMetaAmount(entry.value);
}

/**
 * Leads do Meta (ontem): prioriza os leads no Facebook ("onsite_conversion.lead_grouped",
 * a coluna "Leads" do Ads Manager em campanhas de geração de leads) e soma os leads
 * do site (pixel/CAPI, action_type "lead"). Evita somar "lead" e "lead_grouped"
 * duplicadamente — são formas alternativas de contar o mesmo envio de formulário.
 */
function extractMetaLeads(actions) {
  const grouped = getActionValue(actions, 'onsite_conversion.lead_grouped');
  const onFacebook = getActionValue(actions, 'onsite_conversion.lead');
  const website = getActionValue(actions, 'lead');

  const onFacebookTotal = grouped !== null ? grouped : onFacebook;
  const parts = [];
  if (onFacebookTotal !== null) parts.push(onFacebookTotal);
  if (website !== null) parts.push(website);
  if (!parts.length) return null;
  return parts.reduce((sum, v) => sum + v, 0);
}

/**
 * Mensagens (ontem): "conversas de mensagem iniciadas" (métrica do Ads Manager).
 * Se não existir, soma qualquer action de messaging como aproximação.
 */
function extractMetaMensagens(actions) {
  const conversas = getActionValue(actions, 'onsite_conversion.messaging_conversation_started_7d');
  if (conversas !== null) return conversas;

  let total = null;
  for (const a of actions || []) {
    if (a && String(a.action_type || '').includes('messaging')) {
      total = (total || 0) + parseMetaAmount(a.value);
    }
  }
  return total;
}

/**
 * Resultados (ontem): campo `results` das insights — é a própria coluna
 * "Resultados" do Ads Manager (baseada no objetivo de cada campanha).
 */
function sumInsightsResults(results) {
  if (!Array.isArray(results) || results.length === 0) return null;
  let total = 0;
  for (const r of results) {
    total += parseMetaAmount(r && r.value);
  }
  return total;
}

async function getMetaData(accountId, token, context = {}) {
  const accessToken = token || process.env.META_TOKEN;
  const cliente = context.cliente || 'desconhecido';

  if (!accessToken) {
    throw new Error('META token ausente — defina META_TOKEN no ambiente');
  }

  // A Graph API exige o prefixo act_ para nós de conta de anúncio.
  // Aceita tanto "act_123..." (formato antigo da CONFIGS) quanto "123..." puro
  // (formato salvo pela página web) e normaliza sempre para act_<id>.
  const digits = String(accountId || '').replace(/\D/g, '');
  if (!digits) {
    throw new Error('ID da conta Meta ausente/inválido: "' + String(accountId || '') + '"');
  }
  const adAccountId = 'act_' + digits;

  let saldoRes, spend7dRes;

  // Insights enriquecidas (v21): a v18 não possui o campo `results`.
  // Se a chamada enriquecida falhar, cai para a versão legada (v18, apenas spend)
  // para não comprometer o gasto de ontem / saldo / dias restantes.
  const fetchInsights = async () => {
    try {
      const res = await axios.get(
        `https://graph.facebook.com/v21.0/${adAccountId}/insights?level=account&fields=spend,clicks,impressions,ctr,cpc,frequency,results,actions&date_preset=yesterday&access_token=${accessToken}`,
        { timeout: 15000 }
      );
      return { data: res.data, enriquecida: true };
    } catch (err) {
      const res = await axios.get(
        `https://graph.facebook.com/v18.0/${adAccountId}/insights?level=account&fields=spend&date_preset=yesterday&access_token=${accessToken}`,
        { timeout: 15000 }
      );
      return { data: res.data, enriquecida: false };
    }
  };

  try {
    [saldoRes, spend7dRes] = await Promise.all([
      axios.get(
        `https://graph.facebook.com/v18.0/${adAccountId}?fields=spend_cap,amount_spent&access_token=${accessToken}`
        ,
        { timeout: 15000 }
      ),
      fetchInsights()
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

  // Insights de performance de ontem (apenas quando a chamada enriquecida funcionou)
  const insightsRow = spend7dRes.data?.data?.[0] || null;
  const enriquecida = spend7dRes.enriquecida === true;
  const leads = enriquecida ? extractMetaLeads(insightsRow?.actions) : null;
  const resultados = enriquecida ? sumInsightsResults(insightsRow?.results) : null;
  const mensagens = enriquecida ? extractMetaMensagens(insightsRow?.actions) : null;
  const ctr = enriquecida && insightsRow?.ctr != null && insightsRow.ctr !== ''
    ? parseMetaAmount(insightsRow.ctr)
    : null;
  const cpc = enriquecida && insightsRow?.cpc != null && insightsRow.cpc !== ''
    ? parseMetaAmount(insightsRow.cpc)
    : null;
  const frequencia = enriquecida && insightsRow?.frequency != null && insightsRow.frequency !== ''
    ? parseMetaAmount(insightsRow.frequency)
    : null;

  return {
    ok: true,
    saldo: saldo === null ? null : Number(saldo),
    spendCap: hasValidSpendCap ? Number(spendCapMajor) : null,
    amountSpent: hasValidSpendCap ? Number(amountSpentMajor) : null,
    gastoOntem: Number(gastoOntem),
    gasto7d: Number(gastoOntem),
    media: Number(media),
    dias: Number(dias),
    identificador,
    leads: leads === null ? null : Number(leads),
    resultados: resultados === null ? null : Number(resultados),
    mensagens: mensagens === null ? null : Number(mensagens),
    ctr: ctr === null ? null : Number(ctr),
    frequencia: frequencia === null ? null : Number(frequencia),
    cpc: cpc === null ? null : Number(cpc)
  };

}

module.exports = {
  getMetaData
};