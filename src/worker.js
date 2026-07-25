import { handleRichMenuFeature } from "./rich-menu-feature.js";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const encoder = new TextEncoder();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    try {
      const richMenuResponse = await handleRichMenuFeature(request, env, url, cors);
      if (richMenuResponse) return richMenuResponse;
      if (url.pathname === "/health") {
        return json({ ok: true, service: "lineoa-saas", version: "0.1.2" }, 200, cors);
      }
      if (url.pathname === "/api/auth/register" && request.method === "POST") {
        return await register(request, env, cors);
      }
      if (url.pathname === "/api/auth/login" && request.method === "POST") {
        return await login(request, env, cors);
      }
      if (url.pathname === "/api/auth/me" && request.method === "GET") {
        const auth = await requireUser(request, env);
        return json({ ok: true, user: publicUser(auth.user), limits: planLimits(env, auth.user) }, 200, cors);
      }
      if (url.pathname === "/api/auth/logout" && request.method === "POST") {
        const auth = await requireUser(request, env);
        await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(auth.tokenHash).run();
        await audit(env, auth.user.id, "logout");
        return json({ ok: true }, 200, cors);
      }
      if (url.pathname === "/api/knowledge" && request.method === "GET") {
        const auth = await requireUser(request, env);
        const rows = await env.DB.prepare(`
          SELECT id, category, question, answer, created_at, updated_at
          FROM knowledge_items WHERE user_id = ? ORDER BY updated_at DESC
        `).bind(auth.user.id).all();
        return json({
          ok: true,
          items: rows.results || [],
          usage: { current: rows.results?.length || 0, limit: planLimits(env, auth.user).knowledgeItems }
        }, 200, cors);
      }
      if (url.pathname === "/api/knowledge" && request.method === "POST") {
        const auth = await requireUser(request, env);
        return await saveKnowledge(request, env, cors, auth.user);
      }
      if (url.pathname.startsWith("/api/knowledge/") && request.method === "DELETE") {
        const auth = await requireUser(request, env);
        const id = decodeURIComponent(url.pathname.slice("/api/knowledge/".length));
        await env.DB.prepare("DELETE FROM knowledge_items WHERE id = ? AND user_id = ?")
          .bind(id, auth.user.id).run();
        await audit(env, auth.user.id, "knowledge.delete", id);
        return json({ ok: true }, 200, cors);
      }
      if (url.pathname === "/api/crm/contacts" && request.method === "GET") {
        const auth = await requireUser(request, env);
        return await listCrmContacts(env, cors, auth.user);
      }
      if (url.pathname === "/api/crm/contacts/upsert" && request.method === "POST") {
        const auth = await requireUser(request, env);
        return await upsertCrmContact(request, env, cors, auth.user);
      }
      if (url.pathname.startsWith("/api/crm/contacts/") && request.method === "PATCH") {
        const auth = await requireUser(request, env);
        const id = decodeURIComponent(url.pathname.slice("/api/crm/contacts/".length));
        return await updateCrmContact(request, env, cors, auth.user, id);
      }
      if (url.pathname === "/api/admin/summary" && request.method === "GET") {
        const auth = await requireAdmin(request, env);
        const [users, knowledge, sessions] = await Promise.all([
          env.DB.prepare("SELECT COUNT(*) total FROM users").first(),
          env.DB.prepare("SELECT COUNT(*) total FROM knowledge_items").first(),
          env.DB.prepare("SELECT COUNT(*) total FROM sessions WHERE expires_at > ?").bind(new Date().toISOString()).first()
        ]);
        return json({
          ok: true,
          summary: {
            users: Number(users?.total || 0),
            freeUsers: Number(users?.total || 0),
            knowledgeItems: Number(knowledge?.total || 0),
            activeSessions: Number(sessions?.total || 0)
          },
          operator: publicUser(auth.user)
        }, 200, cors);
      }
      if (url.pathname === "/api/admin/users" && request.method === "GET") {
        await requireAdmin(request, env);
        const rows = await env.DB.prepare(`
          SELECT u.id, u.email, u.display_name, u.company_name, u.role, u.plan, u.status, u.created_at,
                 COUNT(k.id) knowledge_count,
                 f.trial_ends_at rich_menu_trial_ends_at,
                 f.subscription_ends_at rich_menu_subscription_ends_at
          FROM users u
          LEFT JOIN knowledge_items k ON k.user_id = u.id
          LEFT JOIN feature_entitlements f ON f.user_id = u.id AND f.feature = 'rich_menu'
          GROUP BY u.id ORDER BY u.created_at DESC LIMIT 500
        `).all();
        return json({ ok: true, users: rows.results || [] }, 200, cors);
      }
      if (url.pathname === "/api/admin/audit" && request.method === "GET") {
        await requireAdmin(request, env);
        const rows = await env.DB.prepare(`
          SELECT a.id, a.action, a.detail, a.created_at, u.email
          FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
          ORDER BY a.created_at DESC LIMIT 200
        `).all();
        return json({ ok: true, logs: rows.results || [] }, 200, cors);
      }
      if (url.pathname === "/privacy") return html(privacyPage(env));
      if (url.pathname === "/admin") {
        await requireAdmin(request, env);
        return html(appPage(env, "admin"));
      }
      if (url.pathname === "/app" || url.pathname === "/") return html(appPage(env, "app"));
      return json({ ok: false, message: "Not found" }, 404, cors);
    } catch (error) {
      const status = Number(error?.status || 500);
      return json({
        ok: false,
        message: status >= 500 ? "系統暫時無法處理，請稍後再試" : String(error?.message || "Request failed")
      }, status, cors);
    }
  }
};

async function register(request, env, cors) {
  assertDb(env);
  const body = await safeJson(request);
  const email = normalizeEmail(body.email);
  const displayName = cleanText(body.displayName, 80);
  const companyName = cleanText(body.companyName, 120);
  const password = String(body.password || "");
  if (!email) throw httpError(400, "請輸入有效的 Email");
  if (displayName.length < 2) throw httpError(400, "姓名至少需要 2 個字");
  if (password.length < 8) throw httpError(400, "密碼至少需要 8 個字元");

  const exists = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (exists) throw httpError(409, "此 Email 已完成註冊，請直接登入");

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const salt = randomToken(18);
  const passwordHash = await derivePassword(password, salt);
  const role = adminEmails(env).has(email) ? "admin" : "user";
  await env.DB.prepare(`
    INSERT INTO users (id, email, display_name, company_name, password_salt, password_hash, role, plan, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'free', 'active', ?, ?)
  `).bind(id, email, displayName, companyName, salt, passwordHash, role, now, now).run();
  const session = await createSession(env, id);
  const user = { id, email, display_name: displayName, company_name: companyName, role, plan: "free", status: "active", created_at: now };
  await audit(env, id, "register", "free");
  return json({ ok: true, token: session.token, expiresAt: session.expiresAt, user: publicUser(user), limits: planLimits(env, user) }, 201, cors);
}

async function login(request, env, cors) {
  assertDb(env);
  const body = await safeJson(request);
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  const user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  if (!user || user.status !== "active") throw httpError(401, "帳號或密碼錯誤");
  const passwordHash = await derivePassword(password, user.password_salt);
  if (!constantTimeEqual(passwordHash, user.password_hash)) throw httpError(401, "帳號或密碼錯誤");
  const session = await createSession(env, user.id);
  await audit(env, user.id, "login");
  return json({ ok: true, token: session.token, expiresAt: session.expiresAt, user: publicUser(user), limits: planLimits(env, user) }, 200, cors);
}

async function saveKnowledge(request, env, cors, user) {
  const body = await safeJson(request);
  const incoming = Array.isArray(body.items) ? body.items : [body];
  if (!incoming.length || incoming.length > 100) throw httpError(400, "每次可寫入 1 至 100 筆資料");
  const existing = await env.DB.prepare("SELECT COUNT(*) total FROM knowledge_items WHERE user_id = ?")
    .bind(user.id).first();
  const limit = planLimits(env, user).knowledgeItems;
  const normalized = incoming.map((item) => ({
    id: cleanText(item.id, 80) || crypto.randomUUID(),
    category: cleanText(item.category, 80),
    question: cleanText(item.question, 500),
    answer: cleanText(item.answer, 4000)
  }));
  if (normalized.some((item) => !item.question || !item.answer)) {
    throw httpError(400, "每筆知識都必須包含問題與回答");
  }
  const ids = new Set(normalized.map((item) => item.id));
  const currentIds = normalized.length
    ? await env.DB.prepare(`SELECT id FROM knowledge_items WHERE user_id = ? AND id IN (${normalized.map(() => "?").join(",")})`)
      .bind(user.id, ...normalized.map((item) => item.id)).all()
    : { results: [] };
  const updateCount = (currentIds.results || []).filter((row) => ids.has(row.id)).length;
  if (Number(existing?.total || 0) - updateCount + normalized.length > limit) {
    throw httpError(403, `免費方案最多可建立 ${limit} 筆知識`);
  }
  const now = new Date().toISOString();
  const statements = normalized.map((item) => env.DB.prepare(`
    INSERT INTO knowledge_items (id, user_id, category, question, answer, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      category = excluded.category,
      question = excluded.question,
      answer = excluded.answer,
      updated_at = excluded.updated_at
    WHERE knowledge_items.user_id = excluded.user_id
  `).bind(item.id, user.id, item.category, item.question, item.answer, now, now));
  await env.DB.batch(statements);
  await audit(env, user.id, "knowledge.save", String(normalized.length));
  const total = await env.DB.prepare("SELECT COUNT(*) total FROM knowledge_items WHERE user_id = ?").bind(user.id).first();
  return json({ ok: true, saved: normalized.length, usage: { current: Number(total?.total || 0), limit } }, 200, cors);
}

async function listCrmContacts(env, cors, user) {
  const rows = await env.DB.prepare(`
    SELECT id, line_uid, display_name, avatar_url, phone, email, tags_json, notes,
           status, source, first_seen_at, last_seen_at, last_chat_at, created_at, updated_at
    FROM crm_contacts
    WHERE user_id = ?
    ORDER BY last_seen_at DESC
    LIMIT 1000
  `).bind(user.id).all();
  const contacts = (rows.results || []).map(publicCrmContact);
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  return json({
    ok: true,
    contacts,
    summary: {
      total: contacts.length,
      newThisMonth: contacts.filter((item) => Date.parse(item.createdAt) >= monthStart.getTime()).length,
      active: contacts.filter((item) => item.status === "active").length,
      tagged: contacts.filter((item) => item.tags.length > 0).length
    }
  }, 200, cors);
}

async function upsertCrmContact(request, env, cors, user) {
  const body = await safeJson(request);
  const lineUid = cleanText(body.lineUid, 80);
  const displayName = cleanText(body.displayName, 120);
  const avatarUrl = cleanHttpsUrl(body.avatarUrl, 1200);
  if (!/^U[0-9a-f]{32}$/i.test(lineUid)) throw httpError(400, "找不到有效的 LINE UID");
  if (!displayName && !avatarUrl) throw httpError(400, "找不到可辨識的聯絡人資料");
  const existing = await env.DB.prepare(
    "SELECT id FROM crm_contacts WHERE user_id = ? AND line_uid = ? LIMIT 1"
  ).bind(user.id, lineUid).first();
  const now = new Date().toISOString();
  const id = existing?.id || crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO crm_contacts (
      id, user_id, line_uid, display_name, avatar_url, status, source,
      first_seen_at, last_seen_at, last_chat_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, 'active', 'chat_auto_capture', ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, line_uid) DO UPDATE SET
      display_name = CASE WHEN excluded.display_name <> '' THEN excluded.display_name ELSE crm_contacts.display_name END,
      avatar_url = CASE WHEN excluded.avatar_url <> '' THEN excluded.avatar_url ELSE crm_contacts.avatar_url END,
      last_seen_at = excluded.last_seen_at,
      last_chat_at = excluded.last_chat_at,
      updated_at = excluded.updated_at
  `).bind(id, user.id, lineUid, displayName, avatarUrl, now, now, now, now, now).run();
  await audit(env, user.id, existing ? "crm.contact.refresh" : "crm.contact.create", lineUid);
  const contact = await env.DB.prepare(
    `SELECT id, line_uid, display_name, avatar_url, phone, email, tags_json, notes,
            status, source, first_seen_at, last_seen_at, last_chat_at, created_at, updated_at
     FROM crm_contacts WHERE id = ? AND user_id = ?`
  ).bind(id, user.id).first();
  return json({ ok: true, created: !existing, contact: publicCrmContact(contact) }, existing ? 200 : 201, cors);
}

async function updateCrmContact(request, env, cors, user, id) {
  if (!id || id.length > 80) throw httpError(400, "CRM 聯絡人識別碼無效");
  const existing = await env.DB.prepare(
    "SELECT id FROM crm_contacts WHERE id = ? AND user_id = ? LIMIT 1"
  ).bind(id, user.id).first();
  if (!existing) throw httpError(404, "找不到 CRM 聯絡人");
  const body = await safeJson(request);
  const displayName = cleanText(body.displayName, 120);
  const phone = cleanText(body.phone, 40);
  const email = cleanText(body.email, 254).toLowerCase();
  const notes = cleanText(body.notes, 3000);
  const status = body.status === "archived" ? "archived" : "active";
  const tags = Array.isArray(body.tags)
    ? [...new Set(body.tags.map((tag) => cleanText(tag, 40)).filter(Boolean))].slice(0, 20)
    : [];
  if (!displayName) throw httpError(400, "請輸入客戶名稱");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, "Email 格式不正確");
  const now = new Date().toISOString();
  await env.DB.prepare(`
    UPDATE crm_contacts
    SET display_name = ?, phone = ?, email = ?, tags_json = ?, notes = ?, status = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
  `).bind(displayName, phone, email, JSON.stringify(tags), notes, status, now, id, user.id).run();
  await audit(env, user.id, "crm.contact.update", id);
  const contact = await env.DB.prepare(
    `SELECT id, line_uid, display_name, avatar_url, phone, email, tags_json, notes,
            status, source, first_seen_at, last_seen_at, last_chat_at, created_at, updated_at
     FROM crm_contacts WHERE id = ? AND user_id = ?`
  ).bind(id, user.id).first();
  return json({ ok: true, contact: publicCrmContact(contact) }, 200, cors);
}

function publicCrmContact(row) {
  let tags = [];
  try {
    const parsed = JSON.parse(String(row?.tags_json || "[]"));
    if (Array.isArray(parsed)) tags = parsed.map((tag) => cleanText(tag, 40)).filter(Boolean).slice(0, 20);
  } catch {
    tags = [];
  }
  return {
    id: String(row?.id || ""),
    lineUid: String(row?.line_uid || ""),
    displayName: String(row?.display_name || ""),
    avatarUrl: String(row?.avatar_url || ""),
    phone: String(row?.phone || ""),
    email: String(row?.email || ""),
    tags,
    notes: String(row?.notes || ""),
    status: row?.status === "archived" ? "archived" : "active",
    source: String(row?.source || ""),
    firstSeenAt: String(row?.first_seen_at || ""),
    lastSeenAt: String(row?.last_seen_at || ""),
    lastChatAt: String(row?.last_chat_at || ""),
    createdAt: String(row?.created_at || ""),
    updatedAt: String(row?.updated_at || "")
  };
}

async function requireUser(request, env) {
  assertDb(env);
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
  env.DB.prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?")
    .bind(new Date().toISOString(), tokenHash).run().catch(() => {});
  return { user: row, tokenHash };
}

async function requireAdmin(request, env) {
  const auth = await requireUser(request, env);
  if (auth.user.role !== "admin") throw httpError(403, "需要平台管理員權限");
  return auth;
}

async function createSession(env, userId) {
  const token = randomToken(36);
  const tokenHash = await sha256(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString();
  await env.DB.prepare(`
    INSERT INTO sessions (token_hash, user_id, expires_at, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(tokenHash, userId, expiresAt, now.toISOString(), now.toISOString()).run();
  return { token, expiresAt };
}

async function audit(env, userId, action, detail = "") {
  if (!env.DB) return;
  await env.DB.prepare(`
    INSERT INTO audit_logs (id, user_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?)
  `).bind(crypto.randomUUID(), userId || null, action, cleanText(detail, 500), new Date().toISOString()).run();
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    companyName: user.company_name || "",
    role: user.role,
    plan: user.plan,
    status: user.status,
    createdAt: user.created_at
  };
}

function planLimits(env, user) {
  return {
    knowledgeItems: user.plan === "free" ? clampInt(env.FREE_KNOWLEDGE_LIMIT || 100, 1, 1000) : 1000,
    visibleMessages: user.plan === "free" ? 5 : 20,
    cloudSync: true,
    lineMessagingApi: false,
    autoSend: false
  };
}

function appPage(env, mode) {
  const appName = escapeHtml(env.APP_NAME || "LINEOA");
  return `<!doctype html>
<html lang="zh-TW">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${appName} SaaS</title>
  <style>
    :root{--line:#06c755;--ink:#172033;--muted:#64748b;--border:#e2e8f0;--soft:#f0fdf4;--bg:#f8fafc}
    *{box-sizing:border-box}body{margin:0;background:#fff;color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    button,input,textarea{font:inherit}.hidden{display:none!important}.shell{min-height:100vh;display:flex}.sidebar{position:fixed;inset:0 auto 0 0;width:240px;background:#fff;border-right:1px solid #f1f5f9;display:flex;flex-direction:column;z-index:10}
    .brand{padding:24px;font-size:22px;font-weight:900;color:var(--line)}.nav{flex:1;overflow:auto}.group{padding:14px 24px 6px;color:var(--line);font-size:14px;font-weight:800}.nav button{width:100%;border:0;background:#fff;display:flex;gap:12px;padding:14px 24px;color:var(--muted);font-weight:750;cursor:pointer;border-right:4px solid transparent;text-align:left}.nav button.active{background:var(--soft);color:var(--line);border-right-color:var(--line)}
    .sidebar-foot{padding:16px;border-top:1px solid #f1f5f9}.main{margin-left:240px;min-width:0;flex:1;background:#fff}.header{height:74px;padding:16px 28px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #f1f5f9;position:sticky;top:0;background:#fff;z-index:5}.header h1{font-size:24px;margin:0}.status{display:flex;gap:8px;align-items:center;padding:9px 12px;border:1px solid #bbf7d0;border-radius:8px;background:var(--soft);color:#15803d;font-size:13px;font-weight:800}.dot{width:8px;height:8px;border-radius:50%;background:var(--line)}
    .content{padding:28px}.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px}.card{padding:24px;border:1px solid var(--border);border-radius:14px;background:#fff;box-shadow:0 1px 2px #0f172a0a}.label{font-size:13px;font-weight:800;color:#94a3b8}.value{font-size:28px;font-weight:900;margin-top:8px}.panel{margin-top:22px;border:1px solid var(--border);border-radius:14px;overflow:hidden}.panel-head{display:flex;justify-content:space-between;align-items:center;padding:18px 22px;border-bottom:1px solid var(--border)}.panel-head h2{margin:0;font-size:18px}.panel-body{padding:22px}
    .btn{border:1px solid var(--border);background:#fff;border-radius:8px;padding:10px 16px;font-weight:800;cursor:pointer}.btn-primary{background:var(--line);border-color:var(--line);color:#fff}.btn-danger{color:#dc2626}.field{display:grid;gap:6px;margin-bottom:14px}.field label{font-size:13px;color:var(--muted);font-weight:800}.field input,.field textarea{width:100%;border:1px solid #cbd5e1;border-radius:8px;padding:11px 13px;outline:none}.field input:focus,.field textarea:focus{border-color:var(--line);box-shadow:0 0 0 3px #06c7551a}.auth{min-height:100vh;display:grid;place-items:center;background:var(--bg);padding:20px}.auth-card{width:min(430px,100%);background:#fff;border:1px solid var(--border);border-radius:18px;padding:30px;box-shadow:0 18px 50px #0f172a12}.auth-card h1{margin:0;color:var(--line)}.tabs{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:22px 0}.tabs button{padding:10px;border:0;border-radius:8px;font-weight:800}.tabs button.active{background:var(--soft);color:var(--line)}
    .notice{padding:12px 14px;border-radius:8px;background:#eff6ff;color:#1d4ed8;font-size:13px;font-weight:700;margin-bottom:16px}.error{background:#fef2f2;color:#b91c1c}.knowledge-form{display:grid;grid-template-columns:160px 1fr 1.4fr auto;gap:10px;align-items:end}.knowledge-list{display:grid;gap:10px;margin-top:18px}.knowledge-row{display:grid;grid-template-columns:140px 1fr 1.4fr auto;gap:14px;padding:14px;border:1px solid var(--border);border-radius:10px;align-items:start}.muted{color:var(--muted);font-size:13px}.pill{display:inline-flex;padding:5px 9px;border-radius:999px;background:var(--soft);color:#15803d;font-size:12px;font-weight:900}table{width:100%;border-collapse:collapse}th,td{padding:14px 16px;border-bottom:1px solid #f1f5f9;text-align:left;font-size:14px}th{color:var(--muted);font-size:12px}.mobile-nav{display:none}
    @media(max-width:900px){.sidebar{transform:translateX(-100%)}.main{margin-left:0}.cards{grid-template-columns:1fr 1fr}.knowledge-form,.knowledge-row{grid-template-columns:1fr}.mobile-nav{display:block}.content{padding:18px}}
  </style>
</head>
<body data-mode="${mode}">
  <section id="auth" class="auth">
    <div class="auth-card">
      <h1>${appName}</h1><p class="muted">安裝擴充功能、完成註冊，即可使用免費版。</p>
      <div class="tabs"><button id="tab-register" class="active">免費註冊</button><button id="tab-login">登入</button></div>
      <div id="message" class="notice hidden"></div>
      <form id="auth-form">
        <div id="register-fields"><div class="field"><label>姓名</label><input id="displayName" autocomplete="name"></div><div class="field"><label>公司／品牌</label><input id="companyName" autocomplete="organization"></div></div>
        <div class="field"><label>Email</label><input id="email" type="email" autocomplete="email" required></div>
        <div class="field"><label>密碼</label><input id="password" type="password" minlength="8" autocomplete="current-password" required></div>
        <button class="btn btn-primary" style="width:100%">繼續</button>
      </form>
    </div>
  </section>
  <section id="workspace" class="shell hidden">
    <aside class="sidebar"><div class="brand">${appName}</div><nav id="nav" class="nav"></nav><div class="sidebar-foot"><button id="logout" class="btn" style="width:100%">安全登出</button></div></aside>
    <main class="main"><header class="header"><h1 id="page-title">營運總覽</h1><div class="status"><span class="dot"></span><span>免費方案正常</span></div></header><div id="content" class="content"></div></main>
  </section>
<script>
const TOKEN_KEY="lineoa_token",LEGACY_TOKEN_KEY="linepilot_token";
const API="", state={token:localStorage.getItem(TOKEN_KEY)||localStorage.getItem(LEGACY_TOKEN_KEY)||"",user:null,view:"dashboard",authMode:"register",knowledge:[],adminSummary:null,adminUsers:[],audit:[]};
const $=id=>document.getElementById(id); const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function showMessage(text,error=false){const el=$("message");el.textContent=text;el.className="notice"+(error?" error":"");}
async function request(path,options={}){const headers={"content-type":"application/json",...(options.headers||{})};if(state.token)headers.authorization="Bearer "+state.token;const res=await fetch(API+path,{...options,headers});const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.message||"操作失敗");return data}
function setAuthMode(mode){state.authMode=mode;$("tab-register").classList.toggle("active",mode==="register");$("tab-login").classList.toggle("active",mode==="login");$("register-fields").classList.toggle("hidden",mode!=="register")}
$("tab-register").onclick=()=>setAuthMode("register");$("tab-login").onclick=()=>setAuthMode("login");
$("auth-form").onsubmit=async event=>{event.preventDefault();try{const body={email:$("email").value,password:$("password").value,displayName:$("displayName").value,companyName:$("companyName").value};const data=await request("/api/auth/"+state.authMode,{method:"POST",body:JSON.stringify(body)});state.token=data.token;localStorage.setItem(TOKEN_KEY,data.token);localStorage.removeItem(LEGACY_TOKEN_KEY);state.user=data.user;enter()}catch(error){showMessage(error.message,true)}};
$("logout").onclick=async()=>{try{await request("/api/auth/logout",{method:"POST"})}catch{}localStorage.removeItem(TOKEN_KEY);localStorage.removeItem(LEGACY_TOKEN_KEY);location.reload()};
function navItems(){const base=[["dashboard","▣","營運總覽"],["knowledge","▤","我的知識庫"],["extension","⬡","擴充功能"],["plan","◇","方案與帳戶"]];if(state.user?.role==="admin")base.push(["admin-users","♙","使用者管理"],["admin-plans","＄","方案管理"],["admin-versions","⬆","版本管理"],["admin-audit","☷","操作紀錄"],["admin-settings","⚙","系統設定"]);return base}
function renderNav(){const adminIndex=navItems().findIndex(x=>x[0]==="admin-users");$("nav").innerHTML=navItems().map((item,index)=>(index===0?'<div class="group">📦 營運中心</div>':index===adminIndex?'<div class="group">🛠️ 平台管理</div>':"")+'<button data-view="'+item[0]+'" class="'+(state.view===item[0]?"active":"")+'"><span>'+item[1]+'</span>'+item[2]+'</button>').join("");$("nav").querySelectorAll("button").forEach(button=>button.onclick=()=>{state.view=button.dataset.view;render()})}
async function enter(){$("auth").classList.add("hidden");$("workspace").classList.remove("hidden");await loadMe();if(document.body.dataset.mode==="admin"&&state.user.role==="admin")state.view="admin-users";render()}
async function loadMe(){const data=await request("/api/auth/me");state.user=data.user;state.limits=data.limits}
async function loadKnowledge(){const data=await request("/api/knowledge");state.knowledge=data.items||[];state.knowledgeUsage=data.usage}
async function loadAdmin(){const [s,u]=await Promise.all([request("/api/admin/summary"),request("/api/admin/users")]);state.adminSummary=s.summary;state.adminUsers=u.users||[]}
function dashboard(){return '<div class="cards"><div class="card"><div class="label">目前方案</div><div class="value">免費版</div></div><div class="card"><div class="label">知識庫</div><div class="value">'+(state.knowledgeUsage?.current||0)+' / '+(state.limits?.knowledgeItems||100)+'</div></div><div class="card"><div class="label">最近對話讀取</div><div class="value">'+(state.limits?.visibleMessages||5)+' 則</div></div><div class="card"><div class="label">LINE API</div><div class="value">不需要</div></div></div><div class="panel"><div class="panel-head"><h2>免費版啟用完成</h2><span class="pill">可使用</span></div><div class="panel-body"><p>安裝 LINEOA 後，在 LINE OA 聊天室即可讀取目前可見對話，並依照您的知識庫產生回覆建議。</p><p class="muted">所有建議都必須由使用者人工確認、複製並貼回 LINE；系統不會自動發送訊息。</p></div></div>'}
function knowledgeView(){return '<div class="panel" style="margin-top:0"><div class="panel-head"><div><h2>我的知識庫</h2><div class="muted">免費版最多 '+(state.limits?.knowledgeItems||100)+' 筆</div></div><span class="pill">'+(state.knowledgeUsage?.current||0)+' / '+(state.knowledgeUsage?.limit||100)+'</span></div><div class="panel-body"><form id="knowledge-form" class="knowledge-form"><div class="field"><label>分類</label><input id="k-category" placeholder="例如：商品"></div><div class="field"><label>問題</label><input id="k-question" required placeholder="客戶會怎麼問"></div><div class="field"><label>標準回答</label><textarea id="k-answer" rows="2" required placeholder="公司核准的回答內容"></textarea></div><button class="btn btn-primary">新增</button></form><div class="knowledge-list">'+state.knowledge.map(item=>'<div class="knowledge-row"><strong>'+esc(item.category||"未分類")+'</strong><div>'+esc(item.question)+'</div><div class="muted">'+esc(item.answer)+'</div><button class="btn btn-danger" data-delete="'+esc(item.id)+'">刪除</button></div>').join("")+'</div></div></div>'}
function extensionView(){return '<div class="panel" style="margin-top:0"><div class="panel-head"><h2>LINEOA Chrome 擴充功能</h2><span class="pill">v0.1 免費測試版</span></div><div class="panel-body"><h3>三段式工作台</h3><ol><li>極小懸浮模式</li><li>右側客服面板</li><li>全螢幕三欄工作台</li></ol><p>目前測試版以開發人員模式安裝。下載原始碼後，在 <code>chrome://extensions</code> 選擇「載入未封裝項目」，指定 <code>extension</code> 資料夾。</p><a class="btn btn-primary" href="https://github.com/fangwl591021/LINEOA" target="_blank" rel="noreferrer">前往下載測試版</a></div></div>'}
function planView(){return '<div class="cards"><div class="card"><div class="label">基礎方案</div><div class="value">FREE</div></div><div class="card"><div class="label">圖文選單</div><div class="value" style="font-size:18px">試用 30 天</div></div><div class="card"><div class="label">試用後年費</div><div class="value">NT$199</div></div><div class="card"><div class="label">帳號</div><div class="value" style="font-size:18px">'+esc(state.user.email)+'</div></div></div><div class="panel"><div class="panel-head"><h2>方案功能</h2></div><div class="panel-body"><ul><li>免費版讀取目前可見的最近 5 則聊天室內容</li><li>100 筆雲端知識庫</li><li>本機知識比對與建議回覆</li><li>圖文選單首次開啟享 30 天試用</li><li>試用後 NT$199／年，確認付款後由管理員開通</li><li>人工複製，不自動發送聊天訊息</li></ul></div></div>'}
function adminUsers(){const s=state.adminSummary||{};return '<div class="cards"><div class="card"><div class="label">註冊用戶</div><div class="value">'+(s.users||0)+'</div></div><div class="card"><div class="label">免費方案</div><div class="value">'+(s.freeUsers||0)+'</div></div><div class="card"><div class="label">知識筆數</div><div class="value">'+(s.knowledgeItems||0)+'</div></div><div class="card"><div class="label">有效登入</div><div class="value">'+(s.activeSessions||0)+'</div></div></div><div class="panel"><div class="panel-head"><h2>使用者管理</h2></div><table><thead><tr><th>使用者</th><th>公司</th><th>方案</th><th>知識庫</th><th>圖文選單</th><th>註冊時間</th></tr></thead><tbody>'+state.adminUsers.map(u=>{const paid=Date.parse(u.rich_menu_subscription_ends_at||"")>Date.now();const trial=Date.parse(u.rich_menu_trial_ends_at||"")>Date.now();const status=paid?"年費至 "+new Date(u.rich_menu_subscription_ends_at).toLocaleDateString("zh-TW"):trial?"試用至 "+new Date(u.rich_menu_trial_ends_at).toLocaleDateString("zh-TW"):"未開始／已到期";return '<tr><td><strong>'+esc(u.display_name)+'</strong><div class="muted">'+esc(u.email)+'</div></td><td>'+esc(u.company_name||"-")+'</td><td><span class="pill">'+esc(u.plan)+'</span></td><td>'+Number(u.knowledge_count||0)+'</td><td><div class="muted">'+esc(status)+'</div><button class="btn" data-rich-menu-activate="'+esc(u.id)+'">收款後開通一年</button></td><td>'+esc(new Date(u.created_at).toLocaleString("zh-TW"))+'</td></tr>'}).join("")+'</tbody></table></div>'}
function bindAdminUsers(){document.querySelectorAll("[data-rich-menu-activate]").forEach(button=>button.onclick=async()=>{if(!confirm("確認已收到 NT$199，為此用戶開通圖文選單一年？"))return;button.disabled=true;try{await request("/api/admin/users/"+encodeURIComponent(button.dataset.richMenuActivate)+"/features/rich-menu/activate",{method:"POST"});await loadAdmin();await render()}catch(error){alert(error.message)}finally{button.disabled=false}})}
function placeholder(title,text){return '<div class="panel" style="margin-top:0"><div class="panel-head"><h2>'+title+'</h2><span class="pill">第一階段</span></div><div class="panel-body"><p>'+text+'</p></div></div>'}
async function render(){renderNav();const titles={dashboard:"營運總覽",knowledge:"我的知識庫",extension:"擴充功能",plan:"方案與帳戶","admin-users":"使用者管理","admin-plans":"方案管理","admin-versions":"版本管理","admin-audit":"操作紀錄","admin-settings":"系統設定"};$("page-title").textContent=titles[state.view]||"LINEOA";if(state.view==="knowledge"){await loadKnowledge();$("content").innerHTML=knowledgeView();bindKnowledge()}else if(state.view==="admin-users"){await loadAdmin();$("content").innerHTML=adminUsers();bindAdminUsers()}else if(state.view==="dashboard"){await loadKnowledge();$("content").innerHTML=dashboard()}else if(state.view==="extension")$("content").innerHTML=extensionView();else if(state.view==="plan")$("content").innerHTML=planView();else $("content").innerHTML=placeholder(titles[state.view],"此功能已保留於 actionadmin 標準導覽，將在下一階段啟用。")}
function bindKnowledge(){const form=$("knowledge-form");form.onsubmit=async event=>{event.preventDefault();await request("/api/knowledge",{method:"POST",body:JSON.stringify({category:$("k-category").value,question:$("k-question").value,answer:$("k-answer").value})});await render()};document.querySelectorAll("[data-delete]").forEach(button=>button.onclick=async()=>{if(!confirm("確定刪除這筆知識？"))return;await request("/api/knowledge/"+encodeURIComponent(button.dataset.delete),{method:"DELETE"});await render()})}
(async()=>{if(!state.token)return;try{await enter()}catch{localStorage.removeItem(TOKEN_KEY);localStorage.removeItem(LEGACY_TOKEN_KEY);state.token=""}})();
</script>
</body></html>`;
}

function privacyPage(env) {
  return `<!doctype html><html lang="zh-TW"><meta charset="utf-8"><title>LINEOA 隱私說明</title>
  <body style="font-family:sans-serif;max-width:760px;margin:40px auto;padding:20px;line-height:1.8">
  <h1>${escapeHtml(env.APP_NAME || "LINEOA")} 免費版隱私說明</h1>
  <p>擴充功能只在使用者主動開啟 LINE OA 聊天頁時讀取目前畫面上可見的文字，不主動捲動、不讀取 Cookie、LINE Token 或瀏覽器既有 Authorization Header。</p>
  <p>可見對話僅用於當次本機知識比對，不保存為聊天歷史。系統不會修改 LINE 原生輸入框，也不會自動傳送訊息。</p>
  <p>帳號資料與使用者自行建立的知識庫會儲存在 LINEOA 雲端服務，以提供登入及跨裝置使用。</p>
  </body></html>`;
}

function assertDb(env) {
  if (!env.DB) throw httpError(503, "資料庫尚未完成設定");
}
function adminEmails(env) {
  return new Set(String(env.ADMIN_EMAILS || "").split(",").map(normalizeEmail).filter(Boolean));
}
function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}
function cleanText(value, max) {
  return String(value || "").replace(/\u0000/g, "").trim().slice(0, max);
}
function clampInt(value, min, max) {
  return Math.max(min, Math.min(max, Math.trunc(Number(value) || min)));
}
function bearerToken(request) {
  const auth = request.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}
function randomToken(bytes) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return base64Url(data);
}
async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(String(value)));
  return base64Url(new Uint8Array(digest));
}

function cleanHttpsUrl(value, max) {
  const text = cleanText(value, max);
  if (!text) return "";
  try {
    const url = new URL(text);
    return url.protocol === "https:" ? url.href.slice(0, max) : "";
  } catch {
    return "";
  }
}
async function derivePassword(password, salt) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations: 100000 },
    material,
    256
  );
  return base64Url(new Uint8Array(bits));
}
function base64Url(bytes) {
  let binary = "";
  bytes.forEach((byte) => binary += String.fromCharCode(byte));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function constantTimeEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}
async function safeJson(request) {
  try { return await request.json(); } catch { throw httpError(400, "JSON 格式錯誤"); }
}
function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
function corsHeaders(request) {
  const origin = request.headers.get("origin") || "*";
  const allowed = origin.startsWith("chrome-extension://") || /^https:\/\/line-oa\.fangwl591021\.workers\.dev$/.test(origin) ? origin : "*";
  return {
    "access-control-allow-origin": allowed,
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-max-age": "86400",
    "vary": "Origin"
  };
}
function json(payload, status = 200, extra = {}) {
  return new Response(JSON.stringify(payload), { status, headers: { ...JSON_HEADERS, ...extra } });
}
function html(body) {
  return new Response(body, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}
