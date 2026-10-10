import {respond,database} from "../_lib/community.js";
import {chinaDate,isValidDate,ensureDailyTables,dailyStatus,acquireDailyLock,generateDaily} from "../_lib/daily.js";

export async function onRequestGet({env,request,context}){
 const db=database(env);
 if(!db)return respond({ok:false,error:"D1 未绑定 DB"},503);
 try{
  await ensureDailyTables(db);
  const today=chinaDate();
  const url=new URL(request.url),desired=url.searchParams.get("date");
  if(desired!==null&&!isValidDate(desired))return respond({ok:false,error:"日期格式需要 YYYY-MM-DD"},400);
  const archive=await db.prepare("SELECT issue_date,item_count,created_at FROM daily_brief_issues WHERE item_count=10 ORDER BY issue_date DESC LIMIT 100").all();
  const issues=archive.results||[];
  const issueDate=desired||(issues[0]?.issue_date||null);
  let items=[];
  if(issueDate) {
   const rows=await db.prepare(
    "SELECT position,title,journal,authors,published_at,doi,summary_short,summary_full,source_url,rank_note,rank_url "+
    "FROM daily_brief_items WHERE issue_date=? ORDER BY position"
   ).bind(issueDate).all();
   items=rows.results||[];
  }
  const state=await dailyStatus(db),latest=issues[0]?.issue_date||null;
  let running=Number(state?.lock_until||0)>Math.floor(Date.now()/1000);
  const configured=!!(env?.AI&&typeof env.AI.run==="function");
  if(configured&&!issues.some(item=>item.issue_date===today)&&desired===null){
   const locked=await acquireDailyLock(db,today);
   if(locked){
    running=true;
    if(context?.waitUntil)context.waitUntil(generateDaily(db,env,today));
   }
  }
  return respond({ok:true,today,date:issueDate,latest_date:latest,ready:items.length===10,
   items,issues,auto:{configured,running,last_error:state?.last_error||null},
   notice:"AI解读仅基于OpenAlex提供的题目与摘要，不代表已阅读全文。期刊分区取自第三方记录，可能变化，使用前请自行核对。"});
 }catch(error){
  console.error("Read daily digest failed:",error);
  return respond({ok:false,error:"每日简报暂不可用，请检查 D1 数据库绑定和日志"},503);
 }
}
