(()=>{"use strict";const by=id=>document.getElementById(id),state={page:1,total:0,per:20};function node(tag,text,cls){const e=document.createElement(tag);if(text!=null)e.textContent=String(text);if(cls)e.className=cls;return e}function urlSafe(s){try{const u=new URL(s);return["http:","https:"].includes(u.protocol)?u.href:""}catch{return""}}async function search(){const list=by("unified-results"),status=by("unified-status");if(!list)return;status.textContent="正在检索…";const qs=new URLSearchParams({page:String(state.page),q:by("unified-q").value.trim(),source:by("unified-source").value,sort:by("unified-sort").value,per_page:by("unified-size").value});try{const res=await fetch("/api/search?"+qs),d=await res.json();if(!res.ok||!d.ok)throw Error(d.error||"暂不可用");list.replaceChildren();for(const x of d.items){const card=node("article",null,"community-result");card.append(node("small",({community:"读者文献",knowledge:"科研知识",zotero:"Zotero 文献",code:"数据绘图代码"})[x.source]||"文献"),node("h3",x.title),node("p",x.description||"暂无总结"));if(x.authors)card.append(node("small",x.authors));if((x.source==="community"||x.source==="code")&&x.submitter_initials)card.append(node("small","分享者："+x.submitter_initials));const href=x.source==="code"&&/^\/\?code=\d+#code-detail$/.test(x.url)?x.url:urlSafe(x.url);if(href){const a=node("a",x.source==="code"?"查看并复制代码 ↗":"查看文献 ↗");a.href=href;a.target=x.source==="code"?"_self":"_blank";a.rel="noopener noreferrer";card.append(a)}list.append(card)}state.total=d.total;state.per=d.per_page;status.textContent="找到 "+d.total+" 条结果";by("unified-page").textContent="第 "+state.page+" / "+Math.max(1,Math.ceil(state.total/state.per))+" 页";by("unified-jump").max=String(Math.max(1,Math.ceil(state.total/state.per)));by("unified-jump").value=String(state.page);by("unified-prev").disabled=state.page===1;by("unified-next").disabled=state.page*state.per>=state.total}catch(e){status.textContent="检索失败："+e.message}}function init(){if(by("unified-form")){by("unified-form").addEventListener("submit",e=>{e.preventDefault();state.page=1;search()});by("unified-source").addEventListener("change",()=>{state.page=1;search()});for(const id of ["unified-sort","unified-size"]){by(id).addEventListener("change",()=>{state.page=1;search()})}by("unified-reset").addEventListener("click",()=>{by("unified-q").value="";by("unified-source").value="all";by("unified-sort").value="newest";by("unified-size").value="24";state.page=1;search()});by("unified-go").addEventListener("click",()=>{const value=Number(by("unified-jump").value);const last=Math.max(1,Math.ceil(state.total/state.per));if(Number.isSafeInteger(value)&&value>=1&&value<=last){state.page=value;search()}});by("unified-prev").addEventListener("click",()=>{if(state.page>1){state.page--;search()}});by("unified-next").addEventListener("click",()=>{if(state.page*state.per<state.total){state.page++;search()}});search()}const form=by("new-community-form");
if(form)form.addEventListener("submit",async event=>{
  event.preventDefault();
  const button=by("new-submit"),message=by("new-feedback");
  const title=by("new-title").value.trim(),summary=by("new-summary").value.trim(),initials=by("new-initials").value.trim().toLowerCase(),code=by("new-code").value;
  if(Array.from(title).length<6||Array.from(summary).length<24){
    message.textContent="题目至少 6 个字符，总结至少 24 个字符。";
    return;
  }
  if(!/^[a-z]{1,12}$/.test(initials)){message.textContent="请填写 1–12 位英文字母的姓名首字母，例如 wsl。";return;}
  button.disabled=true;message.textContent="正在验证暗号并保存文献…";
  try{
    const res=await fetch("/api/submissions",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({title,summary,submitter_initials:initials,approval_code:code})
    });
    const data=await res.json();
    if(!res.ok||!data.ok)throw Error(data.error||"提交失败");
    message.textContent=data.message||"文献已公开";
    form.reset();
    state.page=1;search();
  }catch(error){
    message.textContent="提交失败："+error.message;
  }finally{button.disabled=false;}
});
}if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init()})();