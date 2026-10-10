-- Data Visualization & Analysis Code Library (Cloudflare D1).
-- Safe to run repeatedly. Does not alter papers, submissions, or Zotero tables.
CREATE TABLE IF NOT EXISTS code_shares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 2 AND 160),
  code TEXT NOT NULL CHECK(length(trim(code)) BETWEEN 10 AND 20000),
  full_title TEXT,
  full_code TEXT,
  publication_key TEXT,
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

-- Only non-NULL publication keys are unique; historical rows migrate on republish.
CREATE UNIQUE INDEX IF NOT EXISTS idx_code_shares_publication_key ON code_shares(publication_key);

-- Sample images are stored privately in R2, NOT in D1. This table only keeps R2 keys.
CREATE TABLE IF NOT EXISTS code_share_images (
  id TEXT PRIMARY KEY,
  code_id INTEGER NOT NULL REFERENCES code_shares(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL CHECK(mime_type IN ('image/png','image/jpeg','image/webp')),
  size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 1048576),
  position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 2),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_code_share_images_code ON code_share_images(code_id,position);
