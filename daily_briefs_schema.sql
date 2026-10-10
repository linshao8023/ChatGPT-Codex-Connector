-- Daily AI literature digest and reader frontier notes; non-destructive.
-- Can be run repeatedly on the existing Cloudflare D1 database.
CREATE TABLE IF NOT EXISTS daily_brief_issues (
 issue_date TEXT PRIMARY KEY,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 item_count INTEGER NOT NULL DEFAULT 0 CHECK(item_count BETWEEN 0 AND 10),
 method TEXT NOT NULL DEFAULT 'abstract_ai'
);
CREATE TABLE IF NOT EXISTS daily_brief_items (
 issue_date TEXT NOT NULL REFERENCES daily_brief_issues(issue_date) ON DELETE CASCADE,
 position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 10),
 openalex_id TEXT NOT NULL,
 doi TEXT NOT NULL,
 title TEXT NOT NULL,
 journal TEXT NOT NULL,
 authors TEXT NOT NULL,
 published_at TEXT NOT NULL,
 summary_short TEXT NOT NULL,
 summary_full TEXT NOT NULL,
 source_url TEXT NOT NULL,
 rank_note TEXT NOT NULL,
 rank_url TEXT NOT NULL,
 PRIMARY KEY(issue_date,position)
);
CREATE INDEX IF NOT EXISTS idx_daily_items_doi ON daily_brief_items(doi);
CREATE TABLE IF NOT EXISTS daily_brief_state (
 id INTEGER PRIMARY KEY CHECK(id=1),
 lock_until INTEGER NOT NULL DEFAULT 0,
 last_attempt_at TEXT,
 last_error TEXT
);
INSERT OR IGNORE INTO daily_brief_state(id) VALUES(1);
CREATE TABLE IF NOT EXISTS daily_frontier_submissions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 4 AND 220),
 journal TEXT NOT NULL CHECK(length(trim(journal)) BETWEEN 2 AND 160),
 source_url TEXT NOT NULL CHECK(length(source_url) BETWEEN 10 AND 600),
 summary TEXT NOT NULL CHECK(length(trim(summary)) BETWEEN 24 AND 2000),
 initials TEXT NOT NULL CHECK(length(initials) BETWEEN 1 AND 12 AND initials NOT GLOB '*[^a-z]*'),
 status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN('pending','approved','rejected')),
 submitter_hash TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_daily_sub_status ON daily_frontier_submissions(status,id DESC);
CREATE INDEX IF NOT EXISTS idx_daily_sub_rate ON daily_frontier_submissions(submitter_hash,created_at);
