function formatCurrencyBRL(value) {
  const n = Number(value || 0);
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(n);
}

function formatDiasHoras(diasValue) {
  const totalDias = Math.max(0, Number(diasValue || 0));
  const diasInteiros = Math.floor(totalDias);
  const horas = Math.floor((totalDias - diasInteiros) * 24);

  const dd = String(diasInteiros).padStart(2, '0');
  const hh = String(horas).padStart(2, '0');

  return `${dd} dias e ${hh} horas`;
}

function formatTimestampPTBR(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  const safeDate = Number.isNaN(value.getTime()) ? new Date() : value;

  const datePart = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Manaus',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(safeDate);

  const timePart = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Manaus',
    hour: '2-digit',
    minute: '2-digit'
  }).format(safeDate);

  return `${datePart} às ${timePart}`;
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== '';
}

function formatIntBR(value) {
  if (!hasValue(value)) return '-';
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(n);
}

function formatPercentBR(value) {
  if (!hasValue(value)) return '-';
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + '%';
}

function formatDecimal2BR(value) {
  if (!hasValue(value)) return '-';
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function formatCurrencyOrDash(value) {
  if (!hasValue(value)) return '-';
  return formatCurrencyBRL(value);
}

function buildRow(cliente, plataforma, data, timestamp = new Date()) {
  const isMetaCard = plataforma === 'META' && data && data.identificador === '💳 CARTÃO';
  const writeTimestamp = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const safeTimestamp = Number.isNaN(writeTimestamp.getTime()) ? new Date() : writeTimestamp;
  // Também retorna campos formatados para uso na DATABASE enriquecida
  return {
    data: formatTimestampPTBR(safeTimestamp),
    dataIso: safeTimestamp.toISOString(),
    cliente,
    plataforma,
    saldo: data.saldo === null || data.saldo === undefined ? null : Number(data.saldo),
    saldoFormatado: isMetaCard
      ? '💳 CARTÃO'
      : formatCurrencyBRL(data.saldo),
    gastoOntem: Number(data.gastoOntem ?? data.gasto7d),
    gastoOntemFormatado: formatCurrencyBRL(data.gastoOntem ?? data.gasto7d),
    gasto7d: Number(data.gastoOntem ?? data.gasto7d),
    gasto7dFormatado: formatCurrencyBRL(data.gastoOntem ?? data.gasto7d),
    media: Number(data.media),
    mediaFormatado: formatCurrencyBRL(data.media),
    dias: Number(data.dias),
    diasFormatado: formatDiasHoras(data.dias),
    identificador: data.identificador || '',
    // Insights de performance (ontem) — null quando a API não retornou
    leads: hasValue(data.leads) ? Number(data.leads) : null,
    leadsFormatado: formatIntBR(data.leads),
    resultados: hasValue(data.resultados) ? Number(data.resultados) : null,
    resultadosFormatado: formatIntBR(data.resultados),
    mensagens: hasValue(data.mensagens) ? Number(data.mensagens) : null,
    mensagensFormatado: formatIntBR(data.mensagens),
    ctr: hasValue(data.ctr) ? Number(data.ctr) : null,
    ctrFormatado: formatPercentBR(data.ctr),
    frequencia: hasValue(data.frequencia) ? Number(data.frequencia) : null,
    frequenciaFormatado: formatDecimal2BR(data.frequencia),
    cpc: hasValue(data.cpc) ? Number(data.cpc) : null,
    cpcFormatado: formatCurrencyOrDash(data.cpc)
  };
}

module.exports = { buildRow };