const API_BASE = "https://line-oa.fangwl591021.workers.dev";
const SESSION_KEY = "lineoa_token";
const SETTINGS_KEY = "lineoa_integration_settings";
const LINE_API = "https://api.line.me";
const LINE_DATA_API = "https://api-data.line.me";
const MAX_IMAGE_BYTES = 1024 * 1024;

export function isRichMenuMessage(message) {
  return String(message?.type || "").startsWith("lineoa:rich-menu:");
}

export async function handleRichMenuMessage(message, sender) {
  const type = String(message?.type || "");
  if (type === "lineoa:rich-menu:open") {
    await chrome.tabs.create({ url: chrome.runtime.getURL("menu.html") });
    return { ok: true };
  }
  requireMenuPage(sender);

  if (type === "lineoa:rich-menu:entitlement") {
    return { ok: true, entitlement: await getEntitlement(false) };
  }

  if (type === "lineoa:rich-menu:deploy") {
    const entitlement = await getEntitlement(true);
    if (!entitlement.allowed) throw new Error("30 天試用已結束，請先開通 NT$199／年方案");
    const settings = await getSettings();
    const channelAccessToken = String(settings.lineBotChannelAccessToken || "").trim();
    if (!channelAccessToken) throw new Error("請先到串接設定填寫 LINE Bot Channel access token");
    const payload = sanitizeDeployPayload(message.body);
    const richMenuId = await deployRichMenu(channelAccessToken, payload);
    return { ok: true, richMenuId, entitlement };
  }

  throw new Error("不支援的圖文選單操作");
}

function requireMenuPage(sender) {
  const menuUrl = chrome.runtime.getURL("menu.html");
  const senderUrl = String(sender?.url || "").split(/[?#]/, 1)[0];
  if (senderUrl !== menuUrl) throw new Error("圖文選單操作只能由擴充功能私有頁面執行");
}

async function getEntitlement(authorizeDeploy) {
  const stored = await chrome.storage.local.get(SESSION_KEY);
  const sessionToken = String(stored[SESSION_KEY] || "");
  if (!sessionToken) throw new Error("請先登入 LINEOA");
  const path = authorizeDeploy ? "/api/features/rich-menu/deploy-authorize" : "/api/features/rich-menu";
  const response = await fetch(`${API_BASE}${path}`, {
    method: authorizeDeploy ? "POST" : "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${sessionToken}`
    },
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    referrerPolicy: "no-referrer"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "無法確認圖文選單使用資格");
  return data.entitlement;
}

async function getSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const value = stored[SETTINGS_KEY];
  return value && typeof value === "object" ? value : {};
}

function sanitizeDeployPayload(input) {
  const config = input?.richMenuConfig;
  const width = Number(config?.size?.width);
  const height = Number(config?.size?.height);
  if (width !== 2500 || ![843, 1686].includes(height)) throw new Error("圖文選單圖片尺寸不正確");
  const name = cleanText(config?.name, 300);
  const chatBarText = cleanText(config?.chatBarText, 14);
  const areas = Array.isArray(config?.areas) ? config.areas.map((area) => sanitizeArea(area, width, height)) : [];
  if (!name || !chatBarText || areas.length < 1 || areas.length > 20) throw new Error("圖文選單資料不完整");
  const imageType = input?.imageType === "image/png" ? "image/png" : "image/jpeg";
  const imageBlob = dataUrlToBlob(input?.imageBase64, imageType);
  if (imageBlob.size > MAX_IMAGE_BYTES) throw new Error("圖文選單圖片不可超過 1 MB");
  return {
    config: { size: { width, height }, selected: true, name, chatBarText, areas },
    imageBlob,
    imageType
  };
}

function sanitizeArea(area, maxWidth, maxHeight) {
  const bounds = {
    x: clampInteger(area?.bounds?.x, 0, maxWidth - 1),
    y: clampInteger(area?.bounds?.y, 0, maxHeight - 1),
    width: clampInteger(area?.bounds?.width, 1, maxWidth),
    height: clampInteger(area?.bounds?.height, 1, maxHeight)
  };
  if (bounds.x + bounds.width > maxWidth || bounds.y + bounds.height > maxHeight) {
    throw new Error("點擊區域超出圖片範圍");
  }
  const type = String(area?.action?.type || "");
  if (type === "uri") {
    const uri = cleanText(area.action.uri, 1000);
    if (!/^https?:\/\//i.test(uri)) throw new Error("網址動作必須使用 http 或 https");
    return { bounds, action: { type, uri } };
  }
  if (type === "message") {
    const text = cleanText(area.action.text, 300);
    if (!text) throw new Error("文字動作不可空白");
    return { bounds, action: { type, text } };
  }
  if (type === "postback") {
    const data = cleanText(area.action.data, 300);
    const displayText = cleanText(area.action.displayText, 300);
    if (!data) throw new Error("Postback Data 不可空白");
    return { bounds, action: { type, data, ...(displayText ? { displayText } : {}) } };
  }
  if (type === "richmenuswitch") {
    const richMenuAliasId = cleanText(area.action.richMenuAliasId, 32);
    const data = cleanText(area.action.data, 300);
    if (!/^[a-z0-9_-]{1,32}$/.test(richMenuAliasId)) throw new Error("Rich Menu Alias ID 格式不正確");
    if (!data) throw new Error("切換選單 Data 不可空白");
    return { bounds, action: { type, richMenuAliasId, data } };
  }
  throw new Error("不支援的點擊動作");
}

async function deployRichMenu(token, payload) {
  const created = await lineRequest(`${LINE_API}/v2/bot/richmenu`, token, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload.config)
  });
  const richMenuId = String(created.richMenuId || "");
  if (!richMenuId) throw new Error("LINE 未回傳 Rich Menu ID");
  try {
    await lineRequest(`${LINE_DATA_API}/v2/bot/richmenu/${encodeURIComponent(richMenuId)}/content`, token, {
      method: "POST",
      headers: { "content-type": payload.imageType },
      body: payload.imageBlob
    });
    await lineRequest(`${LINE_API}/v2/bot/user/all/richmenu/${encodeURIComponent(richMenuId)}`, token, {
      method: "POST"
    });
    return richMenuId;
  } catch (error) {
    await lineRequest(`${LINE_API}/v2/bot/richmenu/${encodeURIComponent(richMenuId)}`, token, {
      method: "DELETE"
    }).catch(() => {});
    throw error;
  }
}

async function lineRequest(url, token, init) {
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      ...(init.headers || {})
    },
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    referrerPolicy: "no-referrer"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `LINE API 驗證失敗 (${response.status})`);
  return data;
}

function dataUrlToBlob(value, expectedType) {
  const text = String(value || "");
  const match = text.match(/^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/);
  if (!match || match[1] !== expectedType) throw new Error("圖文選單圖片格式不正確");
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: expectedType });
}

function cleanText(value, max) {
  return String(value || "").replace(/\u0000/g, "").trim().slice(0, max);
}

function clampInteger(value, min, max) {
  return Math.max(min, Math.min(max, Math.trunc(Number(value) || 0)));
}
