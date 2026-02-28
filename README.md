# Spelling Bee — Multiplayer

A real-time multiplayer take on the NYT Spelling Bee. Share a room with a friend, find words together, and watch each other's progress live.

```
        ┌─────┐
    ┌─────┐ ┌─────┐
    │  M  │ │  N  │ ┌─────┐
    └─────┘ └─────┘ │  D  │
        ┌─────┐     └─────┘
        │  W  │
        └─────┘
    ┌─────┐ ┌─────┐
    │  L  │ │  I  │
    └─────┘ └─────┘
        ┌─────┐
        │  E  │
        └─────┘
```

## Features

- **Real-time collaboration** — two players share a room; words found by either player count for both
- **Live typing indicator** — see what the other player is typing as they type it
- **Synchronized shuffle** — shuffling the outer tiles syncs to all players in the room
- **Puzzle archive** — play today's puzzle or browse the last two weeks
- **Rank progression** — 10 levels from Beginner to Queen Bee, just like the original
- **Dark mode** — follows system preference with a manual override
- **Mobile-first** — tap tiles directly; works on any screen size
- **Self-hosted** — puzzles are fetched automatically every morning; no NYT account needed

## Tech Stack

| Layer      | Technology                       |
|------------|----------------------------------|
| Server     | Node.js 22+, Express             |
| Realtime   | Socket.io 4                      |
| Database   | `node:sqlite` (built-in, no deps)|
| Scraper    | `jsdom` + NYT puzzle endpoint    |
| Scheduler  | `node-cron` (daily 6 AM UTC)     |
| Frontend   | Vanilla JS, CSS custom properties|

No build step, no bundler, no framework — just files.

## Quick Start

```bash
# 1. Clone and install
git clone <repo-url>
cd spellingbee
npm install

# 2. Configure (optional — defaults work out of the box)
cp .env.example .env

# 3. Start
npm start
# → http://localhost:3000
```

The server fetches today's puzzle on startup automatically. Open two browser tabs (or send the URL to a friend on the same network) to play together.

## Development

```bash
npm run dev    # node --watch; restarts on file changes
```

## Docker

```bash
# Build
docker build -t spellingbee .

# Run (persists the database across restarts)
docker run -d \
  --name spellingbee \
  -p 3000:3000 \
  -v spellingbee-data:/data \
  spellingbee
```

Or with Docker Compose:

```yaml
services:
  spellingbee:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - spellingbee-data:/data
    restart: unless-stopped

volumes:
  spellingbee-data:
```

## Environment Variables

| Variable        | Default              | Description                        |
|-----------------|----------------------|------------------------------------|
| `PORT`          | `3000`               | HTTP port to listen on             |
| `DATABASE_PATH` | `./spellingbee.db`   | Path to the SQLite database file   |

## How It Works

### Puzzle Fetching

On startup (and daily at 6 AM UTC), the server fetches the current puzzle directly from the NYT endpoint. The puzzle data — center letter, outer letters, valid word list, pangrams — is parsed from the `window.gameData` object embedded in the page HTML and stored in SQLite.

### Rooms

Each puzzle date is a room. Players join by visiting the site; if no room exists for that date yet, one is created. The room tracks which words have been found and the cumulative score — shared state for all players.

### Multiplayer Sync

All game state is authoritative on the server. Clients emit:

| Event      | Payload                  | Description                   |
|------------|--------------------------|-------------------------------|
| `join`     | `{ date }`               | Join a puzzle room            |
| `typing`   | `{ text }`               | Broadcast current word attempt|
| `submit`   | `{ word, date }`         | Submit a word for validation  |
| `shuffle`  | `{ outer }`              | Sync tile order to all players|

The server validates every submission — letter set, minimum length, center letter requirement, word list membership — and broadcasts `word_found` or `word_error` back to the room.

### Scoring

Points per word: 1 for 4-letter words, 1 per letter for 5+, +7 bonus for pangrams (words using all 7 letters). Rank thresholds mirror the NYT original.

## File Structure

```
spellingbee/
├── server.js           # Express + Socket.io; REST API + game logic
├── lib/
│   ├── db.js           # SQLite schema and queries (node:sqlite)
│   ├── scraper.js      # NYT puzzle fetcher and parser
│   └── scheduler.js    # Daily cron job
├── public/
│   ├── index.html      # Single-page app shell
│   ├── style.css       # Mobile-first styles; CSS hexagons via clip-path
│   └── app.js          # Client game logic and Socket.io events
├── Dockerfile
├── .env.example
└── package.json
```
