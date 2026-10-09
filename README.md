# Material Notes：生物基环境材料文献库

一套适合 **GitHub 托管源码 + Cloudflare Pages 发布** 的纯静态文献分享网站模板。中文响应式界面，原生 HTML/CSS/JavaScript，无 npm、数据库、外部字体、第三方 JavaScript CDN 或后端。面向大陆访问时，可最大限度减少第三方域名造成的资源加载问题，但**不能保证 Cloudflare 海外网络在中国大陆各运营商下均稳定**。

## 一分钟了解

- 标题、摘要、作者、期刊、年份、DOI、材料类型、污染物、关键词均可搜索。
- 材料类别筛选、污染物筛选、年份排序、开放获取筛选。
- 论文原文链接、合法 PDF 链接、复制引用信息。
- 公开网站不需要用户登录，文献全部来自 `public/data/papers.json`。
- `_headers` 带基础安全响应头；自带 `404.html`、`robots.txt`、`favicon.svg`。
- **项目中 8 条记录均为演示条目，并非真实发表论文；请上线前替换。**

## 目录结构

```text
literature-library-pages/
├── README.md
├── public/
│   ├── index.html          # 主页布局和静态内容
│   ├── styles.css          # 视觉样式（适配桌面与手机）
│   ├── app.js              # 本地文献搜索、筛选、展示
│   ├── data/
│   │   └── papers.json     # ★ 以后新增或修改文献主要编辑此文件
│   ├── _headers            # Cloudflare Pages 响应头
│   ├── 404.html
│   ├── favicon.svg
│   └── robots.txt
```

## ① 创建 GitHub 仓库

1. 在 GitHub 新建仓库，例如 `material-notes`；Public 或 Private 均可。
2. 解压压缩包，把项目根目录下的 `README.md` 和整个 `public/` 文件夹上传到仓库**根目录**。
3. 确认 GitHub 仓库里可以看到 `public/index.html` 与 `public/data/papers.json`。
4. 主分支使用 `main`。

注意：**GitHub 在这里只存放源码**。无需打开 GitHub Pages 设置，不需要 GitHub Actions，不需要 GitHub Pages 的 `CNAME` 文件。

## ② 创建 Cloudflare Pages 项目

1. 登录 https://dash.cloudflare.com/
2. 打开 **Workers & Pages** → **Create application** → **Pages** → **Import an existing Git repository**（界面名称可能略有调整）。
3. 授权 GitHub，选择刚才的仓库。
4. 项目设置如下：

| 设置 | 值 |
| --- | --- |
| Project name | `material-notes`（可自定，不一定可用） |
| Production branch | `main` |
| Framework preset | `None` / 无框架 |
| Build command | **留空** |
| Build output directory | `public` |
| Root directory | 留空，使用仓库根目录 |
| Environment variables | 不需要 |

5. 点击 **Save and Deploy**（或同等按钮）。
6. 成功后会得到 `https://<你的项目名>.pages.dev`。

以后修改 `main` 分支，Pages 将自动重新发布，无需手动上传网站。

## ③ 绑定自定义域名（面向国内用户尤其建议）

示例域名：`papers.example.com`，请替换为你实际拥有的域名。

1. 在 Pages 项目中找到 **Custom domains** → **Set up a domain**。
2. 输入 `papers.example.com` 并完成验证。
3. 如果整个 `example.com` 域名的 DNS 已交由 Cloudflare 管理，通常由控制台自动创建对应 DNS 记录；如果 DNS 在外部服务商，按照 Pages 引导添加：

| Type | Name | Target |
| --- | --- | --- |
| `CNAME` | `papers` | `<你的项目名>.pages.dev` |

**务必先在 Pages 的 Custom domains 中添加域名，不能只做 CNAME，否则可能报 522。**

网站根域名（`example.com`）与子域名设置不一样：将根域名接入 Pages，根域名必须成为同一 Cloudflare 账号下的 DNS Zone，按提示更换域名 Nameservers。纯静态站点一般优先使用子域名。

建议：在网站验证成功后再分享正式域名。Pages 自动配置 HTTPS 证书，通常无需额外购买证书。

## ④ 添加真实文献

打开 `public/data/papers.json`。一个文献对象示例如下（此处仅解释字段，并非真实文献）：

```json
{
  "id": "my-paper-001",
  "title": "请填写真实论文标题",
  "authors": "作者甲; 作者乙",
  "year": 2025,
  "journal": "请填写期刊名称",
  "category": "纤维素",
  "pollutants": ["抗生素"],
  "keywords": ["水凝胶", "吸附", "动力学"],
  "abstract": "此处写你自己整理的研究笔记或合法可引用的简短摘要。",
  "doi": "10.XXXX/replace-with-actual-doi",
  "url": "https://example.org/replace-with-actual-article-url",
  "pdf": "",
  "open_access": false
}
```

- `id` 必须唯一。
- `category` 建议保持统一写法，例如 `纤维素`、`半纤维素`、`木质素`、`复合材料`。
- `pollutants` 为数组，建议用 `抗生素`、`PFAS`、`微纳塑料`、`染料`、`药物`、`农药` 等标准化标签。
- `doi` 填真实 DOI（不带 `https://doi.org/`）。若没有就填空字符串 `""`；程序会自动构造 DOI 跳转。
- `url` 填期刊官网、DOI 着陆页或合法开放获取仓储页面。`pdf` 只有在拥有分享授权时才填写 HTTPS 全文地址。
- `open_access` 必须如实设为 `true` 或 `false`。
- 将演示条目的 `"status": "demo"` 删除。全部删除后，网站底部的演示警示会自动隐藏。

不要将出版社付费 PDF、校园网数据库批量下载全文直接公开到 GitHub 或 Cloudflare。

## ⑤ 中国大陆访问优化与备案

此方案以 Cloudflare 全球网络（非中国大陆 China Network）为基础：

1. **优先使用自定义域名。** `*.pages.dev` 可用于测试，但不建议作为面向国内读者的唯一正式入口；大陆网络可达性可能因地区、运营商或时间不同而变化。
2. **所有 CSS、JS、图标本地化。** 此模板已做到；请不要额外加入 Google Fonts、Google APIs、`raw.githubusercontent.com`、`cdn.jsdelivr.net` 等中国大陆可能访问缓慢或异常的运行时依赖。
3. **网站核心内容本地化。** 文献标题、摘要、标签存放在项目 JSON，而不是浏览网页时调用 Crossref、Semantic Scholar、GitHub API 等外部接口。
4. **HTTPS。** 使用 Pages 内建证书，不需要关闭 HTTPS 或人为降低安全级别。
5. **缓存。** 保持 Pages 默认缓存即可；不要起步就为整个站点设置 Cache Everything 或过长缓存 TTL，以免更新后旧页面不刷新。
6. **实测网络。** 请找中国移动、中国联通、中国电信等网络和不同省份进行打开首页、JSON 加载、全文跳转测试。DNS 解析正常不代表 HTTP 请求可用。
7. **ICP 备案。** 当前方案并不在中国大陆服务器/CDN 节点上部署，通常不会因使用海外托管本身而要求先进行大陆接入备案；如果将来接入中国大陆服务器或境内 CDN，需要根据实际服务和主体申请相应备案/许可。即使站点在境外，向大陆公众提供服务仍需遵守适用的法律法规。
8. **Cloudflare China Network。** 不是 Pages 免费加速开关。中国网络服务需要 Cloudflare Enterprise + 单独 China Network 服务 + ICP 备案/许可及审核；而且需要核实计划使用的产品是否在境内节点受支持。

### PDF 的技术限制

Cloudflare Pages **单个静态文件最大 25 MiB**。体积超过 25 MiB 的合法分享文件可以用 Cloudflare R2 或其他你有权限使用的对象存储，但这并不自动改善中国大陆访问速度。很多文献建议只放 DOI/合法 OA 仓储链接，而非镜像全文。

## ⑥ 本地预览

在项目根目录打开终端：

```bash
python3 -m http.server 8000 -d public
```

浏览器访问 `http://localhost:8000`。**不要双击打开 `index.html`（`file://`），否则浏览器可能阻止读取 JSON 数据。**

## ⑦ 后续个性化

- 站点名称、主标题、简介：编辑 `public/index.html`。
- 视觉配色、卡片样式：编辑 `public/styles.css`。
- 文献内容：编辑 `public/data/papers.json`。
- 正式域名确定后，可添加包含真实域名的 `sitemap.xml`，再到百度/必应站长平台提交。
- 若要读者在线投稿、账号登录、评论、云端后台管理，需要后端或第三方服务；该模板目前不包含。

## 官方资料

- Cloudflare Pages GitHub 集成：https://developers.cloudflare.com/pages/configuration/git-integration/
- Cloudflare Pages 构建配置：https://developers.cloudflare.com/pages/configuration/build-configuration/
- Pages 自定义域名：https://developers.cloudflare.com/pages/configuration/custom-domains/
- Pages 静态资源限制：https://developers.cloudflare.com/pages/platform/limits/
- Cloudflare China Network：https://developers.cloudflare.com/china-network/
- Cloudflare China Network ICP：https://developers.cloudflare.com/china-network/concepts/icp/