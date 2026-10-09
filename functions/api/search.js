import {respond,database,safeSearch} from "../_lib/community.js";
export async function onRequestGet({request,env}) {
 const db=database(env);if(!db)return respond({ok:false,error:"数据库未绑定"},503);
 const u=new URL(request.url),source=["all","community","knowledge","zotero"].includes(u.searchParams.get("source"))?u.searchParams.get("source"):"all";
 const q=safeSearch(u.searchParams.get("q")),page=Math.max(1,Math.min(10000,parseInt(u.searchParams.get("page")||"1",10)||1)),limit=20;
 try{
  const rows=[];
  const parts=[];
  if(["all","community"].includes(source))parts.push("SELECT ('community-'||id) AS item_id,'community' AS source,title,summary AS description,'' AS authors,'' AS published,'' AS url,created_at AS sort_time FROM submissions WHERE status='approved'");
  if(["all","knowledge"].includes(source))parts.push("SELECT ('knowledge-'||id) AS item_id,'knowledge' AS source,title,summary AS description,'' AS authors,'' AS published,'' AS url,created_at AS sort_time FROM knowledge_posts WHERE status='approved'");
  if(["all","zotero"].includes(source))parts.push("SELECT ('zotero-'||zotero_key) AS item_id,'zotero' AS source,title,abstract AS description,authors,item_year AS published,COALESCE(NULLIF(url,''),zotero_url) AS url,date_modified AS sort_time FROM zotero_items WHERE generation=(SELECT active_generation FROM zotero_sync_state WHERE id=1)");
  const inner=parts.join(" UNION ALL ");
  const where=q?" WHERE instr(lower(title),lower(?))>0 OR instr(lower(description),lower(?))>0 OR instr(lower(authors),lower(?))>0":"";
  const args=q?[q,q,q]:[];
  const count=await db.prepare("SELECT count(*) AS n FROM ("+inner+") AS combined"+where).bind(...args).first();
  const result=await db.prepare("SELECT * FROM ("+inner+") AS combined"+where+" ORDER BY sort_time DESC,item_id DESC LIMIT ? OFFSET ?").bind(...args,limit,(page-1)*limit).all();
  rows.push(...(result.results||[]));
  return respond({ok:true,items:rows,page,total:Number(count?.n||0),per_page:limit,source});
 }catch(e){console.error("Unified search",e);return respond({ok:false,error:"请执行 community_upgrade.sql 和 zotero_schema.sql"},503);}
}
