const TelegramBot = require('node-telegram-bot-api');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALERT_CHAT_IDS = parseChatIds(
  process.env.TELEGRAM_ALERT_CHAT_IDS || process.env.TELEGRAM_ALERT_CHAT_ID || ''
);

let bot = null;
let initialized = false;

function parseChatIds(rawValue) {
  if (!rawValue) {
    return [];
  }

  if (Array.isArray(rawValue)) {
    return rawValue
      .map(value => String(value).trim())
      .filter(Boolean);
  }

  return String(rawValue)
    .split(/[;,\s]+/)
    .map(value => value.trim())
    .filter(Boolean);
}

function getAlertChatIds() {
  return ALERT_CHAT_IDS.length > 0 ? ALERT_CHAT_IDS : parseChatIds(process.env.TELEGRAM_ALERT_CHAT_IDS || process.env.TELEGRAM_ALERT_CHAT_ID || '');
}

function initTelegramBot(sheetsInstance, spreadsheetId) {
  if (!TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN não configurado');
    return null;
  }

  if (bot && initialized) {
    return bot;
  }

  bot = new TelegramBot(TOKEN, { polling: false });
  initialized = true;

  console.log('✅ Bot Telegram iniciado');
  return bot;
}

async function handleWebhookUpdate(update, sheetsInstance, spreadsheetId) {
  const telegramBot = initTelegramBot(sheetsInstance, spreadsheetId);

  if (!telegramBot) {
    return false;
  }

  const message = update && (update.message || update.edited_message || update.channel_post);
  const text = message && typeof message.text === 'string' ? message.text.trim() : '';

  if (!message || !text || !text.startsWith('/')) {
    return false;
  }

  const chatId = message.chat && message.chat.id;

  if (!chatId) {
    return false;
  }

  if (text === '/start') {
    const welcomeText = `🤖 <b>Dashboard de Saldos</b>

Bot configurado com sucesso.

<b>Comandos disponíveis:</b>
/help - Mostra esta mensagem
/exam - Mostra relatório atual de contas
/atualizar - Atualiza a planilha apenas quando chamado explicitamente

O bot foi configurado para funcionar em modo serverless com webhook.`;

    await telegramBot.sendMessage(chatId, welcomeText, { parse_mode: 'HTML' });
    return true;
  }

  if (text === '/help') {
    const helpText = `🤖 <b>Seu Dashboard Bot</b>

Este bot fornece acesso aos dados de saldo e gasto do dashboard.

<b>Comandos disponíveis:</b>
/help - Mostra esta mensagem
/exam - Mostra relatório atual de contas
/atualizar - Força atualização imediata dos dados

<b>Alertas Automáticos:</b>
Os alertas automáticos são enviados para os destinos configurados em TELEGRAM_ALERT_CHAT_ID ou TELEGRAM_ALERT_CHAT_IDS.

<b>Status:</b>
Webhook ativo e bot pronto para responder ✅`;

    await telegramBot.sendMessage(chatId, helpText, { parse_mode: 'HTML' });
    return true;
  }

  if (text === '/exam') {
    await telegramBot.sendMessage(chatId, '⏳ Gerando relatório...');

    const { generateReport } = require('../core/reportGenerator');
    const report = await generateReport(sheetsInstance, spreadsheetId);

    await telegramBot.sendMessage(chatId, `<b>📊 Relatório Atual</b>\n\n${report}`, { parse_mode: 'HTML' });
    return true;
  }

  if (text === '/atualizar') {
    const loadingMessage = await telegramBot.sendMessage(chatId, '⏳ Carregando...\n0 | 0 contas');

    const { run } = require('../run');
    await run({
      onProgress: async (current, total) => {
        const progressText = `⏳ Carregando...\n${current} | ${total} contas`;
        try {
          await telegramBot.editMessageText(progressText, {
            chat_id: chatId,
            message_id: loadingMessage.message_id
          });
        } catch (editErr) {
          console.error('Erro ao atualizar progresso:', editErr);
        }
      }
    });

    await telegramBot.sendMessage(chatId, '✅ Dados atualizados com sucesso!\n\nUse /exam para ver o relatório.');
    return true;
  }

  return false;
}

// Broadcast alert to configured targets
async function broadcastAlert(message) {
  if (!bot) {
    console.warn('⚠️ Bot não inicializado');
    return;
  }

  const targets = getAlertChatIds();

  if (!targets.length) {
    console.warn('⚠️ Nenhum chat alvo configurado para alertas');
    return;
  }

  console.log(`📢 Enviando alerta para ${targets.length} destino(s)...`);
  
  let sent = 0;
  for (const chatId of targets) {
    try {
      await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
      sent++;
      console.log(`✅ Alerta enviado para ${chatId}`);
    } catch (err) {
      console.error(`❌ Erro ao enviar para ${chatId}:`, err.message);
    }
  }

  console.log(`📊 Total: ${sent}/${targets.length} destino(s) receberam o alerta`);
}

function getBot() {
  return bot;
}

module.exports = {
  initTelegramBot,
  handleWebhookUpdate,
  broadcastAlert,
  getBot,
  getAlertChatIds,
  parseChatIds
};
