import {respond,database,sourceAllowed,sha256} from "../_lib/community.js";
export async function onRequestPost({request,env}) {
 if(!sourceAllowed(request)) return respond({ok:false,error:"来源不允许"},403);
 const db=database(env);
 if(!db) return respond({ok:false,error:"D1 未绑定"},503);
 let data;
 try{data=await request.json();}catch{return respond({ok:false,error:"JSON 格式错误"},400);}
 const code=typeof data?.receipt==="string"?data.receipt.trim():"";
 if(!/^[0-9a-f-]{36}$/i.test(code)) return respond({ok:false,error:"请输入完整的投稿回执码"},400);
 try{
  const hash=await sha256(code);
  const item=await db.prepare("SELECT post_kind,post_id FROM submission_receipts WHERE receipt_hash=?").bind(hash).first();
  if(!item) return respond({ok:false,error:"未找到对应回执，可能是回执码错误"},404);
  const table=item.post_kind==="knowledge"?"knowledge_posts":"submissions";
  const row=await db.prepare("SELECT status,created_at FROM "+table+" WHERE id=?").bind(item.post_id).first();
  if(!row) return respond({ok:false,error:"记录已不存在"},404);
  return respond({ok:true,kind:item.post_kind,status:row.status,created_at:row.created_at});
 }catch(error){console.error("Receipt query error",error);return respond({ok:false,error:"回执查询暂不可用"},503);}
}
