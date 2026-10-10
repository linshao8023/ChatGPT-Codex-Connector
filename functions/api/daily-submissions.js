import {respond,database,sourceAllowed,cleanText,lengthOf,invalidText,fingerprint,approvalCodeMatches,pageNumber} from "../_lib/community.js";
import {ensureDailyTables} from "../_lib/daily.js";
function httpsSource(s){
 if(typeof s!=="string"||s.length>600)return "";
 try{
  const url=new URL(s.trim());
  if(url.protocol!=="https:"||!url.hostname||url.username||url.password)return "";
  return url.href.slice(0,600);
 }catch{return "";}
}
export async function onRequestGet({env,request}){
 const db=database(env);
 if(!db)return respond({ok:false,error:"D1 未绑定"},503);
 try{
  await ensureDailyTables(db);
  const page=pageNumber(new URL(request.url).searchParams.get("page"));
  const count=await db.prepare("SELECT count(*) AS n FROM daily_frontier_submissions WHERE status='approved'").first();
  const rows=await db.prepare(
   "SELECT id,title,journal,source_url,summary,initials,created_at FROM daily_frontier_submissions "+
   "WHERE status='approved' ORDER BY id DESC LIMIT 10 OFFSET ?"
  ).bind((page-1)*10).all();
  return respond({ok:true,items:rows.results||[],total:Number(count?.n||0),page,per_page:10});
 }catch(error){console.error("Daily community listing failed:",error);return respond({ok:false,error:"读者前沿文献暂不可用"},503);}
}
export async function onRequestPost({request,env}){
 const db=database(env);
 if(!db)return respond({ok:false,error:"D1 未绑定"},503);
 if(!sourceAllowed(request))return respond({ok:false,error:"不允许跨站提交"},403);
 if((request.headers.get("Content-Type")||"").split(";")[0].trim()!=="application/json")
  return respond({ok:false,error:"请求格式需要 JSON"},415);
 if(Number(request.headers.get("Content-Length")||0)>12000)return respond({ok:false,error:"投稿内容超过上限"},413);
 let payload;
 try{
  const raw=await request.text();
  if(raw.length>12000)return respond({ok:false,error:"投稿内容超过上限"},413);
  payload=JSON.parse(raw);
 }catch{return respond({ok:false,error:"JSON 格式错误"},400);}
 const title=cleanText(payload?.title),journal=cleanText(payload?.journal),
  url=httpsSource(payload?.source_url),summary=cleanText(payload?.summary),
  initials=typeof payload?.initials==="string"?payload.initials.trim().toLowerCase():"";
 if(lengthOf(title)<4||lengthOf(title)>200||invalidText(title))
  return respond({ok:false,error:"论文题目需 4–200 字符"},400);
 if(lengthOf(journal)<2||lengthOf(journal)>140||invalidText(journal))
  return respond({ok:false,error:"请填写原文期刊名（2–140 字符）"},400);
 if(!url)return respond({ok:false,error:"请填写有效的 HTTPS 原文或 DOI 链接"},400);
 if(lengthOf(summary)<24||lengthOf(summary)>2000||invalidText(summary))
  return respond({ok:false,error:"前沿文献 AI 总结需 24–2000 字符"},400);
 if(!/^[a-z]{1,12}$/.test(initials))
  return respond({ok:false,error:"姓名首字母需 1–12 位英文字母"},400);
 if(!env?.SUBMISSION_APPROVAL_CODE)
  return respond({ok:false,error:"站长尚未配置 SUBMISSION_APPROVAL_CODE Secret"},503);
 if(!approvalCodeMatches(env,payload?.approval_code))
  return respond({ok:false,error:"发布暗号错误，未保存"},403);
 try{
  await ensureDailyTables(db);
  const hash=await fingerprint(request,env);
  const recent=await db.prepare(
   "SELECT count(*) AS n FROM daily_frontier_submissions WHERE submitter_hash=? AND created_at>=datetime('now','-1 hour')"
  ).bind(hash).first();
  if(Number(recent?.n||0)>=3)return respond({ok:false,error:"同一来源每小时最多提交 3 条前沿文献"},429);
  const existed=await db.prepare(
   "SELECT id FROM daily_frontier_submissions WHERE source_url=? AND created_at>=datetime('now','-1 day') LIMIT 1"
  ).bind(url).first();
  if(existed)return respond({ok:false,error:"这篇文献今天已被分享"},409);
  const result=await db.prepare(
   "INSERT INTO daily_frontier_submissions(title,journal,source_url,summary,initials,status,submitter_hash) "+
   "VALUES(?,?,?,?,?,'approved',?)"
  ).bind(title,journal,url,summary,initials,hash).run();
  return respond({ok:true,id:Number(result?.meta?.last_row_id||0),
   message:"前沿文献总结已提交，将以“读者补充”单独显示；不自动标为一区论文。"},201);
 }catch(error){console.error("Daily frontier submission failed:",error);return respond({ok:false,error:"保存前沿文献失败，请检查 D1 日志"},503);}
}
