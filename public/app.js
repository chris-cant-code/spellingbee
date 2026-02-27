/* ─── State ───────────────────────────────────────────────────────────────── */
const state = {
  date: null,
  center: null,
  outer: [],        // shuffled outer letters
  outerOrig: [],    // original outer letters order
  totalScore: 0,
  score: 0,
  rank: 'Beginner',
  foundWords: [],
  playerCount: 1,
};

/* ─── Socket ──────────────────────────────────────────────────────────────── */
const socket = io({ transports: ['websocket', 'polling'] });

socket.on('connect', () => {
  if (state.date) joinRoom(state.date);
});

socket.on('room_state', ({ foundWords, score, totalScore, rank, playerCount }) => {
  state.foundWords = foundWords;
  state.score = score;
  state.totalScore = totalScore;
  state.rank = rank;
  state.playerCount = playerCount;
  renderFoundWords();
  renderScore();
  updatePlayerCount(playerCount);
});

socket.on('typing_update', ({ text }) => {
  showOtherPlayer(text);
});

socket.on('word_found', ({ word, points, isPangram, newScore, totalScore, newRank }) => {
  state.score = newScore;
  state.totalScore = totalScore;
  state.rank = newRank;
  if (!state.foundWords.includes(word)) state.foundWords.push(word);
  renderFoundWords();
  renderScore();

  if (isPangram) {
    showToast(`${word} — Pangram! +${points}`, 'pangram', 2500);
  } else {
    showToast(`${word} +${points}`, 'success', 1800);
  }
  clearInput();
});

socket.on('word_error', ({ word, reason }) => {
  const messages = {
    too_short: 'Too short',
    missing_center: `Must use "${(state.center || '').toUpperCase()}"`,
    bad_letters: 'Bad letters',
    already_found: 'Already found!',
    not_in_list: 'Not in word list',
    no_puzzle: 'No puzzle loaded',
  };
  showToast(messages[reason] || 'Invalid word', 'error', 1600);
  shakeInput();
});

socket.on('player_count', ({ count }) => {
  state.playerCount = count;
  updatePlayerCount(count);
});

/* ─── DOM refs ────────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const elScore       = $('score');
const elRank        = $('rank');
const elProgressBar = $('progress-bar');
const elNextRank    = $('next-rank-label');
const elPlayerCount = $('player-count');
const elHive        = $('hive');
const elInput       = $('word-input');
const elGhost       = $('ghost-input');
const elOtherPlayer = $('other-player');
const elOtherText   = $('other-player-text');
const elFoundWords  = $('found-words');
const elFoundHeader = $('found-header');
const elLoading     = $('loading');
const elNoPuzzle    = $('no-puzzle');
const elGameArea    = $('game-area');
const elDateBtn     = $('date-picker-btn');
const elDateLabel   = $('selected-date-label');
const elDatePanel   = $('date-panel');
const elOverlay     = $('overlay');
const elDateList    = $('date-list');
const elDeleteBtn   = $('delete-btn');
const elSubmitBtn   = $('submit-btn');
const elShuffleBtn  = $('shuffle-btn');
const elToasts      = $('toast-container');

/* ─── Hex Layout ──────────────────────────────────────────────────────────── */
// 7 positions for center + 6 outer (pointy-top hexagon)
// Coordinates as fractions of container width/height
// Center at (0.5, 0.5); outer letters in a ring
function hexPositions(containerSize) {
  const R = containerSize * 0.315; // radius from center to outer hex centers
  const cx = containerSize / 2;
  const cy = containerSize * 0.44;
  const positions = [{ x: cx, y: cy }]; // center
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6; // -30° offset for pointy-top
    positions.push({
      x: cx + R * Math.cos(angle),
      y: cy + R * Math.sin(angle),
    });
  }
  return positions;
}

function buildHive() {
  elHive.innerHTML = '';
  const size = elHive.offsetWidth || 320;
  const hexSize = size * 0.31;
  const positions = hexPositions(size);
  const letters = [state.center, ...state.outer];

  positions.forEach((pos, i) => {
    const hex = document.createElement('div');
    hex.className = 'hex' + (i === 0 ? ' center' : '');
    hex.textContent = letters[i] || '';
    hex.style.left = (pos.x - hexSize / 2) + 'px';
    hex.style.top  = (pos.y - hexSize / 2) + 'px';
    hex.style.width  = hexSize + 'px';
    hex.style.height = hexSize + 'px';
    hex.addEventListener('pointerdown', e => {
      e.preventDefault();
      appendLetter(letters[i]);
    });
    elHive.appendChild(hex);
  });
}

/* ─── Input Handling ──────────────────────────────────────────────────────── */
function appendLetter(letter) {
  if (!letter) return;
  elInput.value += letter.toLowerCase();
  onInputChange();
  elInput.focus();
}

function onInputChange() {
  const val = elInput.value.toUpperCase();
  // Highlight invalid letters
  elInput.style.color = isValidInput(val) ? '' : 'var(--error)';
  // Broadcast typing
  socket.emit('typing', { text: val });
}

function isValidInput(text) {
  if (!state.center) return true;
  const allLetters = new Set([state.center, ...state.outer]);
  return [...text].every(c => allLetters.has(c));
}

function clearInput() {
  elInput.value = '';
  elInput.style.color = '';
  elGhost.textContent = '';
}

function submitWord() {
  const word = elInput.value.trim();
  if (!word || !state.date) return;
  socket.emit('submit', { word, date: state.date });
  // Don't clear input here — wait for server confirmation
}

function shakeInput() {
  elInput.classList.remove('shake');
  void elInput.offsetWidth; // reflow
  elInput.classList.add('shake');
  setTimeout(() => elInput.classList.remove('shake'), 400);
}

function showOtherPlayer(text) {
  if (!text) {
    elOtherPlayer.hidden = true;
    elGhost.textContent = '';
    return;
  }
  elOtherPlayer.hidden = false;
  elOtherText.textContent = `Other player: "${text}"`;
  // Show ghost text (faded) behind the input
  if (!elInput.value) {
    elGhost.textContent = text;
  } else {
    elGhost.textContent = '';
  }
  // Auto-hide after 4 seconds of no updates
  clearTimeout(showOtherPlayer._timer);
  showOtherPlayer._timer = setTimeout(() => {
    elOtherPlayer.hidden = true;
    elGhost.textContent = '';
  }, 4000);
}

/* ─── Rendering ───────────────────────────────────────────────────────────── */
function renderScore() {
  elScore.textContent = state.score;
  elRank.textContent = state.rank;

  const pct = state.totalScore > 0 ? Math.min(1, state.score / state.totalScore) : 0;
  elProgressBar.style.width = (pct * 100).toFixed(1) + '%';

  const next = nextRankInfo(state.score, state.totalScore);
  elNextRank.textContent = next ? `→ ${next.name} (${next.scoreNeeded})` : '';
}

function renderFoundWords() {
  elFoundHeader.textContent = `Found (${state.foundWords.length})`;
  elFoundWords.innerHTML = '';
  // Sort alphabetically
  const sorted = [...state.foundWords].sort();
  sorted.forEach(word => {
    const span = document.createElement('span');
    span.className = 'found-word';
    span.textContent = word;
    // Check pangram: uses all 7 letters
    if (isPangram(word)) span.classList.add('pangram');
    elFoundWords.appendChild(span);
  });
}

function isPangram(word) {
  const allLetters = new Set([state.center, ...state.outerOrig]);
  return [...word.toUpperCase()].every(c => allLetters.has(c)) &&
    [...allLetters].every(c => word.toUpperCase().includes(c));
}

function updatePlayerCount(count) {
  elPlayerCount.textContent = count === 1 ? '1 player' : `${count} players`;
}

/* ─── Rank logic ──────────────────────────────────────────────────────────── */
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
  for (let i = 0; i < RANKS.length; i++) {
    if (pct < RANKS[i].pct) {
      return { name: RANKS[i].name, scoreNeeded: Math.ceil(RANKS[i].pct * total) };
    }
  }
  return null;
}

/* ─── Toast ───────────────────────────────────────────────────────────────── */
function showToast(message, type = '', duration = 2000) {
  const toast = document.createElement('div');
  toast.className = 'toast' + (type ? ' ' + type : '');
  toast.textContent = message;
  elToasts.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

/* ─── Date Panel ──────────────────────────────────────────────────────────── */
function openDatePanel() {
  elDatePanel.hidden = false;
  elOverlay.hidden = false;
}

function closeDatePanel() {
  elDatePanel.hidden = true;
  elOverlay.hidden = true;
}

async function loadDateList() {
  try {
    const res = await fetch('/api/puzzles');
    const { dates } = await res.json();
    elDateList.innerHTML = '';
    dates.forEach(date => {
      const li = document.createElement('li');
      const label = formatDateLabel(date);
      li.textContent = label;
      if (date === state.date) li.classList.add('active');
      li.addEventListener('click', () => {
        closeDatePanel();
        loadPuzzle(date);
      });
      elDateList.appendChild(li);
    });
    if (dates.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'No puzzles available yet';
      li.style.color = 'var(--gray-dark)';
      elDateList.appendChild(li);
    }
  } catch (err) {
    console.error('Failed to load dates:', err);
  }
}

function formatDateLabel(dateStr) {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (dateStr === today) return `Today — ${dateStr}`;
  if (dateStr === yesterday) return `Yesterday — ${dateStr}`;
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

/* ─── Puzzle Load ─────────────────────────────────────────────────────────── */
async function loadPuzzle(date) {
  elGameArea.hidden = true;
  elNoPuzzle.hidden = true;
  elLoading.hidden = false;

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

    elLoading.hidden = true;
    elGameArea.hidden = false;

    buildHive();
    renderFoundWords();
    renderScore();
    clearInput();

    joinRoom(date);
  } catch (err) {
    console.error('Failed to load puzzle:', err);
    elLoading.hidden = true;
    elNoPuzzle.hidden = false;
  }
}

function joinRoom(date) {
  socket.emit('join', { date });
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
  state.outer = shuffle(state.outerOrig);
  buildHive();
}

/* ─── Event Listeners ─────────────────────────────────────────────────────── */
elInput.addEventListener('input', onInputChange);

elInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    submitWord();
  }
});

elDeleteBtn.addEventListener('click', () => {
  elInput.value = elInput.value.slice(0, -1);
  onInputChange();
});

elSubmitBtn.addEventListener('click', submitWord);
elShuffleBtn.addEventListener('click', shuffleOuter);

elDateBtn.addEventListener('click', () => {
  loadDateList();
  openDatePanel();
});

$('close-date-panel').addEventListener('click', closeDatePanel);
elOverlay.addEventListener('click', closeDatePanel);

// Prevent double-tap zoom on hex tiles
document.addEventListener('dblclick', e => {
  if (e.target.closest('.hex') || e.target.closest('.icon-btn')) {
    e.preventDefault();
  }
}, { passive: false });

// Rebuild hive on resize
window.addEventListener('resize', () => {
  if (!elGameArea.hidden) buildHive();
});

/* ─── Init ────────────────────────────────────────────────────────────────── */
async function init() {
  // Try to load today's puzzle; fall back to most recent available
  const today = new Date().toISOString().slice(0, 10);
  const res = await fetch('/api/puzzles').catch(() => null);
  let dates = [];
  if (res && res.ok) {
    const data = await res.json();
    dates = data.dates || [];
  }

  const targetDate = dates.includes(today) ? today : (dates[0] || null);
  if (targetDate) {
    await loadPuzzle(targetDate);
  } else {
    elLoading.hidden = true;
    elNoPuzzle.hidden = false;
  }
}

init();
