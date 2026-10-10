-- 在 Cloudflare D1 控制台执行此文件中的 SQL；可以重复执行，不会删除已有投稿。
-- full_title/full_summary 保存完整文献文本；已有数据库在投稿时安全 ADD COLUMN 升级。
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 2 AND 200),
  summary TEXT NOT NULL CHECK (length(trim(summary)) BETWEEN 10 AND 1200),
  full_title TEXT,
  full_summary TEXT,
  publication_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  submitter_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_submissions_status_id ON submissions (status, id DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_submitter_created ON submissions (submitter_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_submissions_title_created ON submissions (title, created_at);

-- publication_key holds the normalized-title SHA-256; existing rows remain unchanged until updated.
CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_publication_key ON submissions(publication_key);
