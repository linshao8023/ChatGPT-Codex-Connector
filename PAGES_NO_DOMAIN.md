# Cloudflare Pages 无域名部署

源代码位置：https://github.com/linshao8023/ChatGPT-Codex-Connector/tree/material-notes-pages

1. 登录 https://dash.cloudflare.com/ ，进入 Workers & Pages > Create application > Pages > Import an existing Git repository。
2. 授权 Cloudflare Pages 的 GitHub Git 集成，并选择公开仓库 linshao8023/ChatGPT-Codex-Connector。
3. 项目名称建议 material-notes-linshao（若已被占用可改名）；**Production branch** 选择 material-notes-pages，不要选择 main。
4. Framework preset: None；Build command: exit 0（如 UI 允许也可以留空）；Build output directory: public；Root directory: 仓库根目录（不填）。
5. 点击 Save and Deploy / Deploy，Cloudflare 生成类似 https://material-notes-linshao.pages.dev 的地址；实际上线地址以 Cloudflare 控制台为准。
6. 不需要自定义域名，不需要 DNS CNAME，HTTPS 由 Cloudflare 自动管理。

注意：没有自定义域名时，*.pages.dev 在中国大陆的可访问性无法保证，也不能通过普通免费配置启用中国大陆 Cloudflare China Network。如果主要读者在境内，建议部署后分别测试电信、联通、移动网络；必要时再考虑自定义域名或合规境内镜像。

文献数据文件：public/data/papers.json。当前全部为标注 DEMO 的示例记录，并非真实发表论文。请添加 DOI、合法开放获取论文链接；不要未经许可上传受版权保护的 PDF。

所有静态资源均为本地资源，不需要 Node/npm，也不依赖国外公共字体或 JS CDN。
