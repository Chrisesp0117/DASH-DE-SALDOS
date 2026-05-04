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

  // /start command - only register and welcome
  bot.onText(/^\/start$/, (msg) => {
    const chatId = msg.chat.id;
    registerUser(chatId);

    const welcomeText = `🤖 <b>Dashboard de Saldos</b>

Bot registrado com sucesso.

<b>Comandos disponíveis:</b>
/help - Mostra esta mensagem
/exam - Mostra relatório atual de contas
/atualizar - Atualiza a planilha apenas quando chamado explicitamente

Você receberá alertas automáticos às 8h e 17h se estiver registrado.`;

    bot.sendMessage(chatId, welcomeText, { parse_mode: 'HTML' })
      .catch(err => console.error('❌ Erro ao enviar /start:', err));
  });

  // /help command - individual response
  bot.onText(/^\/help$/, (msg) => {
    const chatId = msg.chat.id;
    registerUser(chatId);

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

    bot.sendMessage(chatId, helpText, { parse_mode: 'HTML' })
      .catch(err => console.error('❌ Erro ao enviar /help:', err));
  });

  // /exam command - individual response
  bot.onText(/^\/exam$/, async (msg) => {
    const chatId = msg.chat.id;
    registerUser(chatId);

    try {
      bot.sendMessage(chatId, '⏳ Gerando relatório...')
        .catch(err => console.error('Erro ao enviar mensagem de espera:', err));

      const { generateReport } = require('../core/reportGenerator');
      const report = await generateReport(sheetsInstance, spreadsheetId);
      
      bot.sendMessage(chatId, `<b>📊 Relatório Atual</b>\n\n${report}`, { parse_mode: 'HTML' })
        .catch(err => console.error('❌ Erro ao enviar /exam:', err));
    } catch (err) {
      console.error('❌ Erro ao gerar relatório:', err);
      bot.sendMessage(chatId, `❌ Erro ao gerar relatório: ${err.message}`)
        .catch(e => console.error('Erro ao enviar mensagem de erro:', e));
    }
  });

  // /atualizar command - individual response
  bot.onText(/^\/atualizar$/, async (msg) => {
    const chatId = msg.chat.id;
    registerUser(chatId);

    try {
      const loadingMessage = await bot.sendMessage(chatId, '⏳ Carregando...\n0 | 0 contas');

      // Trigger main data collection from index.js
      const { run } = require('../index');
      await run({
        onProgress: async (current, total) => {
          const text = `⏳ Carregando...\n${current} | ${total} contas`;
          try {
            await bot.editMessageText(text, {
              chat_id: chatId,
              message_id: loadingMessage.message_id
            });
          } catch (editErr) {
            console.error('Erro ao atualizar progresso:', editErr);
          }
        }
      });

      bot.sendMessage(chatId, '✅ Dados atualizados com sucesso!\n\nUse /exam para ver o relatório.')
        .catch(err => console.error('❌ Erro ao enviar confirmação:', err));
    } catch (err) {
      console.error('❌ Erro ao atualizar:', err);
      bot.sendMessage(chatId, `❌ Erro ao atualizar: ${err.message}`)
        .catch(e => console.error('Erro ao enviar mensagem de erro:', e));
    }
  });

  // Register user on any command message
  bot.on('message', (msg) => {
    if (msg.text && msg.text.startsWith('/')) {
      registerUser(msg.chat.id);
    }
  });

  console.log('✅ Bot Telegram iniciado');
  return bot;
}

function processWebhookUpdate(update, sheetsInstance, spreadsheetId) {
  const telegramBot = initTelegramBot(sheetsInstance, spreadsheetId);

  if (!telegramBot) {
    return false;
  }

  telegramBot.processUpdate(update);
  return true;
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
  processWebhookUpdate,
  broadcastAlert,
  getBot,
  getRegisteredUsers,
  loadUsers,
  saveUsers
};
