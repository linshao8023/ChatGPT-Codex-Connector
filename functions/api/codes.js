import {respond,database,sourceAllowed,lengthOf,wordCount,invalidText,safeSearch,pageNumber,pageSize,fingerprint,sha256,normalizePublicationTitle,publicationCodeConfigured,publicationCodeMatches} from "../_lib/community.js";

function sortExpression(sort) {
  switch(sort) {
    case "oldest": return "ORDER BY created_at ASC,id ASC";
    case "title": return "ORDER BY title COLLATE NOCASE ASC,id ASC";
    case "title_desc": return "ORDER BY title COLLATE NOCASE DESC,id DESC";
    default: return "ORDER BY created_at DESC,id DESC";
  }
}

// Non-destructive, idempotent D1 bootstrap. Previously only code_shares was
// checked, so a missing code_share_attempts table produced a generic 503.
const TABLE_SHARES = "CREATE TABLE IF NOT EXISTS code_shares (" +
  "id INTEGER PRIMARY KEY AUTOINCREMENT," +
  "title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 2 AND 160)," +
  "code TEXT NOT NULL CHECK(length(trim(code)) BETWEEN 10 AND 20000)," +
  "full_title TEXT,full_code TEXT,publication_key TEXT," +
  "initials TEXT NOT NULL CHECK(length(initials) BETWEEN 1 AND 12 AND initials NOT GLOB '*[^a-z]*')," +
  "status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('pending','approved','rejected'))," +
  "submitter_hash TEXT NOT NULL,content_hash TEXT NOT NULL UNIQUE," +
  "created_at TEXT NOT NULL DEFAULT (datetime('now')),reviewed_at TEXT)";
const TABLE_ATTEMPTS = "CREATE TABLE IF NOT EXISTS code_share_attempts (" +
  "ip_hash TEXT NOT NULL,window_hour INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0," +
  "PRIMARY KEY(ip_hash,window_hour))";

const shareIndexes = [
  "CREATE INDEX IF NOT EXISTS idx_code_shares_status_created ON code_shares(status,created_at DESC,id DESC)",
  "CREATE INDEX IF NOT EXISTS idx_code_shares_author ON code_shares(initials)",
  "CREATE INDEX IF NOT EXISTS idx_code_shares_rate ON code_shares(submitter_hash,created_at)"
];

function schemaError() {
  const error = new Error("已存在的代码库表结构不完整");
  error.code = "CODE_SCHEMA_MISMATCH";
  return error;
}

async function ensureCodeTables(db) {
  const present=await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('code_shares','code_share_attempts')"
  ).all();
  const names=new Set((present.results||[]).map(row=>row.name));
  const newShares=!names.has("code_shares");
  const newAttempts=!names.has("code_share_attempts");
  if(newShares) await db.prepare(TABLE_SHARES).run();
  if(newAttempts) await db.prepare(TABLE_ATTEMPTS).run();

  // Validate existing schema instead of overwriting or deleting user data.
  const [shares,attempts]=await Promise.all([
    db.prepare("PRAGMA table_info(code_shares)").all(),
    db.prepare("PRAGMA table_info(code_share_attempts)").all()
  ]);
  const sharesFields=new Set((shares.results||[]).map(row=>row.name));
  const attemptFields=new Set((attempts.results||[]).map(row=>row.name));
  const neededShares=["id","title","code","initials","status","submitter_hash","content_hash","created_at","reviewed_at"];
  const neededAttempts=["ip_hash","window_hour","attempts"];
  if(neededShares.some(name=>!sharesFields.has(name))||
    neededAttempts.some(name=>!attemptFields.has(name))) throw schemaError();

  for(const field of ["full_title","full_code","publication_key"]){
    if(!sharesFields.has(field)){
      try{await db.prepare("ALTER TABLE code_shares ADD COLUMN "+field+" TEXT").run();}
      catch(error){if(!/duplicate column name/i.test(String(error)))throw error;}
    }
  }
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_code_shares_publication_key ON code_shares(publication_key)").run();
  if(newShares){
    for(const sql of shareIndexes) await db.prepare(sql).run();
  }
  if(newAttempts) {
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_code_attempts_hour ON code_share_attempts(window_hour)").run();
  }
}

function databaseFailure(error, action) {
  const message=String(error?.message||error||"");
  if(error?.code==="CODE_SCHEMA_MISMATCH"||/no such (table|column)/i.test(message)) {
    return respond({ok:false,error:"代码数据库表结构不完整。请站长核对 code_shares_schema.sql；现有数据不会被自动删除。"},503);
  }
  if(/UNIQUE constraint failed.*code_shares.publication_key/i.test(message)){
    return respond({ok:false,error:"此代码标题刚被其他投稿更新，请刷新后重试"},409);
  }
  if(/(?:UNIQUE constraint failed.*code_shares.content_hash|SQLITE_CONSTRAINT_UNIQUE.*code_shares)/i.test(message)){
    return respond({ok:false,error:"相同代码已经提交，无需重复发布"},409);
  }
  if(/(?:CHECK constraint failed|SQLITE_CONSTRAINT_CHECK)/i.test(message)) {
    return respond({ok:false,error:"数据库拒绝了内容格式：请检查代码长度、功能名称和姓名首字母"},400);
  }
  console.error("Code share database operation failed:",action,error);
  return respond({ok:false,error:action==="read"?"读取代码库失败，请站长检查 Cloudflare D1 绑定与 Functions 日志":
    "代码数据库写入失败，请站长查看 Cloudflare Pages Functions 日志中的 Code share database operation failed。"},503);
}

export async function onRequestGet({env,request}) {
  const db=database(env);
  if (!db) return respond({ok:false,error:"D1 数据库未绑定"},503);
  try {
    await ensureCodeTables(db);
    const url=new URL(request.url);
    const idParam=url.searchParams.get("id");
    if (idParam!==null) {
      const id=Number(idParam);
      if(!Number.isSafeInteger(id)||id<1) return respond({ok:false,error:"代码编号无效"},400);
      const item=await db.prepare(
        "SELECT id,COALESCE(full_title,title) AS title,COALESCE(full_code,code) AS code,initials,created_at FROM code_shares WHERE id=? AND status='approved'"
      ).bind(id).first();
      return item?respond({ok:true,item}):respond({ok:false,error:"代码不存在或已下架"},404);
    }
    const page=pageNumber(url.searchParams.get("page"));
    const perPage=pageSize(url.searchParams.get("per_page"),12);
    const q=safeSearch(url.searchParams.get("q"));
    const sort=["newest","oldest","title","title_desc"].includes(url.searchParams.get("sort"))
      ?url.searchParams.get("sort"):"newest";
    const where=q
      ?"status='approved' AND (instr(lower(COALESCE(full_title,title)),lower(?))>0 OR instr(lower(COALESCE(full_code,code)),lower(?))>0 OR instr(lower(initials),lower(?))>0)"
      :"status='approved'";
    const args=q?[q,q,q]:[];
    const count=await db.prepare("SELECT count(*) AS n FROM code_shares WHERE "+where).bind(...args).first();
    const rows=await db.prepare(
      "SELECT id,COALESCE(full_title,title) AS title,initials,created_at FROM code_shares WHERE "
      +where+" "+sortExpression(sort)+" LIMIT ? OFFSET ?"
    ).bind(...args,perPage,(page-1)*perPage).all();
    const ids=(rows.results||[]).map(row=>row.id);
    let imageCounts=new Map();
    if(ids.length){
      try{
        const table=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='code_share_images'").first();
        if(table){
          const placeholders=ids.map(()=>"?").join(",");
          const countRows=await db.prepare("SELECT code_id,count(*) AS n FROM code_share_images WHERE code_id IN ("+placeholders+") GROUP BY code_id").bind(...ids).all();
          imageCounts=new Map((countRows.results||[]).map(row=>[row.code_id,Number(row.n)]));
        }
      }catch(error){console.warn("Code sample count unavailable",error);}
    }
    const items=(rows.results||[]).map(row=>({...row,image_count:imageCounts.get(row.id)||0}));
    return respond({ok:true,items,total:Number(count?.n||0),page,per_page:perPage,sort});
  }catch(error) {
    return databaseFailure(error,"read");
  }
}

export async function onRequestPost({env,request}) {
  const db=database(env);
  if (!db) return respond({ok:false,error:"D1 数据库未绑定"},503);
  if (!sourceAllowed(request)) return respond({ok:false,error:"不允许跨站提交"},403);
  const contentType=(request.headers.get("Content-Type")||"").split(";")[0].trim().toLowerCase();
  if (contentType!=="application/json") return respond({ok:false,error:"请使用 JSON 格式提交"},415);
  if (Number(request.headers.get("Content-Length")||0)>1200000) return respond({ok:false,error:"代码内容超过大小限制"},413);
  let body;
  try {
    const raw=await request.text();
    if(raw.length>420000) return respond({ok:false,error:"代码内容过长"},413);
    body=JSON.parse(raw);
  }catch{return respond({ok:false,error:"投稿数据格式错误"},400);}
  if (!body||typeof body!=="object"||Array.isArray(body)) return respond({ok:false,error:"投稿数据格式错误"},400);

  const title=typeof body.title==="string"?body.title.trim():"";
  const code=typeof body.code==="string"?body.code.replace(/\r\n?/g,"\n").trim():"";
  const initials=typeof body.initials==="string"?body.initials.trim().toLowerCase():"";
  if(lengthOf(title)<2||wordCount(title)<1||wordCount(title)>=30||lengthOf(title)>2000||invalidText(title)) {
    return respond({ok:false,error:"代码功能名称需少于 30 词（至少 2 个字符）"},400);
  }
  if(lengthOf(code)<10||lengthOf(code)>200000||code.includes("\u0000")) {
    return respond({ok:false,error:"详细代码必须为 10–200,000 个字符"},400);
  }
  if(!/^[a-z]{1,12}$/.test(initials)) {
    return respond({ok:false,error:"姓名首字母请填写 1–12 个英文字母，如 wsl"},400);
  }

  if (!publicationCodeConfigured(env)) return respond({
    ok:false,error:"站长尚未配置 PUBLICATION_APPROVAL_CODE Secret"
  },503);
  try {
    await ensureCodeTables(db);
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
    if(!publicationCodeMatches(env,body.approval_code)) return respond({
      ok:false,error:"发布暗号不正确，代码未保存"
    },403);

    const publicationKey=await sha256(normalizePublicationTitle(title));
    const duplicateHash=await sha256(title.toLocaleLowerCase("en")+"|"+code);
    const [existing,contentOwner]=await Promise.all([
      db.prepare(
        "SELECT id,status FROM code_shares WHERE publication_key=? "+
        "OR lower(trim(COALESCE(NULLIF(full_title,''),title)))=lower(trim(?)) "+
        "ORDER BY CASE status WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,id DESC LIMIT 1"
      ).bind(publicationKey,title).first(),
      db.prepare("SELECT id FROM code_shares WHERE content_hash=?").bind(duplicateHash).first()
    ]);
    if(existing){
      if(existing.status==="rejected")return respond({
        ok:false,error:"此代码标题已被管理员下架，不能使用普通暗号直接恢复"
      },403);
      if(contentOwner&&Number(contentOwner.id)!==Number(existing.id))
        return respond({ok:false,error:"此代码内容已被另一条记录使用，请调整标题或内容"},409);
      const updated=await db.prepare(
        "UPDATE code_shares SET title=?,code=?,full_title=?,full_code=?,initials=?,"+
        "status='approved',submitter_hash=?,content_hash=?,publication_key=?,"+
        "created_at=datetime('now'),reviewed_at=NULL WHERE id=? AND status<>'rejected'"
      ).bind(
        Array.from(title).slice(0,160).join(""),Array.from(code).slice(0,20000).join(""),
        title,code,initials,ipHash,duplicateHash,publicationKey,existing.id
      ).run();
      if(!updated.meta?.changes)return respond({ok:false,error:"该代码状态已改变，请刷新后重试"},409);
      return respond({
        ok:true,id:existing.id,updated:true,status:"approved",
        message:"相同标题的分析代码已覆盖更新，完整代码及署名已替换，可以直接搜索和复制。"
      });
    }
    if(contentOwner)return respond({ok:false,error:"相同代码内容已存在，请不要使用不同标题重复发布"},409);
    const saved=await db.prepare(
      "INSERT INTO code_shares(title,code,full_title,full_code,initials,status,submitter_hash,content_hash,publication_key) "+
      "VALUES (?,?,?,?,?,'approved',?,?,?)"
    ).bind(
      Array.from(title).slice(0,160).join(""),Array.from(code).slice(0,20000).join(""),
      title,code,initials,ipHash,duplicateHash,publicationKey
    ).run();
    const id=Number(saved?.meta?.last_row_id||0);
    if(!id)throw Error("No inserted record ID");
    return respond({ok:true,id,status:"approved",updated:false,
      message:"代码提交成功，已公开；之后使用相同标题提交将直接覆盖本条完整代码。"},201);
  }catch(error){
    return databaseFailure(error,"write");
  }
}
