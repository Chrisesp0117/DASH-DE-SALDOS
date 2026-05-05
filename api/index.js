module.exports = async (req, res) => {
  res.status(200).json({
    ok: true,
    message: 'Telegram bot serverless running',
    uptime: process.uptime()
  });
};
