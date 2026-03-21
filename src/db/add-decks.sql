CREATE TABLE IF NOT EXISTS decks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cards TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
