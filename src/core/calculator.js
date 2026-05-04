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

function buildRow(cliente, plataforma, data) {
  const isMetaCard = plataforma === 'META' && data && data.identificador === '💳 CARTÃO';
  // Também retorna campos formatados para uso na DATABASE enriquecida
  return {
    data: new Date().toLocaleDateString('pt-BR'),
    cliente,
    plataforma,
    saldo: data.saldo === null || data.saldo === undefined ? null : Number(data.saldo),
    saldoFormatado: isMetaCard
      ? '💳 CARTÃO'
      : formatCurrencyBRL(data.saldo),
    gasto7d: Number(data.gasto7d),
    gasto7dFormatado: formatCurrencyBRL(data.gasto7d),
    media: Number(data.media),
    mediaFormatado: formatCurrencyBRL(data.media),
    dias: Number(data.dias),
    diasFormatado: formatDiasHoras(data.dias),
    identificador: data.identificador || ''
  };
}

module.exports = { buildRow };