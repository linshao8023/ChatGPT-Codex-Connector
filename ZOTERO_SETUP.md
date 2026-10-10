# Zotero 群组文献库：只读同步与 D1 缓存

本分支已接入 Zotero 群组 https://www.zotero.org/groups/6671409/shaolin_library

## 配置清单（需要站长在 Cloudflare 控制台完成）

1. Cloudflare → D1 → 选择原来的 \`material-notes-submissions\` 数据库 → Console → 执行本仓库根目录的 [zotero_schema.sql](./zotero_schema.sql)。只新增 zotero_items / zotero_sync_state 两张表，**不会改动 submissions 投稿和审批表**。
2. Cloudflare → Workers & Pages → 现有 Pages 项目 → Settings → Bindings：确认生产环境中 **D1 binding 名称是 \`DB\`**，且指向这同一个数据库。若之前投稿功能已经正常运行，该绑定通常可以复用。
3. 如果这个 Zotero 群组/目标分类是公开可读的，**不用设置 ZOTERO_API_KEY**；如果访问受限，请在 Zotero 官网创建仅能读取此群组的只读 API key，然后到 Cloudflare Pages 项目 → Settings → Variables and Secrets 中添加 **Secret**：\`ZOTERO_API_KEY\`。绝对不要把 key 发到聊天里、写在 GitHub 中，或写进网站前端代码。
4. 若只想同步群组内一个分类（collection），在 Cloudflare 项目环境变量中添加可选 \`ZOTERO_COLLECTION_KEY\`，填写 Zotero collection 的 8 位 KEY，而不是名称。缺省同步群组顶层文献条目（所有分类的文献均会出现在 Zotero 顶层条目 API 结果中）。附件、独立笔记、注释和 PDF 不会进入本站公开目录。
5. 为手动强制同步配置 Cloudflare **Secret**：\`ZOTERO_SYNC_TOKEN\`，填自己生成的至少 24 个字符的随机令牌，**不要与 ZOTERO_API_KEY 相同**。此令牌只用于站长强制刷新接口，非公开 Zotero 读取不需要它。可以用终端 \`openssl rand -hex 32\` 生成。
6. 保存变量/绑定后触发 **重新部署**，使 Pages Functions 获得新绑定。当前项目仍使用仓库 \`linshao8023/ChatGPT-Codex-Connector\` 的 \`material-notes-pages\` 分支，输出目录 \`public\`，构建命令 \`exit 0\`，不需要自定义域名。

## 验证

打开 \`https://你的-project.pages.dev/api/zotero?page=1\`：
- 初始化成功但还没有获取数据：\`{"ok":true,"ready":false,...}\`，首次访问会触发后台同步。请稍后刷新，不保证首次请求就获得文献。
- 同步完成：\`{"ok":true,"ready":true,"total":...,"items":[...]}\`，前端“Zotero 群组文献”区会展示搜索结果及分页。
- 503：确认已经执行 \`zotero_schema.sql\`、D1 生产环境绑定名是 \`DB\`、Pages 已重新部署。
- \`last_error\` 非空：上次尝试失败，已缓存条目仍可浏览。常见原因是访问 Zotero 群组受到权限限制或 API 被临时限流；需要检查 Zotero 群组公开设置或配置只读 API Key。

## 同步与分页行为

- 第一次读取公开 GET \`/api/zotero\` 会检查并触发同步；之后**最多每 12 小时检查一次**，但如果没人访问，不会主动执行定时任务。此版本**不是 Cron 定时触发**。
- 失败后至少间隔 10 分钟再尝试。完整读取到全部分页并写入新一代 D1 快照后才切换展示，不会因为网络中途失败而清空现有缓存。
- 默认单次上限 10,000 个 Zotero 顶层条目，超过上限时不会发布不完整快照；如果数据非常大，应改成分批队列同步。
- 前端公开 API GET：\`/api/zotero?page=1&q=cellulose\`；每页 20 条；服务器按标题、作者、DOI、摘要、标签搜索。
- 附件和 notes/annotations 都不读取或不公开。对公共 Zotero group 也应检查其中条目的摘要/标签是否适合公开。
- 源 Zotero 文献库永远通过 **GET** 请求访问：该程序不创建、不编辑、不删除 Zotero 条目，也不会同步 PDF 内容。D1 只是只读镜像缓存。
- 手动刷新为带令牌的 POST 接口，示例命令（请在你的本地终端执行，令牌绝不可写入文档或 GitHub）：

  \`\`\`bash
  curl -X POST "https://你的-project.pages.dev/api/zotero/refresh" \
    -H "Authorization: Bearer 在Cloudflare中保存的ZOTERO_SYNC_TOKEN"
  \`\`\`

  HTTP 202 表示请求已进入异步任务，并不代表此刻已经同步完成，几秒至更长时间后通过 GET 检查 last_synced_at/last_error。

## 与访客投稿的关系

访客提交的“文献名称 + 简要总结”继续由 \`/api/submissions\` 写入 \`submissions\`，人工审核后公开在“读者分享”区。Zotero 文献只来自群组 API，公开展示在新的“Zotero 群组文献”区。两个来源独立存储、互不覆盖，已有审核记录保持原样。

## 安全

\`ZOTERO_API_KEY\` 和 \`ZOTERO_SYNC_TOKEN\` 只能保存在 Cloudflare Variables and Secrets（选择 Secret），**不可**使用 \`NEXT_PUBLIC_\` 等会暴露到浏览器的前缀。公开 GET 不会返回秘密。生产/预览环境可能需要分别配置 Bindings 和 Secrets。若希望按整点周期自动同步，请另外配置 Worker Cron Triggers；Pages 自身不提供本版本的后台周期 Cron 任务。

## 首次同步断点续传（2026-10-10 更新）

同步已改为每次后台任务最多处理 2 页（每页至多 100 条），使用单条 JSON1 SQL 写入每页，不再占用数百次 D1 查询；首次访问自动创建 `zotero_sync_progress` 进度表，不需额外 SQL。每次访问 `/api/zotero` 会继续未完成的暂存数据，直到发布完整快照。后台中断后短租约允许恢复，API 会暴露 `progress` 与 `last_error`（不含任何密钥）。如果站点无人访问，进度不会自动推进。

密钥泄露处理：若曾把 Zotero API Key 发到聊天或其他地方，先在 Zotero 官网撤销，再生成仅具读取权限的新 Key，并在 Cloudflare 的 `ZOTERO_API_KEY` Secret 中更新；不要把密钥粘贴到网页、GitHub 或任何聊天。
