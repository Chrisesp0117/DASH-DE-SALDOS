require('dotenv').config({ path: '.env' });

module.exports = (req, res) => {
  res.status(200).send('OK');
};