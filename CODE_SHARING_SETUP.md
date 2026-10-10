# 数据绘图代码分析共享：部署说明

本次将“数据绘图代码分析”直接嵌入现有首页 Zotero 区域下方（`/#code-analysis`），让访问者在同一个页面提交、检索和复制科研绘图、分析代码。不再提供独立的 `/codes.html`。公开条目会并入首页统一检索；在搜索结果点击“查看并复制代码”可打开完整代码并复制。投稿内容按纯文本呈现，不会被本站执行。

## Cloudflare 必要配置

1. **新版已支持自动初始化 D1 代码表。** 第一次访问代码库或提交时，程序会安全地创建缺失的 `code_shares`、`code_share_attempts` 表；不会删除文献、投稿或 Zotero 记录。如果你更希望手动初始化，也可在 D1 Console 执行 [code_shares_schema.sql](./code_shares_schema.sql)，可重复运行。
2. Cloudflare Pages 项目 → Settings → Variables and Secrets → 新增 Secret：
   - **Name**: `CODE_SHARING_APPROVAL_CODE`
   - **Value**: 你指定的代码发布暗号 **2029**
   - **Type**: Secret，不要在 GitHub、JS、HTML 中填写实际值
3. 确保 `DB` D1 绑定正常，部署 `material-notes-pages` 的最新代码。
4. 依次检查首页 `/#code-analysis`、`/api/codes` 以及首页 `/#community-discovery`。

原文献投稿密钥 `SUBMISSION_APPROVAL_CODE` 与代码库密钥相互独立。代码提交采用 **2–160 字符功能名称、10–20,000 字符代码正文、1–12 位英文字母姓名首字母、正确暗号** 的验证规则，通过后自动批准并写入 D1。后端限制相同来源每小时最多 6 次代码投稿尝试，阻止重复内容。

**安全提示：** 2029 是容易猜测的弱共享暗号。建议把它视为小范围测试密钥；正式公开使用前改用更长随机字符串，结合 Cloudflare WAF 与独立管理员审核。永远不要在提交的代码中放入 API 密钥、访问令牌、密码或隐私数据。代码正文可能无法安全运行，本站只负责存储和展示，不提供代码运行环境。

## 使用

- 首页 Zotero 版块现在只有两个并排链接：左侧直接进入 `https://www.zotero.org/groups/6671409/shaolin_library/library`，右侧跳转站内统一检索。已移除 Zotero 单独的搜索框、列表和同步提示；D1 后台 Zotero 同步代码仍保留供统一检索使用。
- 通过首页“数据绘图代码分析”导航或 `/#code-analysis` 直达页面底部的代码区。
- 页面上方可按功能名、代码正文或提交者首字母检索。打开具体代码后点击“复制全部代码”。
- 首页统一检索的“全部来源”和“数据绘图代码”选项均可找到已批准代码；搜索结果链接指向首页 `/?code=代码编号#code-detail`，打开同页的完整代码详情，不再跳转独立页面。
- 已批准的代码内容可公开复制，作者仅显示自愿提交的英文首字母。

## 验收

- [ ] 访问首页代码区后确认两张代码表已自动创建（或已手动执行 `code_shares_schema.sql`）
- [ ] 已设置生产环境 `CODE_SHARING_APPROVAL_CODE` Secret 并重新部署
- [ ] 页面提交真实的测试代码，错误暗号不能发布、正确暗号能公开
- [ ] 首页统一检索可以搜索到该代码
- [ ] “查看并复制代码”可打开完整代码并复制文本
- [ ] 原文献投稿与 Zotero 群组链接仍正常

GitHub 提交不意味着 Cloudflare 已部署。没有 Cloudflare 控制台权限，线上运行状态需部署后核实。
## 代码提交提示“数据库写入失败”怎么办？

从 2026-10-10 起，接口会先检查代码表和投稿尝试限流表，缺失时使用 `CREATE TABLE IF NOT EXISTS` 自动补建，不会覆盖已有数据。旧版本只检查 `code_shares`，如果 `code_share_attempts` 缺失就会出现“代码保存失败；请检查 D1 数据库表结构”。更新 GitHub 分支后请确认 Cloudflare Pages 部署已成功、`DB` 指向正确的 D1 数据库，然后刷新页面重试。

若仍失败，在 Cloudflare D1 Console 执行：

```sql
SELECT name FROM sqlite_master WHERE type='table' AND name IN ('code_shares','code_share_attempts');
```

应返回 **两行**。再查看 Cloudflare Pages Functions 日志中 `Code share database operation failed` 对应的 D1 错误。若原表结构不完整，程序会返回明确提示，**不要运行 DROP TABLE 清除已有投稿**；可联系维护者编写非破坏性迁移。
