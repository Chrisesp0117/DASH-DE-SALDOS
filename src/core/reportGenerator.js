function formatDiasHoras(diasValue) {
  const totalDias = Math.max(0, Number(diasValue || 0));
  const diasInteiros = Math.floor(totalDias);
  const horas = Math.floor((totalDias - diasInteiros) * 24);
  const dd = String(diasInteiros).padStart(2, '0');
  const hh = String(horas).padStart(2, '0');
  return `${dd}d ${hh}h`;
}

function parseDiasValue(value) {
  if (value === null || value === undefined || value === '-' || value === '') return null;
  const text = String(value).trim().toLowerCase();
  const diasMatch = text.match(/(\d+)\s*di/i);
  const horasMatch = text.match(/(\d+)\s*hor/i);
  if (diasMatch || horasMatch) {
    const dias = diasMatch ? Number(diasMatch[1]) : 0;
    const horas = horasMatch ? Number(horasMatch[1]) : 0;
    return dias + horas / 24;
  }
  const numeric = Number(text.replace(',', '.'));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function parseCurrency(value) {
  if (!value || value === '-') return 0;
  const str = String(value).replace(/[^\d,]/g, '').replace(',', '.');
  return parseFloat(str) || 0;
}

function separator() {
  return '────────────────────';
}

function classifyByDias(diasNum) {
  if (diasNum === null) return 'sem_info';
  if (diasNum <= 0) return 'zerado';
  if (diasNum <= 3) return 'critico';
  if (diasNum <= 7) return 'atencao';
  if (diasNum <= 15) return 'alerta';
  return 'ok';
}

const CRITICAL_EMOJI = '🔴';
const ATENCAO_EMOJI = '🟠';
const ALERTA_EMOJI = '🟡';
const OK_EMOJI = '🟢';
const ERRO_EMOJI = '❌';

function emojiForClass(cls) {
  switch (cls) {
    case 'critico': return CRITICAL_EMOJI;
    case 'atencao': return ATENCAO_EMOJI;
    case 'alerta': return ALERTA_EMOJI;
    case 'ok': return OK_EMOJI;
    case 'zerado': return '⛔';
    default: return '⚪';
  }
}

const { readDatabaseRows } = require('../services/supabase');

async function generateReport(sheets, spreadsheetId) {
  try {
    const rows = await readDatabaseRows();

    if (rows.length === 0) {
      return '📊 Nenhum dado para exibir.';
    }

    const updated = [];
    const errors = [];

    for (const r of rows) {
      const cliente = r[1] || '-';
      const plataforma = r[2] || '-';
      const saldo = r[3] || '-';
      const gastoOntem = r[4] || '-';
      const media = r[5] || '-';
      const dias = r[6] || '-';
      const gestor = r[7] || '-';
      const supervisor = r[8] || '-';
      const status = r[9] || 'Desconhecido';
      const obs = r[10] || '';
      const identificador = r[12] || '';

      const diasNum = parseDiasValue(dias);
      const cls = classifyByDias(diasNum);
      const saldoNum = parseCurrency(saldo);

      const item = {
        cliente, plataforma, saldo, saldoNum, gastoOntem, media, dias, diasNum,
        gestor, supervisor, status, obs, identificador, cls
      };

      if (String(status).toLowerCase() === 'atualizada') {
        updated.push(item);
      } else {
        errors.push(item);
      }
    }

    let msg = '<b>📊 RELATÓRIO DE SALDOS</b>\n';
    msg += `<i>${new Date().toLocaleString('pt-BR')}</i>\n\n`;

    const byGestor = new Map();
    for (const item of updated) {
      const key = item.gestor || '-';
      if (!byGestor.has(key)) byGestor.set(key, []);
      byGestor.get(key).push(item);
    }

    const errorByGestor = new Map();
    for (const item of errors) {
      const key = item.gestor || '-';
      if (!errorByGestor.has(key)) errorByGestor.set(key, []);
      errorByGestor.get(key).push(item);
    }

    let totalSaldo = 0;
    for (const item of updated) {
      totalSaldo += item.saldoNum;
    }

    const criticos = updated.filter(i => i.cls === 'critico');
    const atencao = updated.filter(i => i.cls === 'atencao');
    const alerta = updated.filter(i => i.cls === 'alerta');
    const zerados = updated.filter(i => i.cls === 'zerado');

    msg += '<b>📈 RESUMO GERAL</b>\n';
    msg += `✅ Atualizadas: <b>${updated.length}</b>\n`;
    msg += `❌ Com erro: <b>${errors.length}</b>\n`;
    msg += `💰 Saldo total: <b>R$ ${totalSaldo.toFixed(2)}</b>\n`;
    msg += `${separator()}\n`;
    msg += `${CRITICAL_EMOJI} Crítico (0-3 dias): <b>${criticos.length}</b>\n`;
    msg += `${ATENCAO_EMOJI} Atenção (4-7 dias): <b>${atencao.length}</b>\n`;
    msg += `${ALERTA_EMOJI} Alerta (8-15 dias): <b>${alerta.length}</b>\n`;
    msg += `⛔ Saldo zerado: <b>${zerados.length}</b>\n`;
    msg += `👥 Gestores com contas: <b>${byGestor.size}</b>\n`;
    msg += `${separator()}\n\n`;

    if (criticos.length > 0) {
      msg += `<b>🚨 CRÍTICO — Saldo até 3 dias</b>\n\n`;
      const criticosByGestor = new Map();
      for (const item of criticos) {
        const key = item.gestor || '-';
        if (!criticosByGestor.has(key)) criticosByGestor.set(key, []);
        criticosByGestor.get(key).push(item);
      }

      for (const [gestor, items] of criticosByGestor.entries()) {
        msg += `${separator()}\n`;
        msg += `👤 <b>${gestor}</b>\n`;
        for (const item of items) {
          msg += `${CRITICAL_EMOJI} <b>${item.cliente}</b> [${item.plataforma}]\n`;
          if (item.identificador) {
            msg += `   💳 ${item.identificador}\n`;
          }
          msg += `   💰 Saldo: <b>${item.saldo}</b>\n`;
          msg += `   📉 Gasto ontem: ${item.gastoOntem}\n`;
          msg += `   ⏳ Duração: <b>${item.dias}</b>\n`;
          if (item.supervisor) {
            msg += `   🧑‍💼 Supervisor: ${item.supervisor}\n`;
          }
          msg += `\n`;
        }
      }
      msg += `${separator()}\n\n`;
    }

    if (atencao.length > 0) {
      msg += `<b>⚠️ ATENÇÃO — Saldo 4 a 7 dias</b>\n\n`;
      const atencaoByGestor = new Map();
      for (const item of atencao) {
        const key = item.gestor || '-';
        if (!atencaoByGestor.has(key)) atencaoByGestor.set(key, []);
        atencaoByGestor.get(key).push(item);
      }

      for (const [gestor, items] of atencaoByGestor.entries()) {
        msg += `${separator()}\n`;
        msg += `👤 <b>${gestor}</b>\n`;
        for (const item of items) {
          msg += `${ATENCAO_EMOJI} <b>${item.cliente}</b> [${item.plataforma}]\n`;
          if (item.identificador) {
            msg += `   💳 ${item.identificador}\n`;
          }
          msg += `   💰 Saldo: <b>${item.saldo}</b>\n`;
          msg += `   📉 Gasto ontem: ${item.gastoOntem}\n`;
          msg += `   ⏳ Duração: <b>${item.dias}</b>\n\n`;
        }
      }
      msg += `${separator()}\n\n`;
    }

    if (alerta.length > 0) {
      msg += `<b>🟡 ALERTA — Saldo 8 a 15 dias</b>\n\n`;
      for (const item of alerta) {
        msg += `${ALERTA_EMOJI} ${item.cliente} [${item.plataforma}] — ${item.gestor}\n`;
        msg += `   💰 ${item.saldo} | ⏳ ${item.dias}\n`;
      }
      msg += `\n${separator()}\n\n`;
    }

    if (zerados.length > 0) {
      msg += `<b>⛔ SALDO ZERADO</b>\n\n`;
      for (const item of zerados) {
        msg += `⛔ ${item.cliente} [${item.plataforma}] — ${item.gestor}\n`;
        if (item.obs) {
          msg += `   Obs: ${item.obs.substring(0, 80)}\n`;
        }
      }
      msg += `\n${separator()}\n\n`;
    }

    msg += '<b>📋 ACOMPANHAMENTO POR GESTOR</b>\n\n';
    for (const [gestor, items] of byGestor.entries()) {
      const gestorSaldo = items.reduce((sum, i) => sum + i.saldoNum, 0);
      const gestorCriticos = items.filter(i => i.cls === 'critico').length;
      const gestorAtencao = items.filter(i => i.cls === 'atencao').length;
      const gestorErros = (errorByGestor.get(gestor) || []).length;

      msg += `${separator()}\n`;
      msg += `👤 <b>${gestor}</b>\n`;
      msg += `   📊 ${items.length} conta(s) | 💰 R$ ${gestorSaldo.toFixed(2)} | ${CRITICAL_EMOJI}${gestorCriticos} ${ATENCAO_EMOJI}${gestorAtencao} ${ERRO_EMOJI}${gestorErros}\n`;

      for (const item of items) {
        const emoji = emojiForClass(item.cls);
        msg += `${emoji} ${item.cliente} [${item.plataforma}]\n`;
        msg += `   💰 ${item.saldo} | 📉 ${item.gastoOntem} | ⏳ ${item.dias}\n`;
      }
      msg += `\n`;
    }
    msg += `${separator()}\n\n`;

    if (errors.length > 0) {
      msg += `<b>❌ ERROS DETALHADOS</b>\n\n`;
      for (const [gestor, items] of errorByGestor.entries()) {
        msg += `${separator()}\n`;
        msg += `👤 <b>${gestor}</b> (${items.length} erro(s))\n`;
        for (const item of errors.filter(e => (e.gestor || '-') === gestor)) {
          msg += `${ERRO_EMOJI} <b>${item.cliente}</b> [${item.plataforma}]\n`;
          if (item.identificador) {
            msg += `   💳 ${item.identificador}\n`;
          }
          msg += `   ⚠️ ${item.obs ? item.obs.substring(0, 100) : 'Erro não especificado'}\n`;
        }
      }
      msg += `\n${separator()}\n`;
    }

    const okCount = updated.filter(i => i.cls === 'ok').length;
    msg += `\n<i>✅ ${okCount} conta(s) em situação normal</i>\n`;
    msg += `<i>Dados ordenados conforme CONFIGS</i>\n`;

    return msg;
  } catch (err) {
    console.error('Erro ao gerar relatório:', err);
    return `❌ Erro ao gerar relatório: ${err.message}`;
  }
}

module.exports = { generateReport };
