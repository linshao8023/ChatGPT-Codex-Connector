import {respond,database,sourceAllowed,cleanText,lengthOf,invalidText,fingerprint,sha256,safeSearch,pageNumber,approvalCodeMatches} from "../_lib/community.js";

export async function onRequestGet({env,request}) {
  const db = database(env);
  if (!db) return respond({ok:false,error:"D1 数据库未绑定"},503);
  try {
    const url = new URL(request.url);
    const page = pageNumber(url.searchParams.get("page"));
    const perPage = 30;
    const q = safeSearch(url.searchParams.get("q"));
    const where = q ? "status='approved' AND (instr(lower(title),lower(?))>0 OR instr(lower(summary),lower(?))>0)" : "status='approved'";
    const params = q ? [q,q] : [];
    const count = await db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE "+where).bind(...params).first();
    const rows = await db.prepare(
      "SELECT id,title,summary,created_at FROM submissions WHERE "+where+" ORDER BY id DESC LIMIT ? OFFSET ?"
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
  if (Number(request.headers.get("Content-Length")||0) > 8192) return respond({ok:false,error:"投稿内容过长"},413);

  let body;
  try {
    const raw = await request.text();
    if (raw.length > 5000) return respond({ok:false,error:"投稿内容过长"},413);
    body = JSON.parse(raw);
  } catch {
    return respond({ok:false,error:"投稿数据格式错误"},400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return respond({ok:false,error:"投稿数据格式错误"},400);
  }

  const title = cleanText(body.title);
  const summary = cleanText(body.summary);
  if (lengthOf(title) < 6 || lengthOf(title) > 200) {
    return respond({ok:false,error:"文献题目至少 6 个字符，最多 200 个字符"},400);
  }
  if (lengthOf(summary) < 24 || lengthOf(summary) > 1200) {
    return respond({ok:false,error:"简要总结至少 24 个字符，最多 1200 个字符"},400);
  }
  if (invalidText(title) || invalidText(summary)) {
    return respond({ok:false,error:"内容不能包含控制字符"},400);
  }

  // Fail closed: code is set ONLY in Cloudflare Pages Secrets.
  // The former AUTO_APPROVE_ENABLED flag is deliberately not consulted.
  if (typeof env?.SUBMISSION_APPROVAL_CODE !== "string" || !env.SUBMISSION_APPROVAL_CODE) {
    return respond({ok:false,error:"发布功能尚未配置：请站长在 Cloudflare 设置 SUBMISSION_APPROVAL_CODE Secret"},503);
  }
  if (!approvalCodeMatches(env,body.approval_code)) {
    return respond({ok:false,error:"发布暗号不正确，文献未提交"},403);
  }

  try {
    const hash = await fingerprint(request,env);
    const [recent,duplicate] = await Promise.all([
      db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE submitter_hash=? AND created_at>=datetime('now','-1 hour')").bind(hash).first(),
      db.prepare("SELECT id FROM submissions WHERE lower(trim(title))=lower(?) AND lower(trim(summary))=lower(?) AND created_at>=datetime('now','-1 day') LIMIT 1").bind(title,summary).first()
    ]);
    if (Number(recent?.n||0) >= 3) {
      return respond({ok:false,error:"提交太频繁：同一网络来源每小时最多提交 3 条"},429);
    }
    if (duplicate) return respond({ok:false,error:"相同的题目和总结最近已提交，请勿重复分享"},409);

    const saved = await db.prepare(
      "INSERT INTO submissions (title,summary,status,submitter_hash) VALUES (?,?,'approved',?)"
    ).bind(title,summary,hash).run();
    const id = Number(saved?.meta?.last_row_id||0);
    if (!id) throw new Error("Missing inserted ID");

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
      ok:true,id,status:"approved",receipt,
      message:"投稿成功，暗号及字符长度验证通过，文献已自动批准并公开。"
    },201);
  } catch(error) {
    console.error("Saving community submission failed:",error);
    return respond({ok:false,error:"投稿保存失败，请联系站长检查 D1 数据库"},503);
  }
}
