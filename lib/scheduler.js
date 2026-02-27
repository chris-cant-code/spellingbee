const cron = require('node-cron');
const { fetchRecentPuzzles } = require('./scraper');
const db = require('./db');

const LOOKBACK_DAYS = 14;

async function runFetch() {
  console.log('[scheduler] Starting puzzle fetch...');
  const results = await fetchRecentPuzzles(LOOKBACK_DAYS, db.hasPuzzle);
  for (const puzzle of results) {
    db.upsertPuzzle(puzzle);
  }
  const dates = db.listPuzzleDates();
  console.log(`[scheduler] Done. ${dates.length} puzzle(s) in DB. Latest: ${dates[0] || 'none'}`);
}

function startScheduler() {
  runFetch().catch(err => console.error('[scheduler] Startup fetch error:', err));

  // Run daily at 6am UTC (NYT publishes new puzzle ~3am ET)
  cron.schedule('0 6 * * *', () => {
    runFetch().catch(err => console.error('[scheduler] Cron fetch error:', err));
  }, { timezone: 'UTC' });

  console.log('[scheduler] Cron job scheduled (daily at 06:00 UTC)');
}

module.exports = { startScheduler, runFetch };
