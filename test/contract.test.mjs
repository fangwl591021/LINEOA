import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const worker = fs.readFileSync(new URL("../src/worker.js", import.meta.url), "utf8");
const schema = fs.readFileSync(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8");
const config = fs.readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
const readme = fs.readFileSync(new URL("../README.md", import.meta.url), "utf8");

test("free plan contract is present", () => {
  assert.match(worker, /plan:\s*"free"/);
  assert.match(worker, /FREE_KNOWLEDGE_LIMIT/);
  assert.match(worker, /\/api\/auth\/register/);
  assert.match(worker, /\/api\/knowledge/);
});

test("production auth constraints are enforced", () => {
  assert.match(worker, /url\.pathname === "\/admin"[\s\S]*await requireAdmin\(request, env\)/);
  assert.match(worker, /return await register\(request, env, cors\)/);
  assert.match(worker, /return await login\(request, env, cors\)/);
  assert.match(worker, /return await saveKnowledge\(request, env, cors, auth\.user\)/);
  const iterations = worker.match(/iterations:\s*(\d+)/);
  assert.ok(iterations);
  assert.equal(Number(iterations[1]), 100000);
});

test("public brand is LINEOA", () => {
  assert.match(worker, /service:\s*"lineoa-saas"/);
  assert.match(worker, /env\.APP_NAME \|\| "LINEOA"/);
  assert.match(worker, /LINEOA Chrome 擴充功能/);
  assert.doesNotMatch(worker, /LINEPILOT/);
  assert.match(config, /APP_NAME = "LINEOA"/);
  assert.doesNotMatch(config, /LINEPILOT/);
  assert.match(readme, /^# LINEOA SaaS/m);
  assert.doesNotMatch(readme, /LINEPILOT/);
});

test("registration and knowledge tables exist", () => {
  assert.match(schema, /CREATE TABLE IF NOT EXISTS users/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS sessions/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS knowledge_items/);
});

