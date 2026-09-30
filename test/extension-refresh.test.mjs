import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const popup = readFileSync(new URL("../extension/popup.js", import.meta.url), "utf8");
function runPopup({ url = "https://chat.line.biz/account/chat/contact", version = "0.1.18", background = true, confirmed = true } = {}) {
  const elements = new Map();
  const reloads = [];
  const current = { id: 42, url };
  let closed = false;
  const chrome = {
    runtime: {
      lastError: null,
      getManifest: () => ({ version: "0.1.20" }),
      sendMessage(_message, callback) {
        this.lastError = background ? null : { message: "offline" };
        callback(background ? { ok: true, version: "0.1.20" } : undefined);
        this.lastError = null;
      }
    },
    tabs: {
      query(_query, callback) { callback([current]); },
      sendMessage(_id, _message, callback) {
        chrome.runtime.lastError = version ? null : { message: "no receiver" };
        callback(version ? { version } : undefined);
        chrome.runtime.lastError = null;
      },
      reload(id, _options, callback) { reloads.push(id); callback(); }
    }
  };
  vm.runInNewContext(popup, { chrome, URL,
    document: { getElementById(id) {
      if (!elements.has(id)) elements.set(id, { dataset: {}, disabled: false, textContent: "", listeners: {}, addEventListener(event, callback) { this.listeners[event] = callback; } });
      return elements.get(id);
    } },
    window: { confirm: () => confirmed, close: () => { closed = true; } }
  });
  return { elements, reloads, current, isClosed: () => closed, click: () => elements.get("reload-page").listeners.click() };
}

test("popup detects stale content, and refresh works even when the background is unavailable", () => {
  const result = runPopup({ background: false });
  assert.match(result.elements.get("status").textContent, /已安裝 v0.1.20／面板 v0.1.18/);
  assert.match(result.elements.get("background-status").textContent, /背景連線失敗/);
  result.click();
  assert.deepEqual(result.reloads, [42]);
  assert.equal(result.isClosed(), true);
});

test("popup handles old content without a version listener and supports cancel", () => {
  const result = runPopup({ version: null, confirmed: false });
  assert.match(result.elements.get("status").textContent, /未回應或仍為舊版/);
  result.click();
  assert.deepEqual(result.reloads, []);
});

test("refresh validates the current tab again and never redirects to the manager directory", () => {
  const result = runPopup();
  result.current.url = "https://chat.line.biz.attacker.invalid/";
  result.click();
  assert.deepEqual(result.reloads, []);
  const inactive = runPopup({ url: "https://example.invalid/" });
  assert.equal(inactive.elements.get("reload-page").disabled, true);
});

test("background module starts and runtime-info does not need auth or network", async () => {
  let messageHandler;
  globalThis.chrome = { runtime: {
    id: "test-extension", getManifest: () => ({ version: "0.1.20" }),
    onInstalled: { addListener() {} },
    onMessage: { addListener(callback) { messageHandler = callback; } }
  } };
  await import("../extension/background.js");
  const result = await new Promise(resolve => messageHandler({ type: "lineoa:runtime-info" }, { id: "test-extension" }, resolve));
  assert.deepEqual(result, { ok: true, version: "0.1.20" });
});
