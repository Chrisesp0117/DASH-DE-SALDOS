const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const USERS_FILE = path.join(__dirname, '..', '..', 'users.json');

let bot = null;
let users = [];
let initialized = false;

// Load registered users from file
function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
      if (!Array.isArray(users)) users = [];
    } else {
      users = [];
      saveUsers();
    }
  } catch (err) {
    console.error('❌ Erro ao carregar users.json:', err);
    users = [];
  }
}

// Save users to file
function saveUsers() {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  } catch (err) {
    console.error('❌ Erro ao salvar users.json:', err);
  }
}

// Register user (implicit on first command)
function registerUser(chatId) {
  if (!users.includes(chatId)) {
    users.push(chatId);
    saveUsers();
    console.log(`✅ Novo usuário registrado: ${chatId}`);
  }
}

function initTelegramBot(sheetsInstance, spreadsheetId) {
  loadUsers();
  
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

  registerUser(chatId);

  if (text === '/start') {
    const welcomeText = `🤖 <b>Dashboard de Saldos</b>

Bot registrado com sucesso.

<b>Comandos disponíveis:</b>
/help - Mostra esta mensagem
/exam - Mostra relatório atual de contas
/atualizar - Atualiza a planilha apenas quando chamado explicitamente

Você receberá alertas automáticos às 8h e 17h se estiver registrado.`;

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
Todos os usuários registrados recebem alertas automáticos às 8h e 17h todos os dias. Cada usuário recebe alertas individuais no seu chat.

<b>Status:</b>
Você está registrado para receber alertas automáticos ✅`;

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

    const { run } = require('../index');
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

// Broadcast alert to all registered users
async function broadcastAlert(message) {
  if (!bot) {
    console.warn('⚠️ Bot não inicializado');
    return;
  }

  loadUsers(); // Reload in case users file was updated

  console.log(`📢 Enviando alerta para ${users.length} usuários...`);
  
  let sent = 0;
  for (const chatId of users) {
    try {
      await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
      sent++;
      console.log(`✅ Alerta enviado para ${chatId}`);
    } catch (err) {
      console.error(`❌ Erro ao enviar para ${chatId}:`, err.message);
    }
  }

  console.log(`📊 Total: ${sent}/${users.length} usuários receberam o alerta`);
}

function getBot() {
  return bot;
}

function getRegisteredUsers() {
  loadUsers();
  return [...users];
}

module.exports = {
  initTelegramBot,
  handleWebhookUpdate,
  broadcastAlert,
  getBot,
  getRegisteredUsers,
  loadUsers,
  saveUsers
};
