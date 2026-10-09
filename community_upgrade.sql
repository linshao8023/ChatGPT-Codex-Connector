-- Material Notes 社区升级（非破坏性）。在已有 D1 数据库执行。
-- 可反复执行，不会清理或覆盖 submissions / zotero_items 已有记录。
CREATE TABLE IF NOT EXISTS knowledge_posts (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 2 AND 200),
 summary TEXT NOT NULL CHECK(length(trim(summary)) BETWEEN 10 AND 1200),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 submitter_hash TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_knowledge_status_time ON knowledge_posts(status,id DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_submitter ON knowledge_posts(submitter_hash,created_at);

CREATE TABLE IF NOT EXISTS submission_receipts (
 receipt_hash TEXT PRIMARY KEY,
 post_kind TEXT NOT NULL CHECK(post_kind IN ('community','knowledge')),
 post_id INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_receipt_post ON submission_receipts(post_kind,post_id);

CREATE TABLE IF NOT EXISTS moderation_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 post_kind TEXT NOT NULL CHECK(post_kind IN ('community','knowledge')),
 post_id INTEGER NOT NULL,
 previous_status TEXT NOT NULL,
 new_status TEXT NOT NULL,
 reason TEXT NOT NULL DEFAULT '',
 acted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_moderation_time ON moderation_events(acted_at DESC);
