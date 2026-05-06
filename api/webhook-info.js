// Telegram webhook info disabled
module.exports = async (req, res) => {
  return res.status(404).json({ ok: false, error: 'Telegram integration disabled' });
};