-- Daily human-submitted AI research digests (10 numbered journal-paper items per issue).
-- This creates a new table only; existing papers, code and Zotero data remain unchanged.
-- The Pages Function also creates this table automatically when first accessed.
CREATE TABLE IF NOT EXISTS daily_ai_digests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_date TEXT NOT NULL UNIQUE,
  headline TEXT NOT NULL,
  body TEXT NOT NULL CHECK(length(trim(body)) BETWEEN 50 AND 2000),
  full_body TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Existing deployments are safely extended via ALTER TABLE on API access;
-- do not run DROP TABLE. full_body stores the complete 20,000-character edition.
