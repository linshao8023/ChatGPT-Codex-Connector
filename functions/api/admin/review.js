import {respond,database,sourceAllowed,adminAuthorized,tableFor} from "../../_lib/community.js";
export async function onRequestGet({request,env}) {
 if(!adminAuthorized(request,env)) return respond({ok:false,error:"未授权；请在 Cloudflare 设置 ADMIN_REVIEW_TOKEN Secret"},401);
 const db=database(env);if(!db)return respond({ok:false,error:"D1 未绑定"},503);
 try {
  const u=new URL(request.url),filter=["pending","approved","rejected"].includes(u.searchParams.get("status"))?u.searchParams.get("status"):"pending";
  const page=Math.max(1,Math.min(1000,parseInt(u.searchParams.get("page")||"1",10)||1));
  const a=await db.prepare("SELECT id,title,summary,status,created_at,'community' AS kind FROM submissions WHERE status=? ORDER BY id DESC LIMIT 30 OFFSET ?").bind(filter,(page-1)*30).all();
  const b=await db.prepare("SELECT id,title,summary,status,created_at,'knowledge' AS kind FROM knowledge_posts WHERE status=? ORDER BY id DESC LIMIT 30 OFFSET ?").bind(filter,(page-1)*30).all();
  const count=await db.prepare("SELECT (SELECT count(*) FROM submissions WHERE status=?) + (SELECT count(*) FROM knowledge_posts WHERE status=?) AS n").bind(filter,filter).first();
  return respond({ok:true,items:[...(a.results||[]),...(b.results||[])].sort((x,y)=>y.created_at.localeCompare(x.created_at)).slice(0,30),total:Number(count?.n||0),status:filter,page});
 } catch(e){console.error("Admin GET",e);return respond({ok:false,error:"请先执行 community_upgrade.sql"},503);}
}
export async function onRequestPost({request,env}) {
 if(!adminAuthorized(request,env))return respond({ok:false,error:"未授权"},401);
 if(!sourceAllowed(request))return respond({ok:false,error:"来源不允许"},403);
 const db=database(env);if(!db)return respond({ok:false,error:"D1 未绑定"},503);
 let body;try{body=await request.json()}catch{return respond({ok:false,error:"参数格式错误"},400);}
 const kind=body?.kind,table=tableFor(kind),id=Number(body?.id),status=body?.status;
 if(!table||!Number.isSafeInteger(id)||id<1||!["approved","rejected","pending"].includes(status))return respond({ok:false,error:"审核参数错误"},400);
 try {
  const current=await db.prepare("SELECT status FROM "+table+" WHERE id=?").bind(id).first();
  if(!current)return respond({ok:false,error:"投稿不存在"},404);
  if(current.status===status)return respond({ok:true,status,id,kind});
  const update=await db.prepare("UPDATE "+table+" SET status=?,reviewed_at=datetime('now') WHERE id=? AND status=?").bind(status,id,current.status).run();
  if(!update?.meta?.changes)return respond({ok:false,error:"记录状态已变化，请刷新"},409);
  await db.prepare("INSERT INTO moderation_events(post_kind,post_id,previous_status,new_status) VALUES(?,?,?,?)").bind(kind,id,current.status,status).run();
  return respond({ok:true,status,id,kind});
 }catch(e){console.error("Admin POST",e);return respond({ok:false,error:"审核失败"},503);}
}
