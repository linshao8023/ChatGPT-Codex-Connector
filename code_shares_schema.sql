-- Data Visualization & Analysis Code Library (Cloudflare D1).
-- Safe to run repeatedly. Does not alter papers, submissions, or Zotero tables.
CREATE TABLE IF NOT EXISTS code_shares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 2 AND 160),
  code TEXT NOT NULL CHECK(length(trim(code)) BETWEEN 10 AND 20000),
  full_title TEXT,
  full_code TEXT,
  initials TEXT NOT NULL CHECK(length(initials) BETWEEN 1 AND 12 AND initials NOT GLOB '*[^a-z]*'),
  status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('pending','approved','rejected')),
  submitter_hash TEXT NOT NULL,
  content_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_code_shares_status_created ON code_shares(status,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_code_shares_author ON code_shares(initials);
CREATE INDEX IF NOT EXISTS idx_code_shares_rate ON code_shares(submitter_hash,created_at);

-- Attempts are counted before checking the short shared publishing code.
-- Cloudflare WAF/rate limiting is additionally recommended.
CREATE TABLE IF NOT EXISTS code_share_attempts (
  ip_hash TEXT NOT NULL,
  window_hour INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(ip_hash,window_hour)
);
CREATE INDEX IF NOT EXISTS idx_code_attempts_hour ON code_share_attempts(window_hour);
