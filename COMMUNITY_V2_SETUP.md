# Material Notes 2.0 — 社区检索、投稿与审核部署

本次升级已提交到 `material-notes-pages`。**原始 D1 表 `submissions`、`zotero_items` 不修改或清空**。升级需要新增独立表，并在 Cloudflare 设置管理员密钥。没有 Cloudflare 的直接账号权限，代码发布不等于数据库已经迁移，也不等于线上功能已经验证。

## 1. 非破坏性数据库迁移（必须）

登录 Cloudflare → Storage & databases → D1 → 现有 `material-notes-submissions` 数据库 → Console。

执行 [community_upgrade.sql](./community_upgrade.sql) 的全部 SQL。脚本只新建：
- `knowledge_posts`：科研知识笔记和审核状态
- `submission_receipts`：匿名投稿的回执代码哈希
- `moderation_events`：审核操作的事件记录

现有的 `submissions` 表和 Zotero 相关表保留。**如果群组 Zotero 尚未配置，也需执行 [zotero_schema.sql](./zotero_schema.sql)**，否则统一搜索无法正常联合查询。

## 2. 管理员密钥（必须）

Cloudflare → Workers & Pages → Pages 项目 → Settings → Variables and Secrets：
- 新增 `ADMIN_REVIEW_TOKEN`，类型 **Secret**，值是至少 32 个字符的高强度随机字符串。推荐本地命令：`openssl rand -hex 32`。
- 可以继续复用原先的 D1 绑定：变量名 **DB**，数据库 `material-notes-submissions`。
- 强烈建议设置已存在的 `RATE_LIMIT_SALT` Secret，用于投稿限流 IP 摘要。
- 默认**不要设置** `AUTO_APPROVE_ENABLED`，或者明确设成 `false`。只有决定允许匿名用户在未经人工事实审核的情况下自动公开时才设为 `true`。

务必重新部署最新 `material-notes-pages`，使 Pages Functions 读取最新 Secrets 和 Bindings。绝对不要把管理员密钥写入 GitHub、网页 JS 或分享给聊天机器人。

## 3. 新的公开体验

- `/` 首页顶部附近新增“科研社区统一检索”，搜索范围涵盖 D1 Zotero 缓存、审核通过的文献分享与知识笔记；支持来源过滤、服务端分页（20 条/页）。
- `/` 新增 “提交文献与科研知识”，只需标题和简要总结，投稿成功提供 UUID 回执。读者可凭回执查询 `pending`、`approved`、`rejected`；回执信息只存为 SHA-256 哈希，不公开给其他读者。
- 原有 Zotero 页面、访客投稿表单、文献精选 JSON 和旧的“读者分享”区域保留。原“读者分享”区域仍显示最新 30 条，新统一检索可以浏览更早的审核通过数据。
- `/admin.html` 管理页面：输入 Secret 后，可按状态查看文献分享和知识笔记，并点击“通过”“拒绝/下架”“恢复待审”。权限由服务器检查，不是仅隐藏网页按钮。
- `/api/search?source=all&q=PFAS&page=1`：聚合分页 API
- `/api/knowledge?page=1`：审核通过的知识笔记 API
- `/api/receipt`：回执码状态查询（POST）
- `/api/admin/review`：经 Secret 授权的审核 API（GET / POST）

## 4. 默认自动检查

**默认是人工审核**。Pages Functions 将验证字符长度、简单广告特征、重复内容及 1 小时内的大致提交次数。选择设置 `AUTO_APPROVE_ENABLED=true` 后，只会对符合基础规则、摘要足够长且无可疑链接的文本自动批准。这不是 AI 事实核查，**不能证明论文存在或总结正确**。对于公众网站，建议先维持 false，后续接入 DOI 核验、反垃圾机制、撤稿/举报后，再逐步开放自动放行。

## 5. 验收

- [ ] D1 Console 执行 `community_upgrade.sql`，确认无报错。
- [ ] 设置 `ADMIN_REVIEW_TOKEN` 为 Secret，确认绑定 `DB`。
- [ ] Pages 重新部署目标分支；打开首页，可看到统一检索和新投稿区。
- [ ] 匿名提交一条测试内容，收到回执；在 D1 Console 能查到新记录。
- [ ] 打开 `/admin.html`，输入 Secret 并审核，刷新首页检索应显示。
- [ ] 使用回执查询状态，检查已拒绝记录不会被公开检索返回。
- [ ] 旧投稿数据继续存在并可审核；原 Zotero 缓存正常。
- [ ] 移动、电信、联通测试实际打开与投稿，`pages.dev` 在中国大陆的可达性无保证。

## 后续增强建议

这次实现了核心工作流，但 **不包含** DOI 自动补全、相似文献合并、知识引用关系、AI 事实核验、Cloudflare Cron 或管理员多账号权限。现有独立社区投稿列表支持全量服务端分页，而精选 JSON 的旧分类浏览仍为单独板块。

管理密钥在前端内存中使用，并随 HTTP Authorization 头发送，只要离开页面即丢失。管理页并不代替企业级身份验证；公开运营建议进一步通过 Cloudflare Access 限制管理员入口以及配置 WAF 限流。匿名回执需要妥善保存，遗失无法找回。