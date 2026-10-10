(() => {
"use strict";
const byId=id=>document.getElementById(id);
const state={page:1,total:0,perPage:12};
function wordCount(value){return (value.normalize("NFKC").match(/[\p{Script=Han}]|[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu)||[]).length;}
const dom=(tag,text,className)=>{const el=document.createElement(tag);if(text!=null)el.textContent=String(text);if(className)el.className=className;return el;};
async function api(url,options){
 const res=await fetch(url,{cache:"no-store",...options});
 const data=await res.json();
 if(!res.ok||!data.ok)throw Error(data.error||"请求失败");
 return data;
}
// All submitted code is fetched through the approved, read-only detail API.
// Never copy preview fragments: this always copies the complete source text.
function legacyClipboardCopy(value){
 const textarea=document.createElement("textarea");
 textarea.value=value;
 textarea.setAttribute("readonly","");
 textarea.style.position="fixed";
 textarea.style.left="-9999px";
 textarea.style.top="0";
 textarea.style.opacity="0";
 document.body.append(textarea);
 textarea.focus();
 textarea.select();
 let done=false;
 try{done=typeof document.execCommand==="function"&&document.execCommand("copy");}
 catch{done=false;}
 finally{textarea.remove();}
 return done;
}
async function writeClipboardText(value){
 if(navigator.clipboard&&typeof navigator.clipboard.writeText==="function"){
  try{await navigator.clipboard.writeText(value);return true;}catch{/* fall back */}
 }
 return legacyClipboardCopy(value);
}
// The ClipboardItem promise is passed while handling the actual click, which
// improves compatibility with browsers requiring transient user activation.
async function copyById(id,button,feedback){
 if(!Number.isSafeInteger(id)||id<1){
  if(feedback)feedback.textContent="代码编号无效";
  return false;
 }
 const originalLabel=button?button.textContent:"一键复制代码";
 if(button){button.disabled=true;button.textContent="正在复制…";}
 if(feedback)feedback.textContent="正在读取完整代码…";
 const fullCodePromise=api("/api/codes?id="+encodeURIComponent(id)).then(data=>data.item.code);
 try{
  let copied=false;
  if(navigator.clipboard&&typeof navigator.clipboard.write==="function"&&typeof ClipboardItem==="function"){
   try{
    const clipboardItem=new ClipboardItem({
     "text/plain":fullCodePromise.then(value=>new Blob([value],{type:"text/plain"}))
    });
    await navigator.clipboard.write([clipboardItem]);
    copied=true;
   }catch{
    const value=await fullCodePromise;
    copied=await writeClipboardText(value);
   }
  }else{
   const value=await fullCodePromise;
   copied=await writeClipboardText(value);
  }
  if(!copied)throw Error("浏览器未授予剪贴板权限，请使用 HTTPS 页面或在浏览器设置中允许复制");
  if(button)button.textContent="已复制 ✓";
  if(feedback)feedback.textContent="完整代码已复制到剪贴板";
  return true;
 }catch(error){
  if(feedback)feedback.textContent="复制失败："+(error.message||"请稍后重试");
  if(button)button.textContent=originalLabel;
  return false;
 }finally{
  if(button)button.disabled=false;
 }
}
window.MaterialNotesCopyCodeById=copyById;
function displayLocalTime(value){
 const utc=String(value||"").trim();
 if(!utc)return {text:"未记录",iso:""};
 const d=new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(utc)?utc.replace(" ","T")+"Z":utc);
 if(Number.isNaN(d.getTime()))return {text:utc+" UTC",iso:""};
 return {text:d.toLocaleString("zh-CN",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}),iso:d.toISOString()};
}
function renderPager(){
 const pages=Math.max(1,Math.ceil(state.total/state.perPage));
 byId("code-page").textContent="第 "+state.page+" / "+pages+" 页";
 byId("code-prev").disabled=state.page<=1;
 byId("code-next").disabled=state.page>=pages;
 const jump=byId("code-jump");
 jump.max=String(pages);
 jump.value=String(state.page);
 return pages;
}
async function load(){
 const list=byId("code-list"),status=byId("code-result-status");
 status.textContent="正在加载…";
 const qs=new URLSearchParams({
  page:String(state.page),per_page:String(state.perPage),
  q:byId("code-search").value.trim(),sort:byId("code-sort").value
 });
 try{
  const data=await api("/api/codes?"+qs);
  state.total=Number(data.total)||0;
  state.perPage=Number(data.per_page)||state.perPage;
  const last=Math.max(1,Math.ceil(state.total/state.perPage));
  if(state.page>last){state.page=last;return load();}
  list.replaceChildren();
  for(const item of data.items){
   const record=dom("article",null,"code-list-row");
   const title=dom("h3",item.title,"code-row-title");
   const meta=dom("div",null,"code-row-meta");
   meta.append(dom("span","分享者："+(item.initials||"未署名")));
   const stored=displayLocalTime(item.created_at);
   const time=dom("time","时间："+stored.text);
   if(stored.iso)time.dateTime=stored.iso;
   meta.append(time);
   const action=dom("div",null,"code-row-action");
   const copyButton=dom("button","一键复制代码","code-card-copy");
   copyButton.type="button";
   copyButton.setAttribute("aria-label","复制“"+item.title+"”的完整代码");
   const feedback=dom("span",null,"code-copy-feedback");
   feedback.setAttribute("role","status");
   feedback.setAttribute("aria-live","polite");
   copyButton.addEventListener("click",()=>copyById(Number(item.id),copyButton,feedback));
   action.append(copyButton);
   if(Number(item.image_count)>0){
    const preview=dom("button","查看样图（"+item.image_count+"）","code-view-images");
    preview.type="button";
    preview.addEventListener("click",()=>openSampleImages(item.id,item.title));
    action.append(preview);
   }
   action.append(feedback);
   record.append(title,meta,action);
   list.append(record);
  }
  if(!data.items.length){
   list.append(dom("p","目前没有符合条件的代码，欢迎分享第一条。","code-empty"));
  }
  status.textContent="共 "+state.total+" 条公开代码";
  byId("code-go").disabled=false;
  renderPager();
 }catch(error){
  list.replaceChildren();
  status.textContent="加载失败："+error.message;
  byId("code-prev").disabled=true;
  byId("code-next").disabled=true;
  byId("code-go").disabled=true;
 }
}
async function openSampleImages(id,title){
 const dialog=byId("code-image-viewer"),grid=byId("code-image-viewer-grid"),status=byId("code-image-viewer-status");
 byId("code-image-viewer-title").textContent=title+" · 样图示例";
 grid.replaceChildren();status.textContent="正在加载样图…";
 dialog.hidden=false;document.body.classList.add("code-images-open");
 byId("code-image-viewer-close").focus();
 try{
  const data=await api("/api/code-images?code_id="+encodeURIComponent(id));
  if(!data.images.length){status.textContent="该代码暂无样图";return;}
  status.textContent="共有 "+data.images.length+" 张样图";
  for(const img of data.images){
   const frame=dom("figure",null,"code-image-frame");
   const picture=document.createElement("img");
   picture.src=img.url;picture.alt=title+" 的样图示例";
   picture.loading="lazy";picture.decoding="async";
   picture.addEventListener("error",()=>frame.append(dom("figcaption","图片暂时无法读取")));
   frame.append(picture);grid.append(frame);
  }
 }catch(error){status.textContent="样图加载失败："+error.message;}
}
function closeSampleImages(){
 byId("code-image-viewer").hidden=true;
 byId("code-image-viewer-grid").replaceChildren();
 document.body.classList.remove("code-images-open");
}
function init(){
 for(const [id,out,words]of [["code-title","code-title-count",true],["code-body","code-body-count",false]]){
   const input=byId(id),target=byId(out);
   const update=()=>{const count=words?wordCount(input.value):Array.from(input.value).length;target.textContent=count+" / "+(words?"29 词":"200,000 字符");target.classList.toggle("over-limit",count>(words?29:200000));};
   input.addEventListener("input",update);update();
 }
 const imageInput=byId("code-images");
 imageInput.addEventListener("change",()=>{
  const files=Array.from(imageInput.files||[]);
  const invalid=files.length>3||files.some(file=>file.size>1048576||file.size<1||!["image/png","image/jpeg","image/webp"].includes(file.type));
  byId("code-images-status").textContent=invalid?"最多 3 张，单张 ≤ 1 MB，仅支持 PNG/JPG/WebP":files.length+" 张待上传样图；发布成功后保存到 R2。";
 });
 byId("code-image-viewer-close").addEventListener("click",closeSampleImages);
 byId("code-image-viewer").addEventListener("click",e=>{if(e.target===byId("code-image-viewer"))closeSampleImages()});
 document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!byId("code-image-viewer").hidden)closeSampleImages()});
 byId("code-search-form").addEventListener("submit",event=>{event.preventDefault();state.page=1;load()});
 byId("code-sort").addEventListener("change",()=>{state.page=1;load()});
 byId("code-prev").addEventListener("click",()=>{if(state.page>1){state.page--;load()}});
 byId("code-next").addEventListener("click",()=>{if(state.page*state.perPage<state.total){state.page++;load()}});
 function goToPage(){
  const input=byId("code-jump");
  const requested=Number(input.value);
  const totalPages=Math.max(1,Math.ceil(state.total/state.perPage));
  if(!Number.isSafeInteger(requested)||requested<1||requested>totalPages){
   byId("code-result-status").textContent="请输入 1 至 "+totalPages+" 之间的页码";
   input.focus();
   return;
  }
  if(requested!==state.page){state.page=requested;load();}
  else renderPager();
 }
 byId("code-go").addEventListener("click",goToPage);
 byId("code-jump").addEventListener("keydown",event=>{
  if(event.key==="Enter"){event.preventDefault();goToPage();}
 });
 byId("code-form").addEventListener("submit",async event=>{
  event.preventDefault();
  const button=byId("code-submit"),feedback=byId("code-form-feedback");
  const title=byId("code-title").value.trim(),code=byId("code-body").value.trim(),initials=byId("code-author").value.trim().toLowerCase(),approval=byId("code-secret").value;
  if(!/^[a-z]{1,12}$/.test(initials)){feedback.textContent="姓名首字母请填写英文字母，如 wsl";return;}
  if(wordCount(title)<1||wordCount(title)>=30||Array.from(title).length<2){feedback.textContent="代码功能名称必须少于 30 词";return;}
  if(Array.from(code).length>200000){feedback.textContent="详细代码不能超过 200,000 个字符";return;}
  const images=Array.from(byId("code-images").files||[]);
  if(images.length>3||images.some(f=>f.size<1||f.size>1048576||!["image/png","image/jpeg","image/webp"].includes(f.type))){
   feedback.textContent="样图最多 3 张，每张 ≤ 1 MB，格式仅限 PNG/JPG/WebP";return;
  }
  button.disabled=true;feedback.textContent="正在验证暗号并发布…";
  try{
   const data=await api("/api/codes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title,code,initials,approval_code:approval})});
   if(images.length){
    feedback.textContent="代码已保存，正在上传 "+images.length+" 张样图…";
    const form=new FormData();
    form.append("code_id",String(data.id));
    form.append("approval_code",approval);
    for(const image of images)form.append("images",image);
    try{
     const uploaded=await api("/api/code-images",{method:"POST",body:form});
     feedback.textContent=data.message+" "+uploaded.message;
    }catch(error){
     feedback.textContent=data.message+" 但样图上传失败："+error.message+"；可使用相同标题重试。";
     state.page=1;await load();return;
    }
   }else{feedback.textContent=data.message;}
   byId("code-form").reset();
   byId("code-images-status").textContent="未选择样图。支持 PNG / JPG / WebP。";
   state.page=1;await load();
  }catch(error){feedback.textContent="提交失败："+error.message;}
  finally{button.disabled=false;}
 });
 load();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();