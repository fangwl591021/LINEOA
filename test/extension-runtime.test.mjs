import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const contentSource = readFileSync(new URL("../extension/content.js", import.meta.url), "utf8");

test("content script inserts one isolated panel and switches modes without touching the host page", async () => {
  const listeners = new Map();
  const hostPage = { marker: "LINE OA host content", mutations: 0 };
  let root = null;

  const documentElement = {
    appendChild(element) {
      if (element.id !== "lineoa-extension-root") hostPage.mutations += 1;
      root = element;
      return element;
    },
    contains(element) {
      return element === root;
    }
  };

  const document = {
    documentElement,
    getElementById(id) {
      return id === "lineoa-extension-root" ? root : null;
    },
    createElement(tagName) {
      return {
        tagName,
        id: "",
        dataset: {},
        innerHTML: "",
        setAttribute() {},
        addEventListener(type, listener) {
          listeners.set(type, listener);
        }
      };
    },
    querySelectorAll() {
      return [];
    }
  };

  const chrome = {
    storage: {
      local: {
        async get() { return {}; },
        async set() {}
      }
    },
    runtime: {
      lastError: null,
      sendMessage(_message, callback) {
        callback({ ok: true, authenticated: false });
      }
    }
  };

  class MutationObserver {
    observe() {}
  }

  vm.runInNewContext(contentSource, {
    chrome,
    console: { info() {} },
    document,
    FormData,
    getComputedStyle() {
      return { display: "block", visibility: "visible", opacity: "1" };
    },
    innerHeight: 900,
    innerWidth: 1400,
    MutationObserver,
    navigator: { clipboard: { async writeText() {} } },
    URL
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(root.id, "lineoa-extension-root");
  assert.equal(root.dataset.mode, "side");
  assert.match(root.innerHTML, /登入 LINEOA/);
  assert.equal(hostPage.marker, "LINE OA host content");
  assert.equal(hostPage.mutations, 0);

  await listeners.get("click")({
    target: {
      closest() {
        return { dataset: { action: "mode", mode: "float" } };
      }
    }
  });
  assert.equal(root.dataset.mode, "float");
  assert.match(root.innerHTML, /lineoa-fab/);
  assert.equal(hostPage.mutations, 0);
});

test("chat.line.biz fallback reads central visible bubbles and excludes the left account list", async () => {
  const listeners = new Map();
  let root = null;

  function candidate(text, left, top, options = {}) {
    return {
      childElementCount: 0,
      innerText: text,
      textContent: text,
      closest(selector) {
        if (selector.includes("#lineoa-extension-root")) return null;
        if (options.insideButton && selector.includes("button")) return {};
        return null;
      },
      getBoundingClientRect() {
        return { left, right: left + 220, top, bottom: top + 38, width: 220, height: 38 };
      }
    };
  }

  const visibleElements = [
    candidate("左側客戶名單", 80, 360),
    candidate("待處理", 700, 170, { insideButton: true }),
    candidate("每日簽到贈點", 590, 720),
    candidate("簽到成功，已贈送 5 K點。點數餘額 70 K點。", 1020, 790)
  ];

  const document = {
    documentElement: {
      appendChild(element) { root = element; return element; },
      contains(element) { return element === root; }
    },
    getElementById(id) { return id === "lineoa-extension-root" ? root : null; },
    createElement() {
      return {
        id: "",
        dataset: {},
        innerHTML: "",
        setAttribute() {},
        addEventListener(type, listener) { listeners.set(type, listener); },
        getBoundingClientRect() {
          return { left: 1410, right: 1890, top: 60, bottom: 1040, width: 480, height: 980 };
        }
      };
    },
    querySelectorAll(selector) { return selector === "p, span, div" ? visibleElements : []; }
  };

  const chrome = {
    storage: { local: { async get() { return {}; }, async set() {} } },
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        if (message.type === "lineoa:session") {
          callback({
            ok: true,
            authenticated: true,
            user: { displayName: "測試者", email: "tester@example.invalid" },
            limits: { knowledgeItems: 100 }
          });
          return;
        }
        if (message.type === "lineoa:knowledge:list") {
          callback({
            ok: true,
            items: [{ id: "k1", category: "簽到", question: "每日簽到贈點", answer: "已為您確認簽到點數。" }],
            usage: { current: 1, limit: 100 }
          });
        }
      }
    }
  };

  class MutationObserver { observe() {} }

  vm.runInNewContext(contentSource, {
    chrome,
    console: { info() {} },
    document,
    FormData,
    getComputedStyle() { return { display: "block", visibility: "visible", opacity: "1" }; },
    innerHeight: 1080,
    innerWidth: 1920,
    location: { hostname: "chat.line.biz" },
    MutationObserver,
    navigator: { clipboard: { async writeText() {} } },
    URL
  });

  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  await listeners.get("click")({
    target: { closest() { return { dataset: { action: "scan" } }; } }
  });

  assert.match(root.innerHTML, /每日簽到贈點/);
  assert.match(root.innerHTML, /簽到成功，已贈送 5 K點/);
  assert.doesNotMatch(root.innerHTML, /左側客戶名單/);
  assert.match(root.innerHTML, /已為您確認簽到點數/);
});