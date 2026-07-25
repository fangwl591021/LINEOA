"use strict";

const API_BASE = "https://line-oa.fangwl591021.workers.dev";
const TOKEN_KEY = "lineoa_token";
const SETTINGS_KEY = "lineoa_integration_settings";

chrome.runtime.onInstalled.addListener(() => {
  console.info("LINEOA test extension installed");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!sender.id || sender.id !== chrome.runtime.id) {
    sendResponse({ ok: false, message: "不允許的訊息來源" });
    return false;
  }

  handleMessage(message)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, message: error.message || "擴充功能暫時無法處理" }));
  return true;
});

async function handleMessage(message) {
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

  if (type === "lineoa:settings:get") {
    return settingsSummary(await getIntegrationSettings());
  }

  if (type === "lineoa:settings:save") {
    const current = await getIntegrationSettings();
    const settings = sanitizeIntegrationSettings(message.body, current);
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    return settingsSummary(settings);
  }

  if (type === "lineoa:settings:clear") {
    await chrome.storage.local.remove(SETTINGS_KEY);
    return settingsSummary({});
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

function settingsSummary(settings) {
  return {
    ok: true,
    values: {
      lineLoginChannelId: String(settings?.lineLoginChannelId || "")
    },
    configured: {
      lineLoginChannelSecret: Boolean(settings?.lineLoginChannelSecret),
      lineBotChannelAccessToken: Boolean(settings?.lineBotChannelAccessToken),
      lineBotChannelSecret: Boolean(settings?.lineBotChannelSecret)
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
