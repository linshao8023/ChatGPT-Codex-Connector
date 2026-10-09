import {output,dbFromEnv,acquireLock,syncGroup} from "../../_lib/zotero.js";
function constantTimeEqual(a,b) {
 if(typeof a!=="string" || typeof b!=="string") return false;
 const x=new TextEncoder().encode(a),y=new TextEncoder().encode(b);
 let diff=x.length^y.length;
 for(let i=0;i<Math.max(x.length,y.length);i++) diff|=(x[i%x.length]||0)^(y[i%y.length]||0);
 return diff===0;
}
export async function onRequestPost({request,env,context}) {
 const secret=typeof env.ZOTERO_SYNC_TOKEN==="string"?env.ZOTERO_SYNC_TOKEN:"";
 const provided=(request.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
 if(secret.length<24 || !constantTimeEqual(secret,provided)) return output({ok:false,error:"未授权"},401);
 const db=dbFromEnv(env);
 if(!db) return output({ok:false,error:"D1 未绑定"},503);
 try {
  const acquired=await acquireLock(db,{force:true});
  if(!acquired) return output({ok:false,error:"同步任务正在运行"},409);
  context.waitUntil(syncGroup(db,env));
  return output({ok:true,message:"同步已提交到后台；稍后刷新网页查看同步状态"},202);
 } catch(e) {
  console.error("Zotero refresh:",e);
  return output({ok:false,error:"请检查是否执行了 zotero_schema.sql"},503);
 }
}
