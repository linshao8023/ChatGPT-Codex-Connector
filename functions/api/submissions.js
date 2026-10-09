const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  }
});

const clean = (value) => typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : "";
const size = (value) => Array.from(value).length;
const invalidControls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function database(env) {
  return env && env.DB && typeof env.DB.prepare === "function" ? env.DB : null;
}

export async function onRequestGet({ env }) {
  const db = database(env);
  if (!db) {
    return json({ ok: false, error: "投稿功能尚未启用：站长需要完成 Cloudflare D1 绑定。" }, 503);
  }
  try {
    const { results } = await db.prepare(
      "SELECT id, title, summary, created_at FROM submissions WHERE status = 'approved' ORDER BY id DESC LIMIT 30"
    ).all();
    return json({ ok: true, submissions: results || [] });
  } catch (error) {
    console.error("D1 submissions GET failed", error);
    return json({ ok: false, error: "投稿数据库尚未初始化或暂时不可用。" }, 503);
  }
}

export async function onRequestPost({ request, env }) {
  const db = database(env);
  if (!db) {
    return json({ ok: false, error: "投稿功能尚未启用：站长需要完成 Cloudflare D1 绑定。" }, 503);
  }

  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ ok: false, error: "不允许跨站提交。" }, 403);
  }

  const type = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") {
    return json({ ok: false, error: "请使用 JSON 格式提交。" }, 415);
  }

  if (Number(request.headers.get("Content-Length") || 0) > 8192) {
    return json({ ok: false, error: "提交内容过长。" }, 413);
  }

  let body;
  try {
    const raw = await request.text();
    if (raw.length > 5000) return json({ ok: false, error: "提交内容过长。" }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: "提交内容格式错误。" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ ok: false, error: "提交内容格式错误。" }, 400);
  }

  // Invisible honeypot field: legitimate visitors leave this empty.
  if (typeof body.website === "string" && body.website.trim()) {
    return json({ ok: true, message: "已收到分享，审核通过后会公开展示。" }, 202);
  }

  const title = clean(body.title);
  const summary = clean(body.summary);
  if (size(title) < 2 || size(title) > 200) {
    return json({ ok: false, error: "文献名称应为 2–200 个字符。" }, 400);
  }
  if (size(summary) < 10 || size(summary) > 1200) {
    return json({ ok: false, error: "简要总结应为 10–1200 个字符。" }, 400);
  }
  if (invalidControls.test(title) || invalidControls.test(summary)) {
    return json({ ok: false, error: "提交内容包含不允许的控制字符。" }, 400);
  }

  try {
    // Hash IP rather than storing the raw address. Optional RATE_LIMIT_SALT secret
    // helps reduce guessability. The digest changes each UTC day.
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const day = new Date().toISOString().slice(0, 10);
    const salt = typeof env.RATE_LIMIT_SALT === "string" ? env.RATE_LIMIT_SALT : "material-notes-v1";
    const digest = await crypto.subtle.digest(
      "SHA-256", new TextEncoder().encode(salt + "|" + day + "|" + ip)
    );
    const hash = Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, "0")).join("");

    const recent = await db.prepare(
      "SELECT COUNT(*) AS total FROM submissions WHERE submitter_hash = ? AND created_at >= datetime('now', '-1 hour')"
    ).bind(hash).first();
    if (Number(recent?.total || 0) >= 3) {
      return json({ ok: false, error: "提交太频繁，请一小时后再试。" }, 429);
    }

    const repeated = await db.prepare(
      "SELECT id FROM submissions WHERE title = ? AND summary = ? AND created_at >= datetime('now', '-1 day') LIMIT 1"
    ).bind(title, summary).first();
    if (repeated) {
      return json({ ok: false, error: "这条内容最近已提交，请勿重复提交。" }, 409);
    }

    await db.prepare(
      "INSERT INTO submissions (title, summary, status, submitter_hash) VALUES (?, ?, 'pending', ?)"
    ).bind(title, summary, hash).run();
    return json({ ok: true, message: "提交成功！审核通过后会在“读者分享”区域公开展示。" }, 201);
  } catch (error) {
    console.error("D1 submissions POST failed", error);
    return json({ ok: false, error: "投稿保存失败，请稍后重试或联系站长。" }, 503);
  }
}