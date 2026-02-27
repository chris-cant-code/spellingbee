/* ─── State ───────────────────────────────────────────────────────────────── */
const state = {
  date: null,
  center: null,
  outer: [],        // current (possibly shuffled) outer letters
  outerOrig: [],    // canonical order from server
  totalScore: 0,
  score: 0,
  rank: 'Beginner',
  foundWords: [],
  playerCount: 1,
  currentWord: '',  // maintained in JS, not inside an <input>
};

/* ─── Socket ──────────────────────────────────────────────────────────────── */
const socket = io({ transports: ['websocket', 'polling'] });

socket.on('connect', () => {
  if (state.date) joinRoom(state.date);
});

socket.on('room_state', ({ foundWords, score, totalScore, rank, playerCount }) => {
  state.foundWords = foundWords;
  state.score      = score;
  state.totalScore = totalScore;
  state.rank       = rank;
  state.playerCount = playerCount;
  renderFoundWords();
  renderScore();
  updatePlayerCount(playerCount);
});

socket.on('typing_update', ({ text }) => {
  showOtherPlayer(text);
});

socket.on('word_found', ({ word, points, isPangram, newScore, totalScore, newRank }) => {
  state.score      = newScore;
  state.totalScore = totalScore;
  state.rank       = newRank;
  if (!state.foundWords.includes(word)) state.foundWords.push(word);
  renderFoundWords();
  renderScore();
  if (isPangram) {
    showToast(`${word} — Pangram! +${points}`, 'pangram', 2500);
  } else {
    showToast(`${word}  +${points}`, 'success', 1800);
  }
  clearWord();
});

socket.on('word_error', ({ word, reason }) => {
  const messages = {
    too_short:     'Too short',
    missing_center: `Must use "${(state.center || '').toUpperCase()}"`,
    bad_letters:   'Bad letters',
    already_found: 'Already found!',
    not_in_list:   'Not in word list',
    no_puzzle:     'No puzzle loaded',
  };
  showToast(messages[reason] || 'Invalid word', 'error', 1600);
  shakeDisplay();
});

socket.on('player_count', ({ count }) => {
  state.playerCount = count;
  updatePlayerCount(count);
});

/* ─── DOM refs ────────────────────────────────────────────────────────────── */
const $id = id => document.getElementById(id);
const elScore       = $id('score');
const elRank        = $id('rank');
const elProgressBar = $id('progress-bar');
const elNextRank    = $id('next-rank-label');
const elPlayerCount = $id('player-count');
const elHive        = $id('hive');
const elWordDisplay = $id('word-display');
const elGhost       = $id('ghost-input');
const elOtherPlayer = $id('other-player');
const elOtherText   = $id('other-player-text');
const elFoundWords  = $id('found-words');
const elFoundHeader = $id('found-header');
const elLoading     = $id('loading');
const elNoPuzzle    = $id('no-puzzle');
const elGameArea    = $id('game-area');
const elDateBtn     = $id('date-picker-btn');
const elDateLabel   = $id('selected-date-label');
const elDatePanel   = $id('date-panel');
const elOverlay     = $id('overlay');
const elDateList    = $id('date-list');
const elDeleteBtn   = $id('delete-btn');
const elSubmitBtn   = $id('submit-btn');
const elShuffleBtn  = $id('shuffle-btn');
const elToasts      = $id('toast-container');

/* ─── Hive Layout ─────────────────────────────────────────────────────────── */
function buildHive() {
  elHive.innerHTML = '';

  // Compute hex size from viewport; clamp to a sensible max
  const maxW = Math.min(window.innerWidth - 40, 340);
  const hexSize = Math.round(maxW * 0.29);   // element side length
  const R = Math.round(hexSize * 1.04);      // center-to-outer-center distance

  // 7 positions: [0] = center, [1..6] = outer ring (pointy-top, 60° steps)
  const positions = [{ x: 0, y: 0 }];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    positions.push({
      x: Math.round(R * Math.cos(angle)),
      y: Math.round(R * Math.sin(angle)),
    });
  }

  // Bounding box — pad by half hex + small gap so no tile gets clipped
  const pad = Math.ceil(hexSize / 2) + 3;
  const xs = positions.map(p => p.x);
  const ys = positions.map(p => p.y);
  const bLeft   = Math.min(...xs) - pad;
  const bTop    = Math.min(...ys) - pad;
  const bRight  = Math.max(...xs) + pad;
  const bBottom = Math.max(...ys) + pad;

  elHive.style.width  = (bRight - bLeft)  + 'px';
  elHive.style.height = (bBottom - bTop) + 'px';

  const letters = [state.center, ...state.outer];
  const fontSize = Math.round(hexSize * 0.33) + 'px';

  positions.forEach((pos, i) => {
    const hex = document.createElement('div');
    hex.className = 'hex' + (i === 0 ? ' center' : '');
    hex.textContent = letters[i] || '';
    hex.style.left     = (pos.x - bLeft - hexSize / 2) + 'px';
    hex.style.top      = (pos.y - bTop  - hexSize / 2) + 'px';
    hex.style.width    = hexSize + 'px';
    hex.style.height   = hexSize + 'px';
    hex.style.fontSize = fontSize;

    // Tap a letter — no focus stealing
    hex.addEventListener('pointerdown', e => {
      e.preventDefault();   // prevents focus on any input, prevents scroll
      appendLetter(letters[i]);
    });
    elHive.appendChild(hex);
  });
}

/* ─── Word State ──────────────────────────────────────────────────────────── */
function appendLetter(letter) {
  if (!letter) return;
  state.currentWord += letter.toUpperCase();
  renderWordDisplay();
  socket.emit('typing', { text: state.currentWord });
}

function deleteLetter() {
  state.currentWord = state.currentWord.slice(0, -1);
  renderWordDisplay();
  socket.emit('typing', { text: state.currentWord });
}

function clearWord() {
  state.currentWord = '';
  elGhost.textContent = '';
  renderWordDisplay();
}

function renderWordDisplay() {
  const w = state.currentWord;
  const valid = isValidWord(w);
  elWordDisplay.textContent = w || '\u00a0'; // nbsp keeps height
  elWordDisplay.classList.toggle('invalid', w.length > 0 && !valid);
}

function isValidWord(text) {
  if (!state.center || !text) return true;
  const allowed = new Set([state.center, ...state.outer]);
  return [...text].every(c => allowed.has(c));
}

function submitWord() {
  const word = state.currentWord.trim();
  if (!word || !state.date) return;
  socket.emit('submit', { word, date: state.date });
}

function shakeDisplay() {
  elWordDisplay.classList.remove('shake');
  void elWordDisplay.offsetWidth;
  elWordDisplay.classList.add('shake');
  setTimeout(() => elWordDisplay.classList.remove('shake'), 350);
}

/* ─── Other-player ghost ──────────────────────────────────────────────────── */
function showOtherPlayer(text) {
  if (!text) {
    elOtherPlayer.hidden = true;
    elGhost.textContent  = '';
    return;
  }
  elOtherPlayer.hidden = false;
  elOtherText.textContent = `Other player: "${text}"`;
  elGhost.textContent = state.currentWord ? '' : text;
  clearTimeout(showOtherPlayer._timer);
  showOtherPlayer._timer = setTimeout(() => {
    elOtherPlayer.hidden = true;
    elGhost.textContent  = '';
  }, 4000);
}

/* ─── Rendering ───────────────────────────────────────────────────────────── */
function renderScore() {
  elScore.textContent = state.score;
  elRank.textContent  = state.rank;

  const pct = state.totalScore > 0 ? Math.min(1, state.score / state.totalScore) : 0;
  elProgressBar.style.width = (pct * 100).toFixed(1) + '%';

  const next = nextRankInfo(state.score, state.totalScore);
  elNextRank.textContent = next ? `→ ${next.name} (${next.scoreNeeded})` : '';
}

function renderFoundWords() {
  elFoundHeader.textContent = `Found (${state.foundWords.length})`;
  elFoundWords.innerHTML = '';
  [...state.foundWords].sort().forEach(word => {
    const span = document.createElement('span');
    span.className = 'found-word';
    span.textContent = word;
    if (wordIsPangram(word)) span.classList.add('pangram');
    elFoundWords.appendChild(span);
  });
}

function wordIsPangram(word) {
  const all = new Set([state.center, ...state.outerOrig]);
  const w   = word.toUpperCase();
  return [...all].every(c => w.includes(c));
}

function updatePlayerCount(count) {
  elPlayerCount.textContent = count === 1 ? '1 player' : `${count} players`;
}

/* ─── Ranks ───────────────────────────────────────────────────────────────── */
const RANKS = [
  { name: 'Beginner',   pct: 0 },
  { name: 'Good Start', pct: 0.02 },
  { name: 'Moving Up',  pct: 0.05 },
  { name: 'Good',       pct: 0.08 },
  { name: 'Solid',      pct: 0.15 },
  { name: 'Nice',       pct: 0.25 },
  { name: 'Great',      pct: 0.40 },
  { name: 'Amazing',    pct: 0.50 },
  { name: 'Genius',     pct: 0.70 },
  { name: 'Queen Bee',  pct: 1.00 },
];

function nextRankInfo(score, total) {
  if (!total) return null;
  const pct = score / total;
  for (const r of RANKS) {
    if (pct < r.pct) return { name: r.name, scoreNeeded: Math.ceil(r.pct * total) };
  }
  return null;
}

/* ─── Toast ───────────────────────────────────────────────────────────────── */
function showToast(message, type = '', duration = 2000) {
  const toast = document.createElement('div');
  toast.className = 'toast' + (type ? ' ' + type : '');
  toast.textContent = message;
  elToasts.appendChild(toast);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('show'));
  });
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 220);
  }, duration);
}

/* ─── Shuffle ─────────────────────────────────────────────────────────────── */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function shuffleOuter() {
  // Keep shuffling until we get an arrangement different from the current one
  let next;
  let tries = 0;
  do {
    next = shuffle(state.outerOrig);
    tries++;
  } while (tries < 20 && next.join() === state.outer.join());

  state.outer = next;

  // Brief scale animation, then rebuild
  elHive.classList.remove('hive-shuffling');
  void elHive.offsetWidth;
  elHive.classList.add('hive-shuffling');
  setTimeout(() => elHive.classList.remove('hive-shuffling'), 220);

  buildHive();
}

/* ─── Date Panel ──────────────────────────────────────────────────────────── */
function openDatePanel()  { elDatePanel.hidden = false; elOverlay.hidden = false; }
function closeDatePanel() { elDatePanel.hidden = true;  elOverlay.hidden = true; }

async function loadDateList() {
  try {
    const res   = await fetch('/api/puzzles');
    const { dates } = await res.json();
    elDateList.innerHTML = '';
    if (dates.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'No puzzles available yet';
      li.style.color = 'var(--text-subtle)';
      elDateList.appendChild(li);
      return;
    }
    dates.forEach(date => {
      const li = document.createElement('li');
      li.textContent = formatDateLabel(date);
      if (date === state.date) li.classList.add('active');
      li.addEventListener('click', () => { closeDatePanel(); loadPuzzle(date); });
      elDateList.appendChild(li);
    });
  } catch (err) {
    console.error('Failed to load dates:', err);
  }
}

function formatDateLabel(dateStr) {
  const today     = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (dateStr === today)     return `Today — ${dateStr}`;
  if (dateStr === yesterday) return `Yesterday — ${dateStr}`;
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

/* ─── Puzzle Load ─────────────────────────────────────────────────────────── */
async function loadPuzzle(date) {
  elGameArea.hidden = true;
  elNoPuzzle.hidden = true;
  elLoading.hidden  = false;

  try {
    const [puzzleRes, roomRes] = await Promise.all([
      fetch(`/api/puzzle/${date}`),
      fetch(`/api/room/${date}`),
    ]);

    if (!puzzleRes.ok) {
      elLoading.hidden = true;
      elNoPuzzle.hidden = false;
      return;
    }

    const puzzle = await puzzleRes.json();
    const room   = await roomRes.json();

    state.date       = date;
    state.center     = puzzle.center.toUpperCase();
    state.outerOrig  = puzzle.outer.map(l => l.toUpperCase());
    state.outer      = [...state.outerOrig];
    state.totalScore = puzzle.totalScore;
    state.foundWords = room.foundWords;
    state.score      = room.score;
    state.rank       = room.rank;

    elDateLabel.textContent = formatDateLabel(date);
    elLoading.hidden  = true;
    elGameArea.hidden = false;

    buildHive();
    renderFoundWords();
    renderScore();
    clearWord();
    joinRoom(date);
  } catch (err) {
    console.error('Failed to load puzzle:', err);
    elLoading.hidden  = true;
    elNoPuzzle.hidden = false;
  }
}

function joinRoom(date) {
  socket.emit('join', { date });
}

/* ─── Dark Mode ───────────────────────────────────────────────────────────── */
const htmlEl = document.documentElement;

function isDarkActive() {
  const theme = htmlEl.getAttribute('data-theme');
  if (theme === 'dark')  return true;
  if (theme === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyTheme(dark) {
  htmlEl.setAttribute('data-theme', dark ? 'dark' : 'light');
  localStorage.setItem('theme', dark ? 'dark' : 'light');
}

$id('theme-toggle').addEventListener('click', () => applyTheme(!isDarkActive()));

// Sync icon when system preference changes (only affects unsaved preference)
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (!localStorage.getItem('theme')) {
    // No manual override — CSS handles it automatically via @media query
    // Nothing to do in JS; icon is handled by CSS rules
  }
});

/* ─── Keyboard (physical keyboard support without requiring input focus) ──── */
document.addEventListener('keydown', e => {
  if (elGameArea.hidden)      return;  // no game loaded
  if (!elDatePanel.hidden)    return;  // date panel open

  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  if (e.metaKey || e.ctrlKey) return;

  if (e.key === 'Enter') {
    e.preventDefault();
    submitWord();
  } else if (e.key === 'Backspace') {
    e.preventDefault();
    deleteLetter();
  } else if (e.key.length === 1 && /[a-zA-Z]/.test(e.key)) {
    e.preventDefault();
    appendLetter(e.key.toUpperCase());
  }
});

/* ─── Button Listeners ────────────────────────────────────────────────────── */
elDeleteBtn.addEventListener('click', deleteLetter);
elSubmitBtn.addEventListener('click', submitWord);
elShuffleBtn.addEventListener('click', shuffleOuter);

elDateBtn.addEventListener('click', () => { loadDateList(); openDatePanel(); });
$id('close-date-panel').addEventListener('click', closeDatePanel);
elOverlay.addEventListener('click', closeDatePanel);

// Prevent double-tap zoom on hex tiles and buttons
document.addEventListener('dblclick', e => {
  if (e.target.closest('.hex, .icon-btn, .shuffle-btn, #theme-toggle, #date-picker-btn')) {
    e.preventDefault();
  }
}, { passive: false });

window.addEventListener('resize', () => {
  if (!elGameArea.hidden) buildHive();
});

/* ─── Init ────────────────────────────────────────────────────────────────── */
async function init() {
  const today = new Date().toISOString().slice(0, 10);
  const res   = await fetch('/api/puzzles').catch(() => null);
  let dates   = [];
  if (res?.ok) {
    const data = await res.json();
    dates = data.dates || [];
  }
  const target = dates.includes(today) ? today : (dates[0] || null);
  if (target) {
    await loadPuzzle(target);
  } else {
    elLoading.hidden  = true;
    elNoPuzzle.hidden = false;
  }
}

init();
