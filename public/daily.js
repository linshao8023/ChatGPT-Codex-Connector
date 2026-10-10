(()=>{"use strict";
const $=id=>document.getElementById(id);
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined&&text!==null)e.textContent=String(text);if(cls)e.className=cls;return e};
let activeIssue=null,archivePage=1,archivePages=1;
async function request(url,options){const r=await fetch(url,{cache:"no-store",...options});const d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||"操作失败");return d;}
function firstFiveLines(value){
 return String(value||"").replace(/\r\n?/g,"\n").split("\n").slice(0,5).join("\n");
}
function showFullIssue(issue){
 if(!issue)return;
 const panel=$("daily-paper-detail");
 $("daily-detail-number").textContent="发布日期 / "+issue.issue_date;
 $("daily-detail-title").textContent=issue.headline;
 $("daily-detail-body").textContent=issue.body;
 panel.hidden=false;
 panel.scrollIntoView({behavior:"smooth",block:"start"});
}
function renderIssue(issue){
 $("daily-paper-detail").hidden=true;
 activeIssue=issue;
 const preview=$("daily-current-preview"),read=$("daily-current-read"),status=$("daily-current-status");
 if(!issue){
   $("daily-current-date").textContent="尚无简报";
   $("daily-current-title").textContent="等待第一期 AI 前沿文献简报";
   status.hidden=false;
   status.textContent="暂无已发布简报。请在页面最下方的投稿中心提交并发布第一期。";
   preview.hidden=true;preview.textContent="";
   read.hidden=true;
   return;
 }
 $("daily-current-date").textContent=issue.issue_date;
 $("daily-current-title").textContent=issue.headline;
 preview.textContent=firstFiveLines(issue.body);
 preview.hidden=false;
 status.textContent="";
 status.hidden=true;
 read.hidden=false;
 read.onclick=()=>showFullIssue(activeIssue);
}
async function loadLatest(){
 try{const d=await request("/api/digests?latest=1");renderIssue(d.issue);}
 catch(error){$("daily-current-status").hidden=false;$("daily-current-status").textContent="简报暂时无法加载："+error.message;}
}
async function loadArchive(){
 const status=$("daily-history-status"),list=$("daily-history-list");status.textContent="正在读取往期简报…";list.replaceChildren();
 try{
  const d=await request("/api/digests?page="+archivePage);
  archivePages=Math.max(1,Math.ceil(d.total/d.per_page));
  status.textContent=d.total?"共有 "+d.total+" 期简报":"暂无往期推送。";
  d.issues.forEach(item=>{
    const b=el("button",null,"daily-history-card");b.type="button";
    b.append(el("small",item.issue_date),el("strong",item.headline),el("pre",firstFiveLines(item.preview),"daily-archive-preview"),el("span","阅读全文 ↗"));
    b.addEventListener("click",async()=>{
      b.disabled=true;try{const issue=await request("/api/digests?id="+item.id);renderIssue(issue.issue);$("daily-digest").scrollIntoView({behavior:"smooth"});}
      catch(error){status.textContent="读取失败："+error.message;}finally{b.disabled=false;}
    });list.append(b);
  });
  $("daily-history-pages").hidden=archivePages<=1;
  $("daily-history-page").textContent="第 "+archivePage+" / "+archivePages+" 页";
  $("daily-history-prev").disabled=archivePage<=1;$("daily-history-next").disabled=archivePage>=archivePages;
 }catch(error){status.textContent="往期推送读取失败："+error.message;}
}
function setTab(name){
 const valid=["digest","paper","code"];
 if(!valid.includes(name))name="digest";
 for(const kind of valid){
   const tab=$("submission-tab-"+kind);
   const panel=$(kind==="digest"?"daily-submit-panel":kind==="paper"?"new-sharing":"code-publish");
   const selected=kind===name;
   tab.setAttribute("aria-selected",String(selected));tab.tabIndex=selected?0:-1;panel.hidden=!selected;
 }
}
function init(){
 const tabs=[...document.querySelectorAll("[data-submission-tab]")];
 tabs.forEach((b,i)=>{
  b.addEventListener("click",()=>setTab(b.dataset.submissionTab));
  b.addEventListener("keydown",e=>{
    if(!["ArrowRight","ArrowLeft","Home","End"].includes(e.key))return;
    e.preventDefault();let n=e.key==="Home"?0:e.key==="End"?tabs.length-1:(i+(e.key==="ArrowRight"?1:-1)+tabs.length)%tabs.length;
    setTab(tabs[n].dataset.submissionTab);tabs[n].focus();
  });
 });
 document.querySelectorAll("[data-open-submission]").forEach(a=>a.addEventListener("click",()=>setTab(a.dataset.openSubmission)));
 $("daily-detail-close").addEventListener("click",()=>{$("daily-paper-detail").hidden=true;});
 $("daily-history-prev").addEventListener("click",()=>{if(archivePage>1){archivePage--;loadArchive();}});
 $("daily-history-next").addEventListener("click",()=>{if(archivePage<archivePages){archivePage++;loadArchive();}});
 $("daily-submit-date").value=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
 $("daily-submit-body").addEventListener("input",()=>{
   const count=Array.from($("daily-submit-body").value).length;
   $("daily-submit-count").textContent=count+" / 10,000 字符";
   $("daily-submit-count").classList.toggle("over-limit",count>10000);
 });
 $("daily-submit-form").addEventListener("submit",async event=>{
   event.preventDefault();const button=$("daily-submit-button"),feedback=$("daily-submit-feedback");
   const date=$("daily-submit-date").value,headline=$("daily-submit-headline").value.trim(),body=$("daily-submit-body").value.trim(),token=$("daily-submit-token").value;
   if(Array.from(body).length>10000){feedback.textContent="简报不能超过 10,000 字符";return;}
   button.disabled=true;feedback.textContent="正在验证发布暗号并保存简报…";
   try{
     const result=await request("/api/digests",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({issue_date:date,headline,body,approval_code:token})});
     feedback.textContent=result.message;
     $("daily-submit-token").value="";archivePage=1;
     await Promise.all([loadLatest(),loadArchive()]);
     $("daily-digest").scrollIntoView({behavior:"smooth"});
   }catch(error){feedback.textContent="发布失败："+error.message;}
   finally{button.disabled=false;}
 });
 const hash=location.hash;
 setTab(hash==="#new-sharing"?"paper":hash==="#code-publish"?"code":"digest");
 loadLatest();loadArchive();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();