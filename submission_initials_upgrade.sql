-- 单独运行此 SQL 即可为已有站点增加投稿者姓名首字母。
-- 重复执行安全；不会修改现有 submissions、知识笔记或 Zotero 记录。
-- 仅存投稿者自愿提供的姓名首字母，不存真实姓名。与原 submissions 表关联。
CREATE TABLE IF NOT EXISTS submission_attributions (
  submission_id INTEGER PRIMARY KEY REFERENCES submissions(id) ON DELETE CASCADE,
  initials TEXT NOT NULL CHECK (length(initials) BETWEEN 1 AND 12 AND initials NOT GLOB '*[^a-z]*')
);
