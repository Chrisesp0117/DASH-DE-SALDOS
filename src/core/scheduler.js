/*
 * LEGACY FILE
 * Serverless migration removed the internal scheduler.
 * Cron is now handled externally by cron-job.org.
 */

function scheduleAlerts() {
  console.warn('scheduler.js is deprecated in serverless mode.');
  return null;
}

function stopScheduler() {
  return null;
}

module.exports = {
  scheduleAlerts,
  stopScheduler
};
