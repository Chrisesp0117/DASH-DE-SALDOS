// Telegram webhook setup disabled. Remove this file if you no longer want related routes.
module.exports = async (req, res) => {
  return res.status(404).json({ ok: false, error: 'Telegram integration disabled' });
};
