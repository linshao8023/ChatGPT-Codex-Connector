// Private helper: read-only Zotero Web API v3 -> Cloudflare D1.
// No Zotero credentials, write requests, attachments, or Zotero notes appear in public responses.
export const GROUP_ID = "6671409";
export const GROUP_URL = "https://www.zotero.org/groups/6671409/shaolin_library";

const API_BASE = "https://api.zotero.org/groups/" + GROUP_ID;
const PAGE_SIZE = 100;
const MAX_PAGES = 100; // Guard: never publish a partial snapshot from >10,000 source items.
const REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;
const RETRY_DELAY_MS = 10 * 60 * 1000;
const LOCK_SECONDS = 15 * 60;

export function output(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export function dbFromEnv(env) {
  return env?.DB && typeof env.DB.prepare === "function" ? env.DB : null;
}

export async function readState(db) {
  return db.prepare(
    "SELECT active_generation, last_synced_at, last_attempt_at, lock_until, last_error, last_version, item_count FROM zotero_sync_state WHERE id = 1"
  ).first();
}

function validUrl(value) {
  if (typeof value !== "string") return "";
  try {
    const parsed = new URL(value);
    return ["https:", "http:"].includes(parsed.protocol) ? parsed.href : "";
  } catch {
    return "";
  }
}

function text(value, maxLength = 10000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function normalizeZoteroItem(item) {
  const data = item?.data;
  if (!item || !data || typeof data !== "object") return null;
  if (["attachment", "note", "annotation"].includes(data.itemType)) return null;
  const key = String(item.key || data.key || "").trim();
  const title = text(data.title, 600);
  if (!/^[A-Z0-9]{8}$/i.test(key) || !title) return null;

  const creators = Array.isArray(data.creators) ? data.creators : [];
  const authors = creators.slice(0, 30).map((creator) => {
    const named = text(creator?.name, 160);
    return named || [text(creator?.firstName, 100), text(creator?.lastName, 100)].filter(Boolean).join(" ");
  }).filter(Boolean).join("; ").slice(0, 2500);

  const date = text(data.date, 120);
  const year = (date.match(/\b(?:18|19|20|21)\d{2}\b/) || [])[0] || "";
  const tags = (Array.isArray(data.tags) ? data.tags : [])
    .map((tag) => text(tag?.tag, 80)).filter(Boolean).slice(0, 25);
  const doi = text(data.DOI, 300).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
  const preferredUrl = validUrl(data.url) || (doi ? validUrl("https://doi.org/" + encodeURIComponent(doi).replace(/%2F/gi, "/")) : "");
  const zoteroUrl = validUrl(item.links?.alternate?.href)
    || "https://www.zotero.org/groups/" + GROUP_ID + "/items/" + key;

  return {
    zotero_key: key,
    item_version: Number.isSafeInteger(item.version) ? item.version : 0,
    item_type: text(data.itemType, 100) || "document",
    title,
    authors,
    publication_title: text(data.publicationTitle || data.bookTitle || data.proceedingsTitle || data.publisher, 600),
    item_year: year,
    doi,
    url: preferredUrl,
    abstract: text(data.abstractNote, 7000),
    tags_json: JSON.stringify(tags),
    zotero_url: zoteroUrl,
    date_modified: text(data.dateModified, 80)
  };
}

export async function acquireLock(db, { force = false } = {}) {
  const now = Date.now();
  const timestamp = new Date(now).toISOString();
  const outdated = new Date(now - REFRESH_INTERVAL_MS).toISOString();
  const retryAllowed = new Date(now - RETRY_DELAY_MS).toISOString();
  const statement = db.prepare(
    "UPDATE zotero_sync_state SET lock_until = ?, last_attempt_at = ?, last_error = NULL " +
    "WHERE id = 1 AND lock_until <= ? AND " +
    "(? = 1 OR ((last_synced_at IS NULL OR last_synced_at < ?) " +
    "AND (last_attempt_at IS NULL OR last_attempt_at < ?)))"
  );
  const result = await statement.bind(
    Math.floor(now / 1000) + LOCK_SECONDS, timestamp, Math.floor(now / 1000),
    force ? 1 : 0, outdated, retryAllowed
  ).run();
  return Number(result?.meta?.changes || 0) === 1;
}

function apiPath(env) {
  const rawKey = typeof env.ZOTERO_COLLECTION_KEY === "string"
    ? env.ZOTERO_COLLECTION_KEY.trim().toUpperCase() : "";
  if (rawKey && !/^[A-Z0-9]{8}$/.test(rawKey)) {
    throw new Error("ZOTERO_COLLECTION_KEY 必须是 8 位 Zotero collection key");
  }
  return rawKey ? "/collections/" + rawKey + "/items/top" : "/items/top";
}

function upstreamHeaders(env) {
  const headers = {
    "Accept": "application/json",
    "Zotero-API-Version": "3"
  };
  const key = typeof env.ZOTERO_API_KEY === "string" ? env.ZOTERO_API_KEY.trim() : "";
  if (key) headers["Zotero-API-Key"] = key;
  return headers;
}

async function storePage(db, rows, generation) {
  if (!rows.length) return;
  const sql = "INSERT INTO zotero_items " +
    "(zotero_key, generation, item_version, item_type, title, authors, publication_title, item_year, doi, url, abstract, tags_json, zotero_url, date_modified) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT(zotero_key, generation) DO UPDATE SET " +
    "item_version=excluded.item_version, item_type=excluded.item_type, title=excluded.title, " +
    "authors=excluded.authors, publication_title=excluded.publication_title, " +
    "item_year=excluded.item_year, doi=excluded.doi, url=excluded.url, " +
    "abstract=excluded.abstract, tags_json=excluded.tags_json, " +
    "zotero_url=excluded.zotero_url, date_modified=excluded.date_modified";
  const batch = rows.map((row) => db.prepare(sql).bind(
    row.zotero_key, generation, row.item_version, row.item_type,
    row.title, row.authors, row.publication_title, row.item_year,
    row.doi, row.url, row.abstract, row.tags_json, row.zotero_url, row.date_modified
  ));
  await db.batch(batch);
}

export async function syncGroup(db, env) {
  const generation = crypto.randomUUID();
  let saved = 0;
  let version = 0;
  let completed = false;
  try {
    const path = apiPath(env);
    const headers = upstreamHeaders(env);
    let offset = 0;
    let total = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const endpoint = new URL(API_BASE + path);
      endpoint.searchParams.set("format", "json");
      endpoint.searchParams.set("limit", String(PAGE_SIZE));
      endpoint.searchParams.set("start", String(offset));
      endpoint.searchParams.set("sort", "dateModified");
      endpoint.searchParams.set("direction", "asc");

      const response = await fetch(endpoint.href, { method: "GET", headers, redirect: "error" });
      if (!response.ok) {
        if ([401, 403, 404].includes(response.status)) {
          throw new Error("Zotero 返回 " + response.status + "，请检查群组可访问性、ZOTERO_API_KEY 和收藏夹权限");
        }
        throw new Error("Zotero HTTP " + response.status + "，请稍后重试");
      }

      const currentVersion = Number(response.headers.get("Last-Modified-Version") || 0);
      if (page > 0 && version && currentVersion && currentVersion !== version) {
        throw new Error("同步期间 Zotero 文献库发生变化，稍后会自动重试");
      }
      if (page === 0) version = currentVersion;
      if (total === null) {
        const count = Number(response.headers.get("Total-Results"));
        total = Number.isSafeInteger(count) && count >= 0 ? count : null;
        if (total !== null && total > MAX_PAGES * PAGE_SIZE) {
          throw new Error("群组文献超过单次同步上限（10,000 条），原缓存已保留");
        }
      }

      const items = await response.json();
      if (!Array.isArray(items)) throw new Error("Zotero API 返回的数据格式不正确");
      const normalized = items.map(normalizeZoteroItem).filter(Boolean);
      await storePage(db, normalized, generation);
      saved += normalized.length;
      offset += items.length;

      if (items.length === 0 || items.length < PAGE_SIZE || (total !== null && offset >= total)) {
        completed = true;
        break;
      }
    }
    if (!completed) throw new Error("达到同步分页上限，未完成的快照不会公开");

    await db.batch([
      db.prepare(
        "UPDATE zotero_sync_state SET active_generation=?, last_synced_at=?, last_error=NULL, " +
        "lock_until=0, last_version=?, item_count=? WHERE id=1"
      ).bind(generation, new Date().toISOString(), version, saved),
      db.prepare("DELETE FROM zotero_items WHERE generation <> ?").bind(generation)
    ]);
    return { ok: true, count: saved, version };
  } catch (error) {
    console.error("Zotero sync failed:", error);
    const diagnostic = String(error?.message || "同步失败").slice(0, 350);
    try {
      await db.batch([
        db.prepare("DELETE FROM zotero_items WHERE generation = ?").bind(generation),
        db.prepare("UPDATE zotero_sync_state SET lock_until=0, last_error=? WHERE id=1").bind(diagnostic)
      ]);
    } catch (cleanupError) {
      console.error("Zotero cache rollback failed:", cleanupError);
    }
    return { ok: false, error: diagnostic };
  }
}
