import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const worker = fs.readFileSync(new URL("../src/worker.js", import.meta.url), "utf8");
const schema = fs.readFileSync(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8");

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

test("registration and knowledge tables exist", () => {
  assert.match(schema, /CREATE TABLE IF NOT EXISTS users/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS sessions/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS knowledge_items/);
});

