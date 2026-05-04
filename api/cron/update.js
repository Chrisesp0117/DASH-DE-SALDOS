require('dotenv').config({ path: '.env' });

const { run } = require('../../src/index');

module.exports = async (req, res) => {
  try {
    await run();
    return res.status(200).json({ ok: true, message: 'Planilha atualizada com sucesso' });
  } catch (error) {
    console.error('❌ Erro no cron de atualização:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
};
