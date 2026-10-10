import {output, dbFromEnv, readState, readProgress, acquireLock, syncGroup, GROUP_URL} from "../_lib/zotero.js";

export async function onRequestGet({env, context, request}) {
 const db=dbFromEnv(env);
 if(!db) return output({ok:false,error:"D1 尚未绑定变量 DB"},503);
 try {
  const state=await readState(db);
  if(!state) return output({ok:false,error:"请先执行 zotero_schema.sql"},503);
  const progress=await readProgress(db);
  const url=new URL(request.url);
  const page=Math.max(1,Math.min(10000,Number.parseInt(url.searchParams.get("page")||"1",10)||1));
  const limit=20;
  const q=(url.searchParams.get("q")||"").trim().slice(0,120);
  if(!state.active_generation) {
   if(await acquireLock(db)) context.waitUntil(syncGroup(db,env));
   return output({ok:true,items:[],total:0,page,per_page:limit,group_url:GROUP_URL,ready:false,last_synced_at:state.last_synced_at,last_error:state.last_error,progress:progress?{processed:Number(progress.upstream_offset)||0,total:Number(progress.expected_total)||0}:null});
  }
  if(await acquireLock(db)) context.waitUntil(syncGroup(db,env));
  const where="generation = ?"+(q?" AND (title LIKE ? ESCAPE '\\' OR authors LIKE ? ESCAPE '\\' OR abstract LIKE ? ESCAPE '\\' OR tags_json LIKE ? ESCAPE '\\' OR doi LIKE ? ESCAPE '\\')":"");
  const escaped=q.replace(/[\\%_]/g,s=>"\\"+s);
  const params=q?[state.active_generation,...Array(5).fill("%"+escaped+"%")]:[state.active_generation];
  const count=await db.prepare("SELECT COUNT(*) AS n FROM zotero_items WHERE "+where).bind(...params).first();
  const {results}=await db.prepare(
   "SELECT zotero_key, item_type, title, authors, publication_title, item_year, doi, url, abstract, tags_json, zotero_url, date_modified "+
   "FROM zotero_items WHERE "+where+" ORDER BY date_modified DESC, zotero_key DESC LIMIT ? OFFSET ?"
  ).bind(...params,limit,(page-1)*limit).all();
  const items=(results||[]).map(x=>({...x,tags:JSON.parse(x.tags_json||"[]"),tags_json:undefined}));
  return output({ok:true,items,total:Number(count?.n||0),page,per_page:limit,group_url:GROUP_URL,ready:true,last_synced_at:state.last_synced_at,last_error:state.last_error,progress:progress?{processed:Number(progress.upstream_offset)||0,total:Number(progress.expected_total)||0}:null});
 } catch(e) {
  console.error("Zotero cache query:",e);
  return output({ok:false,error:"无法读取 Zotero 缓存。请检查 D1 表结构。"},503);
 }
}
