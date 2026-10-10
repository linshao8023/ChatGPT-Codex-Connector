(() => {
"use strict";
const byId=id=>document.getElementById(id);
const state={page:1,total:0,perPage:12};
const dom=(tag,text,className)=>{const el=document.createElement(tag);if(text!=null)el.textContent=String(text);if(className)el.className=className;return el;};
async function api(url,options){
 const res=await fetch(url,{cache:"no-store",...options});
 const data=await res.json();
 if(!res.ok||!data.ok)throw Error(data.error||"请求失败");
 return data;
}
async function copy(value,button){
 try {
  await navigator.clipboard.writeText(value);
  if(button)button.textContent="已复制 ✓";
  byId("code-copy-status").textContent="代码已复制到剪贴板";
 }catch{
  const text=byId("code-full");
  text?.parentElement?.scrollIntoView({behavior:"smooth"});
  byId("code-copy-status").textContent="浏览器不允许自动复制，请选中代码手动复制。";
 }
}
async function detail(id){
 const block=byId("code-detail");
 const title=byId("code-detail-title"),meta=byId("code-detail-meta"),full=byId("code-full");
 title.textContent="正在加载完整代码…";block.hidden=false;full.textContent="";
 block.scrollIntoView({behavior:"smooth",block:"start"});
 try{
  const data=await api("/api/codes?id="+encodeURIComponent(id));
  title.textContent=data.item.title;
  meta.textContent="分享者："+data.item.initials+" · "+data.item.created_at+" UTC";
  full.textContent=data.item.code; // Untrusted code must be text, never HTML/executed.
  byId("code-copy").onclick=()=>copy(data.item.code,byId("code-copy"));
  byId("code-copy").textContent="复制全部代码";
  history.replaceState(null,"","#code-"+data.item.id);
 }catch(e){title.textContent="无法查看代码";meta.textContent=e.message;}
}
async function load(){
 const list=byId("code-list"),status=byId("code-result-status");
 status.textContent="正在加载…";
 const qs=new URLSearchParams({page:String(state.page),per_page:String(state.perPage),q:byId("code-search").value.trim(),sort:byId("code-sort").value});
 try{
  const data=await api("/api/codes?"+qs);
  state.total=data.total;
  list.replaceChildren();
  for(const item of data.items){
   const card=dom("article",null,"code-card");
   card.append(dom("small","分享者："+item.initials+" · "+item.created_at+" UTC"),dom("h3",item.title));
   const pre=dom("pre");const code=dom("code",item.preview);pre.append(code);card.append(pre);
   const actions=dom("div",null,"code-actions");
   const open=dom("button","查看并复制完整代码");
   open.type="button";open.addEventListener("click",()=>detail(item.id));
   actions.append(open);
   card.append(actions);list.append(card);
  }
  status.textContent="共 "+data.total+" 条公开代码";
  const pages=Math.max(1,Math.ceil(state.total/state.perPage));
  byId("code-page").textContent="第 "+state.page+" / "+pages+" 页";
  byId("code-prev").disabled=state.page===1;
  byId("code-next").disabled=state.page>=pages;
  byId("code-pages").hidden=pages<=1;
  if(!data.items.length)list.append(dom("p","目前没有符合条件的代码，欢迎分享第一条。"));
 }catch(e){list.replaceChildren();status.textContent="加载失败："+e.message;byId("code-pages").hidden=true;}
}
function init(){
 byId("code-search-form").addEventListener("submit",event=>{event.preventDefault();state.page=1;load()});
 byId("code-sort").addEventListener("change",()=>{state.page=1;load()});
 byId("code-prev").addEventListener("click",()=>{if(state.page>1){state.page--;load()}});
 byId("code-next").addEventListener("click",()=>{if(state.page*state.perPage<state.total){state.page++;load()}});
 byId("code-close").addEventListener("click",()=>{byId("code-detail").hidden=true;history.replaceState(null,"",location.pathname+location.search)});
 byId("code-form").addEventListener("submit",async event=>{
  event.preventDefault();
  const button=byId("code-submit"),feedback=byId("code-form-feedback");
  const title=byId("code-title").value.trim(),code=byId("code-body").value.trim(),initials=byId("code-author").value.trim().toLowerCase(),approval=byId("code-secret").value;
  if(!/^[a-z]{1,12}$/.test(initials)){feedback.textContent="姓名首字母请填写英文字母，如 wsl";return;}
  button.disabled=true;feedback.textContent="正在验证暗号并发布…";
  try{
   const data=await api("/api/codes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title,code,initials,approval_code:approval})});
   feedback.textContent=data.message;
   byId("code-form").reset();state.page=1;
   await load();await detail(data.id);
  }catch(error){feedback.textContent="提交失败："+error.message;}
  finally{button.disabled=false;}
 });
 const queryId=new URL(location.href).searchParams.get("id");
 if(queryId&&/^\d+$/.test(queryId))detail(queryId);
 load();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();