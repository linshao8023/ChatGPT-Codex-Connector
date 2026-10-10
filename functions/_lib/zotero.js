// Private helper: read-only Zotero Web API v3 -> Cloudflare D1.
// No Zotero credentials, write requests, attachments, or Zotero notes appear in public responses.
export const GROUP_ID = "6671409";
export const GROUP_URL = "https://www.zotero.org/groups/6671409/shaolin_library";

const API_BASE = "https://api.zotero.org/groups/" + GROUP_ID;
const PAGE_SIZE = 100;
const MAX_PAGES = 100; // Guard: never publish a partial snapshot from >10,000 source items.
const REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;
const RETRY_DELAY_MS = 10 * 60 * 1000;
const FAST_RETRY_MS = 5 * 1000;
const LOCK_SECONDS = 70;
const STALE_LOCK_MS = 100 * 1000;
const CHUNK_PAGES = 2;
const FETCH_TIMEOUT_MS = 9 * 1000;

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

// A short recoverable lease replaces the old 15-minute lock.
// An abruptly canceled waitUntil() may never run a catch/finally block.
export async function acquireLock(db, { force = false } = {}) {
  const now = Date.now();
  const result = await db.prepare(
    "UPDATE zotero_sync_state SET lock_until = ?, last_attempt_at = ?, last_error = NULL " +
    "WHERE id = 1 AND (lock_until <= ? OR last_attempt_at < ?) AND " +
    "(? = 1 OR ((last_synced_at IS NULL OR last_synced_at < ?) AND " +
    "(last_attempt_at IS NULL OR last_attempt_at < CASE WHEN last_error IS NOT NULL THEN ? ELSE ? END)))"
  ).bind(
    Math.floor(now / 1000) + LOCK_SECONDS,
    new Date(now).toISOString(),
    Math.floor(now / 1000),
    new Date(now - STALE_LOCK_MS).toISOString(),
    force ? 1 : 0,
    new Date(now - REFRESH_INTERVAL_MS).toISOString(),
    new Date(now - RETRY_DELAY_MS).toISOString(),
    new Date(now - FAST_RETRY_MS).toISOString()
  ).run();
  return Number(result?.meta?.changes || 0) === 1;
}

// Store incremental pagination progress separately from the published snapshot.
// The table can initialize itself on first access: existing Cloudflare D1 data
// remains untouched and no additional console migration is mandatory.
async function ensureProgress(db) {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS zotero_sync_progress (" +
    "id INTEGER PRIMARY KEY CHECK(id=1), " +
    "staging_generation TEXT NOT NULL DEFAULT '', " +
    "upstream_offset INTEGER NOT NULL DEFAULT 0, " +
    "expected_total INTEGER NOT NULL DEFAULT -1, " +
    "source_version INTEGER NOT NULL DEFAULT 0, " +
    "updated_at TEXT)"
  ).run();
  await db.prepare("INSERT OR IGNORE INTO zotero_sync_progress (id) VALUES (1)").run();
}

export async function readProgress(db) {
  try {
    return await db.prepare(
      "SELECT staging_generation,upstream_offset,expected_total,updated_at " +
      "FROM zotero_sync_progress WHERE id=1"
    ).first();
  } catch (error) {
    if (String(error).includes("no such table")) return null;
    throw error;
  }
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

// A single parameterized JSON1 INSERT replaces 100 separate D1 writes.
// On Cloudflare Free, one Worker invocation can make only 50 D1 queries.
function stagePageStatement(db, rows, generation) {
  if (!rows.length) return null;
  const select = [
    "json_extract(j.value,'$.zotero_key')",
    "?",
    "CAST(json_extract(j.value,'$.item_version') AS INTEGER)",
    "json_extract(j.value,'$.item_type')",
    "json_extract(j.value,'$.title')",
    "json_extract(j.value,'$.authors')",
    "json_extract(j.value,'$.publication_title')",
    "json_extract(j.value,'$.item_year')",
    "json_extract(j.value,'$.doi')",
    "json_extract(j.value,'$.url')",
    "json_extract(j.value,'$.abstract')",
    "json_extract(j.value,'$.tags_json')",
    "json_extract(j.value,'$.zotero_url')",
    "json_extract(j.value,'$.date_modified')"
  ].join(", ");
  const query = "INSERT INTO zotero_items (" +
    "zotero_key,generation,item_version,item_type,title,authors,publication_title,item_year," +
    "doi,url,abstract,tags_json,zotero_url,date_modified) " +
    "SELECT " + select + " FROM json_each(?) AS j WHERE 1=1 " +
    "ON CONFLICT(zotero_key,generation) DO UPDATE SET " +
    "item_version=excluded.item_version,item_type=excluded.item_type,title=excluded.title," +
    "authors=excluded.authors,publication_title=excluded.publication_title," +
    "item_year=excluded.item_year,doi=excluded.doi,url=excluded.url," +
    "abstract=excluded.abstract,tags_json=excluded.tags_json," +
    "zotero_url=excluded.zotero_url,date_modified=excluded.date_modified";
  return db.prepare(query).bind(generation, JSON.stringify(rows));
}

async function fetchZoteroPage(path, headers, offset) {
  const endpoint = new URL(API_BASE + path);
  endpoint.searchParams.set("format", "json");
  endpoint.searchParams.set("limit", String(PAGE_SIZE));
  endpoint.searchParams.set("start", String(offset));
  endpoint.searchParams.set("sort", "dateModified");
  endpoint.searchParams.set("direction", "asc");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint.href, {
      method:"GET", headers, redirect:"error", signal:controller.signal
    });
    if (!response.ok) {
      if ([401,403,404].includes(response.status)) {
        throw new Error("Zotero API 返回 " + response.status +
          "。请检查群组是否允许公开读取，以及 Cloudflare ZOTERO_API_KEY Secret 的群组读取权限");
      }
      if (response.status === 429) {
        throw new Error("Zotero API 限流（429），请稍后重试");
      }
      throw new Error("Zotero API HTTP " + response.status);
    }
    const items = await response.json();
    if (!Array.isArray(items)) throw new Error("Zotero 返回了非数组数据");
    const totalHeader = response.headers.get("Total-Results");
    const totalValue = totalHeader === null ? -1 : Number(totalHeader);
    const version = Number(response.headers.get("Last-Modified-Version") || 0);
    return {
      items,
      total:Number.isSafeInteger(totalValue) && totalValue >= 0 ? totalValue : -1,
      version:Number.isSafeInteger(version) ? version : 0
    };
  } finally {
    clearTimeout(timer);
  }
}

// Each invocation handles no more than two upstream pages. Data is persisted
// in a staging snapshot; the published generation switches only on completion.
// This makes Cloudflare waitUntil's 30s ceiling non-destructive.
export async function syncGroup(db, env) {
  try {
    const path = apiPath(env);
    const headers = upstreamHeaders(env);
    await ensureProgress(db);
    let progress = await db.prepare(
      "SELECT staging_generation,upstream_offset,expected_total,source_version " +
      "FROM zotero_sync_progress WHERE id=1"
    ).first();

    if (!progress?.staging_generation) {
      const generation = crypto.randomUUID();
      await db.prepare(
        "UPDATE zotero_sync_progress SET staging_generation=?, upstream_offset=0," +
        "expected_total=-1,source_version=0,updated_at=? WHERE id=1"
      ).bind(generation,new Date().toISOString()).run();
      progress = {staging_generation:generation,upstream_offset:0,expected_total:-1,source_version:0};
    }
    const generation = progress.staging_generation;
    let offset = Number(progress.upstream_offset || 0);
    let total = Number(progress.expected_total ?? -1);
    let version = Number(progress.source_version || 0);
    let completed = false;

    for (let page = 0; page < CHUNK_PAGES; page++) {
      if (offset >= MAX_PAGES * PAGE_SIZE) {
        throw new Error("已达到 10,000 条同步上限，旧缓存仍被保留");
      }
      const nextPage = await fetchZoteroPage(path,headers,offset);
      if (version && nextPage.version && version !== nextPage.version) {
        // Restart the staging snapshot if the source changed mid-pagination.
        await db.batch([
          db.prepare("DELETE FROM zotero_items WHERE generation=?").bind(generation),
          db.prepare(
            "UPDATE zotero_sync_progress SET upstream_offset=0,expected_total=-1," +
            "source_version=0,updated_at=? WHERE id=1"
          ).bind(new Date().toISOString())
        ]);
        throw new Error("Zotero 文献库正在变化，已重置本轮暂存快照");
      }
      if (!version) version = nextPage.version;
      if (nextPage.total >= 0) total = nextPage.total;
      if (total > MAX_PAGES * PAGE_SIZE) {
        throw new Error("群组文献超过 10,000 条单库同步上限");
      }
      if (nextPage.items.length === 0 && total > offset) {
        throw new Error("Zotero 分页数据异常，保持已缓存数据并等待重试");
      }
      const rows = nextPage.items.map(normalizeZoteroItem).filter(Boolean);
      offset += nextPage.items.length;
      const statements = [];
      const insert = stagePageStatement(db,rows,generation);
      if (insert) statements.push(insert);
      statements.push(db.prepare(
        "UPDATE zotero_sync_progress SET upstream_offset=?,expected_total=?," +
        "source_version=?,updated_at=? WHERE id=1 AND staging_generation=?"
      ).bind(offset,total,version,new Date().toISOString(),generation));
      await db.batch(statements);

      if (nextPage.items.length < PAGE_SIZE || (total >= 0 && offset >= total)) {
        completed = true;
        break;
      }
    }

    if (completed) {
      const count = await db.prepare(
        "SELECT COUNT(*) AS n FROM zotero_items WHERE generation=?"
      ).bind(generation).first();
      const saved = Number(count?.n || 0);
      await db.batch([
        db.prepare(
          "UPDATE zotero_sync_state SET active_generation=?, last_synced_at=?," +
          "last_error=NULL,lock_until=0,last_version=?,item_count=? WHERE id=1"
        ).bind(generation,new Date().toISOString(),version,saved),
        db.prepare(
          "UPDATE zotero_sync_progress SET staging_generation='',upstream_offset=0," +
          "expected_total=-1,source_version=0,updated_at=? WHERE id=1"
        ).bind(new Date().toISOString()),
        db.prepare("DELETE FROM zotero_items WHERE generation<>?").bind(generation)
      ]);
      return {ok:true,complete:true,count:saved,version};
    }

    await db.prepare(
      "UPDATE zotero_sync_state SET lock_until=0,last_error=NULL WHERE id=1"
    ).run();
    return {ok:true,complete:false,processed:offset,total};
  } catch(error) {
    const diagnostic = String(error?.message||"同步失败").slice(0,350);
    console.error("Zotero sync failed:",error);
    try {
      await db.prepare(
        "UPDATE zotero_sync_state SET lock_until=0,last_error=? WHERE id=1"
      ).bind(diagnostic).run();
    } catch(cleanupError) {
      console.error("Zotero sync status update failed:",cleanupError);
    }
    return {ok:false,error:diagnostic};
  }
}
