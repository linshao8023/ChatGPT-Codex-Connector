// Shared validation for D1-backed public posts and moderation.
export const respond = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer"
  }
});

export const database = (env) => env?.DB && typeof env.DB.prepare === "function" ? env.DB : null;
export const sourceAllowed = (request) => {
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin;
};
export const lengthOf = (value) => Array.from(value).length;
// Bilingual count: each Han character is one unit, contiguous Latin/digit tokens one word.
export const wordCount = (value) => typeof value === "string"
  ? (value.normalize("NFKC").match(/[\p{Script=Han}]|[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu) || []).length : 0;
// Stable case- and whitespace-insensitive key for all three publication forms.
export const normalizePublicationTitle = (value) => typeof value === "string"
  ? value.normalize("NFKC").trim().replace(/\s+/g," ").toLocaleLowerCase("en") : "";
export const cleanText = (value) => typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : "";
export const invalidText = (value) => /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
export const kindFor = (value) => value === "knowledge" ? "knowledge" : value === "community" || value == null ? "community" : "";
export const tableFor = (kind) => kind === "knowledge" ? "knowledge_posts" : kind === "community" ? "submissions" : null;
export const safeSearch = (value) => typeof value === "string" ? value.normalize("NFKC").trim().slice(0, 120) : "";
export const pageNumber = (value) => {
  const n = Number(value);
  return Number.isSafeInteger(n) ? Math.min(10000, Math.max(1, n)) : 1;
};
export const pageSize = (value, defaultSize = 24) => {
  const n = Number(value);
  return [12, 20, 24, 30, 48].includes(n) ? n : defaultSize;
};
export const orderClause = (sort, prefix = "") => {
  const time = prefix + "sort_time";
  const title = prefix + "title";
  const id = prefix + "item_id";
  switch (sort) {
    case "oldest": return "ORDER BY " + time + " ASC, " + id + " ASC";
    case "title": return "ORDER BY " + title + " COLLATE NOCASE ASC, " + id + " ASC";
    case "title_desc": return "ORDER BY " + title + " COLLATE NOCASE DESC, " + id + " DESC";
    default: return "ORDER BY " + time + " DESC, " + id + " DESC";
  }
};

// Verify the publishing code exclusively on the server. No default/hardcoded
// code: a missing Cloudflare Secret must never cause automatic publication.
// One Cloudflare Secret gates all three public submission workflows.
// Never put its actual value into public HTML, JavaScript or the repository.
export function publicationCodeConfigured(env) {
  return typeof env?.PUBLICATION_APPROVAL_CODE === "string" && env.PUBLICATION_APPROVAL_CODE.length > 0;
}
export function publicationCodeMatches(env, submitted) {
  if (!publicationCodeConfigured(env) || typeof submitted !== "string" || submitted.length > 128) return false;
  const expected = env.PUBLICATION_APPROVAL_CODE;
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(submitted.trim());
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    difference |= (a[i] || 0) ^ (b[i] || 0);
  }
  return difference === 0;
}
// Compatibility for any older imports. The obsolete per-form secrets are
// intentionally not fallback authentication, so old passcodes cannot survive.
export function approvalCodeMatches(env, submitted) {
  return publicationCodeMatches(env, submitted);
}
export async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function fingerprint(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const salt = typeof env.RATE_LIMIT_SALT === "string" ? env.RATE_LIMIT_SALT : "material-notes-rate-v1";
  return sha256(salt + "|" + new Date().toISOString().slice(0, 10) + "|" + ip);
}
export function adminAuthorized(request, env) {
  const secret = typeof env?.ADMIN_REVIEW_TOKEN === "string" ? env.ADMIN_REVIEW_TOKEN : "";
  const provided = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (secret.length < 32 || provided.length < 32) return false;
  let difference = secret.length ^ provided.length;
  for (let i = 0; i < Math.max(secret.length, provided.length); i++) {
    difference |= (secret.charCodeAt(i) || 0) ^ (provided.charCodeAt(i) || 0);
  }
  return difference === 0;
}
