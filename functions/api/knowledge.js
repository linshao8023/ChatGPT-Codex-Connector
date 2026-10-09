import {respond,database,safeSearch} from "../_lib/community.js";
export async function onRequestGet({request,env}) {
 const db=database(env);if(!db)return respond({ok:false,error:"D1 未绑定"},503);
 try{
  const u=new URL(request.url),q=safeSearch(u.searchParams.get("q")),page=Math.max(1,Math.min(10000,parseInt(u.searchParams.get("page")||"1",10)||1));
  const where=q?"status='approved' AND (instr(lower(title),lower(?))>0 OR instr(lower(summary),lower(?))>0)":"status='approved'";
  const p=q?[q,q]:[];
  const total=await db.prepare("SELECT count(*) AS n FROM knowledge_posts WHERE "+where).bind(...p).first();
  const rows=await db.prepare("SELECT id,title,summary,created_at FROM knowledge_posts WHERE "+where+" ORDER BY id DESC LIMIT 20 OFFSET ?").bind(...p,(page-1)*20).all();
  return respond({ok:true,items:rows.results||[],total:Number(total?.n||0),page,per_page:20});
 }catch(e){console.error("Knowledge GET",e);return respond({ok:false,error:"知识库未初始化，请执行 community_upgrade.sql"},503);}
}
