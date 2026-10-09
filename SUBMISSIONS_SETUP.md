# 开启访客文献投稿（无登录、无独立域名）

此项目使用 Cloudflare Pages Functions + Cloudflare D1。网站访客只填写 **文献名称**、**简要总结** 两项，不需要 GitHub 账号。保存进 D1 的记录默认为 \`pending\`，经站长审核后才显示在网页下方的「读者分享」区域。原有 \`public/data/papers.json\` 手工精选目录不被公众直接改动。

## 首次启用：Cloudflare 控制台 3 步

1. 在 [Cloudflare 控制台](https://dash.cloudflare.com/) → Workers & Pages → D1 SQL database → Create database，名称建议 \`material-notes-submissions\`（可自定），创建完成进入该数据库的 **Console**。
2. 打开仓库根目录的 [schema.sql](./schema.sql)，复制其中所有 SQL 到 D1 数据库的 **Console**，点击 Execute。仅需首次执行；脚本使用 \`IF NOT EXISTS\`，再次运行不会清空投稿。
3. Workers & Pages → 你的网站 Pages 项目 → **Settings → Bindings → Add → D1 database**，**Variable name 必须填写 \`DB\`**，数据库选择 \`material-notes-submissions\`，保存后 **重新部署生产环境**。如果使用预览分支测试，Preview 环境也要单独绑定。

Pages 原有设置仍然是：GitHub 仓库 \`linshao8023/ChatGPT-Codex-Connector\`，Production branch \`material-notes-pages\`，Framework preset \`None\`，Build command \`exit 0\`，输出目录 \`public\`，根目录留空。无需自定义域名，无需 Node/npm。Functions 源码自动从 **仓库根目录** 的 \`functions/api/submissions.js\` 部署；不要将它放入 \`public/\`。

**验证**：部署后打开 \`https://你的项目.pages.dev/api/submissions\`：
- 返回 \`{"ok":true,"submissions":[]}\` 表示数据库连接正常且没有已审核的公开记录。
- 若返回 503，则检查 D1 表是否建好、绑定变量名是否精确为 \`DB\`、以及是否重新部署。
- 访问首页底部投稿区域，在无登录状态填写两个字段并提交，应看到“提交成功，审核后展示”。

## 审核与公开（在 Cloudflare D1 控制台）

查看待审核稿件：
\`\`\`sql
SELECT id, title, summary, created_at
FROM submissions
WHERE status = 'pending'
ORDER BY id DESC
LIMIT 50;
\`\`\`

检查内容后，批准某条记录（将数字替换为真实 id）：
\`\`\`sql
UPDATE submissions
SET status = 'approved', reviewed_at = datetime('now')
WHERE id = 123 AND status = 'pending';
\`\`\`

拒绝或隐藏某条记录：
\`\`\`sql
UPDATE submissions
SET status = 'rejected', reviewed_at = datetime('now')
WHERE id = 123;
\`\`\`

公开展示时仅会返回 \`approved\` 的最新 30 条，无需修改 GitHub、不需要重新部署，刷新网页即可看到。数据库里的 \`pending\`、\`rejected\` 记录不会从公开接口返回。请在审核时检查文献是否真实、总结是否合理，必要时拒绝明显广告或侵权内容。

## 防滥用与安全

- 后端验证字段长度（名称 2–200 字、总结 10–1200 字）、提交来源、JSON 大小和隐藏蜜罐字段。
- 单个来源大致每小时限 3 次，重复内容 24 小时内拒绝；不存储原始 IP，仅存储按 UTC 日生成的 IP 摘要。
- **强烈建议**在 Pages Settings → Variables and Secrets 新增名为 \`RATE_LIMIT_SALT\` 的随机、较长的加密 Secret，然后重新部署。该项可选，缺省也能工作，但仅提供基础限流，不能代替专业反垃圾措施。
- 面向大量不受信任的公众时，可再加 Cloudflare Turnstile 和 WAF 限流规则；当前版本无需用户验证码/账号，不能保证阻挡所有自动化滥用。
- 后端采用参数化 SQL，公开展示使用 \`textContent\`；不在前端公开 D1 查询凭据。_routes.json 仅将 \`/api/*\` 交给 Function，静态请求不消耗 Functions 调用额度。
- 未完成 D1 初始化时，前端会显示“投稿功能尚未启用”，不把未保存的内容谎报为成功。
- 请勿把受版权保护的 PDF 当作投稿附件；这里仅接收名称和你自己撰写的简要总结。

官方说明：https://developers.cloudflare.com/pages/functions/bindings/ 、https://developers.cloudflare.com/d1/get-started/ 、https://developers.cloudflare.com/pages/functions/routing/ 
