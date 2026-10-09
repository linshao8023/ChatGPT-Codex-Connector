(() => {
  "use strict";

  const byId = (id) => document.getElementById(id);
  const state = {
    papers: [],
    category: "全部",
    pollutant: "全部",
    sort: "newest",
    query: "",
    onlyOA: false
  };

  function el(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = String(value);
    return node;
  }

  function safeLink(value) {
    if (typeof value !== "string" || !value.trim()) return "";
    try {
      const parsed = new URL(value, window.location.href);
      return ["https:", "http:"].includes(parsed.protocol) ? parsed.href : "";
    } catch {
      return "";
    }
  }

  function normalize(value) {
    return String(value ?? "").normalize("NFKC").toLocaleLowerCase("zh-CN").trim();
  }

  function isPaper(p) {
    return p && typeof p === "object" && typeof p.title === "string"
      && p.title.trim().length > 0 && typeof p.category === "string";
  }

  function clearFilters() {
    state.category = "全部";
    state.pollutant = "全部";
    state.sort = "newest";
    state.query = "";
    state.onlyOA = false;
    byId("paper-search").value = "";
    byId("pollutant-select").value = "全部";
    byId("sort-select").value = "newest";
    byId("open-access-only").checked = false;
    buildCategoryChips();
    render();
  }

  function listOptions(items, element, allLabel) {
    element.replaceChildren();
    const all = document.createElement("option");
    all.value = "全部";
    all.textContent = allLabel;
    element.append(all);
    items.forEach((item) => {
      const option = document.createElement("option");
      option.value = item;
      option.textContent = item;
      element.append(option);
    });
  }

  function buildCategoryChips() {
    const categories = [...new Set(state.papers.map((p) => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
    const container = byId("category-filters");
    container.replaceChildren();
    ["全部", ...categories].forEach((category) => {
      const button = el("button", "filter-chip", category === "全部" ? "全部文献" : category);
      button.type = "button";
      button.setAttribute("aria-pressed", String(state.category === category));
      button.addEventListener("click", () => {
        state.category = category;
        buildCategoryChips();
        render();
      });
      container.append(button);
    });
  }

  function matches(p) {
    if (state.category !== "全部" && p.category !== state.category) return false;
    if (state.pollutant !== "全部" && !(p.pollutants || []).includes(state.pollutant)) return false;
    if (state.onlyOA && !p.open_access) return false;
    if (!state.query) return true;

    const bag = [
      p.title, p.authors, p.year, p.journal, p.abstract, p.doi, p.category,
      ...(Array.isArray(p.keywords) ? p.keywords : []),
      ...(Array.isArray(p.pollutants) ? p.pollutants : [])
    ].map(normalize).join(" ");
    return bag.includes(state.query);
  }

  function sortedPapers() {
    const papers = state.papers.filter(matches);
    papers.sort((a, b) => {
      if (state.sort === "oldest") return (Number(a.year) || 0) - (Number(b.year) || 0);
      if (state.sort === "title") return String(a.title).localeCompare(String(b.title), "zh-CN");
      return (Number(b.year) || 0) - (Number(a.year) || 0);
    });
    return papers;
  }

  function getCitation(p) {
    const doiText = p.doi ? ` DOI: ${p.doi}.` : "";
    return `${p.authors || "作者待填"} (${p.year || "年份待填"}). ${p.title}. ${p.journal || "期刊待填"}.${doiText}`;
  }

  function createLink(label, url, extraClass) {
    const a = el("a", `paper-link ${extraClass || ""}`, label);
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    return a;
  }

  function paperCard(p) {
    const card = el("article", "paper-card");
    const head = el("div", "paper-card-head");
    head.append(el("span", "paper-category", p.category));
    const meta = el("div", "paper-card-right");
    if (p.status === "demo") meta.append(el("span", "demo-tag", "DEMO"));
    meta.append(el("span", "paper-year", p.year || "—"));
    head.append(meta);
    card.append(head);

    card.append(el("h3", "", p.title));
    card.append(el("p", "paper-authors", p.authors || "作者信息待填写"));
    card.append(el("p", "paper-journal", p.journal || "期刊信息待填写"));
    card.append(el("p", "paper-summary", p.abstract || "暂无研究摘要。"));

    const tagArea = el("div", "paper-tags");
    const tags = [...(Array.isArray(p.pollutants) ? p.pollutants : []), ...(Array.isArray(p.keywords) ? p.keywords : [])].slice(0, 5);
    tags.forEach((tag) => tagArea.append(el("span", "paper-tag", tag)));
    card.append(tagArea);

    const footer = el("div", "paper-card-footer");
    const links = el("div", "paper-links");
    const doiUrl = p.doi ? safeLink(`https://doi.org/${encodeURIComponent(p.doi.trim()).replace(/%2F/ig, "/")}`) : "";
    const sourceUrl = safeLink(p.url) || doiUrl;
    const pdfUrl = safeLink(p.pdf);
    if (sourceUrl) links.append(createLink("查看原文 ↗", sourceUrl));
    if (pdfUrl) links.append(createLink("合法全文 PDF ↗", pdfUrl, "is-pdf"));
    if (!sourceUrl && !pdfUrl) links.append(el("span", "paper-link-muted", "文献链接待完善"));
    if (p.open_access) links.append(el("span", "oa-label", "OPEN ACCESS"));
    footer.append(links);

    const copy = el("button", "cite-button", "复制引用 ↗");
    copy.type = "button";
    copy.setAttribute("aria-label", `复制“${p.title}”的引用信息`);
    copy.addEventListener("click", async () => {
      if (!navigator.clipboard || !navigator.clipboard.writeText) {
        copy.textContent = "当前浏览器不支持复制";
        return;
      }
      try {
        await navigator.clipboard.writeText(getCitation(p));
        copy.textContent = "已复制 ✓";
        window.setTimeout(() => { copy.textContent = "复制引用 ↗"; }, 2000);
      } catch {
        copy.textContent = "复制失败，请使用 HTTPS";
      }
    });
    footer.append(copy);
    card.append(footer);
    return card;
  }

  function render() {
    const matchesList = sortedPapers();
    const grid = byId("paper-grid");
    grid.replaceChildren(...matchesList.map(paperCard));
    byId("empty-state").hidden = matchesList.length !== 0;
    byId("result-message").replaceChildren(
      document.createTextNode("找到 "),
      el("strong", "", matchesList.length),
      document.createTextNode(` 篇文献 · 共收录 ${state.papers.length} 篇`)
    );
    const demoCount = state.papers.filter((p) => p.status === "demo").length;
    byId("demo-note").hidden = demoCount === 0;
  }


  function submissionMessage(message, isError = false) {
    const area = byId("submission-feedback");
    area.textContent = message;
    area.classList.toggle("is-error", isError);
  }

  async function loadCommunity() {
    const list = byId("community-list");
    const status = byId("community-status");
    try {
      const response = await fetch("/api/submissions", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "服务暂不可用");
      list.replaceChildren();
      const items = Array.isArray(data.submissions) ? data.submissions : [];
      for (const item of items) {
        const article = el("article", "community-item");
        article.append(el("h4", "", item.title));
        article.append(el("p", "", item.summary));
        article.append(el("time", "", item.created_at ? "提交时间：" + item.created_at + " UTC" : "已审核分享"));
        list.append(article);
      }
      status.textContent = items.length ? `已公开 ${items.length} 条审核通过的读者分享。` : "尚无公开分享，欢迎提交第一条文献。";
    } catch (error) {
      list.replaceChildren();
      status.textContent = "在线投稿暂未启用或数据库不可用，站长需完成 Cloudflare D1 配置。";
      console.warn("投稿接口不可用", error);
    }
  }

  function setupSubmission() {
    const form = byId("submission-form");
    if (!form) return;
    const button = byId("submission-button");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const title = byId("submission-title").value.trim();
      const summary = byId("submission-summary").value.trim();
      if (Array.from(title).length < 2 || Array.from(title).length > 200
          || Array.from(summary).length < 10 || Array.from(summary).length > 1200) {
        submissionMessage("请输入 2–200 字的文献名称和 10–1200 字的简要总结。", true);
        return;
      }
      button.disabled = true;
      button.textContent = "正在提交…";
      submissionMessage("");
      try {
        const response = await fetch("/api/submissions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({title, summary, website: byId("submission-website").value})
        });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "提交失败，请稍后重试。");
        submissionMessage(result.message || "已收到分享，等待审核。");
        form.reset();
      } catch (error) {
        submissionMessage(error.message || "提交失败，请检查网络后再试。", true);
      } finally {
        button.disabled = false;
        button.textContent = "提交文献分享 ↗";
      }
    });
    loadCommunity();
  }

  async function init() {
    setupSubmission();
    byId("current-year").textContent = new Date().getFullYear();

    byId("paper-search").addEventListener("input", (event) => {
      state.query = normalize(event.target.value);
      render();
    });
    byId("pollutant-select").addEventListener("change", (event) => {
      state.pollutant = event.target.value;
      render();
    });
    byId("sort-select").addEventListener("change", (event) => {
      state.sort = event.target.value;
      render();
    });
    byId("open-access-only").addEventListener("change", (event) => {
      state.onlyOA = event.target.checked;
      render();
    });
    byId("reset-filters").addEventListener("click", clearFilters);
    byId("empty-reset").addEventListener("click", clearFilters);

    try {
      const result = await fetch("/data/papers.json", { cache: "no-cache" });
      if (!result.ok) throw new Error(`HTTP ${result.status}`);
      const rows = await result.json();
      if (!Array.isArray(rows)) throw new TypeError("papers.json 顶层必须为数组");
      state.papers = rows.filter(isPaper);
      const categories = new Set(state.papers.map((p) => p.category));
      const pollutants = [...new Set(state.papers.flatMap((p) => Array.isArray(p.pollutants) ? p.pollutants : []))].sort((a, b) => a.localeCompare(b, "zh-CN"));
      byId("stat-total").textContent = state.papers.length;
      byId("stat-categories").textContent = categories.size;
      byId("stat-open").textContent = state.papers.filter((p) => p.open_access).length;
      listOptions(pollutants, byId("pollutant-select"), "全部污染物");
      buildCategoryChips();
      render();
    } catch (error) {
      console.error("加载文献数据失败:", error);
      byId("result-message").textContent = "文献目录加载失败，请检查 /data/papers.json 是否存在且 JSON 格式正确。";
      byId("empty-state").hidden = true;
      byId("stat-total").textContent = "!";
      byId("stat-categories").textContent = "!";
      byId("stat-open").textContent = "!";
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();