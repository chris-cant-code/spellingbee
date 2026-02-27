const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'spellingbee.db');

let db;

function getDb() {
  if (!db) {
    db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA foreign_keys = ON;');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS puzzles (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      date        TEXT UNIQUE NOT NULL,
      center      TEXT NOT NULL,
      outer       TEXT NOT NULL,
      answers     TEXT NOT NULL,
      total_score INTEGER NOT NULL DEFAULT 0,
      fetched_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS game_rooms (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      puzzle_date  TEXT UNIQUE NOT NULL,
      found_words  TEXT NOT NULL DEFAULT '[]',
      score        INTEGER NOT NULL DEFAULT 0,
      updated_at   INTEGER NOT NULL
    );
  `);
}

// Puzzle queries

function getPuzzle(date) {
  const row = getDb().prepare('SELECT * FROM puzzles WHERE date = ?').get(date);
  if (!row) return null;
  return {
    ...row,
    outer: JSON.parse(row.outer),
    answers: JSON.parse(row.answers),
  };
}

function listPuzzleDates() {
  return getDb().prepare('SELECT date FROM puzzles ORDER BY date DESC').all().map(r => r.date);
}

function upsertPuzzle({ date, center, outer, answers, total_score }) {
  getDb().prepare(`
    INSERT INTO puzzles (date, center, outer, answers, total_score, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      center = excluded.center,
      outer = excluded.outer,
      answers = excluded.answers,
      total_score = excluded.total_score,
      fetched_at = excluded.fetched_at
  `).run(
    date,
    center,
    JSON.stringify(outer),
    JSON.stringify(answers),
    total_score,
    Math.floor(Date.now() / 1000)
  );
}

function hasPuzzle(date) {
  const row = getDb().prepare('SELECT 1 FROM puzzles WHERE date = ?').get(date);
  return !!row;
}

// Room queries

function getRoom(date) {
  const row = getDb().prepare('SELECT * FROM game_rooms WHERE puzzle_date = ?').get(date);
  if (!row) return null;
  return {
    ...row,
    found_words: JSON.parse(row.found_words),
  };
}

function ensureRoom(date) {
  getDb().prepare(`
    INSERT OR IGNORE INTO game_rooms (puzzle_date, found_words, score, updated_at)
    VALUES (?, '[]', 0, ?)
  `).run(date, Math.floor(Date.now() / 1000));
  return getRoom(date);
}

function addFoundWord(date, word, points) {
  const room = getRoom(date);
  if (!room) return null;
  const words = room.found_words;
  if (words.includes(word)) return null;
  words.push(word);
  const newScore = room.score + points;
  getDb().prepare(`
    UPDATE game_rooms SET found_words = ?, score = ?, updated_at = ? WHERE puzzle_date = ?
  `).run(JSON.stringify(words), newScore, Math.floor(Date.now() / 1000), date);
  return { found_words: words, score: newScore };
}

function resetRoom(date) {
  getDb().prepare(`
    UPDATE game_rooms SET found_words = '[]', score = 0, updated_at = ? WHERE puzzle_date = ?
  `).run(Math.floor(Date.now() / 1000), date);
}

module.exports = {
  getDb,
  getPuzzle,
  listPuzzleDates,
  upsertPuzzle,
  hasPuzzle,
  getRoom,
  ensureRoom,
  addFoundWord,
  resetRoom,
};
