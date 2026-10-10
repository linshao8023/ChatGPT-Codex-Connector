import {respond,database,sourceAllowed,lengthOf,invalidText,safeSearch,pageNumber,pageSize,fingerprint,sha256} from "../_lib/community.js";

function sortExpression(sort) {
  switch(sort) {
    case "oldest": return "ORDER BY created_at ASC,id ASC";
    case "title": return "ORDER BY title COLLATE NOCASE ASC,id ASC";
    case "title_desc": return "ORDER BY title COLLATE NOCASE DESC,id DESC";
    default: return "ORDER BY created_at DESC,id DESC";
  }
}

function codeMatches(secret, submitted) {
  if (typeof secret !== "string" || !secret || typeof submitted !== "string" || submitted.length > 128) return false;
  const a = new TextEncoder().encode(secret);
  const b = new TextEncoder().encode(submitted.trim());
  let diff = a.length ^ b.length;
  for(let i=0;i<Math.max(a.length,b.length);i++) diff |= (a[i]||0)^(b[i]||0);
  return diff === 0;
}

async function hasCodeTable(db) {
  return Boolean(await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='code_shares'"
  ).first());
}

export async function onRequestGet({env,request}) {
  const db=database(env);
  if (!db) return respond({ok:false,error:"D1 数据库未绑定"},503);
  try {
    if (!await hasCodeTable(db)) return respond({
      ok:false,error:"代码库尚未初始化：请先执行 code_shares_schema.sql"
    },503);
    const url=new URL(request.url);
    const idParam=url.searchParams.get("id");
    if (idParam!==null) {
      const id=Number(idParam);
      if(!Number.isSafeInteger(id)||id<1) return respond({ok:false,error:"代码编号无效"},400);
      const item=await db.prepare(
        "SELECT id,title,code,initials,created_at FROM code_shares WHERE id=? AND status='approved'"
      ).bind(id).first();
      return item?respond({ok:true,item}):respond({ok:false,error:"代码不存在或已下架"},404);
    }
    const page=pageNumber(url.searchParams.get("page"));
    const perPage=pageSize(url.searchParams.get("per_page"),12);
    const q=safeSearch(url.searchParams.get("q"));
    const sort=["newest","oldest","title","title_desc"].includes(url.searchParams.get("sort"))
      ?url.searchParams.get("sort"):"newest";
    const where=q
      ?"status='approved' AND (instr(lower(title),lower(?))>0 OR instr(lower(code),lower(?))>0 OR instr(lower(initials),lower(?))>0)"
      :"status='approved'";
    const args=q?[q,q,q]:[];
    const count=await db.prepare("SELECT count(*) AS n FROM code_shares WHERE "+where).bind(...args).first();
    const rows=await db.prepare(
      "SELECT id,title,initials,substr(code,1,280) AS preview,created_at FROM code_shares WHERE "
      +where+" "+sortExpression(sort)+" LIMIT ? OFFSET ?"
    ).bind(...args,perPage,(page-1)*perPage).all();
    return respond({ok:true,items:rows.results||[],total:Number(count?.n||0),page,per_page:perPage,sort});
  }catch(error) {
    console.error("Code library listing failed:",error);
    return respond({ok:false,error:"代码库读取失败，请检查 D1 配置"},503);
  }
}

export async function onRequestPost({env,request}) {
  const db=database(env);
  if (!db) return respond({ok:false,error:"D1 数据库未绑定"},503);
  if (!sourceAllowed(request)) return respond({ok:false,error:"不允许跨站提交"},403);
  const contentType=(request.headers.get("Content-Type")||"").split(";")[0].trim().toLowerCase();
  if (contentType!=="application/json") return respond({ok:false,error:"请使用 JSON 格式提交"},415);
  if (Number(request.headers.get("Content-Length")||0)>100000) return respond({ok:false,error:"代码内容超过大小限制"},413);
  let body;
  try {
    const raw=await request.text();
    if(raw.length>45000) return respond({ok:false,error:"代码内容过长"},413);
    body=JSON.parse(raw);
  }catch{return respond({ok:false,error:"投稿数据格式错误"},400);}
  if (!body||typeof body!=="object"||Array.isArray(body)) return respond({ok:false,error:"投稿数据格式错误"},400);

  const title=typeof body.title==="string"?body.title.trim():"";
  const code=typeof body.code==="string"?body.code.replace(/\r\n?/g,"\n").trim():"";
  const initials=typeof body.initials==="string"?body.initials.trim().toLowerCase():"";
  if(lengthOf(title)<2||lengthOf(title)>160||invalidText(title)) {
    return respond({ok:false,error:"代码功能名称必须为 2–160 个字符"},400);
  }
  if(lengthOf(code)<10||lengthOf(code)>20000||code.includes("\u0000")) {
    return respond({ok:false,error:"详细代码必须为 10–20000 个字符"},400);
  }
  if(!/^[a-z]{1,12}$/.test(initials)) {
    return respond({ok:false,error:"姓名首字母请填写 1–12 个英文字母，如 wsl"},400);
  }

  const secret=typeof env?.CODE_SHARING_APPROVAL_CODE==="string"?env.CODE_SHARING_APPROVAL_CODE:"";
  if (!secret) return respond({ok:false,error:"站长尚未配置 CODE_SHARING_APPROVAL_CODE Secret"},503);
  try {
    if (!await hasCodeTable(db)) return respond({ok:false,error:"请先在 D1 执行 code_shares_schema.sql"},503);
    const ipHash=await fingerprint(request,env);
    const hour=Math.floor(Date.now()/3600000);
    await db.prepare(
      "INSERT INTO code_share_attempts(ip_hash,window_hour,attempts) VALUES(?,?,1) "+
      "ON CONFLICT(ip_hash,window_hour) DO UPDATE SET attempts=attempts+1"
    ).bind(ipHash,hour).run();
    const attempt=await db.prepare(
      "SELECT attempts FROM code_share_attempts WHERE ip_hash=? AND window_hour=?"
    ).bind(ipHash,hour).first();
    if (Number(attempt?.attempts||0)>6) return respond({
      ok:false,error:"尝试次数过多，请一小时后重试"
    },429);
    if(!codeMatches(secret,body.approval_code)) return respond({
      ok:false,error:"发布暗号不正确，代码未保存"
    },403);

    const duplicateHash=await sha256(title.toLocaleLowerCase("en")+"|"+code);
    const existed=await db.prepare("SELECT id FROM code_shares WHERE content_hash=?").bind(duplicateHash).first();
    if(existed) return respond({ok:false,error:"相同代码已经提交，无需重复分享"},409);
    const saved=await db.prepare(
      "INSERT INTO code_shares(title,code,initials,status,submitter_hash,content_hash) VALUES (?,?,?,'approved',?,?)"
    ).bind(title,code,initials,ipHash,duplicateHash).run();
    const id=Number(saved?.meta?.last_row_id||0);
    if (!id) throw new Error("No inserted record ID");
    return respond({ok:true,id,status:"approved",message:"代码提交成功，已公开，可在统一检索中搜索并复制。"},201);
  }catch(error){
    console.error("Code library publish failed:",error);
    return respond({ok:false,error:"代码保存失败；请检查 D1 数据库表结构"},503);
  }
}
