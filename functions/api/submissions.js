import {respond,database,sourceAllowed,cleanText,lengthOf,invalidText,fingerprint,sha256,safeSearch,pageNumber,wordCount,normalizePublicationTitle,approvalCodeMatches} from "../_lib/community.js";

// Additive D1 upgrade; no table rebuild, no lost attribution/receipt links.
async function ensureExtendedPaperFields(db) {
  const schema=await db.prepare("PRAGMA table_info(submissions)").all();
  const cols=new Set((schema.results||[]).map(row=>row.name));
  for (const name of ["full_title","full_summary","publication_key"]) {
    if (!cols.has(name)) {
      try { await db.prepare("ALTER TABLE submissions ADD COLUMN "+name+" TEXT").run(); }
      catch(error) {
        if(!/duplicate column name/i.test(String(error))) throw error;
      }
    }
  }
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_publication_key ON submissions(publication_key)").run();
}
export async function onRequestGet({env,request}) {
  const db = database(env);
  if (!db) return respond({ok:false,error:"D1 数据库未绑定"},503);
  try {
    const url = new URL(request.url);
    const page = pageNumber(url.searchParams.get("page"));
    const perPage = 30;
    const q = safeSearch(url.searchParams.get("q"));
    const schema=await db.prepare("PRAGMA table_info(submissions)").all();
    const cols=new Set((schema.results||[]).map(row=>row.name));
    const titleField=cols.has("full_title")?"COALESCE(NULLIF(full_title,''),title)":"title";
    const summaryField=cols.has("full_summary")?"COALESCE(NULLIF(full_summary,''),summary)":"summary";
    const where=q
      ? "status='approved' AND (instr(lower("+titleField+"),lower(?))>0 OR instr(lower("+summaryField+"),lower(?))>0)"
      : "status='approved'";
    const params=q?[q,q]:[];
    const count=await db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE "+where).bind(...params).first();
    const rows=await db.prepare(
      "SELECT id,"+titleField+" AS title,"+summaryField+" AS summary,created_at FROM submissions WHERE "+
      where+" ORDER BY id DESC LIMIT ? OFFSET ?"
    ).bind(...params,perPage,(page-1)*perPage).all();
    return respond({ok:true,submissions:rows.results||[],total:Number(count?.n||0),page,per_page:perPage});
  } catch(error) {
    console.error("Reading public submissions failed:",error);
    return respond({ok:false,error:"读取文献分享失败"},503);
  }
}

export async function onRequestPost({request,env}) {
  const db = database(env);
  if (!db) return respond({ok:false,error:"D1 数据库未绑定"},503);
  if (!sourceAllowed(request)) return respond({ok:false,error:"不允许跨站提交"},403);
  const contentType = (request.headers.get("Content-Type")||"").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") return respond({ok:false,error:"请使用 JSON 提交"},415);
  if (Number(request.headers.get("Content-Length")||0) > 100000) return respond({ok:false,error:"投稿内容过长"},413);

  let body;
  try {
    const raw = await request.text();
    if (raw.length > 50000) return respond({ok:false,error:"投稿内容过长"},413);
    body = JSON.parse(raw);
  } catch {
    return respond({ok:false,error:"投稿数据格式错误"},400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return respond({ok:false,error:"投稿数据格式错误"},400);
  }

  const title = cleanText(body.title);
  const summary = cleanText(body.summary);
  const submitterInitials = typeof body.submitter_initials === "string" ? body.submitter_initials.trim().toLowerCase() : "";
  if(wordCount(title)<6||wordCount(title)>50||lengthOf(title)>2000) {
    return respond({ok:false,error:"文献题目需 6–50 词（中文按字、英文按词统计）"},400);
  }
  if(wordCount(summary)<24||wordCount(summary)>200||lengthOf(summary)>20000) {
    return respond({ok:false,error:"简要总结需 24–200 词（中文按字、英文按词统计）"},400);
  }
  if (invalidText(title) || invalidText(summary)) {
    return respond({ok:false,error:"内容不能包含控制字符"},400);
  }

  if (!/^[a-z]{1,12}$/.test(submitterInitials)) {
    return respond({ok:false,error:"提交者姓名首字母请填写 1–12 个英文字母，例如：王少林 → wsl"},400);
  }

  // Fail closed: one Cloudflare Secret controls all three publication forms.
  // The former AUTO_APPROVE_ENABLED flag is deliberately not consulted.
  if (typeof env?.PUBLICATION_APPROVAL_CODE !== "string" || !env.PUBLICATION_APPROVAL_CODE) {
    return respond({ok:false,error:"发布功能尚未配置：请站长在 Cloudflare 设置 PUBLICATION_APPROVAL_CODE Secret"},503);
  }
  if (!approvalCodeMatches(env,body.approval_code)) {
    return respond({ok:false,error:"发布暗号不正确，文献未提交"},403);
  }

  try {
    const attributionTable = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='submission_attributions'").first();
    if (!attributionTable) return respond({ok:false,error:"投稿暂不可用：请站长先在 Cloudflare D1 执行 submission_initials_upgrade.sql"},503);
    await ensureExtendedPaperFields(db);
    const hash=await fingerprint(request,env);
    const publicationKey=await sha256(normalizePublicationTitle(title));
    const [recent,existing]=await Promise.all([
      db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE submitter_hash=? AND created_at>=datetime('now','-1 hour')").bind(hash).first(),
      db.prepare(
        "SELECT id,status FROM submissions WHERE publication_key=? "+
        "OR lower(trim(COALESCE(NULLIF(full_title,''),title)))=lower(trim(?)) "+
        "ORDER BY CASE status WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,id DESC LIMIT 1"
      ).bind(publicationKey,title).first()
    ]);
    if(Number(recent?.n||0)>=3){
      return respond({ok:false,error:"提交太频繁：同一网络来源每小时最多提交 3 条"},429);
    }
    if(existing){
      // Rejected content cannot be silently restored with a shared publishing code.
      if(existing.status==="rejected")return respond({
        ok:false,error:"此标题曾被管理员下架，请联系管理员审核后恢复"
      },403);
      const [changed]=await db.batch([
        db.prepare(
          "UPDATE submissions SET title=?,summary=?,full_title=?,full_summary=?,"+
          "status='approved',submitter_hash=?,publication_key=?,created_at=datetime('now'),reviewed_at=NULL "+
          "WHERE id=? AND status<>'rejected'"
        ).bind(Array.from(title).slice(0,200).join(""),
          Array.from(summary).slice(0,1200).join(""),title,summary,hash,publicationKey,existing.id),
        db.prepare(
          "INSERT INTO submission_attributions(submission_id,initials) VALUES(?,?) "+
          "ON CONFLICT(submission_id) DO UPDATE SET initials=excluded.initials"
        ).bind(existing.id,submitterInitials)
      ]);
      if(!changed.meta?.changes)return respond({ok:false,error:"原文献状态已变化，请刷新后重试"},409);
      return respond({
        ok:true,id:existing.id,status:"approved",updated:true,submitter_initials:submitterInitials,
        message:"相同标题的文献已覆盖更新，原记录编号保留，最新总结与署名已公开。"
      });
    }

    // First-time title: save the paper and initials in one transaction.
    const [saved]=await db.batch([
      db.prepare(
        "INSERT INTO submissions (title,summary,full_title,full_summary,status,submitter_hash,publication_key) "+
        "VALUES (?,?,?,?,'approved',?,?)"
      ).bind(Array.from(title).slice(0,200).join(""),
        Array.from(summary).slice(0,1200).join(""),title,summary,hash,publicationKey),
      db.prepare("INSERT INTO submission_attributions (submission_id,initials) VALUES (last_insert_rowid(),?)")
        .bind(submitterInitials)
    ]);
    const id=Number(saved?.meta?.last_row_id||0);
    if(!id)throw Error("Missing inserted ID");

    // Keep historical receipt API compatible; the streamlined form no longer
    // asks visitors to manage a receipt.
    let receipt = null;
    try {
      receipt = crypto.randomUUID();
      await db.prepare("INSERT INTO submission_receipts(receipt_hash,post_kind,post_id) VALUES (?,'community',?)")
        .bind(await sha256(receipt),id).run();
    } catch(error) {
      receipt = null;
      console.warn("Optional receipt registration skipped",error);
    }

    return respond({
      ok:true,id,status:"approved",submitter_initials:submitterInitials,receipt,
      message:"投稿成功，暗号及词数验证通过，文献已自动批准并公开。"
    },201);
  } catch(error) {
    console.error("Saving community submission failed:",error);
    if(/UNIQUE constraint failed.*(publication_key|idx_submissions_publication_key)/i.test(String(error)))
      return respond({ok:false,error:"此标题正被其他投稿更新，请刷新后再提交"},409);
    return respond({ok:false,error:"投稿保存失败，请联系站长检查 D1 数据库"},503);
  }
}
