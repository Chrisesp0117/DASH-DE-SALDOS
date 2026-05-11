require('dotenv').config({ path: '.env' });

const updateFullHandler = require('./cron/update-full');

module.exports = async (req, res) => {
  return updateFullHandler(req, res);
};
