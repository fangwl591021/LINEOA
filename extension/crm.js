"use strict";

(() => {
  const AUTO_KEY = "lineoa_crm_auto_capture";
  const state = {
    authenticated: false,
    autoCapture: false,
    contacts: [],
    summary: { total: 0, newThisMonth: 0, active: 0, tagged: 0 },
    selectedId: "",
    loading: false,
    notice: "",
    lastSyncKey: "",
    timer: 0,
    render: () => {}
  };

  async function init(render) {
    state.render = typeof render === "function" ? render : () => {};
    const stored = await chrome.storage.local.get(AUTO_KEY);
    state.autoCapture = stored[AUTO_KEY] === true;
  }

  function setAuthenticated(value) {
    state.authenticated = value === true;
    if (!state.authenticated) {
      state.contacts = [];
      state.selectedId = "";
      state.lastSyncKey = "";
    }
  }

  async function load() {
    if (!state.authenticated) return;
    state.loading = true;
    state.render();
    try {
      const data = await send({ type: "lineoa:crm:list" });
      state.contacts = Array.isArray(data.contacts) ? data.contacts : [];
      state.summary = data.summary || { total: 0, newThisMonth: 0, active: 0, tagged: 0 };
    } catch (error) {
      state.notice = error.message;
    } finally {
      state.loading = false;
      state.render();
    }
  }

  function followConversation(contact) {
    clearTimeout(state.timer);
    if (!state.authenticated || !state.autoCapture) return;
    state.timer = setTimeout(() => {
      capture(contact, false).catch((error) => {
        state.notice = error.message;
        state.render();
      });
    }, 1200);
  }

  async function capture(contact, manual) {
    if (!state.authenticated) throw new Error("請先登入 LINEOA");
    if (location.hostname !== "chat.line.biz") throw new Error("請在 LINE OA 一對一聊天室中使用 CRM 擷取");
    const lineUid = String(contact?.uid || "");
    const displayName = String(contact?.name || "");
    const avatarUrl = String(contact?.avatarUrl || "");
    if (!/^U[0-9a-f]{32}$/i.test(lineUid)) throw new Error("目前聊天室沒有可用的 LINE UID");
    if (!displayName && !avatarUrl) throw new Error("目前聊天室尚未載入客戶名稱或頭貼");
    const key = `${lineUid}|${displayName}|${avatarUrl}`;
    if (!manual && key === state.lastSyncKey) return;
    const result = await send({
      type: "lineoa:crm:upsert",
      body: { lineUid, displayName, avatarUrl }
    });
    state.lastSyncKey = key;
    const index = state.contacts.findIndex((item) => item.id === result.contact.id);
    if (index >= 0) state.contacts.splice(index, 1, result.contact);
    else state.contacts.unshift(result.contact);
    state.notice = result.created ? "已將目前客戶新增至 CRM" : "已更新目前客戶的 CRM 資料";
    await load();
  }

  async function handleClick(action, button, contact) {
    if (action === "crm-auto-toggle") {
      state.autoCapture = !state.autoCapture;
      await chrome.storage.local.set({ [AUTO_KEY]: state.autoCapture });
      state.notice = state.autoCapture
        ? "CRM 自動擷取已開啟；符合條件的下一次聊天室切換才會自動寫入"
        : "CRM 自動擷取已關閉";
      if (state.autoCapture && contact) {
        try {
          await capture(contact, true);
        } catch (error) {
          state.notice = error.message;
        }
      }
      state.render();
      return true;
    }
    if (action === "crm-capture") {
      try {
        await capture(contact, true);
      } catch (error) {
        state.notice = error.message;
      }
      state.render();
      return true;
    }
    if (action === "crm-refresh") {
      await load();
      state.notice = `已同步 ${state.contacts.length} 位 CRM 客戶`;
      state.render();
      return true;
    }
    if (action === "crm-select") {
      state.selectedId = String(button?.dataset?.id || "");
      state.render();
      return true;
    }
    if (action === "crm-back") {
      state.selectedId = "";
      state.render();
      return true;
    }
    return false;
  }

  async function handleSubmit(form) {
    if (form?.id !== "lineoa-crm-form") return false;
    const data = new FormData(form);
    try {
      const result = await send({
        type: "lineoa:crm:update",
        id: state.selectedId,
        body: {
          displayName: data.get("displayName"),
          phone: data.get("phone"),
          email: data.get("email"),
          tags: String(data.get("tags") || "").split(","),
          notes: data.get("notes"),
          status: data.get("status")
        }
      });
      const index = state.contacts.findIndex((item) => item.id === result.contact.id);
      if (index >= 0) state.contacts.splice(index, 1, result.contact);
      state.selectedId = "";
      state.notice = "CRM 客戶資料已儲存";
    } catch (error) {
      state.notice = error.message;
    }
    state.render();
    return true;
  }

  function renderView() {
    const selected = state.contacts.find((item) => item.id === state.selectedId);
    if (selected) return renderProfile(selected);
    const summary = state.summary;
    return `
      <div class="lineoa-admin-stats">
        ${stat("客戶總數", summary.total || 0, "目前 LINEOA 帳戶")}
        ${stat("本月新增", summary.newThisMonth || 0, "首次寫入於本月")}
        ${stat("有效客戶", summary.active || 0, "未封存")}
        ${stat("已加標籤", summary.tagged || 0, "已有客戶分類", "green")}
      </div>
      <div class="lineoa-admin-toolbar lineoa-crm-toolbar">
        <div><strong>客戶 CRM</strong><span>客戶名單、檔案、標籤、備註與封存</span></div>
        <div>
          <button type="button" data-action="crm-refresh">同步名單</button>
          <button type="button" data-action="crm-capture">加入目前客戶</button>
          <button class="${state.autoCapture ? "lineoa-primary" : ""}" type="button" data-action="crm-auto-toggle">${state.autoCapture ? "自動擷取：開" : "自動擷取：關"}</button>
        </div>
      </div>
      <div class="lineoa-crm-rule ${state.autoCapture ? "active" : ""}">
        <strong>${state.autoCapture ? "自動寫入已開啟" : "自動寫入預設關閉"}</strong>
        <span>只有已登入、位於 chat.line.biz 一對一聊天室、取得有效 LINE UID 及名稱或頭貼、且切換穩定 1.2 秒後才會寫入。以「LINEOA 帳戶 + LINE UID」去重；不儲存聊天內容、Cookie 或 LINE Token。</span>
      </div>
      ${state.notice ? `<div class="lineoa-notice">${escapeHtml(state.notice)}</div>` : ""}
      <section class="lineoa-admin-card lineoa-crm-list">
        <div class="lineoa-crm-list-head"><span>客戶</span><span>標籤／聯絡方式</span><span>最近出現</span><span>操作</span></div>
        ${state.loading ? '<div class="lineoa-empty"><p>CRM 載入中</p></div>' : state.contacts.length ? state.contacts.map(renderRow).join("") : '<div class="lineoa-empty"><p>目前沒有 CRM 客戶</p></div>'}
      </section>`;
  }

  function renderProfile(contact) {
    return `
      <div class="lineoa-admin-toolbar">
        <div><strong>CRM 客戶檔案</strong><span>依 LINE UID 隔離於目前 LINEOA 帳戶</span></div>
        <div><button type="button" data-action="crm-back">返回客戶名單</button></div>
      </div>
      ${state.notice ? `<div class="lineoa-notice">${escapeHtml(state.notice)}</div>` : ""}
      <section class="lineoa-admin-card lineoa-crm-profile">
        <div class="lineoa-crm-profile-head">${avatar(contact)}<div><h3>${escapeHtml(contact.displayName || "未命名客戶")}</h3><code>${escapeHtml(contact.lineUid)}</code></div><span>${contact.status === "archived" ? "已封存" : "有效客戶"}</span></div>
        <form id="lineoa-crm-form" class="lineoa-crm-form">
          <label>客戶名稱<input name="displayName" maxlength="120" required value="${escapeHtml(contact.displayName)}"></label>
          <label>電話<input name="phone" maxlength="40" value="${escapeHtml(contact.phone)}"></label>
          <label>Email<input name="email" type="email" maxlength="254" value="${escapeHtml(contact.email)}"></label>
          <label>標籤（逗號分隔）<input name="tags" maxlength="500" value="${escapeHtml((contact.tags || []).join(", "))}"></label>
          <label class="lineoa-crm-wide">備註<textarea name="notes" maxlength="3000" rows="6">${escapeHtml(contact.notes)}</textarea></label>
          <label>狀態<select name="status"><option value="active" ${contact.status === "active" ? "selected" : ""}>有效</option><option value="archived" ${contact.status === "archived" ? "selected" : ""}>封存</option></select></label>
          <div class="lineoa-crm-form-actions"><button type="button" data-action="crm-back">取消</button><button class="lineoa-primary" type="submit">儲存客戶檔案</button></div>
        </form>
      </section>`;
  }

  function renderRow(contact) {
    return `<div class="lineoa-crm-row ${contact.status === "archived" ? "archived" : ""}">
      <div class="lineoa-crm-person">${avatar(contact)}<div><strong>${escapeHtml(contact.displayName || "未命名客戶")}</strong><code>${escapeHtml(contact.lineUid)}</code></div></div>
      <div><span>${escapeHtml((contact.tags || []).join("、") || "尚未加標籤")}</span><small>${escapeHtml(contact.phone || contact.email || "尚未補充聯絡方式")}</small></div>
      <time>${escapeHtml(formatDate(contact.lastSeenAt))}</time>
      <button type="button" data-action="crm-select" data-id="${escapeHtml(contact.id)}">CRM 檔案</button>
    </div>`;
  }

  function avatar(contact) {
    return contact.avatarUrl
      ? `<img class="lineoa-contact-avatar" src="${escapeHtml(contact.avatarUrl)}" alt="">`
      : `<span class="lineoa-contact-avatar">${escapeHtml((contact.displayName || "?").slice(0, 1))}</span>`;
  }

  function stat(label, value, note, tone = "") {
    return `<article class="lineoa-stat-card ${tone}"><span>${label}</span><strong>${escapeHtml(value)}</strong><small>${note}</small></article>`;
  }

  function formatDate(value) {
    const time = Date.parse(String(value || ""));
    if (!Number.isFinite(time)) return "-";
    return new Intl.DateTimeFormat("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(time));
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  function send(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) return reject(new Error("LINEOA 背景服務未連線"));
        if (!response?.ok) return reject(new Error(response?.message || "LINEOA CRM 操作失敗"));
        resolve(response);
      });
    });
  }

  globalThis.LINEOA_CRM = {
    init,
    setAuthenticated,
    load,
    followConversation,
    handleClick,
    handleSubmit,
    renderView
  };
})();
