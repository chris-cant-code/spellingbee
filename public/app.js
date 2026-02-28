/* ─── State ───────────────────────────────────────────────────────────────── */
const state = {
  date: null,
  center: null,
  outer: [],         // current (possibly shuffled) outer letters
  outerOrig: [],     // canonical order from server
  totalScore: 0,
  score: 0,
  rank: 'Beginner',
  foundWords: [],    // insertion order (most recently found at end)
  playerCount: 1,
  currentWord: '',   // maintained in JS, not inside an <input>
  letterCounts: {},  // total valid words per starting letter (from server)
  sortMode: 'recent',          // 'recent' | 'alpha' | 'player'
  myFoundWords: new Set(),     // words found by this client this session
  pendingWord: null,           // word just submitted (detect "mine" on word_found)
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
  renderHints();
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
  // Track which words this client found (pendingWord set in submitWord)
  if (word === state.pendingWord) {
    state.myFoundWords.add(word);
    state.pendingWord = null;
  }
  renderFoundWords();
  renderScore();
  renderHints();
  if (isPangram) {
    showToast(`${word} — Pangram! +${points}`, 'pangram', 2500);
  } else {
    showToast(`${word}  +${points}`, 'success', 1800);
  }
  clearWord();
});

socket.on('word_error', ({ word, reason }) => {
  state.pendingWord = null;
  const messages = {
    too_short:      'Too short',
    missing_center: `Must use "${(state.center || '').toUpperCase()}"`,
    bad_letters:    'Bad letters',
    already_found:  'Already found!',
    not_in_list:    'Not in word list',
    no_puzzle:      'No puzzle loaded',
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
const elScore        = $id('score');
const elRank         = $id('rank');
const elProgressBar  = $id('progress-bar');
const elNextRank     = $id('next-rank-label');
const elPlayerCount  = $id('player-count');
const elHive         = $id('hive');
const elWordDisplay  = $id('word-display');
const elGhost        = $id('ghost-input');
const elOtherPlayer  = $id('other-player');
const elOtherText    = $id('other-player-text');
const elFoundWords   = $id('found-words');
const elFoundHeader  = $id('found-header');
const elHintsSection = $id('hints-section');
const elHintsList    = $id('hints-list');
const elLoading      = $id('loading');
const elNoPuzzle     = $id('no-puzzle');
const elGameArea     = $id('game-area');
const elDateBtn      = $id('date-picker-btn');
const elDateLabel    = $id('selected-date-label');
const elDatePanel    = $id('date-panel');
const elOverlay      = $id('overlay');
const elDateList     = $id('date-list');
const elDeleteBtn    = $id('delete-btn');
const elSubmitBtn    = $id('submit-btn');
const elShuffleBtn   = $id('shuffle-btn');
const elToasts       = $id('toast-container');
const elSortTabs     = document.querySelectorAll('.sort-tab');

/* ─── Hive Layout ─────────────────────────────────────────────────────────── */
function buildHive() {
  elHive.innerHTML = '';

  // Flat-top regular hexagon geometry:
  //   hexW = 2s,  hexH = √3·s  (s = circumradius)
  //   → hexW/hexH = 2/√3,  center-to-center distance = hexH
  // Total hive width  = R·√3 + hexW  (outermost centers ± half-element)
  // With R = hexH and hexW = hexH·2/√3:  width = hexH·5/√3
  // → hexH = maxW·√3/5
  const maxW = Math.min(window.innerWidth - 40, 340);
  const hexH = Math.round(maxW * 0.30);
  const hexW = Math.round(hexH * 2 / Math.sqrt(3));
  const gap  = 3;            // breathing room between tiles (px)
  const R    = hexH + gap;   // center-to-center distance

  // 7 positions: [0] = center, [1..6] = flat-top outer ring (60° steps)
  const positions = [{ x: 0, y: 0 }];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    positions.push({
      x: Math.round(R * Math.cos(angle)),
      y: Math.round(R * Math.sin(angle)),
    });
  }

  // Bounding box: center positions ± half the element size
  const xs = positions.map(p => p.x);
  const ys = positions.map(p => p.y);
  const bLeft   = Math.min(...xs) - Math.ceil(hexW / 2);
  const bTop    = Math.min(...ys) - Math.ceil(hexH / 2);
  const bRight  = Math.max(...xs) + Math.ceil(hexW / 2);
  const bBottom = Math.max(...ys) + Math.ceil(hexH / 2);

  elHive.style.width  = (bRight - bLeft) + 'px';
  elHive.style.height = (bBottom - bTop) + 'px';

  const letters  = [state.center, ...state.outer];
  const fontSize = Math.round(hexH * 0.36) + 'px';

  positions.forEach((pos, i) => {
    const hex = document.createElement('div');
    hex.className = 'hex' + (i === 0 ? ' center' : '');
    hex.textContent = letters[i] || '';
    hex.style.left     = (pos.x - bLeft - hexW / 2) + 'px';
    hex.style.top      = (pos.y - bTop  - hexH / 2) + 'px';
    hex.style.width    = hexW + 'px';
    hex.style.height   = hexH + 'px';
    hex.style.fontSize = fontSize;

    // Tap a letter — no focus stealing
    hex.addEventListener('pointerdown', e => {
      e.preventDefault();
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
  state.pendingWord = word;
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
function tierProgressInfo(score, total) {
  if (!total) return { pct: 0, nextName: null, nextScore: null };
  const pctOfTotal = score / total;
  let curIdx = 0;
  for (let i = 0; i < RANKS.length; i++) {
    if (pctOfTotal >= RANKS[i].pct) curIdx = i;
  }
  const cur  = RANKS[curIdx];
  const next = RANKS[curIdx + 1];
  if (!next) return { pct: 1, nextName: null, nextScore: null };

  const curScore  = Math.ceil(cur.pct  * total);
  const nextScore = Math.ceil(next.pct * total);
  const pct = nextScore === curScore
    ? 1
    : Math.min(1, (score - curScore) / (nextScore - curScore));

  return { pct, nextName: next.name, nextScore };
}

function renderScore() {
  elScore.textContent = state.score;
  elRank.textContent  = state.rank;

  const { pct, nextName, nextScore } = tierProgressInfo(state.score, state.totalScore);
  elProgressBar.style.width = (pct * 100).toFixed(1) + '%';

  elNextRank.textContent = nextName ? `→ ${nextName} at ${nextScore}` : '★ Queen Bee!';
}

function sortedFoundWords() {
  const words = [...state.foundWords];
  if (state.sortMode === 'alpha') return words.sort();
  if (state.sortMode === 'player') {
    // My words first (maintaining relative order within each group)
    return [
      ...words.filter(w =>  state.myFoundWords.has(w)),
      ...words.filter(w => !state.myFoundWords.has(w)),
    ];
  }
  // 'recent': most recently found first
  return words.reverse();
}

function renderFoundWords() {
  elFoundHeader.textContent = `Found (${state.foundWords.length})`;
  elFoundWords.innerHTML = '';
  sortedFoundWords().forEach(word => {
    const span = document.createElement('span');
    span.className = 'found-word';
    span.textContent = word;
    if (wordIsPangram(word))          span.classList.add('pangram');
    if (state.myFoundWords.has(word)) span.classList.add('mine');
    elFoundWords.appendChild(span);
  });
}

function renderHints() {
  if (!Object.keys(state.letterCounts).length) {
    elHintsSection.hidden = true;
    return;
  }
  elHintsSection.hidden = false;

  // Count found words per starting letter
  const foundByLetter = {};
  state.foundWords.forEach(w => {
    const ch = w[0];
    foundByLetter[ch] = (foundByLetter[ch] || 0) + 1;
  });

  elHintsList.innerHTML = Object.entries(state.letterCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([letter, total]) => {
      const remaining = total - (foundByLetter[letter] || 0);
      const done = remaining === 0;
      return `<span class="hint-chip${done ? ' done' : ''}">${letter}<span class="hint-count">${remaining}</span></span>`;
    })
    .join('');
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

  // Broadcast to all players in the room — server echoes back to everyone
  socket.emit('shuffle', { outer: next });
}

socket.on('shuffle', ({ outer }) => {
  state.outer = outer;
  elHive.classList.remove('hive-shuffling');
  void elHive.offsetWidth;
  elHive.classList.add('hive-shuffling');
  setTimeout(() => elHive.classList.remove('hive-shuffling'), 220);
  buildHive();
});

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

    state.date         = date;
    state.center       = puzzle.center.toUpperCase();
    state.outerOrig    = puzzle.outer.map(l => l.toUpperCase());
    state.outer        = [...state.outerOrig];
    state.totalScore   = puzzle.totalScore;
    state.foundWords   = room.foundWords;
    state.score        = room.score;
    state.rank         = room.rank;
    state.letterCounts = puzzle.letterCounts || {};
    state.myFoundWords = new Set();
    state.pendingWord  = null;

    elDateLabel.textContent = formatDateLabel(date);
    elLoading.hidden  = true;
    elGameArea.hidden = false;

    buildHive();
    renderFoundWords();
    renderScore();
    renderHints();
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

elSortTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    state.sortMode = tab.dataset.sort;
    elSortTabs.forEach(t => {
      t.classList.toggle('active', t === tab);
      t.setAttribute('aria-pressed', t === tab ? 'true' : 'false');
    });
    renderFoundWords();
  });
});

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
