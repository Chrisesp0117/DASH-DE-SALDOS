/**
 * Lógica compartilhada de severidade das linhas (SUPERVISOR + DASH-{Gestor}).
 *
 * Identidade de cores por duração restante (saldo):
 *   - durar 6 dias ou menos -> AMARELO
 *   - durar 4 dias ou menos -> LARANJA
 *   - durar 2 dias ou menos -> VERMELHO
 *
 * Além disso, conta que não está gastando (gasto de ontem <= 0) fica VERMELHA.
 *
 * Este módulo é a fonte única: os dois geradores de aba usam os mesmos
 * parsers e as mesmas cores, então o SUPERVISOR e o DASH-{Gestor} nunca
 * divergem.
 */

function parseLocaleNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const raw = String(value === null || value === undefined ? '' : value).trim();
  if (!raw || raw === '-') {
    return null;
  }

  let cleaned = raw.replace(/[^\d,.-]/g, '');
  if (!cleaned) {
    return null;
  }

  if (cleaned.includes(',') && cleaned.includes('.')) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (cleaned.includes(',')) {
    cleaned = cleaned.replace(',', '.');
  }

  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseDias(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const text = String(value === null || value === undefined ? '' : value).trim().toLowerCase();
  if (!text || text === '-') {
    return null;
  }

  const diasMatch = text.match(/(\d+)\s*dias?/i);
  const horasMatch = text.match(/(\d+)\s*horas?/i);
  if (diasMatch || horasMatch) {
    const dias = diasMatch ? Number(diasMatch[1]) : 0;
    const horas = horasMatch ? Number(horasMatch[1]) : 0;
    return dias + horas / 24;
  }

  return parseLocaleNumber(text);
}

function severityFromDias(dias) {
  if (dias === null || dias === undefined) {
    return null;
  }
  if (dias <= 2) return 'red';
  if (dias <= 4) return 'orange';
  if (dias <= 6) return 'yellow';
  return null;
}

/**
 * Severidade de uma linha de conta.
 *
 * @param {object} row
 * @param {*} row.dias       Duração restante ("5 dias", "10 horas", "3,5" ou número). Alias: row.duracao.
 * @param {*} row.gastoOntem Gasto de ontem (número ou texto pt-BR).
 * @returns {'red'|'orange'|'yellow'|null} null = linha normal (zebra da plataforma).
 */
function getRowSeverity({ dias, duracao, gastoOntem } = {}) {
  const gasto = parseLocaleNumber(gastoOntem);

  // Conta que não está gastando (gasto zerado/negativo) -> vermelho.
  if (gasto !== null && gasto <= 0) {
    return 'red';
  }

  const diasValue = dias !== undefined ? dias : duracao;
  return severityFromDias(parseDias(diasValue));
}

// Cores compartilhadas (RGB fracionário, formato da Sheets API).
// Vermelho usa texto branco; amarelo e laranja usam texto preto (legibilidade).
const SEVERITY_STYLES = {
  yellow: {
    background: { red: 1, green: 0.85, blue: 0.26 },
    foreground: { red: 0, green: 0, blue: 0 }
  },
  orange: {
    background: { red: 0.96, green: 0.52, blue: 0.04 },
    foreground: { red: 0, green: 0, blue: 0 }
  },
  red: {
    background: { red: 0.82, green: 0.18, blue: 0.18 },
    foreground: { red: 1, green: 1, blue: 1 }
  }
};

module.exports = {
  parseLocaleNumber,
  parseDias,
  severityFromDias,
  getRowSeverity,
  SEVERITY_STYLES
};
