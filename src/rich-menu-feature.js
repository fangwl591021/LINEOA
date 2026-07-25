const FEATURE = "rich_menu";
const TRIAL_DAYS = 30;
const ANNUAL_PRICE_TWD = 199;
const encoder = new TextEncoder();

export async function handleRichMenuFeature(request, env, url, cors) {
  if (url.pathname === "/api/features/rich-menu" && request.method === "GET") {
    const auth = await requireUser(request, env);
    const entitlement = await getEntitlement(env, auth.user, true);
    return json({ ok: true, entitlement }, 200, cors);
  }

  if (url.pathname === "/api/features/rich-menu/deploy-authorize" && request.method === "POST") {
    const auth = await requireUser(request, env);
    const entitlement = await getEntitlement(env, auth.user, true);
    if (!entitlement.allowed) throw httpError(403, "30 天試用已結束，請開通 NT$199／年方案");
    await audit(env, auth.user.id, "rich_menu.deploy.authorized", entitlement.status);
    return json({ ok: true, entitlement }, 200, cors);
  }

  const activation = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/features\/rich-menu\/activate$/);
  if (activation && request.method === "POST") {
    const operator = await requireAdmin(request, env);
    const targetUserId = decodeURIComponent(activation[1]);
    const target = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(targetUserId).first();
    if (!target) throw httpError(404, "找不到指定使用者");
    const current = await env.DB.prepare(`
      SELECT subscription_ends_at FROM feature_entitlements
      WHERE user_id = ? AND feature = ?
    `).bind(targetUserId, FEATURE).first();
    const now = new Date();
    const currentEnd = Date.parse(current?.subscription_ends_at || "");
    const base = Number.isFinite(currentEnd) && currentEnd > now.getTime() ? new Date(currentEnd) : now;
    const subscriptionEndsAt = addYears(base, 1).toISOString();
    await env.DB.prepare(`
      INSERT INTO feature_entitlements (
        user_id, feature, subscription_started_at, subscription_ends_at, price_twd, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, feature) DO UPDATE SET
        subscription_started_at = CASE
          WHEN feature_entitlements.subscription_ends_at > excluded.subscription_started_at
            THEN feature_entitlements.subscription_started_at
          ELSE excluded.subscription_started_at
        END,
        subscription_ends_at = excluded.subscription_ends_at,
        price_twd = excluded.price_twd,
        updated_at = excluded.updated_at
    `).bind(
      targetUserId,
      FEATURE,
      now.toISOString(),
      subscriptionEndsAt,
      ANNUAL_PRICE_TWD,
      now.toISOString()
    ).run();
    await audit(env, operator.user.id, "rich_menu.subscription.activate", `${targetUserId}:${subscriptionEndsAt}`);
    const entitlement = await getEntitlement(env, { id: targetUserId, role: "user" }, false);
    return json({ ok: true, entitlement }, 200, cors);
  }

  return null;
}

async function getEntitlement(env, user, createTrial) {
  if (user.role === "admin") {
    return {
      feature: FEATURE,
      allowed: true,
      status: "admin",
      trialStartedAt: null,
      trialEndsAt: null,
      subscriptionEndsAt: null,
      daysRemaining: null,
      priceTwd: ANNUAL_PRICE_TWD,
      billingPeriod: "year"
    };
  }

  let row = await env.DB.prepare(`
    SELECT trial_started_at, trial_ends_at, subscription_started_at, subscription_ends_at, price_twd
    FROM feature_entitlements WHERE user_id = ? AND feature = ?
  `).bind(user.id, FEATURE).first();

  if (!row && createTrial) {
    const now = new Date();
    const trialEndsAt = addDays(now, TRIAL_DAYS).toISOString();
    await env.DB.prepare(`
      INSERT INTO feature_entitlements (
        user_id, feature, trial_started_at, trial_ends_at, price_twd, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, feature) DO NOTHING
    `).bind(user.id, FEATURE, now.toISOString(), trialEndsAt, ANNUAL_PRICE_TWD, now.toISOString()).run();
    row = await env.DB.prepare(`
      SELECT trial_started_at, trial_ends_at, subscription_started_at, subscription_ends_at, price_twd
      FROM feature_entitlements WHERE user_id = ? AND feature = ?
    `).bind(user.id, FEATURE).first();
    await audit(env, user.id, "rich_menu.trial.started", trialEndsAt);
  }

  const nowMs = Date.now();
  const subscriptionEndMs = Date.parse(row?.subscription_ends_at || "");
  const trialEndMs = Date.parse(row?.trial_ends_at || "");
  const paidActive = Number.isFinite(subscriptionEndMs) && subscriptionEndMs > nowMs;
  const trialActive = Number.isFinite(trialEndMs) && trialEndMs > nowMs;
  const activeUntil = paidActive ? subscriptionEndMs : trialActive ? trialEndMs : 0;
  return {
    feature: FEATURE,
    allowed: paidActive || trialActive,
    status: paidActive ? "paid" : trialActive ? "trial" : "expired",
    trialStartedAt: row?.trial_started_at || null,
    trialEndsAt: row?.trial_ends_at || null,
    subscriptionEndsAt: row?.subscription_ends_at || null,
    daysRemaining: activeUntil ? Math.max(0, Math.ceil((activeUntil - nowMs) / 86400000)) : 0,
    priceTwd: Number(row?.price_twd || ANNUAL_PRICE_TWD),
    billingPeriod: "year"
  };
}

async function requireUser(request, env) {
  if (!env.DB) throw httpError(503, "資料庫尚未完成設定");
  const token = bearerToken(request);
  if (!token) throw httpError(401, "請先登入");
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(`
    SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? LIMIT 1
  `).bind(tokenHash).first();
  if (!row || row.status !== "active" || Date.parse(row.expires_at) <= Date.now()) {
    throw httpError(401, "登入狀態已失效，請重新登入");
  }
  await env.DB.prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?")
    .bind(new Date().toISOString(), tokenHash).run();
  return { user: row, tokenHash };
}

async function requireAdmin(request, env) {
  const auth = await requireUser(request, env);
  if (auth.user.role !== "admin") throw httpError(403, "需要平台管理員權限");
  return auth;
}

async function audit(env, userId, action, detail = "") {
  await env.DB.prepare(`
    INSERT INTO audit_logs (id, user_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?)
  `).bind(crypto.randomUUID(), userId || null, action, cleanText(detail, 500), new Date().toISOString()).run();
}

function addDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function addYears(date, years) {
  const result = new Date(date);
  result.setUTCFullYear(result.getUTCFullYear() + years);
  return result;
}

function bearerToken(request) {
  const auth = request.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(String(value)));
  return base64Url(new Uint8Array(digest));
}

function base64Url(bytes) {
  let binary = "";
  bytes.forEach((byte) => binary += String.fromCharCode(byte));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function cleanText(value, max) {
  return String(value || "").replace(/\u0000/g, "").trim().slice(0, max);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function json(payload, status = 200, extra = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra }
  });
}
