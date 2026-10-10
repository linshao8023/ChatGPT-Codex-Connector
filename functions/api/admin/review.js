import {respond,database,sourceAllowed,adminAuthorized,tableFor,safeSearch,pageNumber,pageSize,orderClause} from "../../_lib/community.js";

const formatSelect = (table,kind,full=false) => {
  const title=full?"COALESCE(NULLIF(full_title,''),title)":"title";
  const summary=full?"COALESCE(NULLIF(full_summary,''),summary)":"summary";
  return "SELECT id,"+title+" AS title,"+summary+" AS summary,status,created_at,'"+kind+
    "' AS kind,'"+kind+"-'||id AS item_id,created_at AS sort_time FROM "+table;
};
export async function onRequestGet({request,env}) {
  if (!adminAuthorized(request,env)) return respond({ok:false,error:"未授权，请检查 ADMIN_REVIEW_TOKEN"},401);
  const db = database(env);
  if (!db) return respond({ok:false,error:"D1 未绑定"},503);
  const url = new URL(request.url);
  const status = ["all","pending","approved","rejected"].includes(url.searchParams.get("status"))
    ? url.searchParams.get("status") : "pending";
  const source = ["all","community","knowledge","code"].includes(url.searchParams.get("source"))
    ? url.searchParams.get("source") : "all";
  const sort = ["newest","oldest","title","title_desc"].includes(url.searchParams.get("sort"))
    ? url.searchParams.get("sort") : "newest";
  const q = safeSearch(url.searchParams.get("q"));
  const page = pageNumber(url.searchParams.get("page"));
  const perPage = pageSize(url.searchParams.get("per_page"),24);

  const parts = [];
  const schema=await db.prepare("PRAGMA table_info(submissions)").all();
  const cols=new Set((schema.results||[]).map(row=>row.name));
  if (source === "all" || source === "community") parts.push(formatSelect("submissions","community",cols.has("full_title")&&cols.has("full_summary")));
  if (source === "all" || source === "knowledge") parts.push(formatSelect("knowledge_posts","knowledge"));
  if(source === "all" || source === "code") {
    const exists=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='code_shares'").first();
    if(exists) parts.push("SELECT id,COALESCE(full_title,title) AS title,substr(COALESCE(full_code,code),1,1000) AS summary,status,created_at,'code' AS kind,'code-'||id AS item_id,created_at AS sort_time FROM code_shares");
  }
  const dataSet = "(" + parts.join(" UNION ALL ") + ") AS posts";
  const clauses = [],binds = [];
  if (status !== "all") {clauses.push("status=?");binds.push(status);}
  if (q) {clauses.push("(instr(lower(title),lower(?))>0 OR instr(lower(summary),lower(?))>0)");binds.push(q,q);}
  const where = clauses.length ? " WHERE " + clauses.join(" AND ") : "";

  try {
    const count = await db.prepare("SELECT COUNT(*) AS total FROM " + dataSet + where).bind(...binds).first();
    const list = await db.prepare(
      "SELECT id,title,summary,status,created_at,kind FROM " + dataSet + where + " " + orderClause(sort) + " LIMIT ? OFFSET ?"
    ).bind(...binds,perPage,(page-1)*perPage).all();
    return respond({ok:true,items:list.results||[],total:Number(count?.total||0),page,per_page:perPage,status,source,sort});
  }catch(error){
    console.error("Admin review list failed:",error);
    return respond({ok:false,error:"查询失败：请确认已执行 community_upgrade.sql"},503);
  }
}

export async function onRequestPost({request,env}) {
  if (!adminAuthorized(request,env)) return respond({ok:false,error:"未授权"},401);
  if (!sourceAllowed(request)) return respond({ok:false,error:"不允许跨站操作"},403);
  const db = database(env);
  if (!db) return respond({ok:false,error:"D1 未绑定"},503);
  if ((request.headers.get("Content-Type") || "").split(";")[0] !== "application/json") {
    return respond({ok:false,error:"请求格式错误"},415);
  }
  let payload;
  try {
    const body = await request.text();
    if (body.length > 2000) return respond({ok:false,error:"请求过大"},413);
    payload = JSON.parse(body);
  }catch {return respond({ok:false,error:"JSON 参数错误"},400);}
  const table = payload?.kind === "code" ? "code_shares" : tableFor(payload?.kind);
  const id = Number(payload?.id);
  const status = payload?.status;
  if (!table || !Number.isSafeInteger(id) || id < 1 || !["pending","approved","rejected"].includes(status)) {
    return respond({ok:false,error:"审核参数错误"},400);
  }
  try {
    const existing = await db.prepare("SELECT status FROM "+table+" WHERE id=?").bind(id).first();
    if (!existing) return respond({ok:false,error:"投稿不存在"},404);
    if (existing.status === status) return respond({ok:true,kind:payload.kind,id,status});
    // Atomic compare-and-swap prevents overwriting a concurrent moderator action.
    const changed = await db.prepare(
      "UPDATE "+table+" SET status=?,reviewed_at=datetime('now') WHERE id=? AND status=?"
    ).bind(status,id,existing.status).run();
    if (!changed.meta?.changes) return respond({ok:false,error:"此条记录已经被更新，请刷新"},409);
    try {
      await db.prepare(
        "INSERT INTO moderation_events(post_kind,post_id,previous_status,new_status,reason) VALUES(?,?,?,?,?)"
      ).bind(payload.kind,id,existing.status,status,"admin").run();
    }catch(error){console.error("Moderation log insert failed:",error);}
    return respond({ok:true,kind:payload.kind,id,status});
  }catch(error){
    console.error("Admin review change failed:",error);
    return respond({ok:false,error:"审核操作失败"},503);
  }
}
