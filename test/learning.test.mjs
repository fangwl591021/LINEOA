import test from "node:test";
import assert from "node:assert/strict";
import "../extension/learning-core.js";
import { handleLearningMessage } from "../extension/learning-background.js";
const { draftPairs, redact, collectBubbles } = globalThis.LINEOA_LEARNING;

test("quoted question is not mixed into the staff answer", () => {
  const { stripRepeatedQuote } = globalThis.LINEOA_LEARNING;
  const previous = [{ role: "customer", text: "若有近視或閃光呢？" }];
  assert.equal(stripRepeatedQuote("Thera\n若有近視或閃光呢？\n我公司的原廠眼鏡沒有度數", previous), "我公司的原廠眼鏡沒有度數");
  assert.equal(stripRepeatedQuote("若有近視或閃光呢？請至門市詢問", previous), "若有近視或閃光呢？請至門市詢問");
});

test("learning groups customer question and subsequent staff answer, without dangling answers", () => {
  assert.deepEqual(draftPairs([
    { role: "agent", text: "這是上一段回覆" },
    { role: "customer", text: "收到商品不符" },
    { role: "customer", text: "需要如何處理？" },
    { role: "agent", text: "請聯繫行政客服" },
    { role: "agent", text: "由客服留下紀錄" },
    { role: "customer", text: "還有一個未解決問題" }
  ]), [{ question: "收到商品不符\n需要如何處理？", answer: "請聯繫行政客服\n由客服留下紀錄", category: "對話學習" }]);
});

test("unknown roles break pairing, short fragments and oversized pairs are not learned", () => {
  assert.deepEqual(draftPairs([{ role: "customer", text: "台南" }, { role: "agent", text: "已轉知相關單位" }]), []);
  assert.deepEqual(draftPairs([{ role: "customer", text: "商品如何處理" }, { role: "unknown", text: "職員姓名" }, { role: "agent", text: "請洽行政客服" }]), []);
  assert.deepEqual(draftPairs([{ role: "customer", text: "問".repeat(501) }, { role: "agent", text: "請洽行政客服" }]), []);
});

test("local redaction removes known names, IDs, order number, email, phone and URLs", () => {
  const result = redact("小明 訂單編號 O260923141245592 U" + "a".repeat(32) + " a@b.com 0912-345-678 https://example.com/customer?id=1", ["小明"]);
  for (const original of ["小明", "O260923141245592", "a@b.com", "0912", "https://", "a".repeat(32)]) assert.ok(!result.includes(original));
});

test("bubble geometry excludes plain employee labels and uses blue right / gray left roles", () => {
  function element(text, left, top, color, radius = "16px") {
    return { innerText: text, closest: () => null, contains: () => false,
      getBoundingClientRect: () => ({ left, right: left + 200, top, bottom: top + 40, width: 200, height: 40 }),
      style: { visibility: "visible", display: "block", opacity: "1", borderTopLeftRadius: radius,
        borderTopRightRadius: radius, borderBottomLeftRadius: radius, borderBottomRightRadius: radius, backgroundColor: color } };
  }
  const nodes = [element("收到商品不符", 550, 250, "rgb(241, 242, 244)"), element("客服姓名", 1100, 295, "rgba(0, 0, 0, 0)", "0px"), element("請洽行政客服", 1100, 350, "rgb(185, 214, 255)")];
  const doc = { querySelectorAll: () => nodes, defaultView: { getComputedStyle: el => el.style } };
  assert.deepEqual(collectBubbles(doc, { left: 520, right: 1500, bottom: 900, exclude: "#root" }), [
    { role: "customer", text: "收到商品不符" }, { role: "agent", text: "請洽行政客服" }
  ]);
});

test("draft storage isolates users, deduplicates, keeps edits on quota failure, and requires review", async () => {
  const store = {};
  globalThis.chrome = {
    runtime: { getURL: path => `chrome-extension://test/${path}` },
    storage: { local: { get: async key => ({ [key]: structuredClone(store[key]) }), set: async data => Object.assign(store, structuredClone(data)) } },
    tabs: { create: async () => {} }
  };
  let user = "first", failPublish = false, posts = 0;
  const api = { requireToken: async () => "test-only", apiRequest: async (path, options) => {
    if (path === "/api/auth/me") return { user: { id: user } };
    if (options.method === "POST") { posts++; if (failPublish) throw new Error("100 筆上限"); return { ok: true }; }
    return { items: [] };
  } };
  const line = { url: `https://chat.line.biz/U${"a".repeat(32)}/chat/U${"b".repeat(32)}` };
  const page = { url: "chrome-extension://test/learning.html" };
  const call = (action, fields = {}, sender = page) => handleLearningMessage({ type: `lineoa:learning:${action}`, userId: user, ...fields }, sender, api);
  const pair = { question: "商品不符如何處理？", answer: "請洽行政客服留下紀錄" };
  assert.equal((await call("add", { items: [pair, pair] }, line)).added, 1);
  const [draft] = (await call("list")).items;
  await assert.rejects(call("approve", { id: draft.id, body: pair }), /人工檢查/);
  assert.equal(posts, 0);
  await assert.rejects(call("approve", { id: draft.id, body: pair, reviewed: true }, line), /不允許/);
  failPublish = true;
  const edited = { ...pair, answer: "請聯繫行政客服 https://lin.ee/example" };
  await assert.rejects(call("approve", { id: draft.id, body: edited, reviewed: true }), /100 筆/);
  assert.equal((await call("list")).items[0].answer, edited.answer);
  assert.equal((await call("list")).items[0].status, "pending");
  failPublish = false;
  await call("approve", { id: draft.id, body: edited, reviewed: true });
  assert.equal((await call("list")).items[0].status, "approved");
  await call("delete", { id: draft.id });
  assert.equal((await call("add", { items: [pair] }, line)).added, 0);
  user = "second";
  assert.deepEqual((await call("list")).items, []);
  await assert.rejects(call("add", { items: [pair], userId: "first" }, line), /帳號已變更/);
});
