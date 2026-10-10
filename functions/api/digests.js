import {respond,database,sourceAllowed,publicationCodeConfigured,publicationCodeMatches,cleanText,lengthOf,invalidText,pageNumber} from "../_lib/community.js";

const ISSUE_LIMIT=20000;
const CREATE_TABLE="CREATE TABLE IF NOT EXISTS daily_ai_digests ("+
  "id INTEGER PRIMARY KEY AUTOINCREMENT,"+
  "issue_date TEXT NOT NULL UNIQUE,"+
  "headline TEXT NOT NULL,"+
  "body TEXT NOT NULL CHECK(length(trim(body)) BETWEEN 50 AND 2000),"+
  "full_body TEXT,"+
  "created_at TEXT NOT NULL DEFAULT (datetime('now')),"+
  "updated_at TEXT NOT NULL DEFAULT (datetime('now'))"+
")";

async function ensureTable(db){
  await db.prepare(CREATE_TABLE).run();
  const fields=await db.prepare("PRAGMA table_info(daily_ai_digests)").all();
  if(!(fields.results||[]).some(x=>x.name==="full_body")){
    try{await db.prepare("ALTER TABLE daily_ai_digests ADD COLUMN full_body TEXT").run();}
    catch(error){if(!/duplicate column name/i.test(String(error)))throw error;}
  }
}

function validDate(value){
  if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(value+"T00:00:00Z");
  return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;
}

// Show only the first five source lines (including intentionally blank lines).
// The full body remains available when a reader opens the complete issue.
function firstFiveLines(value){
  return String(value||"").replace(/\r\n?/g,"\n").split("\n").slice(0,5).join("\n");
}

function publicIssue(row){
  if(!row)return null;
  return {
    id:row.id,
    issue_date:row.issue_date,
    headline:row.headline,
    body:row.full_body||row.body,
    preview:firstFiveLines(row.full_body||row.body),
    updated_at:row.updated_at
  };
}

export async function onRequestGet({request,env}){
  const db=database(env);
  if(!db)return respond({ok:false,error:"D1 数据库未绑定变量 DB"},503);
  try{
    await ensureTable(db);
    const params=new URL(request.url).searchParams;
    const idParam=params.get("id");
    if(idParam!==null){
      const id=Number(idParam);
      if(!Number.isSafeInteger(id)||id<1)return respond({ok:false,error:"简报编号无效"},400);
      const item=await db.prepare(
        "SELECT id,issue_date,headline,body,full_body,updated_at FROM daily_ai_digests WHERE id=?"
      ).bind(id).first();
      return item?respond({ok:true,issue:publicIssue(item)}):respond({ok:false,error:"这期简报不存在"},404);
    }
    if(params.get("latest")==="1"){
      const latest=await db.prepare(
        "SELECT id,issue_date,headline,body,full_body,updated_at FROM daily_ai_digests ORDER BY issue_date DESC,id DESC LIMIT 1"
      ).first();
      return respond({ok:true,issue:publicIssue(latest)});
    }
    const page=pageNumber(params.get("page"));
    const perPage=12;
    const total=await db.prepare("SELECT count(*) AS count FROM daily_ai_digests").first();
    const list=await db.prepare(
      "SELECT id,issue_date,headline,body,full_body,created_at,updated_at FROM daily_ai_digests "+
      "ORDER BY issue_date DESC,id DESC LIMIT ? OFFSET ?"
    ).bind(perPage,(page-1)*perPage).all();
    const issues=(list.results||[]).map(row=>({id:row.id,issue_date:row.issue_date,headline:row.headline,preview:firstFiveLines(row.full_body||row.body),created_at:row.created_at,updated_at:row.updated_at}));
    return respond({ok:true,issues,total:Number(total?.count||0),page,per_page:perPage});
  }catch(error){
    console.error("Daily digest read failed",error);
    return respond({ok:false,error:"每日简报暂时无法读取，请检查 D1 绑定"},503);
  }
}

export async function onRequestPost({request,env}){
  if(!sourceAllowed(request))return respond({ok:false,error:"不允许跨站发布"},403);
  if(!publicationCodeConfigured(env))return respond({ok:false,error:"请站长先配置 PUBLICATION_APPROVAL_CODE Secret"},503);
  const db=database(env);
  if(!db)return respond({ok:false,error:"D1 数据库未绑定变量 DB"},503);
  if((request.headers.get("Content-Type")||"").split(";")[0].trim().toLowerCase()!=="application/json"){
    return respond({ok:false,error:"请使用 JSON 格式提交"},415);
  }
  if(Number(request.headers.get("Content-Length")||0)>180000)return respond({ok:false,error:"简报内容过长"},413);

  let payload;
  try{
    const raw=await request.text();
    if(raw.length>90000)return respond({ok:false,error:"简报内容过长"},413);
    payload=JSON.parse(raw);
  }catch{return respond({ok:false,error:"提交的数据不是有效 JSON"},400);}
  if(!payload||typeof payload!=="object"||Array.isArray(payload))return respond({ok:false,error:"提交格式无效"},400);
  if(!publicationCodeMatches(env,payload.approval_code))return respond({ok:false,error:"发布暗号不正确，简报未保存"},403);
  const issueDate=cleanText(payload.issue_date);
  const headline=cleanText(payload.headline);
  const body=cleanText(payload.body);
  if(!validDate(issueDate))return respond({ok:false,error:"请填写有效的推送日期"},400);
  if(lengthOf(headline)<2||lengthOf(headline)>120||invalidText(headline)){
    return respond({ok:false,error:"本期标题需 2–120 个字符"},400);
  }
  if(lengthOf(body)<50||lengthOf(body)>ISSUE_LIMIT||invalidText(body)){
    return respond({ok:false,error:"推送正文需 50–20,000 字符"},400);
  }
  try{
    await ensureTable(db);
    await db.prepare(
      "INSERT INTO daily_ai_digests(issue_date,headline,body,full_body) VALUES(?,?,?,?) "+
      "ON CONFLICT(issue_date) DO UPDATE SET headline=excluded.headline,body=excluded.body,full_body=excluded.full_body,updated_at=datetime('now')"
    ).bind(issueDate,headline,Array.from(body).slice(0,2000).join(""),body).run();
    const stored=await db.prepare(
      "SELECT id FROM daily_ai_digests WHERE issue_date=?"
    ).bind(issueDate).first();
    if(!stored)return respond({ok:false,error:"简报已处理但未能读取编号，请检查 D1"},503);
    return respond({
      ok:true,id:stored.id,issue_date:issueDate,
      message:"每日简报已发布。相同日期重新提交会更新该期内容，往期其他简报保持不变。"
    },201);
  }catch(error){
    console.error("Daily digest write failed",error);
    return respond({ok:false,error:"保存失败，请检查 Cloudflare D1 数据库及 Functions 日志"},503);
  }
}
