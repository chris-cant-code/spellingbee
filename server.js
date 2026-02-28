require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const db = require('./lib/db');
const { startScheduler } = require('./lib/scheduler');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Ranking Thresholds ───────────────────────────────────────────────────────

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

function getRank(score, totalScore) {
  if (totalScore === 0) return RANKS[0].name;
  const pct = score / totalScore;
  let rank = RANKS[0].name;
  for (const r of RANKS) {
    if (pct >= r.pct) rank = r.name;
  }
  return rank;
}

function getNextRank(score, totalScore) {
  if (totalScore === 0) return null;
  const pct = score / totalScore;
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (pct >= RANKS[i].pct) {
      const next = RANKS[i + 1];
      return next ? { name: next.name, scoreNeeded: Math.ceil(next.pct * totalScore) } : null;
    }
  }
  return null;
}

// ─── REST API ─────────────────────────────────────────────────────────────────

app.get('/api/puzzles', (req, res) => {
  const dates = db.listPuzzleDates();
  res.json({ dates });
});

app.get('/api/puzzle/:date', (req, res) => {
  const puzzle = db.getPuzzle(req.params.date);
  if (!puzzle) return res.status(404).json({ error: 'Puzzle not found' });

  // Count valid answers per starting letter (used for hints — doesn't expose words)
  const letterCounts = {};
  puzzle.answers.forEach(a => {
    const ch = a.word[0];
    letterCounts[ch] = (letterCounts[ch] || 0) + 1;
  });

  res.json({
    date: puzzle.date,
    center: puzzle.center,
    outer: puzzle.outer,
    totalScore: puzzle.total_score,
    letterCounts,
  });
});

app.get('/api/room/:date', (req, res) => {
  const { date } = req.params;
  const puzzle = db.getPuzzle(date);
  if (!puzzle) return res.status(404).json({ error: 'Puzzle not found' });
  const room = db.ensureRoom(date);
  const rank = getRank(room.score, puzzle.total_score);
  const nextRank = getNextRank(room.score, puzzle.total_score);
  res.json({
    date,
    foundWords: room.found_words,
    score: room.score,
    totalScore: puzzle.total_score,
    rank,
    nextRank,
  });
});

app.post('/api/room/:date/reset', (req, res) => {
  const { date } = req.params;
  const puzzle = db.getPuzzle(date);
  if (!puzzle) return res.status(404).json({ error: 'Puzzle not found' });
  db.resetRoom(date);
  res.json({ ok: true });
});

// ─── Socket.io ────────────────────────────────────────────────────────────────

// Track player counts per room
const roomPlayers = new Map(); // date → Set of socket ids

io.on('connection', (socket) => {
  let currentDate = null;

  socket.on('join', ({ date }) => {
    if (!date) return;
    currentDate = date;
    socket.join(date);

    if (!roomPlayers.has(date)) roomPlayers.set(date, new Set());
    roomPlayers.get(date).add(socket.id);
    const playerCount = roomPlayers.get(date).size;

    // Emit current state to joining player
    const puzzle = db.getPuzzle(date);
    if (!puzzle) {
      socket.emit('error', { message: 'Puzzle not found for date: ' + date });
      return;
    }
    const room = db.ensureRoom(date);
    const rank = getRank(room.score, puzzle.total_score);

    socket.emit('room_state', {
      foundWords: room.found_words,
      score: room.score,
      totalScore: puzzle.total_score,
      rank,
      playerCount,
    });

    // Notify everyone about player count
    io.to(date).emit('player_count', { count: playerCount });
  });

  socket.on('typing', ({ text }) => {
    if (!currentDate) return;
    // Broadcast to others in same room (not sender)
    socket.to(currentDate).emit('typing_update', { text, playerId: socket.id });
  });

  socket.on('shuffle', ({ outer }) => {
    if (!currentDate || !Array.isArray(outer)) return;
    // Broadcast the new tile order to everyone in the room (including sender)
    io.to(currentDate).emit('shuffle', { outer });
  });

  socket.on('submit', ({ word, date }) => {
    if (!date || !word) return;
    const puzzle = db.getPuzzle(date);
    if (!puzzle) {
      socket.emit('word_error', { word, reason: 'no_puzzle' });
      return;
    }

    const w = word.toUpperCase().trim();

    // Validation
    if (w.length < 4) {
      socket.emit('word_error', { word: w, reason: 'too_short' });
      return;
    }
    if (!w.includes(puzzle.center)) {
      socket.emit('word_error', { word: w, reason: 'missing_center' });
      return;
    }
    const allLetters = new Set([puzzle.center, ...puzzle.outer]);
    if ([...w].some(c => !allLetters.has(c))) {
      socket.emit('word_error', { word: w, reason: 'bad_letters' });
      return;
    }

    const room = db.getRoom(date) || db.ensureRoom(date);
    if (room.found_words.includes(w)) {
      socket.emit('word_error', { word: w, reason: 'already_found' });
      return;
    }

    const answer = puzzle.answers.find(a => a.word === w);
    if (!answer) {
      socket.emit('word_error', { word: w, reason: 'not_in_list' });
      return;
    }

    // Valid! Save and broadcast
    const updated = db.addFoundWord(date, w, answer.points);
    const newRank = getRank(updated.score, puzzle.total_score);

    io.to(date).emit('word_found', {
      word: w,
      points: answer.points,
      isPangram: !!answer.is_pangram,
      newScore: updated.score,
      totalScore: puzzle.total_score,
      newRank,
    });
  });

  socket.on('disconnect', () => {
    if (currentDate && roomPlayers.has(currentDate)) {
      roomPlayers.get(currentDate).delete(socket.id);
      const count = roomPlayers.get(currentDate).size;
      io.to(currentDate).emit('player_count', { count });
    }
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`[server] Listening on http://localhost:${PORT}`);
  startScheduler();
});
