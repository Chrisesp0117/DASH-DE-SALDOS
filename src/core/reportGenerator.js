function formatDiasHoras(diasValue) {
  const totalDias = Math.max(0, Number(diasValue || 0));
  const diasInteiros = Math.floor(totalDias);
  const horas = Math.floor((totalDias - diasInteiros) * 24);
  const dd = String(diasInteiros).padStart(2, '0');
  const hh = String(horas).padStart(2, '0');
  return `${dd}d ${hh}h`;
}

function parseCurrency(value) {
  if (!value || value === '-') return 0;
  const str = String(value).replace(/[^\d,]/g, '').replace(',', '.');
  return parseFloat(str) || 0;
}

function separator() {
  return '────────────────────';
}

const { readDatabaseRows } = require('../services/supabase');

async function generateReport(sheets, spreadsheetId) {
  try {
    const rows = await readDatabaseRows();

    if (rows.length === 0) {
      return '📊 Nenhum dado para exibir.';
    }

    // Group by status
    const updated = [];
    const errors = [];

    for (const r of rows) {
      const cliente = r[1] || '-';
      const plataforma = r[2] || '-';
      const saldo = r[3] || '-';
      const dias = r[6] || '-';
      const gestor = r[7] || '-';
      const status = r[9] || 'Desconhecido';
      const obs = r[10] || '';
      const identificador = r[12] || '';

      const item = { cliente, plataforma, saldo, dias, gestor, status, obs, identificador };

      if (status.toLowerCase() === 'atualizada') {
        updated.push(item);
      } else {
        errors.push(item);
      }
    }

    // Build message
    let msg = '<b>📊 RELATÓRIO DE SALDOS</b>\n';
    msg += `<i>${new Date().toLocaleString('pt-BR')}</i>\n\n`;

    // Criticals (dias <= 7)
    const criticals = updated.filter(item => {
      const diasNum = parseInt(String(item.dias).split(' ')[0]);
      return diasNum <= 7 && diasNum > 0;
    });

    if (criticals.length > 0) {
      msg += '<b>⚠️ ATENÇÃO - SALDO BAIXO (≤ 7 dias)⏳</b>\n\n';
      const criticalsByGestor = new Map();
      for (const item of criticals) {
        const key = item.gestor || '-';
        if (!criticalsByGestor.has(key)) {
          criticalsByGestor.set(key, []);
        }
        criticalsByGestor.get(key).push(item);
      }

      for (const [gestor, items] of criticalsByGestor.entries()) {
        msg += `${separator()}\n`;
        msg += `=========👤 ${gestor}=========\n`;
        for (const item of items) {
          msg += `🔴 <b>${item.cliente}</b> (${item.plataforma})\n`;
          if (item.identificador) {
            msg += `💳 ${item.identificador}\n`;
          }
          msg += `💰 Saldo: ${item.saldo}\n`;
          msg += `⏳ Duração: ${item.dias}\n\n`;
        }
      }
      msg += `${separator()}\n\n`;
    }

    // Summary
    msg += '<b>📈 RESUMO</b>\n';
    msg += `✅ Contas atualizadas: <b>${updated.length}</b>\n`;
    msg += `❌ Contas com erro: <b>${errors.length}</b>\n`;

    msg += `\n${separator()}\n`;

    if (errors.length > 0 && errors.length <= 5) {
      msg += '<b>❌ ERROS</b>\n';
      for (const item of errors) {
        msg += `🔴 <b>${item.cliente}</b> (${item.plataforma})\n`;
        msg += `   ${item.obs.substring(0, 60)}\n`;
        msg += `${separator()}\n`;
      }
    } else if (errors.length > 5) {
      msg += `<i>Ver planilha para detalhes dos ${errors.length} erros</i>\n`;
    }

    return msg;
  } catch (err) {
    console.error('Erro ao gerar relatório:', err);
    return `❌ Erro ao gerar relatório: ${err.message}`;
  }
}

module.exports = { generateReport };
