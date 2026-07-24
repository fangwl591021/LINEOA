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

test("registration and knowledge tables exist", () => {
  assert.match(schema, /CREATE TABLE IF NOT EXISTS users/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS sessions/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS knowledge_items/);
});

