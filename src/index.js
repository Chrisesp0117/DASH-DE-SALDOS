require('dotenv').config({ path: '.env' });

const { getSheets } = require('./services/sheets');
module.exports = (req, res) => {
  res.status(200).send('OK');
};
      process.exit(1);
    });
}