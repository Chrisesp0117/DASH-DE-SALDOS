// Telegram webhook endpoint disabled. Remove or re-enable by restoring original implementation.
module.exports = async (req, res) => {
  return res.status(404).json({ ok: false, error: 'Telegram integration disabled' });
};
