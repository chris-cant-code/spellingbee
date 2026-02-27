const { JSDOM } = require('jsdom');

const NYT_BASE = 'https://www.nytimes.com/puzzles/spelling-bee';

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Fetch puzzle data for a specific date from NYT.
// Returns { date, center, outer, answers, total_score }
async function fetchPuzzleByDate(date) {
  const url = `${NYT_BASE}/${date}`;
  const res = await fetch(url, { headers: FETCH_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const html = await res.text();

  // Strategy 1: fast regex extraction of the gameData JSON blob
  let gameData = extractViaRegex(html);

  // Strategy 2: JSDOM script execution (slower but handles obfuscated assignments)
  if (!gameData) {
    console.log(`[scraper] Regex extraction failed for ${date}, falling back to JSDOM`);
    const dom = new JSDOM(html, { url, runScripts: 'dangerously' });
    gameData = dom.window.gameData;
  }

  if (!gameData?.today) throw new Error(`No gameData.today found for ${date}`);

  return normalize(date, gameData.today);
}

function extractViaRegex(html) {
  // NYT embeds game data as: window.gameData = {...};
  const start = html.indexOf('window.gameData = ');
  if (start === -1) return null;
  const jsonStart = html.indexOf('{', start);
  if (jsonStart === -1) return null;

  // Walk forward counting braces to find the matching closing brace
  let depth = 0;
  let inString = false;
  let escape = false;
  let i = jsonStart;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { if (--depth === 0) break; }
  }

  try {
    return JSON.parse(html.slice(jsonStart, i + 1));
  } catch {
    return null;
  }
}

function normalize(date, today) {
  const center = today.centerLetter.toUpperCase();
  const outer = today.outerLetters.map(l => l.toUpperCase());
  const pangramSet = new Set((today.pangrams || []).map(w => w.toUpperCase()));

  const answers = (today.answers || []).map(word => {
    const w = word.toUpperCase();
    const isPangram = pangramSet.has(w);
    const points = computePoints(w, isPangram);
    return { word: w, points, is_pangram: isPangram ? 1 : 0 };
  });

  const total_score = answers.reduce((sum, a) => sum + a.points, 0);
  return { date, center, outer, answers, total_score };
}

function computePoints(word, isPangram) {
  if (isPangram) return word.length + 7;
  return word.length === 4 ? 1 : word.length;
}

// Fetch the last `days` days of puzzles, skipping dates already in DB.
async function fetchRecentPuzzles(days, hasPuzzleFn) {
  const results = [];
  const now = new Date();

  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const date = d.toISOString().slice(0, 10);

    if (hasPuzzleFn(date)) continue;

    try {
      const puzzle = await fetchPuzzleByDate(date);
      results.push(puzzle);
      console.log(`[scraper] Fetched ${date}: center=${puzzle.center} ${puzzle.answers.length} words score=${puzzle.total_score}`);
    } catch (err) {
      console.error(`[scraper] Failed ${date}: ${err.message}`);
    }

    if (i < days - 1) await sleep(500);
  }

  return results;
}

module.exports = { fetchPuzzleByDate, fetchRecentPuzzles };
