import {respond,database,sourceAllowed,cleanText,lengthOf,invalidText,kindFor,tableFor,reviewDecision,fingerprint,sha256,safeSearch} from "../_lib/community.js";

export async function onRequestGet({env,request}) {
 const db=database(env);
 if(!db) return respond({ok:false,error:"D1 数据库未绑定"},503);
 try {
  const url=new URL(request.url);
  const page=Math.max(1,Math.min(10000,Number(url.searchParams.get("page"))||1));
  const limit=30;
  const q=safeSearch(url.searchParams.get("q"));
  const where=q?"status='approved' AND (instr(lower(title),lower(?))>0 OR instr(lower(summary),lower(?))>0)":"status='approved'";
  const params=q?[q,q]:[];
  const count=await db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE "+where).bind(...params).first();
  const {results}=await db.prepare("SELECT id,title,summary,created_at FROM submissions WHERE "+where+" ORDER BY id DESC LIMIT ? OFFSET ?")
   .bind(...params,limit,(page-1)*limit).all();
  return respond({ok:true,submissions:results||[],total:Number(count?.n||0),page,per_page:limit});
 } catch(error){
  console.error("Public submissions read failed:",error);
  return respond({ok:false,error:"读取文献分享失败"},503);
 }
}

export async function onRequestPost({request,env}) {
 const db=database(env);
 if(!db) return respond({ok:false,error:"D1 数据库未绑定"},503);
 if(!sourceAllowed(request)) return respond({ok:false,error:"不允许跨站提交"},403);
 if((request.headers.get("Content-Type")||"").split(";")[0].trim().toLowerCase()!=="application/json") return respond({ok:false,error:"请提交 JSON 数据"},415);
 if(Number(request.headers.get("Content-Length")||0)>8192) return respond({ok:false,error:"内容过长"},413);
 let body;
 try{
  const raw=await request.text();
  if(raw.length>5000) return respond({ok:false,error:"内容过长"},413);
  body=JSON.parse(raw);
 }catch{return respond({ok:false,error:"数据格式错误"},400);}
 if(!body || typeof body!=="object" || Array.isArray(body)) return respond({ok:false,error:"数据格式错误"},400);
 const kind=kindFor(body.kind);
 if(!kind) return respond({ok:false,error:"投稿类别无效"},400);
 if(typeof body.website==="string"&&body.website.trim()) return respond({ok:true,status:"pending",message:"已收到分享，等待处理"},202);
 const title=cleanText(body.title),summary=cleanText(body.summary);
 if(lengthOf(title)<2||lengthOf(title)>200||lengthOf(summary)<10||lengthOf(summary)>1200||invalidText(title)||invalidText(summary))
  return respond({ok:false,error:"名称需 2–200 字，总结需 10–1200 字，并且不能含控制字符"},400);
 const decision=reviewDecision(env,{kind,title,summary});
 if(decision.status==="rejected") return respond({ok:false,error:decision.reason},422);
 const table=tableFor(kind);
 try {
  const hash=await fingerprint(request,env);
  const [existing,identical]=await Promise.all([
   db.prepare("SELECT (SELECT COUNT(*) FROM submissions WHERE submitter_hash=? AND created_at>=datetime('now','-1 hour')) + (SELECT COUNT(*) FROM knowledge_posts WHERE submitter_hash=? AND created_at>=datetime('now','-1 hour')) AS n").bind(hash,hash).first(),
   db.prepare("SELECT id FROM "+table+" WHERE lower(trim(title))=lower(?) AND lower(trim(summary))=lower(?) AND created_at>=datetime('now','-1 day') LIMIT 1").bind(title,summary).first()
  ]);
  if(Number(existing?.n||0)>=3) return respond({ok:false,error:"提交太频繁，请一小时后重试"},429);
  if(identical) return respond({ok:false,error:"相同的名称和总结最近已经提交"},409);
  const inserted=await db.prepare("INSERT INTO "+table+" (title,summary,status,submitter_hash) VALUES (?,?,?,?)")
   .bind(title,summary,decision.status,hash).run();
  const id=Number(inserted?.meta?.last_row_id||0);
  if(!id) throw new Error("新增记录缺少标识");
  const receipt=crypto.randomUUID();
  const receiptHash=await sha256(receipt);
  try{
   await db.prepare("INSERT INTO submission_receipts(receipt_hash,post_kind,post_id) VALUES(?,?,?)")
    .bind(receiptHash,kind,id).run();
  }catch(error){console.error("Receipt registration failed for",kind,id,error);}
  return respond({
   ok:true,id,kind,status:decision.status,
   receipt,
   message:decision.status==="approved"?"分享已通过基础规则检查并公开展示。内容尚未经人工事实核实。":"提交成功，内容已保存，审核通过后公开。"
  },201);
 }catch(error){
  console.error("Submissions write failed:",error);
  return respond({ok:false,error:"保存投稿失败，请检查是否已执行 community_upgrade.sql"},503);
 }
}
