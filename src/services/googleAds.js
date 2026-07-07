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

function getMccCandidates() {
  const candidates = [
    process.env.MCC_ID,
    process.env.MCC_FALLBACK_1,
    process.env.MCC_FALLBACK_2
  ]
    .map(normalizeDigits)
    .filter(Boolean);

  return [...new Set(candidates)];
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
  const loginCustomerIds = getMccCandidates();

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
        action: 'validar Customer ID e MCCs',
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

      const spendPromise = withTimeout(customer.query(`
        SELECT
          metrics.cost_micros
        FROM customer
        WHERE segments.date DURING YESTERDAY
      `).then(rows => ({ ok: true, rows })).catch(err => ({ ok: false, err })), 20000, 'google spend query');

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
      try {
        if (!spendResult.ok) {
          throw spendResult.err;
        }
        const spendRows = spendResult.rows;
        gastoOntem = (spendRows && spendRows[0] && spendRows[0].metrics && spendRows[0].metrics.cost_micros) ? spendRows[0].metrics.cost_micros / 1000000 : 0;
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
            identificador: '📂 MANAGER'
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
        identificador: identificador
      };
    }

        message: 'customerId deve ter 10 dígitos e MCCs devem existir'
      }
    };
  }
    const loginAttempts = loginCustomerIds.length ? [...loginCustomerIds, ''] : [''];

    for (const loginCustomerId of loginAttempts) {
  let lastErrorInfo = null;
  let lastLoginCustomerId = '';
  const attempts = [];
        return await queryGoogleAccount(loginCustomerId);
        media: media,
        dias: dias.toFixed(1),
        loginCustomerId: loginCustomerId,
        identificador: identificador
      };
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