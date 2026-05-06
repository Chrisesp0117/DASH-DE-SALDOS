// Telegram integration removed.
// This module kept as a safe stub to avoid breaking imports in other files.

function initTelegramBot() {
  // no-op
  return null;
}

async function handleWebhookUpdate() {
  // Telegram integration disabled
  return false;
}

async function broadcastAlert() {
  // no-op
}

function getBot() {
  return null;
}

function getAlertChatIds() {
  return [];
}

function parseChatIds() {
  return [];
}

module.exports = {
  initTelegramBot,
  handleWebhookUpdate,
  broadcastAlert,
  getBot,
  getAlertChatIds,
  parseChatIds
};
