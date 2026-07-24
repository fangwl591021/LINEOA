"use strict";

(() => {
  const ROOT_ID = "lineoa-extension-root";
  const MODE_KEY = "lineoa_panel_mode";
  const MESSAGE_LIMIT = 5;
  const state = {
    mode: "side",
    authMode: "login",
    user: null,
    limits: null,
    knowledge: [],
    usage: null,
    messages: [],
    suggestions: [],
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

    const stored = await chrome.storage.local.get(MODE_KEY);
    if (["float", "side", "full"].includes(stored[MODE_KEY])) state.mode = stored[MODE_KEY];
    await restoreSession();
  }

  async function restoreSession() {
    state.loading = true;
    render();
    try {
      const session = await send({ type: "lineoa:session" });
      if (session.authenticated) {
        state.user = session.user;
        state.limits = session.limits;
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

      if (action === "mode") return setMode(button.dataset.mode);
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
      await loadKnowledge();
      state.notice = "登入成功，知識庫已同步";
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

  function scanVisibleConversation() {
    state.messages = collectVisibleMessages();
    state.suggestions = rankSuggestions(state.messages, state.knowledge);
    state.notice = state.messages.length
      ? `已在本機比對 ${state.messages.length} 則目前可見文字，沒有傳送聊天內容`
      : "找不到可見訊息；請先開啟 LINE OA 聊天室並顯示對話";
    render();
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
    let candidates = preferredSelectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));

    if (!candidates.length) {
      candidates = Array.from(document.querySelectorAll('main p, main [dir="auto"], main [role="row"]'));
    }

    const texts = [];
    const seen = new Set();
    for (const element of [...new Set(candidates)]) {
      if (element.closest(`#${ROOT_ID}`) || !isVisibleInViewport(element) || element.childElementCount > 8) continue;
      const text = normalizeDisplayText(element.innerText || element.textContent || "");
      if (!text || text.length > 600 || seen.has(text)) continue;
      seen.add(text);
      texts.push(text);
    }
    return texts.slice(-MESSAGE_LIMIT);
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

    root.innerHTML = `
      <section class="lineoa-shell" aria-live="polite">
        <header class="lineoa-header">
          <div><strong>LINEOA</strong><small>免審查測試版 v0.1.1</small></div>
          <nav aria-label="顯示模式">
            <button type="button" data-action="mode" data-mode="float" title="縮成懸浮按鈕">—</button>
            <button type="button" data-action="mode" data-mode="${state.mode === "full" ? "side" : "full"}" title="切換全螢幕">${state.mode === "full" ? "▣" : "□"}</button>
          </nav>
        </header>
        <div class="lineoa-body">
          ${state.loading ? loadingView() : state.user ? workspaceView() : authView()}
        </div>
      </section>`;
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
      <div class="lineoa-actions">
        <button class="lineoa-primary" type="button" data-action="scan">讀取目前可見對話並比對</button>
        <button type="button" data-action="sync">同步知識庫</button>
      </div>
      <div class="lineoa-privacy-note">只有你按下按鈕時，才會讀取畫面目前可見文字；比對在瀏覽器內完成，不讀取 Cookie、LINE Token，也不會自動發送。</div>
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
