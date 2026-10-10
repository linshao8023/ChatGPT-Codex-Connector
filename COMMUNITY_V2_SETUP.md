# 文献投稿：题目 + 总结 + 发布暗号

最新版本访客填写四个字段：**文献题目**（6–50 词）、**简要总结**（24–200 词）、**提交者姓名首字母**（1–12 个英文字母，如王少林→wsl）、**发布暗号**。服务端验证发布暗号，符合题目与总结词数条件则写入 D1 `submissions`，`status='approved'`，公开搜索立即可查询。自动公开不代表论文内容已核实，管理员仍可在 `/admin.html` 下架。重复投稿和频率限制保留。

## Cloudflare 配置（必须完成）

**新增必要迁移：** 在当前 D1 数据库 Console 执行 [submission_initials_upgrade.sql](./submission_initials_upgrade.sql)（或尚未执行过 community_upgrade.sql 时，执行其最新版本）。它只建立投稿署名关联表，不会修改原有文献记录。若不执行，新的投稿将明确返回 503 提示，不会出现投稿保存成功但署名丢失的情况。公开列表只显示署名首字母，不显示提交者 IP。


1. 登录 Cloudflare Pages → 对应项目 → Settings → Variables and Secrets，新建 **Secret**，变量名 **`SUBMISSION_APPROVAL_CODE`**，变量值输入你指定的暗号 **2026**。
2. 确认 D1 binding 变量名 **`DB`** 指向原来的 `material-notes-submissions` 数据库。
3. 重新部署最新 GitHub `material-notes-pages` 分支（如需，在 Preview 环境分别绑定 Secret）。
4. 页面打开后填入 6 字符以上标题、24 字符以上总结与正确暗号，提交后会显示“投稿成功，已自动公开”。其他访客不需要 GitHub 账号。

> **暗号安全提醒：** `2026` 是非常弱的共享暗号，知道暗号的任何人都能发布内容。将它配置成 Cloudflare Secret 能防止它直接出现在前端源代码，但并不能阻止猜测或转发。公开运营建议换成长随机暗号、启用 WAF 限速与举报/撤稿流程。只有 Cloudflare 环境 Secret 中设置实际值后才能生效；不要把它硬编码到公开 GitHub 代码中。密钥未配置或错误会明确失败，不会自动通过。

**旧变量 `AUTO_APPROVE_ENABLED` 不再控制投稿批准**。当前服务端要求正确暗号，不会因以前设置了 `AUTO_APPROVE_ENABLED=true` 而绕过它。已存在的待审核记录和知识笔记数据保持原样，不会被批量批准。

## 原有升级说明

- 如之前尚未执行 `community_upgrade.sql`，请先在 D1 Console 执行。已有数据不会被清空。
- 管理员入口 `/admin.html` 仍使用 Cloudflare Secret `ADMIN_REVIEW_TOKEN`；可以人工下架、恢复旧投稿。
- 统一检索 `/api/search` 支持来源筛选、排序和分页；Zotero 仍为只读缓存同步。
- 回执 API 保留兼容历史记录，但新的投稿表单不再显示回执输入框。
- 这次发布只包含 GitHub 文件更新，Cloudflare 侧 Secret 设置和线上联机测试需要站长完成。

## 新词数规则和兼容数据库升级

文献题目 6–50 词，简要总结 24–200 词。中文按汉字逐字统计、英文及数字的连续序列按一词统计，标点与空格不算词。网页和 API 使用相同规则。为保留原 D1 的长度 CHECK 约束，系统会新增 `full_title` 和 `full_summary` 用来保存完整内容；旧字段保留短前缀，不清除旧投稿，检索和公开列表优先读完整字段。
