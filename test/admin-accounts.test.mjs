import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomBytes, createHash } from "node:crypto";
import vm from "node:vm";
import { Miniflare } from "miniflare";

test("admin creation uses real local D1: authorization, required LINE@, audit, login and no session switch", async () => {
  const mf = new Miniflare({
    modules: true,
    modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
    scriptPath: fileURLToPath(new URL("../src/worker.js", import.meta.url)),
    compatibilityDate: "2026-07-24", d1Databases: ["DB"],
    bindings: { APP_NAME: "LINEOA", FREE_KNOWLEDGE_LIMIT: "100", ADMIN_EMAILS: "new-account@example.invalid" }
  });
  try {
    const db = await mf.getD1Database("DB");
    for (const name of ["0001_initial.sql", "0002_rich_menu_entitlements.sql", "0003_crm_contacts.sql"]) {
      const sql = readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
      for (const part of sql.split(";").filter(part => part.trim())) await db.prepare(part).run();
    }
    const adminToken = randomBytes(32).toString("hex"), userToken = randomBytes(32).toString("hex");
    for (const [id, role, token] of [["operator", "admin", adminToken], ["existing-user", "user", userToken]]) {
      await db.prepare("INSERT INTO users (id,email,display_name,password_salt,password_hash,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
        .bind(id, `${id}@example.invalid`, id, "test-salt", "not-used-for-login", role, "2026-01-01", "2026-01-01").run();
      await db.prepare("INSERT INTO sessions (token_hash,user_id,expires_at,created_at,last_seen_at) VALUES (?,?,?,?,?)")
        .bind(createHash("sha256").update(token).digest("base64url"), id, "2099-01-01", "2026-01-01", "2026-01-01").run();
    }
    const before = await db.prepare("SELECT * FROM users ORDER BY id").all();
    const migration = readFileSync(new URL("../migrations/0004_user_monitored_line_oa.sql", import.meta.url), "utf8");
    await db.prepare(migration).run();
    const after = await db.prepare("SELECT * FROM users ORDER BY id").all();
    assert.deepEqual(after.results.map(({ monitored_line_oa, ...row }) => row), before.results);
    assert.ok(after.results.every(row => row.monitored_line_oa === ""));

    const password = randomBytes(20).toString("base64url");
    const input = { displayName: "測試用戶", email: "New-Account@example.invalid", password, companyName: "測試品牌", monitoredLineOa: " @Demo.123 " };
    async function call(path, token, body, raw = false) {
      const headers = { "content-type": "application/json" };
      if (token) headers.authorization = `Bearer ${token}`;
      const response = await mf.dispatchFetch(`http://localhost${path}`, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
      const text = await response.text();
      return { status: response.status, body: JSON.parse(text), text };
    }
    assert.equal((await call("/api/admin/users", null, input)).status, 401);
    assert.equal((await call("/api/admin/users", userToken, input)).status, 403);
    assert.equal((await call("/api/admin/users", userToken)).status, 403);
    for (const monitoredLineOa of ["", "abc123", "https://chat.line.biz/uid", "@a b", "@<script>", "@" + "a".repeat(101)]) {
      assert.equal((await call("/api/admin/users", adminToken, { ...input, monitoredLineOa })).status, 400);
    }
    for (const patch of [{ role: "admin" }, { plan: "paid" }, { password: "short" }, { displayName: "a" }, { email: "bad-email" }]) {
      assert.equal((await call("/api/admin/users", adminToken, { ...input, ...patch })).status, 400);
    }
    assert.equal((await call("/api/admin/users", adminToken, null)).status, 400);
    assert.equal((await call("/api/admin/users", adminToken, "{bad", true)).status, 400);
    assert.equal((await call("/api/admin/users", adminToken, { ...input, companyName: "x".repeat(9000) })).status, 413);
    assert.equal((await db.prepare("SELECT COUNT(*) n FROM users").first()).n, 2);

    const result = await call("/api/admin/users", adminToken, input);
    assert.equal(result.status, 201);
    assert.equal(result.body.user.monitoredLineOa, "@demo.123");
    assert.equal(result.body.user.role, "user"); // Even if email is on the registration admin allowlist.
    assert.equal(result.body.user.plan, "free");
    assert.equal(result.body.limits.knowledgeItems, 100);
    assert.equal(result.body.token, undefined);
    assert.ok(!result.text.includes(password));
    const account = await db.prepare("SELECT * FROM users WHERE id = ?").bind(result.body.user.id).first();
    assert.notEqual(account.password_hash, password);
    assert.ok(account.password_salt.length > 10);
    assert.equal((await db.prepare("SELECT COUNT(*) n FROM sessions").first()).n, 2);
    const audit = await db.prepare("SELECT * FROM audit_logs WHERE action = 'admin.user.create'").first();
    assert.equal(audit.user_id, "operator");
    assert.equal(audit.detail, result.body.user.id);
    assert.ok(!JSON.stringify(audit).includes(password));
    assert.equal((await call("/api/auth/me", adminToken)).body.user.id, "operator");
    assert.equal((await call("/api/admin/users", adminToken, { ...input, displayName: "不可覆寫" })).status, 409);
    assert.equal((await db.prepare("SELECT display_name FROM users WHERE id = ?").bind(account.id).first()).display_name, "測試用戶");
    const list = await call("/api/admin/users", adminToken);
    assert.ok(list.body.users.some(user => user.monitored_line_oa === "@demo.123"));
    assert.ok(!list.text.includes("password_hash") && !list.text.includes(password));
    const login = await call("/api/auth/login", null, { email: input.email, password });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.monitoredLineOa, "@demo.123");
    assert.equal((await call("/api/admin/users", login.body.token, input)).status, 403);
    assert.equal((await call("/api/auth/login", null, { email: input.email, password: "incorrect-password" })).status, 401);

    // Two simultaneous submissions must never create two users for one email.
    const raceInput = { ...input, email: "race@example.invalid" };
    const concurrent = await Promise.all([call("/api/admin/users", adminToken, raceInput), call("/api/admin/users", adminToken, raceInput)]);
    assert.deepEqual(concurrent.map(row => row.status).sort(), [201, 409]);
    const app = await mf.dispatchFetch("http://localhost/app");
    const html = await app.text();
    const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    assert.doesNotThrow(() => new vm.Script(script));
    assert.match(html, /監控 LINE@/);
    assert.match(html, /取消／返回用戶名單/);
  } finally { await mf.dispose(); }
});

test("extension create-account form stays private and never replaces the operator token", () => {
  const background = readFileSync(new URL("../extension/background.js", import.meta.url), "utf8");
  const page = readFileSync(new URL("../extension/accounts.html", import.meta.url), "utf8");
  const content = readFileSync(new URL("../extension/content.js", import.meta.url), "utf8");
  const js = readFileSync(new URL("../extension/accounts.js", import.meta.url), "utf8");
  assert.match(background, /sender.url\?\.split\(\/\[\?#\]\/\)\[0\] !== chrome.runtime.getURL\("accounts.html"\)/);
  assert.match(page, /name="monitoredLineOa" required/);
  assert.match(page, /返回帳戶方案／關閉/);
  assert.match(content, /state.user.role === "admin"/);
  assert.doesNotMatch(js, /storage\.local|localStorage|console\./);
  assert.doesNotMatch(js, /lineoa:auth/);
});
