"use strict";

(() => {
  const ROOT_ID = "lineoa-extension-root";
  const MODE_KEY = "lineoa_panel_mode";
  const LAYOUT_VERSION_KEY = "lineoa_layout_version";
  const LAYOUT_VERSION = 2;
  const MESSAGE_LIMIT = 5;
  const state = {
    mode: "float",
    adminView: "overview",
    adminGroups: { service: true, tools: true },
    authMode: "login",
    user: null,
    limits: null,
    knowledge: [],
    usage: null,
    messages: [],
    suggestions: [],
    contact: { uid: "", name: "", avatarUrl: "" },
    conversationKey: "",
    loading: true,
    notice: ""
  };

  let root;

  init();

  async function init() {
    if (document.getElementById(ROOT_ID)) return;
    console.info("LINEOA Loaded");
    root = document.createElement("aside");
    root.id = ROOT_ID;
    root.setAttribute("aria-label", "LINEOA 客服輔助工具");
    document.documentElement.appendChild(root);
    bindRootEvents();
    observeReinsertion();
    await globalThis.LINEOA_CRM.init(() => render(), {
      start: startCrmBatch,
      stop: stopCrmBatch
    });

    const stored = await chrome.storage.local.get([MODE_KEY, LAYOUT_VERSION_KEY]);
    if (stored[LAYOUT_VERSION_KEY] === LAYOUT_VERSION && ["float", "side", "full"].includes(stored[MODE_KEY])) {
      state.mode = stored[MODE_KEY];
    } else {
      await chrome.storage.local.set({ [MODE_KEY]: "float", [LAYOUT_VERSION_KEY]: LAYOUT_VERSION });
    }
    await restoreSession();
    startConversationTracking();
  }

  async function restoreSession() {
    state.loading = true;
    render();
    try {
      const session = await send({ type: "lineoa:session" });
      if (session.authenticated) {
        state.user = session.user;
        state.limits = session.limits;
        globalThis.LINEOA_CRM.setAuthenticated(true);
        await loadKnowledge();
      }
    } catch (error) {
      state.notice = error.message;
    } finally {
      state.loading = false;
      render();
    }
  }

  async function loadKnowledge() {
    const data = await send({ type: "lineoa:knowledge:list" });
    state.knowledge = Array.isArray(data.items) ? data.items : [];
    state.usage = data.usage || null;
  }

  function bindRootEvents() {
    root.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      const action = button.dataset.action;

      if (action.startsWith("crm-")) {
        await globalThis.LINEOA_CRM.handleClick(action, button, state.contact);
        return;
      }
      if (action === "mode") return setMode(button.dataset.mode);
      if (action === "admin-view") {
        state.adminView = ["overview", "monitor", "crm", "knowledge", "account", "settings"].includes(button.dataset.view)
          ? button.dataset.view
          : "overview";
        if (state.adminView === "crm") await globalThis.LINEOA_CRM.load();
        return render();
      }
      if (action === "toggle-admin-group") {
        const group = button.dataset.group;
        if (!["service", "tools"].includes(group)) return;
        state.adminGroups[group] = !state.adminGroups[group];
        return render();
      }
      if (action === "open-rich-menu") {
        try {
          await send({ type: "lineoa:rich-menu:open" });
          state.notice = "已開啟圖文選單編輯器";
        } catch (error) {
          state.notice = error.message;
        }
        return render();
      }
      if (action === "open-settings") {
        try {
          await send({ type: "lineoa:settings:open" });
          state.notice = "已開啟擴充功能私有串接設定頁";
        } catch (error) {
          state.notice = error.message;
        }
        return render();
      }
      if (action === "auth-mode") {
        state.authMode = button.dataset.mode === "register" ? "register" : "login";
        state.notice = "";
        return render();
      }
      if (action === "logout") return logout();
      if (action === "scan") return scanVisibleConversation();
      if (action === "sync") return syncKnowledge();
      if (action === "copy") return copySuggestion(Number(button.dataset.index));
    });

    root.addEventListener("submit", async (event) => {
      if (["lineoa-crm-form", "lineoa-crm-url-form"].includes(event.target.id)) {
        event.preventDefault();
        await globalThis.LINEOA_CRM.handleSubmit(event.target);
        return;
      }
      if (event.target.id !== "lineoa-auth-form") return;
      event.preventDefault();
      await authenticate(new FormData(event.target));
    });
  }

  function setMode(mode) {
    if (!["float", "side", "full"].includes(mode)) return;
    state.mode = mode;
    chrome.storage.local.set({ [MODE_KEY]: mode });
    render();
  }

  async function authenticate(form) {
    state.loading = true;
    state.notice = "";
    render();
    try {
      const result = await send({
        type: "lineoa:auth",
        mode: state.authMode,
        body: {
          email: form.get("email"),
          password: form.get("password"),
          displayName: form.get("displayName"),
          companyName: form.get("companyName")
        }
      });
      state.user = result.user;
      state.limits = result.limits;
      globalThis.LINEOA_CRM.setAuthenticated(true);
      await loadKnowledge();
      state.notice = "登入成功，知識庫已同步";
      if (state.conversationKey) scanVisibleConversation({ automatic: true });
    } catch (error) {
      state.notice = error.message;
    } finally {
      state.loading = false;
      render();
    }
  }

  async function logout() {
    state.loading = true;
    render();
    try {
      await send({ type: "lineoa:logout" });
    } catch {
      // The background worker clears the local session even if the API is unavailable.
    }
    state.user = null;
    globalThis.LINEOA_CRM.setAuthenticated(false);
    state.knowledge = [];
    state.messages = [];
    state.suggestions = [];
    state.loading = false;
    state.notice = "已登出";
    render();
  }

  async function syncKnowledge() {
    state.loading = true;
    state.notice = "";
    render();
    try {
      await loadKnowledge();
      state.notice = `已同步 ${state.knowledge.length} 筆知識`;
    } catch (error) {
      state.notice = error.message;
    } finally {
      state.loading = false;
      render();
    }
  }

  function scanVisibleConversation(options = {}) {
    state.messages = collectVisibleMessages();
    state.suggestions = rankSuggestions(state.messages, state.knowledge);
    const prefix = options.automatic ? "已自動跟隨目前聊天室，" : "";
    state.notice = state.messages.length
      ? `${prefix}在本機比對 ${state.messages.length} 則目前可見文字，沒有傳送聊天內容`
      : "找不到可見訊息；請確認目前已開啟一對一聊天室";
    render();
  }

  let conversationCheckTimer = 0;
  let lastObservedHref = "";
  const crmBatch = {
    running: false,
    cancelled: false
  };

  function startConversationTracking() {
    if (typeof location === "undefined" || location.hostname !== "chat.line.biz") return;
    lastObservedHref = String(location.href || "");
    checkActiveConversation(true);

    const observer = new MutationObserver(() => scheduleConversationCheck());
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "aria-selected"]
    });

    setInterval(() => {
      const currentHref = String(location.href || "");
      if (currentHref === lastObservedHref) return;
      lastObservedHref = currentHref;
      scheduleConversationCheck();
    }, 700);
  }

  function scheduleConversationCheck() {
    clearTimeout(conversationCheckTimer);
    conversationCheckTimer = setTimeout(() => checkActiveConversation(false), 350);
  }

  function checkActiveConversation(force) {
    const next = readActiveContact();
    const nextKey = next.uid || `${next.name}|${next.avatarUrl}`;
    if (!nextKey) return;

    const profileChanged = next.uid !== state.contact.uid
      || next.name !== state.contact.name
      || next.avatarUrl !== state.contact.avatarUrl;
    const conversationChanged = force || nextKey !== state.conversationKey;
    state.contact = next;
    if (!conversationChanged) {
      if (profileChanged) {
        render();
        globalThis.LINEOA_CRM.followConversation(next);
      }
      return;
    }

    state.conversationKey = nextKey;
    state.messages = [];
    state.suggestions = [];
    state.notice = `已切換至 ${next.name || "目前聯絡人"}，正在自動讀取目前對話`;
    render();
    if (state.user) setTimeout(() => scanVisibleConversation({ automatic: true }), 450);
    globalThis.LINEOA_CRM.followConversation(next);
  }

  function readActiveContact() {
    const uid = readUidFromLocation();
    const panelLeft = state.mode === "side"
      ? (root?.getBoundingClientRect?.().left || innerWidth)
      : innerWidth;
    const chatLeft = Math.min(520, innerWidth * 0.24);
    const inHeaderBand = (element) => {
      if (!element || element.closest?.(`#${ROOT_ID}`) || !isVisibleInViewport(element)) return false;
      const rect = element.getBoundingClientRect();
      return rect.left >= chatLeft && rect.right < panelLeft && rect.top >= 55 && rect.bottom <= 200;
    };

    const avatars = Array.from(document.querySelectorAll("img"))
      .filter(inHeaderBand)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width >= 24 && rect.width <= 80 && rect.height >= 24 && rect.height <= 80;
      })
      .sort((left, right) => left.getBoundingClientRect().left - right.getBoundingClientRect().left);
    const avatar = avatars[0] || null;
    const avatarUrl = safeAvatarUrl(avatar?.currentSrc || avatar?.src || "");
    const avatarRect = avatar?.getBoundingClientRect?.() || null;

    const nameCandidates = Array.from(document.querySelectorAll('h1, h2, h3, [role="heading"], strong, span, div'))
      .filter(inHeaderBand)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const text = normalizeDisplayText(element.innerText || element.textContent || element.getAttribute?.("aria-label") || "");
        const distance = avatarRect
          ? Math.abs(rect.left - avatarRect.right) + Math.abs((rect.top + rect.bottom) / 2 - (avatarRect.top + avatarRect.bottom) / 2)
          : rect.left - chatLeft;
        return { element, rect, text, distance };
      })
      .filter((item) => item.text && item.text.length <= 80 && item.rect.height <= 70 && item.element.childElementCount <= 3)
      .filter((item) => !isInterfaceText(item.text) && !/^(LINE|Official Account|Manager)$/i.test(item.text))
      .sort((left, right) => left.distance - right.distance || left.rect.left - right.rect.left);
    const name = nameCandidates[0]?.text || "";
    return { uid, name, avatarUrl };
  }

  async function startCrmBatch(onProgress) {
    if (location.hostname !== "chat.line.biz") throw new Error("請先進入 LINE OA 聊天室再啟動批次掃描");
    if (crmBatch.running) throw new Error("批次掃描已在執行中");
    crmBatch.running = true;
    crmBatch.cancelled = false;
    const progress = { running: true, discovered: 0, completed: 0, saved: 0, skipped: 0, failed: 0 };
    const processed = new Set();
    let scrollContainer = null;
    let stalled = 0;
    let previousScrollTop = -1;

    try {
      while (!crmBatch.cancelled && progress.completed < 500) {
        const rows = findConversationRows().filter((item) => !processed.has(item.key));
        progress.discovered = processed.size + rows.length;
        onProgress?.({ ...progress });

        for (const item of rows) {
          if (crmBatch.cancelled) break;
          processed.add(item.key);
          const beforeUid = readUidFromLocation();
          item.element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
          const contact = await waitForConversationContact(beforeUid, item.uid);
          if (!contact) {
            progress.skipped += 1;
          } else {
            try {
              const result = await globalThis.LINEOA_CRM.captureBatchContact(contact);
              if (result) progress.saved += 1;
              else progress.skipped += 1;
            } catch {
              progress.failed += 1;
            }
          }
          progress.completed += 1;
          progress.discovered = Math.max(progress.discovered, processed.size);
          onProgress?.({ ...progress });
          await delay(250);
        }

        if (crmBatch.cancelled) break;
        scrollContainer = scrollContainer || findConversationScrollContainer();
        if (!scrollContainer || scrollContainer.scrollHeight <= scrollContainer.clientHeight + 4) break;
        const nextTop = Math.min(
          scrollContainer.scrollHeight - scrollContainer.clientHeight,
          scrollContainer.scrollTop + Math.max(180, Math.floor(scrollContainer.clientHeight * 0.72))
        );
        if (nextTop <= scrollContainer.scrollTop + 2 || nextTop === previousScrollTop) {
          stalled += 1;
        } else {
          stalled = 0;
          previousScrollTop = scrollContainer.scrollTop;
          scrollContainer.scrollTop = nextTop;
          scrollContainer.dispatchEvent(new Event("scroll", { bubbles: true }));
          await delay(700);
        }
        if (stalled >= 2) break;
      }
    } finally {
      crmBatch.running = false;
      progress.running = false;
      progress.cancelled = crmBatch.cancelled;
      onProgress?.({ ...progress });
    }
    return progress;
  }

  function stopCrmBatch() {
    crmBatch.cancelled = true;
  }

  function findConversationRows() {
    const viewportRight = Math.min(640, innerWidth * 0.42);
    const anchors = Array.from(document.querySelectorAll('a[href*="/chat/"]'));
    const candidates = [...new Set([
      ...anchors,
      ...Array.from(document.querySelectorAll('[role="listitem"], [role="link"], [role="button"]')),
      ...Array.from(document.querySelectorAll("img")).map((image) => conversationRowFromAvatar(image, viewportRight)).filter(Boolean)
    ])];
    const rows = [];
    const seen = new Set();

    for (const element of candidates) {
      if (element.closest?.(`#${ROOT_ID}`) || !isVisibleInViewport(element)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.left < 45 || rect.right > viewportRight || rect.top < 100 || rect.height < 42 || rect.height > 170 || rect.width < 180) continue;
      if (!element.querySelector?.("img")) continue;
      const href = element.href || element.getAttribute?.("href") || "";
      const uidMatch = String(href).match(/\/chat\/(U[0-9a-f]{32})(?:[/?#]|$)/i);
      const label = normalizeDisplayText(element.innerText || element.textContent || "");
      if (!uidMatch && !label) continue;
      const image = element.querySelector("img");
      const key = uidMatch?.[1]?.toLowerCase() || `${label}|${safeAvatarUrl(image?.currentSrc || image?.src || "")}`;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push({ element, key, uid: uidMatch?.[1] || "" });
    }
    return rows.sort((left, right) => left.element.getBoundingClientRect().top - right.element.getBoundingClientRect().top);
  }

  function conversationRowFromAvatar(image, viewportRight) {
    if (!isVisibleInViewport(image)) return null;
    const imageRect = image.getBoundingClientRect();
    if (imageRect.left < 45 || imageRect.right > viewportRight || imageRect.top < 100) return null;
    if (imageRect.width < 28 || imageRect.width > 96 || imageRect.height < 28 || imageRect.height > 96) return null;
    let element = image.parentElement;
    while (element && element !== document.body) {
      const rect = element.getBoundingClientRect();
      if (rect.left >= 45 && rect.right <= viewportRight && rect.top >= 100
        && rect.width >= 180 && rect.height >= 42 && rect.height <= 170) return element;
      element = element.parentElement;
    }
    return null;
  }

  function findConversationScrollContainer() {
    const rows = findConversationRows();
    if (!rows.length) return null;
    let element = rows[0].element.parentElement;
    while (element && element !== document.body) {
      const rect = element.getBoundingClientRect();
      if (rect.left < 540 && element.scrollHeight > element.clientHeight + 40 && element.clientHeight > 200) return element;
      element = element.parentElement;
    }
    return null;
  }

  async function waitForConversationContact(beforeUid, expectedUid) {
    const startedAt = Date.now();
    while (!crmBatch.cancelled && Date.now() - startedAt < 8000) {
      const contact = readActiveContact();
      const uidMatches = expectedUid
        ? contact.uid.toLowerCase() === expectedUid.toLowerCase()
        : contact.uid && contact.uid !== beforeUid;
      if (uidMatches && (contact.name || contact.avatarUrl)) {
        await delay(650);
        return readActiveContact();
      }
      await delay(200);
    }
    return null;
  }

  function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function readUidFromLocation() {
    if (typeof location === "undefined") return "";
    const match = String(location.pathname || "").match(/\/chat\/([^/?#]+)/i);
    if (!match) return "";
    try {
      const value = decodeURIComponent(match[1]);
      return /^[A-Za-z0-9_-]{8,128}$/.test(value) ? value : "";
    } catch {
      return "";
    }
  }

  function safeAvatarUrl(value) {
    const url = String(value || "").trim();
    return /^(https?:|blob:|data:image\/)/i.test(url) ? url : "";
  }

  async function copySuggestion(index) {
    const suggestion = state.suggestions[index];
    if (!suggestion) return;
    try {
      await navigator.clipboard.writeText(suggestion.answer);
      state.notice = "建議已複製；請人工確認後再貼回 LINE";
    } catch {
      state.notice = "瀏覽器拒絕剪貼簿操作，請手動選取建議內容";
    }
    render();
  }

  function collectVisibleMessages() {
    const preferredSelectors = [
      '[data-testid*="message" i]',
      '[class*="message" i]',
      '[aria-label*="訊息"]',
      '[aria-label*="message" i]',
      '[role="log"] > *',
      'main [role="listitem"]'
    ];
    const preferred = preferredSelectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
    const fallback = location.hostname === "chat.line.biz"
      ? Array.from(document.querySelectorAll("p, span, div"))
      : Array.from(document.querySelectorAll('main p, main [dir="auto"], main [role="row"]'));
    const records = [
      ...messageRecords(preferred, false),
      ...messageRecords(fallback, location.hostname === "chat.line.biz")
    ];
    const latestByText = new Map();
    for (const record of records) {
      const previous = latestByText.get(record.text);
      if (!previous || record.top >= previous.top) latestByText.set(record.text, record);
    }
    return [...latestByText.values()]
      .sort((left, right) => left.top - right.top || left.left - right.left)
      .slice(-MESSAGE_LIMIT)
      .map((record) => record.text);
  }

  function messageRecords(elements, restrictToChatSurface) {
    const records = [];
    const panelLeft = root?.getBoundingClientRect?.().left || innerWidth;
    const chatLeft = Math.min(520, innerWidth * 0.24);
    for (const element of [...new Set(elements)]) {
      if (element.closest(`#${ROOT_ID}`) || !isVisibleInViewport(element) || element.childElementCount > 8) continue;
      const rect = element.getBoundingClientRect();
      if (restrictToChatSurface) {
        if (element.childElementCount > 1) continue;
        if (element.closest('button, a, input, textarea, select, nav, header, [role="button"]')) continue;
        if (rect.left < chatLeft || rect.right > panelLeft || rect.top < 150 || rect.bottom > innerHeight - 30) continue;
      }
      const text = normalizeDisplayText(element.innerText || element.textContent || "");
      if (!text || text.length > 600 || isInterfaceText(text)) continue;
      records.push({ text, top: rect.top, left: rect.left });
    }
    return records;
  }

  function isInterfaceText(text) {
    if (/^\d{1,2}:\d{2}$/.test(text)) return true;
    if (/^(已讀|傳送|搜尋|全部|待處理|處理完畢|使用手動聊天|預約傳送)$/.test(text)) return true;
    return text.includes("功能執行中") || text.includes("目前為回應時間內") || text.includes("若希望暫時以手動聊天");
  }
  function isVisibleInViewport(element) {
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 2 && rect.height > 2 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
  }

  function rankSuggestions(messages, knowledge) {
    const ranked = [];
    for (const message of messages.slice(-3).reverse()) {
      for (const item of knowledge) {
        const score = similarity(message, item.question);
        if (score < 0.12) continue;
        ranked.push({
          id: item.id,
          score,
          message,
          question: item.question,
          answer: item.answer,
          category: item.category || "未分類"
        });
      }
    }
    const used = new Set();
    return ranked
      .sort((left, right) => right.score - left.score)
      .filter((item) => {
        if (used.has(item.id)) return false;
        used.add(item.id);
        return true;
      })
      .slice(0, 3);
  }

  function similarity(left, right) {
    const a = normalizeForMatch(left);
    const b = normalizeForMatch(right);
    if (!a || !b) return 0;
    if (a.includes(b) || b.includes(a)) return 1;
    const aPairs = bigrams(a);
    const bPairs = bigrams(b);
    let overlap = 0;
    const remaining = new Map();
    for (const pair of bPairs) remaining.set(pair, (remaining.get(pair) || 0) + 1);
    for (const pair of aPairs) {
      const count = remaining.get(pair) || 0;
      if (count > 0) {
        overlap += 1;
        remaining.set(pair, count - 1);
      }
    }
    return (2 * overlap) / Math.max(1, aPairs.length + bPairs.length);
  }

  function bigrams(text) {
    if (text.length < 2) return [text];
    return Array.from({ length: text.length - 1 }, (_, index) => text.slice(index, index + 2));
  }

  function normalizeForMatch(value) {
    return String(value || "").toLocaleLowerCase("zh-TW").replace(/[\s\p{P}\p{S}]+/gu, "");
  }

  function normalizeDisplayText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function send(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) return reject(new Error("LINEOA 背景服務未連線"));
        if (!response?.ok) return reject(new Error(response?.message || "LINEOA 操作失敗"));
        resolve(response);
      });
    });
  }

  function observeReinsertion() {
    const observer = new MutationObserver(() => {
      if (!document.documentElement.contains(root)) document.documentElement.appendChild(root);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function render() {
    if (!root) return;
    root.dataset.mode = state.mode;

    if (state.mode === "float") {
      root.innerHTML = `
        <button class="lineoa-fab" type="button" data-action="mode" data-mode="side" aria-label="開啟 LINEOA">
          <span>LO</span><strong>LINEOA</strong>
        </button>`;
      return;
    }

    if (state.mode === "full") {
      root.innerHTML = fullAdminView();
      return;
    }

    root.innerHTML = `
      <section class="lineoa-shell" aria-live="polite">
        <header class="lineoa-header">
          <div><strong>LINEOA</strong><small>聊天室監控 v0.1.15</small></div>
          <nav aria-label="顯示模式">
            <button type="button" data-action="mode" data-mode="float" title="縮成懸浮按鈕">—</button>
            <button type="button" data-action="mode" data-mode="full" title="開啟管理全版">□</button>
          </nav>
        </header>
        <div class="lineoa-body">
          ${state.loading ? loadingView() : state.user ? workspaceView() : authView()}
        </div>
      </section>`;
  }

  function fullAdminView() {
    const titles = {
      overview: "工作總覽",
      monitor: "聊天室監控",
      crm: "客戶 CRM",
      knowledge: "知識庫",
      account: "帳戶方案",
      settings: "串接設定"
    };
    const title = titles[state.adminView] || titles.overview;
    const current = state.usage?.current || state.knowledge.length || 0;
    const limit = state.usage?.limit || state.limits?.knowledgeItems || 100;
    const navItem = (view, icon, label) => `
      <button type="button" class="lineoa-admin-nav-item ${state.adminView === view ? "active" : ""}" data-action="admin-view" data-view="${view}">
        <span>${icon}</span><strong>${label}</strong>
      </button>`;
    const groupHeader = (group, icon, label) => `
      <button type="button" class="lineoa-admin-group" data-action="toggle-admin-group" data-group="${group}" aria-expanded="${state.adminGroups[group]}">
        <span>${icon} ${label}</span><i>${state.adminGroups[group] ? "⌄" : "›"}</i>
      </button>`;

    return `
      <section class="lineoa-admin-shell" aria-live="polite">
        <aside class="lineoa-admin-sidebar">
          <div class="lineoa-admin-brand"><span>LO</span><div><strong>LINEOA</strong><small>管理中心 v0.1.13</small></div></div>
          <nav>
            ${groupHeader("service", "📦", "服務中心")}
            ${state.adminGroups.service ? `
              ${navItem("overview", "▦", "工作總覽")}
              ${navItem("monitor", "◉", "聊天室監控")}
              ${navItem("crm", "♙", "客戶 CRM")}` : ""}
            ${groupHeader("tools", "🛠️", "管理工具")}
            ${state.adminGroups.tools ? `
              ${navItem("knowledge", "▤", "知識庫")}
              ${navItem("account", "◎", "帳戶方案")}
              ${navItem("settings", "⚙", "串接設定")}` : ""}
          </nav>
          <div class="lineoa-admin-sidebar-footer">
            ${state.user ? `<strong>${escapeHtml(state.user.displayName || state.user.email)}</strong><small>免費版 · ${current}/${limit} 筆知識</small><button type="button" data-action="logout">安全登出</button>` : "<small>請先登入 LINEOA</small>"}
          </div>
        </aside>
        <main class="lineoa-admin-main">
          <header class="lineoa-admin-header">
            <div><h2>${title}</h2><p>LINEOA 客服營運管理</p></div>
            <div class="lineoa-admin-header-actions">
              <span class="lineoa-channel-status"><i></i>通道正常</span>
              <button type="button" data-action="sync" ${state.user ? "" : "disabled"}>重新同步</button>
              <button type="button" data-action="mode" data-mode="side" title="回到側邊監控">縮小</button>
              <button type="button" data-action="mode" data-mode="float" title="收合">×</button>
            </div>
          </header>
          <div class="lineoa-admin-content">
            ${state.loading ? loadingView() : state.adminView === "settings" ? fullSettingsView() : state.user ? fullAdminContent(current, limit) : fullAdminLogin()}
          </div>
        </main>
      </section>`;
  }

  function fullAdminLogin() {
    return `
      <div class="lineoa-admin-login">
        <div class="lineoa-admin-login-card">
          <span class="lineoa-admin-login-icon">LO</span>
          ${authView()}
        </div>
      </div>`;
  }

  function fullAdminContent(current, limit) {
    if (state.adminView === "monitor") return fullMonitorView();
    if (state.adminView === "crm") return globalThis.LINEOA_CRM.renderView();
    if (state.adminView === "knowledge") return fullKnowledgeView(current, limit);
    if (state.adminView === "account") return fullAccountView(current, limit);
    if (state.adminView === "settings") return fullSettingsView();
    return fullOverviewView(current, limit);
  }

  function fullSettingsView() {
    return `
      <div class="lineoa-admin-settings-intro">
        <div><span>⚙</span><div><h3>LINE API 串接設定</h3><p>填寫使用者自己的 LINE Login 與 Messaging API 參數</p></div></div>
        <button class="lineoa-primary" type="button" data-action="open-settings">開啟安全設定頁</button>
      </div>
      <div class="lineoa-admin-grid">
        <section class="lineoa-admin-card">
          <div class="lineoa-admin-card-title"><div><h3>LINE Login API</h3><p>會員登入與授權</p></div><span>2 項參數</span></div>
          <div class="lineoa-settings-field-list"><span>LINE Login Channel ID</span><span>LINE Login Channel secret</span></div>
        </section>
        <section class="lineoa-admin-card">
          <div class="lineoa-admin-card-title"><div><h3>LINE Messaging API</h3><p>官方帳號機器人與訊息 API</p></div><span>2 項參數</span></div>
          <div class="lineoa-settings-field-list"><span>LINE Bot Channel access token</span><span>LINE Bot Channel secret</span></div>
        </section>
        <section class="lineoa-admin-card">
          <div class="lineoa-admin-card-title"><div><h3>圖文選單上傳</h3><p>上傳底圖、劃定區域並部署至 LINE</p></div><span>30 天試用</span></div>
          <div class="lineoa-admin-quick"><button class="lineoa-primary" type="button" data-action="open-rich-menu">開啟圖文選單編輯器</button><small>試用後 NT$199／年</small></div>
        </section>
      </div>
      <section class="lineoa-admin-card">
        <div class="lineoa-admin-table-row"><strong>憑證保護</strong><span>設定表單位於 Chrome 擴充功能私有頁面，不放入 LINE 聊天頁 DOM</span><em>安全</em></div>
        <div class="lineoa-admin-table-row"><strong>目前行為</strong><span>此版本只安全保管參數，不會自動發送 LINE 訊息</span><em>不傳送</em></div>
      </section>`;
  }

  function fullOverviewView(current, limit) {
    return `
      <div class="lineoa-admin-stats">
        ${statCard("知識庫用量", `${current} / ${limit}`, "免費方案上限")}
        ${statCard("目前對話", state.messages.length, "已讀取可見訊息")}
        ${statCard("建議回覆", state.suggestions.length, "本次比對結果")}
        ${statCard("服務狀態", "正常", "LINEOA API 已連線", "green")}
      </div>
      ${noticeView()}
      <div class="lineoa-admin-grid">
        <section class="lineoa-admin-card">
          <div class="lineoa-admin-card-title"><div><h3>聊天室監控</h3><p>切換聯絡人後自動讀取目前對話並與知識庫比對</p></div><span>客服工具</span></div>
          <div class="lineoa-admin-quick">
            <button class="lineoa-primary" type="button" data-action="admin-view" data-view="monitor">進入聊天室監控</button>
            <button type="button" data-action="scan">立即讀取並比對</button>
          </div>
        </section>
        <section class="lineoa-admin-card">
          <div class="lineoa-admin-card-title"><div><h3>知識庫</h3><p>管理客服問答與建議回覆內容</p></div><span>${current} 筆</span></div>
          <div class="lineoa-admin-quick">
            <button class="lineoa-primary" type="button" data-action="admin-view" data-view="knowledge">查看知識庫</button>
            <button type="button" data-action="sync">同步最新資料</button>
          </div>
        </section>
      </div>
      <section class="lineoa-admin-card lineoa-admin-activity">
        <div class="lineoa-admin-card-title"><div><h3>使用說明</h3><p>LINEOA 自動跟隨目前聊天室</p></div></div>
        <div class="lineoa-admin-table-row"><strong>隱私保護</strong><span>不讀取 Cookie、LINE Token，也不會自動發送訊息</span><em>安全</em></div>
        <div class="lineoa-admin-table-row"><strong>聊天室監控</strong><span>切換聯絡人後讀取目前畫面可見文字</span><em>自動</em></div>
      </section>`;
  }

  function fullMonitorView() {
    return `
      ${contactView("wide")}
      <div class="lineoa-admin-toolbar">
        <div><strong>客服對話分析</strong><span>自動跟隨目前聊天室可見訊息，於本機比對知識庫</span></div>
        <div><button type="button" data-action="sync">同步知識庫</button><button class="lineoa-primary" type="button" data-action="scan">重新讀取目前聊天室</button></div>
      </div>
      ${noticeView()}
      <div class="lineoa-monitor-layout">
        <section class="lineoa-admin-card">
          <div class="lineoa-admin-card-title"><div><h3>目前可見文字</h3><p>最多顯示 ${MESSAGE_LIMIT} 則</p></div><span>${state.messages.length}/${MESSAGE_LIMIT}</span></div>
          ${state.messages.length ? `<ol class="lineoa-messages">${state.messages.map((message) => `<li>${escapeHtml(message)}</li>`).join("")}</ol>` : emptyCard("尚未讀取對話")}
        </section>
        <section class="lineoa-admin-card">
          <div class="lineoa-admin-card-title"><div><h3>建議回覆</h3><p>依知識庫相似度排序</p></div><span>${state.suggestions.length}</span></div>
          ${state.suggestions.length ? state.suggestions.map((item, index) => suggestionCard(item, index)).join("") : emptyCard(state.messages.length ? "知識庫中沒有相近答案" : "讀取對話後顯示建議")}
        </section>
      </div>
      <div class="lineoa-privacy-note">切換聊天室後會自動讀取畫面目前可見文字；比對在瀏覽器內完成，不會自動發送。</div>`;
  }

  function fullKnowledgeView(current, limit) {
    return `
      <div class="lineoa-admin-toolbar">
        <div><strong>知識庫內容</strong><span>免費版 ${current}/${limit} 筆</span></div>
        <div><button type="button" data-action="sync">同步知識庫</button><a href="https://line-oa.fangwl591021.workers.dev/app" target="_blank" rel="noreferrer">新增與編輯</a></div>
      </div>
      ${noticeView()}
      <section class="lineoa-admin-card lineoa-knowledge-table">
        <div class="lineoa-knowledge-head"><span>分類</span><span>問題</span><span>答案</span></div>
        ${state.knowledge.length ? state.knowledge.map((item) => `
          <div class="lineoa-knowledge-row"><span>${escapeHtml(item.category || "未分類")}</span><strong>${escapeHtml(item.question)}</strong><p>${escapeHtml(item.answer)}</p></div>`).join("") : emptyCard("目前沒有知識內容")}
      </section>`;
  }

  function fullAccountView(current, limit) {
    const percentage = Math.min(100, Math.round((current / Math.max(limit, 1)) * 100));
    return `
      <div class="lineoa-admin-grid">
        <section class="lineoa-admin-card">
          <div class="lineoa-admin-card-title"><div><h3>帳戶資料</h3><p>目前登入的 LINEOA 帳戶</p></div><span>已登入</span></div>
          <dl class="lineoa-account-details">
            <div><dt>顯示名稱</dt><dd>${escapeHtml(state.user.displayName || "-")}</dd></div>
            <div><dt>Email</dt><dd>${escapeHtml(state.user.email || "-")}</dd></div>
            <div><dt>方案</dt><dd>免費版</dd></div>
          </dl>
        </section>
        <section class="lineoa-admin-card">
          <div class="lineoa-admin-card-title"><div><h3>知識庫額度</h3><p>免費方案最多 ${limit} 筆</p></div><span>${percentage}%</span></div>
          <div class="lineoa-quota"><i style="width:${percentage}%"></i></div>
          <strong class="lineoa-quota-label">${current} / ${limit} 筆</strong>
        </section>
      </div>
      <section class="lineoa-admin-card">
        <div class="lineoa-admin-card-title"><div><h3>安全與隱私</h3><p>擴充功能資料邊界</p></div></div>
        <div class="lineoa-admin-table-row"><strong>登入權杖</strong><span>只保存在 Chrome 擴充功能自己的儲存空間</span><em>本機</em></div>
        <div class="lineoa-admin-table-row"><strong>LINE 資料</strong><span>不讀取 Cookie 或 LINE Token；CRM 自動擷取預設關閉，只同步 UID、名稱與頭貼</span><em>可控</em></div>
      </section>`;
  }

  function statCard(label, value, note, tone = "") {
    return `<article class="lineoa-stat-card ${tone}"><span>${label}</span><strong>${escapeHtml(value)}</strong><small>${note}</small></article>`;
  }

  function loadingView() {
    return '<div class="lineoa-empty"><span class="lineoa-spinner"></span><p>LINEOA 載入中</p></div>';
  }

  function authView() {
    const registering = state.authMode === "register";
    return `
      <div class="lineoa-auth">
        <h2>${registering ? "免費註冊" : "登入 LINEOA"}</h2>
        <p>登入資料只會傳送到 LINEOA 正式 API，不會提供給 LINE。</p>
        <div class="lineoa-tabs">
          <button type="button" data-action="auth-mode" data-mode="login" class="${registering ? "" : "active"}">登入</button>
          <button type="button" data-action="auth-mode" data-mode="register" class="${registering ? "active" : ""}">免費註冊</button>
        </div>
        <form id="lineoa-auth-form">
          ${registering ? `
            <label>姓名<input name="displayName" minlength="2" maxlength="80" required autocomplete="name"></label>
            <label>公司／品牌<input name="companyName" maxlength="120" autocomplete="organization"></label>` : ""}
          <label>Email<input name="email" type="email" maxlength="254" required autocomplete="email"></label>
          <label>密碼<input name="password" type="password" minlength="8" maxlength="200" required autocomplete="${registering ? "new-password" : "current-password"}"></label>
          <button class="lineoa-primary" type="submit">${registering ? "建立免費帳號" : "登入"}</button>
        </form>
        ${noticeView()}
        <a class="lineoa-link" href="https://line-oa.fangwl591021.workers.dev/privacy" target="_blank" rel="noreferrer">隱私權說明</a>
      </div>`;
  }

  function workspaceView() {
    return `
      <div class="lineoa-account">
        <div><strong>${escapeHtml(state.user.displayName || state.user.email)}</strong><small>免費版 · ${state.usage?.current || 0}/${state.usage?.limit || state.limits?.knowledgeItems || 100} 筆知識</small></div>
        <button type="button" data-action="logout">登出</button>
      </div>
      ${contactView()}
      <div class="lineoa-actions">
        <button class="lineoa-primary" type="button" data-action="scan">重新讀取目前聊天室</button>
        <button type="button" data-action="sync">同步知識庫</button>
      </div>
      <div class="lineoa-privacy-note">切換聊天室後會自動讀取畫面目前可見文字；比對在瀏覽器內完成，不讀取 Cookie、LINE Token，也不會自動發送。</div>
      ${noticeView()}
      <section class="lineoa-section">
        <h3>目前可見文字 <span>${state.messages.length}/${MESSAGE_LIMIT}</span></h3>
        ${state.messages.length ? `<ol class="lineoa-messages">${state.messages.map((message) => `<li>${escapeHtml(message)}</li>`).join("")}</ol>` : emptyCard("尚未讀取對話")}
      </section>
      <section class="lineoa-section">
        <h3>建議回覆 <span>${state.suggestions.length}</span></h3>
        ${state.suggestions.length ? state.suggestions.map((item, index) => suggestionCard(item, index)).join("") : emptyCard(state.messages.length ? "知識庫中沒有相近答案" : "讀取對話後顯示建議")}
      </section>
      <a class="lineoa-manage" href="https://line-oa.fangwl591021.workers.dev/app" target="_blank" rel="noreferrer">管理我的知識庫 ↗</a>`;
  }

  function contactView(extraClass = "") {
    const contact = state.contact;
    if (!contact.uid && !contact.name && !contact.avatarUrl) {
      return `<section class="lineoa-contact-card ${extraClass} empty"><span class="lineoa-contact-avatar">?</span><div><strong>尚未選擇聯絡人</strong><small>請從左側切換聊天室</small></div></section>`;
    }
    const label = contact.name || "目前聯絡人";
    const initial = Array.from(label)[0] || "?";
    return `
      <section class="lineoa-contact-card ${extraClass}">
        ${contact.avatarUrl
          ? `<img class="lineoa-contact-avatar" src="${escapeHtml(contact.avatarUrl)}" alt="" referrerpolicy="no-referrer">`
          : `<span class="lineoa-contact-avatar">${escapeHtml(initial)}</span>`}
        <div><strong>${escapeHtml(label)}</strong><small>LINE UID <code>${escapeHtml(contact.uid || "未取得")}</code></small></div>
        <em>自動跟隨</em>
      </section>`;
  }

  function suggestionCard(item, index) {
    return `
      <article class="lineoa-suggestion">
        <div class="lineoa-suggestion-meta"><span>${escapeHtml(item.category)}</span><small>符合度 ${Math.round(item.score * 100)}%</small></div>
        <strong>${escapeHtml(item.question)}</strong>
        <p>${escapeHtml(item.answer)}</p>
        <button type="button" data-action="copy" data-index="${index}">複製建議</button>
      </article>`;
  }

  function noticeView() {
    return state.notice ? `<div class="lineoa-notice">${escapeHtml(state.notice)}</div>` : "";
  }

  function emptyCard(text) {
    return `<div class="lineoa-empty-card">${escapeHtml(text)}</div>`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[character]);
  }
})();
