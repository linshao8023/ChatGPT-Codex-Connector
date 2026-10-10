# 数据绘图代码分析共享：部署说明

本次将“数据绘图代码分析”直接嵌入现有首页 Zotero 区域下方（`/#code-analysis`），让访问者在同一个页面提交、检索和复制科研绘图、分析代码。不再提供独立的 `/codes.html`。代码仅在下方独立代码库中搜索；已从科研社区统一检索中完全排除。公开代码以紧凑列表显示名称、分享者和时间；点击“一键复制代码”直接复制完整源码，不展示代码正文或详情面板。本站不会执行访客提交的代码。

## Cloudflare 必要配置

1. **新版已支持自动初始化 D1 代码表。** 第一次访问代码库或提交时，程序会安全地创建缺失的 `code_shares`、`code_share_attempts` 表；不会删除文献、投稿或 Zotero 记录。如果你更希望手动初始化，也可在 D1 Console 执行 [code_shares_schema.sql](./code_shares_schema.sql)，可重复运行。
2. Cloudflare Pages 项目 → Settings → Variables and Secrets → 新增 Secret：
   - **Name**: `PUBLICATION_APPROVAL_CODE`
   - **Value**: 你指定的代码发布暗号 **2029**
   - **Type**: Secret，不要在 GitHub、JS、HTML 中填写实际值
3. 确保 `DB` D1 绑定正常，部署 `material-notes-pages` 的最新代码。
4. 依次检查首页 `/#code-analysis`、`/api/codes` 以及首页 `/#community-discovery`。

文献、代码和每日简报使用同一个 `PUBLICATION_APPROVAL_CODE`，值为 `2029`；管理员审核仍使用独立的 `ADMIN_REVIEW_TOKEN`。代码提交采用 **功能名称少于 30 词（至少 2 字符）、10–200,000 字符代码正文、1–12 位英文字母姓名首字母、正确暗号** 的验证规则，通过后自动批准并写入 D1。后端限制相同来源每小时最多 6 次代码投稿尝试。相同功能名称再次提交会直接覆盖原代码、完整正文与署名；被管理员下架的标题不能通过普通发布暗号恢复。

**安全提示：** 2029 是容易猜测的弱共享暗号。建议把它视为小范围测试密钥；正式公开使用前改用更长随机字符串，结合 Cloudflare WAF 与独立管理员审核。永远不要在提交的代码中放入 API 密钥、访问令牌、密码或隐私数据。代码正文可能无法安全运行，本站只负责存储和展示，不提供代码运行环境。

## 使用

- 首页 Zotero 版块现在只有两个并排链接：左侧直接进入 `https://www.zotero.org/groups/6671409/shaolin_library/library`，右侧跳转站内统一检索。已移除 Zotero 单独的搜索框、列表和同步提示；D1 后台 Zotero 同步代码仍保留供统一检索使用。
- 通过首页“数据绘图代码分析”导航或 `/#code-analysis` 直达页面底部的代码区。
- 代码库可按功能名、代码正文或分享者首字母搜索；每行直接显示“功能名称 / 一键复制代码 / 分享者 / 时间”，无需打开详情。
- 科研社区统一检索不再包含代码；独立代码库支持搜索、排序、一键复制与“上一页 / 第 N / M 页 / 下一页 / 输入页码 / 跳转”。即使只有一页，分页控件也始终显示。
- 已批准的代码内容可公开复制，作者仅显示自愿提交的英文首字母。

## 验收

- [ ] 访问首页代码区后确认两张代码表已自动创建（或已手动执行 `code_shares_schema.sql`）
- [ ] 已设置生产环境 `PUBLICATION_APPROVAL_CODE` Secret 并重新部署
- [ ] 页面提交真实的测试代码，错误暗号不能发布、正确暗号能公开
- [ ] 首页“数据绘图代码分析”的独立检索可以搜索到代码；科研社区统一检索不再返回代码
- [ ] “一键复制代码”可不打开详情直接复制完整文本
- [ ] 原文献投稿与 Zotero 群组链接仍正常

GitHub 提交不意味着 Cloudflare 已部署。没有 Cloudflare 控制台权限，线上运行状态需部署后核实。
## 代码提交提示“数据库写入失败”怎么办？

从 2026-10-10 起，接口会先检查代码表和投稿尝试限流表，缺失时使用 `CREATE TABLE IF NOT EXISTS` 自动补建，不会覆盖已有数据。旧版本只检查 `code_shares`，如果 `code_share_attempts` 缺失就会出现“代码保存失败；请检查 D1 数据库表结构”。更新 GitHub 分支后请确认 Cloudflare Pages 部署已成功、`DB` 指向正确的 D1 数据库，然后刷新页面重试。

若仍失败，在 Cloudflare D1 Console 执行：

```sql
SELECT name FROM sqlite_master WHERE type='table' AND name IN ('code_shares','code_share_attempts');
```

应返回 **两行**。再查看 Cloudflare Pages Functions 日志中 `Code share database operation failed` 对应的 D1 错误。若原表结构不完整，程序会返回明确提示，**不要运行 DROP TABLE 清除已有投稿**；可联系维护者编写非破坏性迁移。

## 长代码兼容升级

最新代码允许 200,000 字符源码，自动为已存在的 D1 `code_shares` 增加 `full_title`、`full_code` 两列。旧 `title`、`code` 保留为兼容前缀，完整代码写入新列，读取与复制优先使用新列。此升级不删除旧数据。\n

## 相同标题覆盖

再次用同一功能名称提交代码时，通过 `publication_key` 唯一索引定位原记录，覆盖完整代码和投稿者首字母，保留原记录 ID，搜索与一键复制立即读取更新后的正文，公开列表不展示源代码。旧记录不删除，原先的下架状态仍由管理员控制。同名提交需要正确的统一发布暗号；建议不要将这个暗号公开分享给非可信用户。


## R2 样图上传与按需查看（新增）

每条科研代码最多上传 **3 张样图**，单张 **不超过 1 MiB**，仅允许 **PNG / JPG / WebP**。图片二进制文件保存在 **Cloudflare R2 私有存储桶**，原 D1 数据库仅保存图片的 R2 对象键、格式、大小与代码关联，不会把图片存到 D1。公开代码库只有在有图片时显示“查看样图（N）”；访客点击才会从同源 API 加载图片。代码一键复制仍然独立可用。

### Cloudflare 必做配置

1. 打开 **Cloudflare → R2 Object Storage → Create bucket**，新建一个私有存储桶，例如 `material-notes-code-images`。不需要开启公共访问或绑定 R2 自定义域名。
2. 进入 **Workers & Pages → Pages 项目 → Settings → Bindings → Add binding → R2 bucket**。将 **变量名填成 `CODE_IMAGES`**，选择刚创建的存储桶。生产环境需要设置该绑定；若使用 Preview 环境测试，也要确认该环境有绑定。
3. 原来的 D1 变量名 `DB`、统一发布 Secret `PUBLICATION_APPROVAL_CODE` 不变。新版 Functions 自动新建 `code_share_images` 关联表，也可手动在 D1 Console 执行仓库的 `code_shares_schema.sql`。
4. 重新部署 `material-notes-pages` 分支，刷新页面后，在“分享分析代码”表单选择 PNG/JPG/WebP 图片。正常投稿成功后，公开列表出现“查看样图”入口。

### 同标题覆盖与失败情况

- **不选择样图**：重新提交相同标题的代码，仅更新代码和署名，保留原样图。
- **选择新样图**：提交完代码后单独上传并替换旧样图；上传全部成功后才更换 D1 图片关联并删除旧 R2 文件。
- **R2 上传失败**：代码本身可能已经发布；表单会提示样图失败，可以重新以相同标题提交并重试。
- 图片以文件签名验证基础格式，不运行任何上传图片中的脚本。请在上传前清除图中的机密信息及不必要的 EXIF 元数据。

新增接口：`GET /api/code-images?code_id=123` 读取代码关联的图片清单，`GET /api/code-images?image_id=...` 按需读取已公开代码的某张样图，`POST /api/code-images` 需要统一发布暗号的 multipart 上传或替换图片操作。上传并不自动压缩图像，由投稿者自行保证大小。
