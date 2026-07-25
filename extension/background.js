import { handleRichMenuMessage, isRichMenuMessage } from "./rich-menu-background.js";

"use strict";

const API_BASE = "https://line-oa.fangwl591021.workers.dev";
const TOKEN_KEY = "lineoa_token";
const SETTINGS_KEY = "lineoa_integration_settings";
const CRM_PENDING_URL_KEY = "lineoa_crm_pending_url_capture";
const CRM_URL_RESULT_KEY = "lineoa_crm_url_capture_result";

chrome.runtime.onInstalled.addListener(() => {
  console.info("LINEOA test extension installed");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!sender.id || sender.id !== chrome.runtime.id) {
    sendResponse({ ok: false, message: "不允許的訊息來源" });
    return false;
  }

  const operation = isRichMenuMessage(message)
    ? handleRichMenuMessage(message, sender)
    : handleMessage(message, sender);
  operation
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, message: error.message || "擴充功能暫時無法處理" }));
  return true;
});

async function handleMessage(message, sender) {
  const type = String(message?.type || "");

  if (type === "lineoa:session") {
    const token = await getToken();
    if (!token) return { ok: true, authenticated: false };
    try {
      const data = await apiRequest("/api/auth/me", { token });
      return { ...data, authenticated: true };
    } catch (error) {
      if (error.status === 401) await clearToken();
      throw error;
    }
  }

  if (type === "lineoa:auth") {
    const mode = message.mode === "register" ? "register" : "login";
    const data = await apiRequest(`/api/auth/${mode}`, {
      method: "POST",
      body: sanitizeAuthBody(message.body, mode)
    });
    if (!data.token) throw new Error("登入回應缺少工作階段");
    await chrome.storage.local.set({ [TOKEN_KEY]: data.token });
    return { ok: true, user: data.user, limits: data.limits };
  }

  if (type === "lineoa:logout") {
    const token = await getToken();
    try {
      if (token) await apiRequest("/api/auth/logout", { method: "POST", token });
    } finally {
      await clearToken();
    }
    return { ok: true };
  }

  if (type === "lineoa:knowledge:list") {
    const token = await requireToken();
    return apiRequest("/api/knowledge", { token });
  }


  if (type === "lineoa:crm:open-chat") {
    requireLinePage(sender);
    await requireToken();
    const target = sanitizeCrmChatUrl(message.url);
    await chrome.storage.local.set({
      [CRM_PENDING_URL_KEY]: { uid: target.uid, expiresAt: Date.now() + 2 * 60 * 1000 }
    });
    await chrome.storage.local.remove(CRM_URL_RESULT_KEY);
    try {
      await chrome.tabs.create({ url: target.url, active: true });
    } catch (error) {
      await chrome.storage.local.remove(CRM_PENDING_URL_KEY);
      throw error;
    }
    return { ok: true, uid: target.uid };
  }

  if (type === "lineoa:crm:list") {
    requireLinePage(sender);
    const token = await requireToken();
    return apiRequest("/api/crm/contacts", { token });
  }

  if (type === "lineoa:crm:upsert") {
    requireLinePage(sender);
    const token = await requireToken();
    return apiRequest("/api/crm/contacts/upsert", {
      method: "POST",
      token,
      body: sanitizeCrmCapture(message.body)
    });
  }

  if (type === "lineoa:crm:update") {
    requireLinePage(sender);
    const token = await requireToken();
    const id = String(message.id || "").trim().slice(0, 80);
    if (!id) throw new Error("CRM 聯絡人識別碼無效");
    return apiRequest(`/api/crm/contacts/${encodeURIComponent(id)}`, {
      method: "PATCH", token, body: sanitizeCrmUpdate(message.body)
    });
  }
  if (type === "lineoa:settings:get") {
    requireOptionsPage(sender);
    return settingsView(await getIntegrationSettings());
  }

  if (type === "lineoa:settings:save") {
    requireOptionsPage(sender);
    const current = await getIntegrationSettings();
    const settings = sanitizeIntegrationSettings(message.body, current);
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    return settingsView(settings);
  }

  if (type === "lineoa:settings:clear") {
    requireOptionsPage(sender);
    await chrome.storage.local.remove(SETTINGS_KEY);
    return settingsView({});
  }

  if (type === "lineoa:settings:open") {
    await chrome.runtime.openOptionsPage();
    return { ok: true };
  }

  if (type === "lineoa:health") {
    return apiRequest("/health");
  }

  throw new Error("不支援的擴充功能操作");
}

async function apiRequest(path, options = {}) {
  const headers = { accept: "application/json" };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers["content-type"] = "application/json";

  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    referrerPolicy: "no-referrer"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || `LINEOA API 錯誤 (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function sanitizeAuthBody(input, mode) {
  const body = {
    email: String(input?.email || "").trim().slice(0, 254),
    password: String(input?.password || "").slice(0, 200)
  };
  if (mode === "register") {
    body.displayName = String(input?.displayName || "").trim().slice(0, 80);
    body.companyName = String(input?.companyName || "").trim().slice(0, 120);
  }
  return body;
}

async function getIntegrationSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const value = stored[SETTINGS_KEY];
  return value && typeof value === "object" ? value : {};
}

function sanitizeIntegrationSettings(input, current) {
  const next = {
    lineLoginChannelId: String(input?.lineLoginChannelId || "").trim().slice(0, 80),
    lineLoginChannelSecret: String(current?.lineLoginChannelSecret || ""),
    lineBotChannelAccessToken: String(current?.lineBotChannelAccessToken || ""),
    lineBotChannelSecret: String(current?.lineBotChannelSecret || "")
  };
  for (const field of ["lineLoginChannelSecret", "lineBotChannelAccessToken", "lineBotChannelSecret"]) {
    const limit = field === "lineBotChannelAccessToken" ? 5000 : 200;
    const value = String(input?.[field] || "").trim();
    if (value) next[field] = value.slice(0, limit);
  }

  return next;
}

function sanitizeCrmChatUrl(input) {
  let url;
  try {
    url = new URL(String(input || "").trim());
  } catch {
    throw new Error("請輸入有效的聊天室網址");
  }
  if (url.protocol !== "https:" || url.hostname !== "chat.line.biz") {
    throw new Error("只允許 chat.line.biz 聊天室網址");
  }
  const match = url.pathname.match(/\/chat\/(U[0-9a-f]{32})(?:\/|$)/i);
  if (!match) throw new Error("網址中找不到有效的 LINE UID");
  url.hash = "";
  return { url: url.href, uid: match[1] };
}

function sanitizeCrmCapture(input) {
  const lineUid = String(input?.lineUid || "").trim().slice(0, 80);
  if (!/^U[0-9a-f]{32}$/i.test(lineUid)) throw new Error("找不到有效的 LINE UID");
  const avatarUrl = String(input?.avatarUrl || "").trim().slice(0, 1200);
  if (avatarUrl && !avatarUrl.startsWith("https://")) throw new Error("客戶頭貼網址無效");
  return {
    lineUid,
    displayName: String(input?.displayName || "").trim().slice(0, 120),
    avatarUrl
  };
}

function sanitizeCrmUpdate(input) {
  return {
    displayName: String(input?.displayName || "").trim().slice(0, 120),
    phone: String(input?.phone || "").trim().slice(0, 40),
    email: String(input?.email || "").trim().slice(0, 254),
    tags: Array.isArray(input?.tags)
      ? input.tags.map((tag) => String(tag || "").trim().slice(0, 40)).filter(Boolean).slice(0, 20)
      : [],
    notes: String(input?.notes || "").trim().slice(0, 3000),
    status: input?.status === "archived" ? "archived" : "active"
  };
}

function requireLinePage(sender) {
  let url;
  try {
    url = new URL(String(sender?.url || ""));
  } catch {
    throw new Error("CRM 只能由 LINE 官方帳號管理頁使用");
  }
  if (url.protocol !== "https:" || !["chat.line.biz", "manager.line.biz"].includes(url.hostname)) {
    throw new Error("CRM 只能由 LINE 官方帳號管理頁使用");
  }
}

function requireOptionsPage(sender) {
  const optionsUrl = chrome.runtime.getURL("options.html");
  const senderUrl = String(sender?.url || "").split(/[?#]/, 1)[0];
  if (senderUrl !== optionsUrl) throw new Error("串接參數只能由擴充功能設定頁存取");
}

function settingsView(settings) {
  return {
    ok: true,
    values: {
      lineLoginChannelId: String(settings?.lineLoginChannelId || ""),
      lineLoginChannelSecret: String(settings?.lineLoginChannelSecret || ""),
      lineBotChannelAccessToken: String(settings?.lineBotChannelAccessToken || ""),
      lineBotChannelSecret: String(settings?.lineBotChannelSecret || "")
    }
  };
}

async function getToken() {
  const stored = await chrome.storage.local.get(TOKEN_KEY);
  return String(stored[TOKEN_KEY] || "");
}

async function requireToken() {
  const token = await getToken();
  if (!token) throw new Error("請先登入 LINEOA");
  return token;
}

async function clearToken() {
  await chrome.storage.local.remove(TOKEN_KEY);
}
