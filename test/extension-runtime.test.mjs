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
