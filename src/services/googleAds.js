const { GoogleAdsApi } = require('google-ads-api');
const fs = require('fs');

const ads = new GoogleAdsApi({
  client_id: process.env.CLIENT_ID,
  client_secret: process.env.CLIENT_SECRET,
  developer_token: process.env.DEVELOPER_TOKEN
});

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
  });

  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    timeoutPromise
  ]);
}

function normalizeDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function isValidGoogleCustomerId(value) {
  return /^\d{10}$/.test(normalizeDigits(value));
}

function classifyGoogleError(errorInfo) {
  const raw = typeof errorInfo === 'string' ? errorInfo : JSON.stringify(errorInfo || {});
  if (raw.includes('DEVELOPER_TOKEN_INVALID')) {
    return {
      category: 'invalid_developer_token',
      action: 'validar o DEVELOPER_TOKEN no Google Ads e no ambiente',
    };
  }
  if (raw.includes('USER_PERMISSION_DENIED')) {
    return {
      category: 'permission_denied',
      action: 'verificar permissões do MCC e o login-customer-id',
    };
  }
  if (raw.includes('CUSTOMER_NOT_FOUND')) {
    return {
      category: 'customer_not_found',
      action: 'validar o Customer ID informado na planilha',
    };
  }
  if (raw.includes('CUSTOMER_NOT_ENABLED')) {
    return {
      category: 'customer_not_enabled',
      action: 'confirmar se a conta está ativa ou habilitada',
    };
  }
  if (raw.includes('REQUESTED_METRICS_FOR_MANAGER') || raw.includes('REQUESTED_METRICS_FOR_MANAGER_FOR_MANAGER')) {
    return {
      category: 'manager_metrics',
      action: 'conta do tipo manager; evite solicitar métricas de cliente no MCC',
    };
  }
  if (raw.includes('UNRECOGNIZED_FIELD')) {
    return {
      category: 'unrecognized_field',
      action: 'remover campos GAQL inválidos e usar fallback',
    };
  }
  if (raw.includes('INVALID_ARGUMENT') || raw.includes('invalid')) {
    return {
      category: 'invalid_argument',
      action: 'revisar o Customer ID e MCC ID',
    };
  }
  return {
    category: 'api_error',
    action: 'verificar acesso e tentar novamente',
  };
}

function summarizeGoogleError(errorInfo) {
  const raw = typeof errorInfo === 'string' ? errorInfo : JSON.stringify(errorInfo || {});
  if (raw.includes('USER_PERMISSION_DENIED')) {
    return 'User does not have permission to access the customer.';
  }
  if (raw.includes('CUSTOMER_NOT_FOUND')) {
    return 'No customer found for the provided customer id.';
  }
  if (raw.includes('CUSTOMER_NOT_ENABLED')) {
    return 'The customer account is not enabled or has been deactivated.';
  }
  if (Array.isArray(errorInfo)) {
    const first = errorInfo[0] || {};
    if (first.message) return first.message;
    return JSON.stringify(first);
  }
  if (errorInfo && typeof errorInfo === 'object') {
    if (errorInfo.message) return errorInfo.message;
    return JSON.stringify(errorInfo);
  }
  if (typeof errorInfo === 'string') return errorInfo;
  return 'erro desconhecido';
}

async function getGoogleData(customerId, refreshToken, context = {}) {
  const rt = refreshToken || process.env.REFRESH_TOKEN;
  const cliente = context.cliente || 'desconhecido';
  const loginCustomerIds = [...new Set([
    normalizeDigits(context.loginCustomerId)
  ])].filter(Boolean);

  if (!isValidGoogleCustomerId(customerId)) {
    const message = `[${new Date().toISOString()}] platform=GOOGLE cliente="${cliente}" customerId="${customerId || ''}" mccIds="${loginCustomerIds.join(',')}" category="invalid_input" action="validar Customer ID" message="customerId deve ter 10 dígitos"`;
    console.error(message);
    try {
      fs.appendFileSync('errors.log', `${message}\n`);
    } catch (e) {
      console.error('Failed to write to errors.log:', e.message || e);
    }
    return {
      ok: false,
      error: {
        category: 'invalid_input',
        action: 'validar Customer ID',
        message: 'customerId deve ter 10 dígitos'
      }
    };
  }

  async function queryGoogleAccount(loginCustomerId) {
    const customerOptions = {
      customer_id: customerId,
      refresh_token: rt
    };

    if (loginCustomerId) {
      customerOptions.login_customer_id = loginCustomerId;
    }

    const customer = ads.Customer(customerOptions);

    const budgetPromise = withTimeout(customer.query(`
      SELECT
        account_budget.adjusted_spending_limit_micros,
        account_budget.approved_spending_limit_micros,
        account_budget.amount_served_micros
      FROM account_budget
    `), 20000, 'google budget query');

    // Métricas de ontem (contrato). "Resultados" = conversions (coluna Conversões,
    // primárias); "Leads" = all_conversions (Todas as conversões, inclui cross-device).
    const CORE_METRICS_QUERY = `
      SELECT
        metrics.cost_micros,
        metrics.clicks,
        metrics.impressions,
        metrics.conversions,
        metrics.all_conversions,
        metrics.ctr,
        metrics.average_cpc
      FROM customer
      WHERE segments.date DURING YESTERDAY
    `;

    // Alcance/frequência nem sempre são aceitas com segmento de data em todas as
    // contas — por isso são tentadas primeiro e há fallback para o conjunto básico.
    const FULL_METRICS_QUERY = `
      SELECT
        metrics.cost_micros,
        metrics.clicks,
        metrics.impressions,
        metrics.conversions,
        metrics.all_conversions,
        metrics.ctr,
        metrics.average_cpc,
        metrics.reach,
        metrics.average_impression_frequency_per_user
      FROM customer
      WHERE segments.date DURING YESTERDAY
    `;

    const spendPromise = withTimeout((async () => {
      try {
        const rows = await customer.query(FULL_METRICS_QUERY);
        return { ok: true, rows };
      } catch (err) {
        try {
          const rows = await customer.query(CORE_METRICS_QUERY);
          return { ok: true, rows, reducedMetrics: true };
        } catch (err2) {
          return { ok: false, err: err2 };
        }
      }
    })(), 20000, 'google spend query');

    const budgetRows = await budgetPromise;
    const spendResult = await spendPromise;

    const saldos = (budgetRows || []).map(function (r) {
      const acc = r.account_budget || {};
      const adj = acc.adjusted_spending_limit_micros || 0;
      const app = acc.approved_spending_limit_micros || 0;
      const limite = (adj || app) / 1000000;
      const gasto = (acc.amount_served_micros || 0) / 1000000;
      return limite - gasto;
    }).filter(function (v) { return v > 0; });

    const saldo = saldos.length ? Math.max.apply(null, saldos) : 0;
    let identificador = '';

    if (!saldos.length) {
      identificador = '💳 CARTÃO';
    } else {
      identificador = '🟡 PRÉ-PAGO';
    }

    let gastoOntem = 0;
    let performance = {
      leads: null,
      resultados: null,
      mensagens: null,
      ctr: null,
      cpc: null,
      frequencia: null
    };
    try {
      if (!spendResult.ok) {
        throw spendResult.err;
      }
      const spendRows = spendResult.rows;
      const m = (spendRows && spendRows[0] && spendRows[0].metrics) || {};
      gastoOntem = m.cost_micros ? m.cost_micros / 1000000 : 0;

      // Insights de performance de ontem
      const impressoes = Number(m.impressions || 0);
      const alcance = Number(m.reach || 0);
      const freqBruta = m.average_impression_frequency_per_user != null
        ? Number(m.average_impression_frequency_per_user)
        : null;
      const frequencia = (freqBruta !== null && Number.isFinite(freqBruta) && freqBruta > 0)
        ? freqBruta
        : (alcance > 0 ? impressoes / alcance : null);

      performance = {
        // Resultados = "Conversões" (primárias) | Leads = "Todas as conversões"
        resultados: Number.isFinite(Number(m.conversions)) ? Number(m.conversions) : 0,
        leads: Number.isFinite(Number(m.all_conversions)) ? Number(m.all_conversions) : 0,
        mensagens: null, // não há métrica de mensagens equivalente no Google Ads
        ctr: Number(m.ctr || 0) * 100, // GAQL devolve razão; padroniza em pontos percentuais
        cpc: m.average_cpc ? m.average_cpc / 1000000 : 0,
        frequencia: frequencia !== null && Number.isFinite(frequencia) ? Number(frequencia.toFixed(2)) : null
      };
    } catch (spendErr) {
      const rawSpend = (spendErr && spendErr.response && JSON.stringify(spendErr.response.errors)) || (spendErr && spendErr.message) || String(spendErr);
      if (rawSpend.includes('REQUESTED_METRICS_FOR_MANAGER')) {
        const msg = `[${new Date().toISOString()}] platform=GOOGLE cliente="${cliente}" customerId="${customerId}" loginCustomerId="${loginCustomerId || ''}" category="manager_metrics" action="evitar métricas em MCC" message="requested_metrics_for_manager"`;
        console.warn(msg);
        try { fs.appendFileSync('errors.log', `${msg} raw=${rawSpend}\n`); } catch (e) { /* ignore */ }
        return {
          ok: true,
          saldo: 0,
          gastoOntem: 0,
          gasto7d: 0,
          media: 0,
          dias: 0,
          loginCustomerId: loginCustomerId || '',
          identificador: '📂 MANAGER',
          leads: null,
          resultados: null,
          mensagens: null,
          ctr: null,
          cpc: null,
          frequencia: null
        };
      }
      throw spendErr;
    }

    const media = gastoOntem;
    const dias = media > 0 ? saldo / media : 0;

    return {
      saldo: saldo,
      gastoOntem: gastoOntem,
      gasto7d: gastoOntem,
      media: media,
      dias: dias.toFixed(1),
      loginCustomerId: loginCustomerId || '',
      identificador: identificador,
      leads: performance.leads,
      resultados: performance.resultados,
      mensagens: performance.mensagens,
      ctr: performance.ctr,
      cpc: performance.cpc,
      frequencia: performance.frequencia
    };
  }

  let lastErrorInfo = null;
  let lastLoginCustomerId = '';
  const attempts = [];
  const loginAttempts = loginCustomerIds.length ? [...loginCustomerIds, ''] : [''];

  for (const loginCustomerId of loginAttempts) {
    lastLoginCustomerId = loginCustomerId;

    try {
      return await queryGoogleAccount(loginCustomerId);
    } catch (err) {
      const rawErr = (err && err.response && err.response.errors) ? err.response.errors : (err && err.message) ? err.message : err;
      lastErrorInfo = rawErr;
      const classified = classifyGoogleError(rawErr);
      const summary = summarizeGoogleError(rawErr);
      attempts.push({ loginCustomerId, category: classified.category, message: summary });
      const attemptMsg = `[${new Date().toISOString()}] platform=GOOGLE cliente="${cliente}" customerId="${customerId}" loginCustomerId="${loginCustomerId}" attempt=true category="${classified.category}" action="${classified.action}" message="${String(summary).replace(/"/g, "'")}"`;
      try { fs.appendFileSync('errors.log', `${attemptMsg} raw=${JSON.stringify(rawErr)}\n`); } catch (e) { /* ignore */ }
    }
  }

  const classified = classifyGoogleError(lastErrorInfo);
  const summary = summarizeGoogleError(lastErrorInfo);
  const message = `[${new Date().toISOString()}] platform=GOOGLE cliente="${cliente}" customerId="${customerId}" mccIds="${loginCustomerIds.join(',')}" loginCustomerId="${lastLoginCustomerId}" category="${classified.category}" action="${classified.action}" message="${summary.replace(/"/g, "'")}"`;
  console.error(message);
  try {
    const log = `${message} raw=${JSON.stringify(lastErrorInfo)}\n`;
    fs.appendFileSync('errors.log', log);
  } catch (e) {
    console.error('Failed to write to errors.log:', e.message || e);
  }
  return {
    ok: false,
    error: {
      category: classified.category,
      action: classified.action,
      message: summary,
      attempts: attempts
    }
  };
}

module.exports = { getGoogleData };