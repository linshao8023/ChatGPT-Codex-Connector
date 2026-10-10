import {respond,database,safeSearch,pageNumber,pageSize,orderClause} from "../_lib/community.js";

export async function onRequestGet({request,env}) {
  const db = database(env);
  if (!db) return respond({ok:false,error:"D1 数据库尚未绑定"},503);

  const url = new URL(request.url);
  const source = ["all","community","knowledge","zotero"].includes(url.searchParams.get("source"))
    ? url.searchParams.get("source") : "all";
  const q = safeSearch(url.searchParams.get("q"));
  const sort = ["newest","oldest","title","title_desc"].includes(url.searchParams.get("sort"))
    ? url.searchParams.get("sort") : "newest";
  const page = pageNumber(url.searchParams.get("page"));
  const perPage = pageSize(url.searchParams.get("per_page"),24);

  try {
    // During a staged D1 migration, existing approved posts remain searchable.
    const existing = await db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('submissions','knowledge_posts','zotero_items','zotero_sync_state','submission_attributions')"
    ).all();
    const available = new Set((existing.results || []).map((row) => row.name));
    const parts = [];
    if(available.has("submissions")){
      const cols=await db.prepare("PRAGMA table_info(submissions)").all();
      const fields=new Set((cols.results||[]).map(x=>x.name));
      if(fields.has("full_title")&&fields.has("full_summary")) available.add("submissions_full_columns");
    }
    if (["all","community"].includes(source) && available.has("submissions")) {
      const attr = available.has("submission_attributions");
      const titleExpr=available.has("submissions_full_columns")?"COALESCE(NULLIF(s.full_title,''),s.title)":"s.title";
      const summaryExpr=available.has("submissions_full_columns")?"COALESCE(NULLIF(s.full_summary,''),s.summary)":"s.summary";
      parts.push("SELECT 'community-'||s.id AS item_id,'community' AS source,"+titleExpr+" AS title,"+summaryExpr+" AS description,'' AS authors,'' AS published,'' AS url,s.created_at AS sort_time,'' AS search_extra,"+(attr?"COALESCE(a.initials,'')":"''")+" AS submitter_initials FROM submissions s "+(attr?"LEFT JOIN submission_attributions a ON a.submission_id=s.id ":"")+"WHERE s.status='approved'");
    }
    if (["all","knowledge"].includes(source) && available.has("knowledge_posts")) {
      parts.push("SELECT 'knowledge-'||id AS item_id,'knowledge' AS source,title,summary AS description,'' AS authors,'' AS published,'' AS url,created_at AS sort_time,'' AS search_extra,'' AS submitter_initials FROM knowledge_posts WHERE status='approved'");
    }
    if (["all","zotero"].includes(source)
      && available.has("zotero_items") && available.has("zotero_sync_state")) {
      parts.push("SELECT 'zotero-'||zotero_key AS item_id,'zotero' AS source,title,abstract AS description,authors,item_year AS published,COALESCE(NULLIF(url,''),zotero_url) AS url,date_modified AS sort_time,(doi||' '||tags_json||' '||publication_title) AS search_extra,'' AS submitter_initials FROM zotero_items WHERE generation=(SELECT active_generation FROM zotero_sync_state WHERE id=1)");
    }
    if (!parts.length) return respond({ok:true,items:[],total:0,page,per_page:perPage,sort,source,ready:false});

    const inner = "(" + parts.join(" UNION ALL ") + ") AS records";
    const where = q
      ? " WHERE instr(lower(title),lower(?))>0 OR instr(lower(description),lower(?))>0 OR instr(lower(authors),lower(?))>0 OR instr(lower(search_extra),lower(?))>0"
      : "";
    const binds = q ? [q,q,q,q] : [];
    const totalRow = await db.prepare("SELECT COUNT(*) AS total FROM " + inner + where).bind(...binds).first();
    const rows = await db.prepare(
      "SELECT item_id,source,title,description,authors,published,url,sort_time,submitter_initials FROM " + inner + where + " " +
      orderClause(sort) + " LIMIT ? OFFSET ?"
    ).bind(...binds,perPage,(page-1)*perPage).all();

    return respond({
      ok:true,
      ready:true,
      items:rows.results || [],
      total:Number(totalRow?.total || 0),
      page,
      per_page:perPage,
      sort,
      source
    });
  } catch(error) {
    console.error("Public search failed:",error);
    return respond({ok:false,error:"检索失败，请稍后重试"},503);
  }
}
