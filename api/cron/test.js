require('dotenv').config({ path: '.env' });

const { assertCronAuth, sendJson } = require('../../src/core/serverlessJobs');

module.exports = async (req, res) => {
  const authResponse = assertCronAuth(req, res);
  if (authResponse) {
    return authResponse;
  }

  return sendJson(res, {
    ok: true,
    message: 'Test route working',
    timestamp: new Date().toISOString(),
    headers: {
      host: req.headers.host || req.headers.Host,
      xSecret: req.headers['x-cron-secret'] || 'none',
      xVercelCron: req.headers['x-vercel-cron'] || 'none'
    }
  }, 200);
};
