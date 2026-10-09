// Shared validation and security utilities for the community endpoints.
export const respond = (payload, status=200) => new Response(JSON.stringify(payload), {
 status, headers: {
  "Content-Type":"application/json; charset=utf-8",
  "Cache-Control":"no-store",
  "X-Content-Type-Options":"nosniff",
  "Referrer-Policy":"no-referrer"
 }
});
export const database = (env) => env?.DB && typeof env.DB.prepare==="function" ? env.DB : null;
export const sourceAllowed = (request) => {
 const origin=request.headers.get("Origin");
 return !origin || origin === new URL(request.url).origin;
};
export const lengthOf = text => Array.from(text).length;
export const cleanText = value => typeof value==="string" ? value.replace(/\r\n?/g,"\n").trim() : "";
export const invalidText = value => /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
export const kindFor = value => value==="knowledge" ? "knowledge" : value==="community" || value==null ? "community" : "";
export const tableFor = kind => kind==="knowledge" ? "knowledge_posts" : kind==="community" ? "submissions" : null;
export function reviewDecision(env, {kind,title,summary}) {
 const text=(title+" "+summary).normalize("NFKC");
 const blocked=/加(我|微|v)[信vx]|私信(购买|付款)|代写(论文|毕业)|代发(论文|期刊)|赌博|刷单|色情|博彩|telegram|whatsapp/i.test(text);
 if(blocked) return {status:"rejected",reason:"内容疑似广告或违规推广，请修改后重试"};
 const link=/(https?:\/\/|www\.|(?:^|\s)[\w.+-]+@[\w.-]+\.\w+)/i.test(text);
 const suspicious=link || /(\S)\1{9,}/u.test(text) || /<\s*script|<\s*iframe|onerror\s*=/i.test(text);
 const enabled=String(env?.AUTO_APPROVE_ENABLED||"").toLowerCase()==="true";
 // Disabled by default. An anonymous title does not establish that a paper exists.
 const threshold=kind==="knowledge"?100:80;
 const clear=enabled && !suspicious && lengthOf(summary)>=threshold && lengthOf(title)>=8;
 return {status:clear?"approved":"pending",reason:suspicious?"需要人工核查链接或异常内容":clear?"规则自动放行":"等待人工审核"};
}
export async function fingerprint(request,env) {
 const ip=request.headers.get("CF-Connecting-IP")||"unknown";
 const salt=typeof env.RATE_LIMIT_SALT==="string"?env.RATE_LIMIT_SALT:"material-notes-rate-v1";
 const day=new Date().toISOString().slice(0,10);
 return sha256(salt+"|"+day+"|"+ip);
}
export async function sha256(value) {
 const bytes=new TextEncoder().encode(value);
 const hash=await crypto.subtle.digest("SHA-256",bytes);
 return Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,"0")).join("");
}
export function adminAuthorized(request,env) {
 const secret=typeof env?.ADMIN_REVIEW_TOKEN==="string"?env.ADMIN_REVIEW_TOKEN:"";
 const supplied=(request.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
 if(secret.length<32 || supplied.length<32) return false;
 let diff=secret.length ^ supplied.length;
 for(let i=0;i<Math.max(secret.length,supplied.length);i++){
  diff |= (secret.charCodeAt(i)||0)^(supplied.charCodeAt(i)||0);
 }
 return diff===0;
}
export function safeSearch(value) {
 // Avoid unbounded search queries. INSTR does not have LIKE's 50-byte pattern limit.
 return typeof value==="string" ? value.normalize("NFKC").trim().slice(0,120) : "";
}
