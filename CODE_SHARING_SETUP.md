# 数据绘图代码分析共享：部署说明

本次新增 `/codes.html`，让访问者提交和检索科研数据绘图、分析代码。公开条目会并入首页统一检索；在搜索结果点击“查看并复制代码”可打开完整代码并复制。投稿内容按纯文本呈现，不会被本站执行。

## Cloudflare 两项必要配置

1. Cloudflare → D1 → 已绑定 `DB` 的数据库 → Console，执行仓库根目录的 [code_shares_schema.sql](./code_shares_schema.sql)。该 SQL 仅新增 `code_shares`、`code_share_attempts` 两张表，不删除文献、投稿、Zotero 缓存。
2. Cloudflare Pages 项目 → Settings → Variables and Secrets → 新增 Secret：
   - **Name**: `CODE_SHARING_APPROVAL_CODE`
   - **Value**: 你指定的代码发布暗号 **2029**
   - **Type**: Secret，不要在 GitHub、JS、HTML 中填写实际值
3. 确保 `DB` D1 绑定正常，部署 `material-notes-pages` 的最新代码。
4. 依次检查 `/codes.html`、`/api/codes` 以及首页 `/#community-discovery`。

原文献投稿密钥 `SUBMISSION_APPROVAL_CODE` 与代码库密钥相互独立。代码提交采用 **2–160 字符功能名称、10–20,000 字符代码正文、1–12 位英文字母姓名首字母、正确暗号** 的验证规则，通过后自动批准并写入 D1。后端限制相同来源每小时最多 6 次代码投稿尝试，阻止重复内容。

**安全提示：** 2029 是容易猜测的弱共享暗号。建议把它视为小范围测试密钥；正式公开使用前改用更长随机字符串，结合 Cloudflare WAF 与独立管理员审核。永远不要在提交的代码中放入 API 密钥、访问令牌、密码或隐私数据。代码正文可能无法安全运行，本站只负责存储和展示，不提供代码运行环境。

## 使用

- 首页 Zotero 版块现在只有两个并排链接：左侧直接进入 `https://www.zotero.org/groups/6671409/shaolin_library/library`，右侧跳转站内统一检索。已移除 Zotero 单独的搜索框、列表和同步提示；D1 后台 Zotero 同步代码仍保留供统一检索使用。
- 通过首页“数据绘图代码分析”导航或 `/codes.html` 打开代码库。
- 页面上方可按功能名、代码正文或提交者首字母检索。打开具体代码后点击“复制全部代码”。
- 首页统一检索的“全部来源”和“数据绘图代码”选项均可找到已批准代码。
- 已批准的代码内容可公开复制，作者仅显示自愿提交的英文首字母。

## 验收

- [ ] 已执行 `code_shares_schema.sql` 并确认表存在
- [ ] 已设置生产环境 `CODE_SHARING_APPROVAL_CODE` Secret 并重新部署
- [ ] 页面提交真实的测试代码，错误暗号不能发布、正确暗号能公开
- [ ] 首页统一检索可以搜索到该代码
- [ ] “查看并复制代码”可打开完整代码并复制文本
- [ ] 原文献投稿与 Zotero 群组链接仍正常

GitHub 提交不意味着 Cloudflare 已部署。没有 Cloudflare 控制台权限，线上运行状态需部署后核实。