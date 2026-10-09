-- Material Notes: Zotero 群组缓存专用表
-- 仅新增独立表，不修改或清空 submissions 投稿/审核数据。
-- 可以在 Cloudflare D1 Console 中重复执行。
CREATE TABLE IF NOT EXISTS zotero_items (
  zotero_key TEXT NOT NULL,
  generation TEXT NOT NULL,
  item_version INTEGER NOT NULL DEFAULT 0,
  item_type TEXT NOT NULL,
  title TEXT NOT NULL,
  authors TEXT NOT NULL DEFAULT '',
  publication_title TEXT NOT NULL DEFAULT '',
  item_year TEXT NOT NULL DEFAULT '',
  doi TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  abstract TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  zotero_url TEXT NOT NULL DEFAULT '',
  date_modified TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (zotero_key, generation)
);
CREATE INDEX IF NOT EXISTS idx_zotero_generation_modified
ON zotero_items (generation, date_modified DESC, zotero_key DESC);

CREATE TABLE IF NOT EXISTS zotero_sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  active_generation TEXT NOT NULL DEFAULT '',
  last_synced_at TEXT,
  last_attempt_at TEXT,
  lock_until INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_version INTEGER NOT NULL DEFAULT 0,
  item_count INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO zotero_sync_state (id) VALUES (1);
