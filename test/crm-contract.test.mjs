import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const worker = readFileSync(new URL("../src/worker.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("../migrations/0003_crm_contacts.sql", import.meta.url), "utf8");
const background = readFileSync(new URL("../extension/background.js", import.meta.url), "utf8");
const crm = readFileSync(new URL("../extension/crm.js", import.meta.url), "utf8");

test("CRM contacts are tenant-scoped and deduplicated by LINE UID", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS crm_contacts/);
  assert.match(migration, /UNIQUE\(user_id, line_uid\)/);
  assert.match(migration, /FOREIGN KEY \(user_id\) REFERENCES users/);
  assert.match(worker, /WHERE user_id = \?/);
  assert.match(worker, /ON CONFLICT\(user_id, line_uid\)/);
  assert.match(worker, /\/api\/crm\/contacts\/upsert/);
  assert.match(worker, /crm\.contact\.create/);
});

test("automatic capture is explicit, narrow, and excludes message contents", () => {
  assert.match(crm, /lineoa_crm_auto_capture/);
  assert.match(crm, /stored\[AUTO_KEY\] === true/);
  assert.match(crm, /location\.hostname !== "chat\.line\.biz"/);
  assert.match(crm, /\^U\[0-9a-f\]\{32\}\$/i);
  assert.match(crm, /setTimeout\(\(\) =>/);
  assert.match(crm, /}, 1200\)/);
  assert.match(crm, /body: \{ lineUid, displayName, avatarUrl \}/);
  assert.doesNotMatch(crm, /body:\s*\{[^}]*messages/i);
  assert.match(crm, /不儲存聊天內容、Cookie 或 LINE Token/);
  assert.match(background, /sanitizeCrmCapture/);
  assert.match(background, /requireLinePage/);
});

test("CRM follows the macro-style list and profile structure", () => {
  assert.match(crm, /客戶總數/);
  assert.match(crm, /本月新增/);
  assert.match(crm, /CRM 客戶檔案/);
  assert.match(crm, /標籤（逗號分隔）/);
  assert.match(crm, /返回客戶名單/);
  assert.match(crm, />取消</);
});
