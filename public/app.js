(() => {
"use strict";
const byId=id=>document.getElementById(id);
function el(tag,cls,text){const node=document.createElement(tag);if(cls)node.className=cls;if(text!=null)node.textContent=String(text);return node;}
function safeLink(value){try{const url=new URL(value);return ["https:","http:"].includes(url.protocol)?url.href:"";}catch{return "";}}
function createLink(label,url){const a=el("a","paper-link",label);a.href=url;a.target="_blank";a.rel="noopener noreferrer";return a;}
  const zoteroState = { page: 1, search: "", total: 0, perPage: 20 };
  async function loadZotero() {
    const status = byId("zotero-status");
    const grid = byId("zotero-grid");
    const pagination = byId("zotero-pagination");
    if (!grid) return;
    status.textContent = "正在加载 Zotero 文献…";
    try {
      const query = new URLSearchParams({page:String(zoteroState.page)});
      if (zoteroState.search) query.set("q",zoteroState.search);
      const response = await fetch("/api/zotero?" + query, {cache:"no-store"});
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Zotero 暂不可用");
      grid.replaceChildren();
      const rows=Array.isArray(data.items)?data.items:[];
      for (const paper of rows) {
        const card=el("article","zotero-card");
        card.append(el("h3","",paper.title || "未命名文献"));
        const meta = [paper.authors,paper.publication_title,paper.item_year].filter(Boolean).join(" · ");
        if(meta) card.append(el("p","zotero-meta",meta));
        if(paper.abstract) card.append(el("p","zotero-abstract",paper.abstract));
        const tags=el("div","zotero-tags");
        (Array.isArray(paper.tags)?paper.tags:[]).slice(0,6).forEach(tag=>tags.append(el("span","zotero-tag",tag)));
        card.append(tags);
        const links=el("div","zotero-links");
        const doi=paper.doi ? "https://doi.org/"+encodeURIComponent(paper.doi).replace(/%2F/ig,"/") : "";
        const sources=[["查看论文",paper.url||doi],["Zotero 条目",paper.zotero_url]];
        sources.forEach(([label,value])=>{const href=safeLink(value);if(href)links.append(createLink(label+" ↗",href));});
        card.append(links);
        grid.append(card);
      }
      zoteroState.total=Number(data.total)||0;
      zoteroState.perPage=Number(data.per_page)||20;
      const maxPages=Math.max(1,Math.ceil(zoteroState.total/zoteroState.perPage));
      pagination.hidden=!data.ready || maxPages<=1;
      byId("zotero-page-text").textContent="第 "+zoteroState.page+" / "+maxPages+" 页";
      byId("zotero-prev").disabled=zoteroState.page<=1;
      byId("zotero-next").disabled=zoteroState.page>=maxPages;
      if(!data.ready) status.textContent=data.last_error?"Zotero 同步失败："+data.last_error+"。下一次访问将尝试续传。":"Zotero 正在首次同步"+(data.progress&&data.progress.processed?"（已处理 "+data.progress.processed+" / "+(data.progress.total||"未知")+" 条）":"")+"。请稍后刷新；同步任务将分批续传。";
      else status.textContent="已缓存 "+zoteroState.total+" 条符合条件的文献 · 每页 "+zoteroState.perPage+" 条"+(data.last_synced_at?" · 最近同步 "+new Date(data.last_synced_at).toLocaleString("zh-CN"):"")+(data.last_error?" · 上次刷新失败，当前展示旧缓存":"");
    } catch (error) {
      grid.replaceChildren();
      pagination.hidden=true;
      status.textContent="Zotero 文献暂不可用："+(error.message||"请检查网络或配置");
    }
  }
  function setupZotero() {
    if(!byId("zotero-grid")) return;
    byId("zotero-search-btn").addEventListener("click",()=>{
      zoteroState.search=byId("zotero-search").value.trim().slice(0,120);
      zoteroState.page=1;
      loadZotero();
    });
    byId("zotero-search").addEventListener("keydown",event=>{
      if(event.key==="Enter"){event.preventDefault();byId("zotero-search-btn").click();}
    });
    byId("zotero-prev").addEventListener("click",()=>{if(zoteroState.page>1){zoteroState.page--;loadZotero();}});
    byId("zotero-next").addEventListener("click",()=>{if(zoteroState.page*zoteroState.perPage<zoteroState.total){zoteroState.page++;loadZotero();}});
    loadZotero();
  }


function init(){byId("current-year").textContent=new Date().getFullYear();setupZotero();}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();