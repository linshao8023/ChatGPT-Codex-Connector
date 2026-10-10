// Daily journal-article digest. Only public metadata and abstracts are processed;
// never claim to have read the underlying copyrighted full texts.
export const chinaDate=()=>new Date(Date.now()+8*3600000).toISOString().slice(0,10);
export const isValidDate=(s)=>typeof s==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
  !Number.isNaN(Date.parse(s+"T00:00:00Z"))&&new Date(s+"T00:00:00Z").toISOString().slice(0,10)===s;

// Candidate journals with 2026 CAS zone-1 entries in third-party databases.
// Classification is NOT independently verified against an authoritative,
// licensed CAS database. Display an explicit caveat and verification link.
const JOURNALS=[
 {name:"Water Research",issn:"0043-1354",rank:"2026 中科院一区（第三方记录，待复核）",rank_url:"https://www.xueshu.com.cn/sci/40709.html"},
 {name:"Chemical Engineering Journal",issn:"1385-8947",rank:"2026 中科院一区（第三方记录，待复核）",rank_url:"https://journalcompass.com/journals/chemical-engineering-journal-13858947.html"},
 {name:"Nature Materials",issn:"1476-1122",rank:"2026 中科院一区（第三方记录，待复核）",rank_url:"https://journalcompass.com/journals/nature-materials-14761122.html"}
];

const DDL=[
 "CREATE TABLE IF NOT EXISTS daily_brief_issues (issue_date TEXT PRIMARY KEY,created_at TEXT NOT NULL DEFAULT (datetime('now')),item_count INTEGER NOT NULL DEFAULT 0 CHECK(item_count BETWEEN 0 AND 10),method TEXT NOT NULL DEFAULT 'abstract_ai')",
 "CREATE TABLE IF NOT EXISTS daily_brief_items (issue_date TEXT NOT NULL REFERENCES daily_brief_issues(issue_date) ON DELETE CASCADE,position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 10),openalex_id TEXT NOT NULL,doi TEXT NOT NULL,title TEXT NOT NULL,journal TEXT NOT NULL,authors TEXT NOT NULL,published_at TEXT NOT NULL,summary_short TEXT NOT NULL,summary_full TEXT NOT NULL,source_url TEXT NOT NULL,rank_note TEXT NOT NULL,rank_url TEXT NOT NULL,PRIMARY KEY(issue_date,position))",
 "CREATE TABLE IF NOT EXISTS daily_brief_state (id INTEGER PRIMARY KEY CHECK(id=1),lock_until INTEGER NOT NULL DEFAULT 0,last_attempt_at TEXT,last_error TEXT)",
 "CREATE TABLE IF NOT EXISTS daily_frontier_submissions (id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 4 AND 220),journal TEXT NOT NULL CHECK(length(trim(journal)) BETWEEN 2 AND 160),source_url TEXT NOT NULL CHECK(length(source_url) BETWEEN 10 AND 600),summary TEXT NOT NULL CHECK(length(trim(summary)) BETWEEN 24 AND 2000),initials TEXT NOT NULL CHECK(length(initials) BETWEEN 1 AND 12 AND initials NOT GLOB '*[^a-z]*'),status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN('pending','approved','rejected')),submitter_hash TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (datetime('now')),reviewed_at TEXT)"
];
export async function ensureDailyTables(db){
 for(const stmt of DDL)await db.prepare(stmt).run();
 await db.prepare("INSERT OR IGNORE INTO daily_brief_state(id) VALUES(1)").run();
}
export async function dailyStatus(db){
 return await db.prepare("SELECT lock_until,last_attempt_at,last_error FROM daily_brief_state WHERE id=1").first();
}
export async function acquireDailyLock(db,date,{force=false}={}){
 const now=Date.now(),seconds=Math.floor(now/1000);
 // Repeated public requests must not spend the AI budget or duplicate publishes.
 if(await db.prepare("SELECT issue_date FROM daily_brief_issues WHERE issue_date=?").bind(date).first())return false;
 const result=await db.prepare(
  "UPDATE daily_brief_state SET lock_until=?,last_attempt_at=?,last_error=NULL "+
  "WHERE id=1 AND lock_until<=? AND (?=1 OR last_attempt_at IS NULL OR last_attempt_at<?)"
 ).bind(seconds+120,new Date(now).toISOString(),seconds,force?1:0,
   new Date(now-5*60*1000).toISOString()).run();
 return Number(result?.meta?.changes||0)===1;
}
function makeError(error){
 const message=String(error?.message||error||"同步失败");
 // Do not expose tokens, queries, sensitive env values or upstream stack traces.
 return message.replace(/(?:sk-|Bearer\s+)[A-Za-z0-9_\-]{12,}/g,"[redacted]").slice(0,280);
}
async function getPage(issn){
 const url=new URL("https://api.openalex.org/works");
 const earliest=new Date(Date.now()-1000*60*60*24*120).toISOString().slice(0,10);
 url.searchParams.set("filter","type:article,has_abstract:true,from_publication_date:"+earliest+
 ",primary_location.source.issn:"+issn);
 url.searchParams.set("sort","publication_date:desc");
 url.searchParams.set("per_page","45");
 url.searchParams.set("select","id,doi,title,publication_date,primary_location,authorships,abstract_inverted_index");
 const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),11000);
 try{
  const response=await fetch(url.href,{headers:{"Accept":"application/json"},signal:ctl.signal});
  if(!response.ok)throw Error("OpenAlex 返回 HTTP "+response.status);
  const data=await response.json();
  if(!Array.isArray(data.results))throw Error("OpenAlex 响应不正确");
  return data.results;
 }finally{clearTimeout(timer);}
}
function abstractText(index){
 if(!index||typeof index!=="object"||Array.isArray(index))return "";
 const terms=[];
 for(const [word,positions] of Object.entries(index)){
  if(!Array.isArray(positions))continue;
  for(const n of positions.slice(0,20)){
   if(Number.isInteger(n)&&n>=0&&n<5000)terms.push([n,word]);
  }
 }
 terms.sort((a,b)=>a[0]-b[0]);
 return terms.slice(0,360).map(x=>x[1]).join(" ").slice(0,2500);
}
function normalizeWork(w,journal){
 const source=w?.primary_location?.source;
 const issns=Array.isArray(source?.issn)?source.issn:[];
 if(!issns.includes(journal.issn))return null;
 const title=typeof w.title==="string"?w.title.trim().slice(0,500):"";
 const abstract=abstractText(w.abstract_inverted_index);
 const doi=typeof w.doi==="string"&&/^https:\/\/doi\.org\/10\./i.test(w.doi)?w.doi:"";
 if(!title||abstract.length<80||!doi)return null;
 const authors=Array.isArray(w.authorships)?w.authorships.slice(0,4)
   .map(x=>x.author?.display_name).filter(Boolean).join("; ").slice(0,450):"";
 return {
  id:String(w.id||"").slice(0,120),doi,title,abstract,
  journal:journal.name,rank:journal.rank,rank_url:journal.rank_url,
  authors,published_at:String(w.publication_date||"").slice(0,10),url:doi
 };
}
function parseAI(value){
 const raw=typeof value==="string"?value:
   typeof value?.response==="string"?value.response:
   value?.choices?.[0]?.message?.content||"";
 const first=raw.indexOf("["),last=raw.lastIndexOf("]");
 if(first<0||last<=first)throw Error("AI 没有返回结构化摘要");
 const parsed=JSON.parse(raw.slice(first,last+1));
 if(!Array.isArray(parsed)||parsed.length!==10)throw Error("AI 摘要数量不符合十篇要求");
 const table=new Map();
 for(const item of parsed){
  const n=Number(item?.index);
  if(!Number.isInteger(n)||n<1||n>10||table.has(n))throw Error("AI 返回了重复序号");
  const short=typeof item.brief==="string"?item.brief.trim().slice(0,260):"";
  const full=typeof item.detail==="string"?item.detail.trim().slice(0,1150):"";
  if(short.length<12||full.length<40)throw Error("AI 摘要缺失");
  table.set(n,{short,full});
 }
 if(table.size!==10)throw Error("AI 摘要不完整");
 return table;
}
async function aiSummaries(env,works){
 if(!env?.AI||typeof env.AI.run!=="function")throw Error("请先在 Cloudflare Pages 绑定 Workers AI，变量名 AI");
 const items=works.map((w,i)=>({index:i+1,title:w.title,journal:w.journal,abstract:w.abstract.slice(0,1600)}));
 const messages=[
  {role:"system",content:"你是科研文献摘要编辑。只能依据用户提供的真实论文题目和摘要写中文说明，不得声称阅读了全文，不得编造数据、结论、作者、期刊分区。返回严格JSON数组，每项包含index（1-10整数）、brief（30-90字短简报）、detail（100-260字完整解读，包含研究问题、方法、发现与局限性；原摘要信息不足就直说）。禁止Markdown、反引号、额外解释。"},
  {role:"user",content:JSON.stringify(items)}
 ];
 const output=await env.AI.run("@cf/meta/llama-3.1-8b-instruct",{
  messages,max_tokens:4000,temperature:0.2
 });
 return parseAI(output);
}
export async function generateDaily(db,env,date){
 try{
  const pages=await Promise.all(JOURNALS.map(j=>getPage(j.issn)));
  const candidates=[],seen=new Set();
  for(let i=0;i<JOURNALS.length;i++){
   for(const work of pages[i]){
    const item=normalizeWork(work,JOURNALS[i]);
    if(!item||seen.has(item.doi.toLowerCase()))continue;
    seen.add(item.doi.toLowerCase());
    candidates.push(item);
   }
  }
  if(candidates.length<10)throw Error("近120天可核对来源的期刊摘要不足10篇，未发布不完整日报");
  // Favor research relevance and recency; avoid over-representation.
  const relevant=/cellulos|lignin|microplastic|wastewater|PFAS|pollutan|adsorp|membran|biochar|hydrogel|nanocellulos|water treat/i;
  candidates.sort((a,b)=>Number(relevant.test(b.title+" "+b.abstract))-Number(relevant.test(a.title+" "+a.abstract))||
   b.published_at.localeCompare(a.published_at));
  const selected=[],quotas=new Map();
  for(const work of candidates){
   const count=quotas.get(work.journal)||0;
   if(count>=5)continue;
   selected.push(work);quotas.set(work.journal,count+1);
   if(selected.length===10)break;
  }
  if(selected.length!==10)throw Error("可用合格期刊论文不足10篇，未生成今日简报");
  const ai=await aiSummaries(env,selected);
  if(await db.prepare("SELECT issue_date FROM daily_brief_issues WHERE issue_date=?").bind(date).first()){
   await db.prepare("UPDATE daily_brief_state SET lock_until=0,last_error=NULL WHERE id=1").run();
   return {ok:true,skipped:true};
  }
  const inserts=[
   db.prepare("INSERT INTO daily_brief_issues(issue_date,item_count,method) VALUES(?,10,'abstract_ai')").bind(date)
  ];
  for(let i=0;i<10;i++){
   const w=selected[i],note=ai.get(i+1);
   inserts.push(db.prepare("INSERT INTO daily_brief_items(issue_date,position,openalex_id,doi,title,journal,authors,published_at,summary_short,summary_full,source_url,rank_note,rank_url) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(date,i+1,w.id,w.doi,w.title,w.journal,w.authors,w.published_at,note.short,note.full,w.url,w.rank,w.rank_url));
  }
  inserts.push(db.prepare("UPDATE daily_brief_state SET lock_until=0,last_error=NULL WHERE id=1"));
  await db.batch(inserts);
  return {ok:true,count:10};
 }catch(error){
  console.error("Daily AI digest generation failed:",error);
  const diagnostic=makeError(error);
  try{await db.prepare("UPDATE daily_brief_state SET lock_until=0,last_error=? WHERE id=1").bind(diagnostic).run();}
  catch(e){console.error("Daily digest error status failed:",e);}
  return {ok:false,error:diagnostic};
 }
}
