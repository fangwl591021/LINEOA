"use strict";

const ORIGINAL_WIDTH = 2500;
const DISPLAY_WIDTH = 720;
const VALID_HEIGHTS = new Set([843, 1686]);
const MAX_IMAGE_BYTES = 1024 * 1024;
const DRAFT_DB_NAME = "lineoa-rich-menu-library";
const DRAFT_STORE = "menus";
const ACTIVE_DRAFT_KEY = "lineoa_rich_menu_active_id";
const LEGACY_DRAFT_KEY = "lineoa_rich_menu_draft";
const canvas = document.getElementById("menu-canvas");
const context = canvas.getContext("2d");
const notice = document.getElementById("notice");
const placeholder = document.getElementById("placeholder");
const areasContainer = document.getElementById("areas");
const deployButton = document.getElementById("deploy");
const entitlementBox = document.getElementById("entitlement");
const galleryList = document.getElementById("menu-gallery-list");
const state = {
  image: null,
  imageDataUrl: "",
  imageType: "",
  originalHeight: 843,
  areas: [],
  drawing: false,
  dragStart: null,
  draftRect: null,
  entitlement: null,
  activeDraftId: ""
};
let draftDbPromise;

loadEntitlement();
initializeDraftGallery();

document.getElementById("image-upload").addEventListener("change", loadImage);
document.getElementById("draw-mode").addEventListener("click", () => {
  state.drawing = !state.drawing;
  document.getElementById("draw-mode").textContent = state.drawing ? "劃定中（拖曳圖片）" : "開始劃定區域";
  document.getElementById("draw-mode").classList.toggle("primary", !state.drawing);
});
document.getElementById("clear-areas").addEventListener("click", () => {
  if (!state.areas.length || window.confirm("確定清除所有點擊區域？")) {
    state.areas = [];
    render();
  }
});
document.getElementById("save-draft").addEventListener("click", saveDraft);
document.getElementById("new-menu").addEventListener("click", () => newMenu());
document.getElementById("cancel-menu").addEventListener("click", () => {
  if (window.history.length > 1) {
    window.history.back();
    return;
  }
  window.close();
});
deployButton.addEventListener("click", deploy);
canvas.addEventListener("pointerdown", pointerDown);
canvas.addEventListener("pointermove", pointerMove);
canvas.addEventListener("pointerup", pointerUp);
canvas.addEventListener("pointercancel", pointerUp);

async function loadEntitlement() {
  try {
    const response = await send({ type: "lineoa:rich-menu:entitlement" });
    state.entitlement = response.entitlement;
    const item = state.entitlement;
    entitlementBox.className = `entitlement ${item.allowed ? "active" : "expired"}`;
    if (item.status === "admin") entitlementBox.textContent = "管理員可使用";
    else if (item.status === "paid") entitlementBox.textContent = `年費已啟用，剩餘 ${item.daysRemaining} 天`;
    else if (item.status === "trial") entitlementBox.textContent = `30 天試用中，剩餘 ${item.daysRemaining} 天`;
    else entitlementBox.textContent = "試用已結束・NT$199／年";
    updateDeployState();
  } catch (error) {
    entitlementBox.className = "entitlement expired";
    entitlementBox.textContent = error.message;
    setNotice("請先在 LINEOA 側欄登入，再重新開啟圖文選單。", "error");
  }
}

async function loadImage(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!["image/jpeg", "image/png"].includes(file.type)) return setNotice("只接受 JPG 或 PNG。", "error");
  if (file.size > MAX_IMAGE_BYTES) return setNotice("圖片超過 LINE 規定的 1 MB。", "error");
  const dataUrl = await fileToDataUrl(file);
  const image = await decodeImage(dataUrl);
  if (image.naturalWidth !== ORIGINAL_WIDTH || !VALID_HEIGHTS.has(image.naturalHeight)) {
    return setNotice(`圖片尺寸 ${image.naturalWidth}×${image.naturalHeight} 不符合規定。`, "error");
  }
  state.image = image;
  state.imageDataUrl = dataUrl;
  state.imageType = file.type;
  state.originalHeight = image.naturalHeight;
  state.areas = [];
  canvas.width = DISPLAY_WIDTH;
  canvas.height = Math.round(DISPLAY_WIDTH * image.naturalHeight / ORIGINAL_WIDTH);
  placeholder.classList.add("hidden");
  setNotice("底圖已載入，請按「開始劃定區域」後在圖片拖曳。", "success");
  render();
}

function pointerDown(event) {
  if (!state.image || !state.drawing || state.areas.length >= 20) return;
  canvas.setPointerCapture(event.pointerId);
  state.dragStart = pointFromEvent(event);
  state.draftRect = { x: state.dragStart.x, y: state.dragStart.y, width: 0, height: 0 };
}

function pointerMove(event) {
  if (!state.dragStart) return;
  const point = pointFromEvent(event);
  state.draftRect = normalizeRect(state.dragStart, point);
  renderCanvas();
}

function pointerUp(event) {
  if (!state.dragStart) return;
  const point = pointFromEvent(event);
  const rect = normalizeRect(state.dragStart, point);
  state.dragStart = null;
  state.draftRect = null;
  if (rect.width >= 40 && rect.height >= 40) {
    state.areas.push({ bounds: rect, action: { type: "uri", uri: "https://" } });
  } else {
    setNotice("區域太小，請重新拖曳。", "error");
  }
  state.drawing = false;
  document.getElementById("draw-mode").textContent = "開始劃定區域";
  document.getElementById("draw-mode").classList.add("primary");
  render();
}

function render() {
  renderCanvas();
  renderAreas();
  updateDeployState();
}

function renderCanvas() {
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (state.image) context.drawImage(state.image, 0, 0, canvas.width, canvas.height);
  [...state.areas.map((area) => area.bounds), ...(state.draftRect ? [state.draftRect] : [])].forEach((rect, index) => {
    const scale = canvas.width / ORIGINAL_WIDTH;
    context.fillStyle = "rgba(6,199,85,.22)";
    context.strokeStyle = "#06c755";
    context.lineWidth = 3;
    context.fillRect(rect.x * scale, rect.y * scale, rect.width * scale, rect.height * scale);
    context.strokeRect(rect.x * scale, rect.y * scale, rect.width * scale, rect.height * scale);
    context.fillStyle = "#047c36";
    context.font = "bold 18px sans-serif";
    context.fillText(`#${index + 1}`, rect.x * scale + 8, rect.y * scale + 24);
  });
}

function renderAreas() {
  areasContainer.replaceChildren();
  if (!state.areas.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "尚未建立區域";
    areasContainer.append(empty);
    return;
  }
  state.areas.forEach((area, index) => {
    const card = document.getElementById("area-template").content.firstElementChild.cloneNode(true);
    card.querySelector("strong").textContent = `區域 #${index + 1}`;
    const select = card.querySelector('[data-field="type"]');
    const valueInput = card.querySelector('[data-field="value"]');
    const displayInput = card.querySelector('[data-field="displayText"]');
    select.value = area.action.type;
    configureAreaInputs(card, area);
    valueInput.value = actionValue(area.action);
    displayInput.value = area.action.type === "richmenuswitch"
      ? area.action.data || ""
      : area.action.displayText || "";
    select.addEventListener("change", () => {
      area.action = defaultAction(select.value);
      renderAreas();
    });
    valueInput.addEventListener("input", () => setActionValue(area.action, valueInput.value));
    displayInput.addEventListener("input", () => {
      if (area.action.type === "richmenuswitch") area.action.data = displayInput.value;
      else area.action.displayText = displayInput.value;
    });
    card.querySelector("[data-remove]").addEventListener("click", () => {
      state.areas.splice(index, 1);
      render();
    });
    areasContainer.append(card);
  });
}

function configureAreaInputs(card, area) {
  const label = card.querySelector("[data-value-label]");
  const display = card.querySelector(".display-text");
  if (area.action.type === "uri") {
    label.childNodes[0].textContent = "網址";
    label.querySelector("input").placeholder = "https://";
  } else if (area.action.type === "message") {
    label.childNodes[0].textContent = "傳送文字";
    label.querySelector("input").placeholder = "點擊後傳送的文字";
  } else if (area.action.type === "postback") {
    label.childNodes[0].textContent = "Postback Data";
    label.querySelector("input").placeholder = "action=menu";
    display.classList.remove("hidden");
  } else {
    label.childNodes[0].textContent = "目標選單 Alias ID";
    label.querySelector("input").placeholder = "richmenu-alias-b";
    label.querySelector("input").maxLength = 32;
    display.childNodes[0].textContent = "切換資料 Data";
    display.querySelector("input").placeholder = "action=richmenu-switch";
    display.classList.remove("hidden");
  }
}

async function deploy() {
  const payload = buildPayload();
  if (!payload) return;
  if (!window.confirm("部署後會把這份圖文選單設為官方帳號的預設選單，確定繼續？")) return;
  deployButton.disabled = true;
  deployButton.textContent = "部署中…";
  try {
    const response = await send({ type: "lineoa:rich-menu:deploy", body: payload });
    await persistMenu(payload, response.richMenuId);
    setNotice(`部署成功，Rich Menu ID：${response.richMenuId}`, "success");
  } catch (error) {
    setNotice(error.message, "error");
  } finally {
    deployButton.textContent = "部署至 LINE";
    updateDeployState();
  }
}

function buildPayload() {
  if (!state.imageDataUrl) return setNotice("請先上傳選單底圖。", "error");
  if (!state.areas.length) return setNotice("請至少建立一個點擊區域。", "error");
  const name = document.getElementById("menu-name").value.trim();
  const chatBarText = document.getElementById("chatbar-text").value.trim();
  if (!name || !chatBarText) return setNotice("選單名稱與選單列文字不可空白。", "error");
  for (let index = 0; index < state.areas.length; index += 1) {
    const action = state.areas[index].action;
    const value = actionValue(action).trim();
    if (action.type === "richmenuswitch") {
      if (!/^[a-z0-9_-]{1,32}$/.test(value)) {
        return setNotice(`區域 #${index + 1} 的 Alias ID 格式不正確。`, "error");
      }
      if (!String(action.data || "").trim()) {
        return setNotice(`區域 #${index + 1} 的切換資料 Data 不可空白。`, "error");
      }
      continue;
    }
    if (!value || (action.type === "uri" && !/^https?:\/\//i.test(value))) {
      return setNotice(`區域 #${index + 1} 的動作內容不正確。`, "error");
    }
  }
  return {
    richMenuConfig: {
      size: { width: ORIGINAL_WIDTH, height: state.originalHeight },
      selected: true,
      name,
      chatBarText,
      areas: state.areas
    },
    imageBase64: state.imageDataUrl,
    imageType: state.imageType
  };
}

async function saveDraft() {
  const payload = buildPayload();
  if (!payload) return;
  try {
    await persistMenu(payload);
    setNotice("選單已儲存並更新右側縮圖。", "success");
  } catch {
    setNotice("選單儲存失敗，請確認瀏覽器儲存空間。", "error");
  }
}

async function persistMenu(payload, richMenuId = "") {
  const existing = state.activeDraftId ? await getMenuRecord(state.activeDraftId) : null;
  const record = {
    id: existing?.id || createDraftId(),
    payload,
    thumbnailBase64: createThumbnail(),
    richMenuId: richMenuId || existing?.richMenuId || "",
    updatedAt: Date.now()
  };
  await putMenuRecord(record);
  state.activeDraftId = record.id;
  localStorage.setItem(ACTIVE_DRAFT_KEY, record.id);
  await renderDraftGallery();
  return record;
}

async function initializeDraftGallery() {
  try {
    await migrateLegacyDraft();
    const records = await listMenuRecords();
    await renderDraftGallery(records);
    if (!records.length) return;
    const requestedId = localStorage.getItem(ACTIVE_DRAFT_KEY);
    const active = records.find((item) => item.id === requestedId) || records[0];
    await loadDraftById(active.id, false);
  } catch {
    galleryList.innerHTML = '<p class="gallery-empty">無法讀取本機選單資料庫</p>';
  }
}

async function renderDraftGallery(records = null) {
  const items = records || await listMenuRecords();
  galleryList.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "gallery-empty";
    empty.textContent = "儲存後會在這裡顯示縮圖";
    galleryList.append(empty);
    return;
  }
  items.forEach((record) => {
    const card = document.createElement("article");
    card.className = `menu-thumb${record.id === state.activeDraftId ? " active" : ""}`;
    const select = document.createElement("button");
    select.type = "button";
    select.className = "thumb-select";
    select.title = `切換至 ${record.payload.richMenuConfig.name}`;
    const image = document.createElement("img");
    image.src = record.thumbnailBase64 || record.payload.imageBase64;
    image.alt = `${record.payload.richMenuConfig.name} 縮圖`;
    image.style.aspectRatio = `2500 / ${record.payload.richMenuConfig.size.height}`;
    const meta = document.createElement("span");
    meta.className = "thumb-meta";
    const name = document.createElement("strong");
    name.textContent = record.payload.richMenuConfig.name;
    const time = document.createElement("span");
    time.textContent = new Date(record.updatedAt).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
    meta.append(name, time);
    select.append(image, meta);
    select.addEventListener("click", () => loadDraftById(record.id));
    const status = document.createElement("span");
    status.className = `thumb-status${record.richMenuId ? " deployed" : ""}`;
    status.textContent = record.richMenuId ? "已部署" : "草稿";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "thumb-delete";
    remove.textContent = "刪除";
    remove.addEventListener("click", () => deleteDraft(record.id, record.payload.richMenuConfig.name));
    card.append(select, status, remove);
    galleryList.append(card);
  });
}

async function loadDraftById(id, announce = true) {
  const record = await getMenuRecord(id);
  if (!record?.payload?.imageBase64 || !record.payload.richMenuConfig) return;
  const payload = record.payload;
  const image = await decodeImage(payload.imageBase64);
  state.activeDraftId = record.id;
  state.image = image;
  state.imageDataUrl = payload.imageBase64;
  state.imageType = payload.imageType || "image/jpeg";
  state.originalHeight = payload.richMenuConfig.size.height;
  state.areas = structuredClone(payload.richMenuConfig.areas || []);
  document.getElementById("menu-name").value = payload.richMenuConfig.name || "";
  document.getElementById("chatbar-text").value = payload.richMenuConfig.chatBarText || "";
  canvas.width = DISPLAY_WIDTH;
  canvas.height = Math.round(DISPLAY_WIDTH * state.originalHeight / ORIGINAL_WIDTH);
  placeholder.classList.add("hidden");
  localStorage.setItem(ACTIVE_DRAFT_KEY, record.id);
  render();
  await renderDraftGallery();
  if (announce) setNotice(`已切換至「${payload.richMenuConfig.name}」。`, "success");
}

function newMenu(force = false) {
  if (!force && state.image && !window.confirm("要新增空白選單嗎？尚未儲存的變更會遺失。")) return;
  state.activeDraftId = "";
  state.image = null;
  state.imageDataUrl = "";
  state.imageType = "";
  state.originalHeight = 843;
  state.areas = [];
  state.drawing = false;
  state.dragStart = null;
  state.draftRect = null;
  document.getElementById("menu-name").value = "LINEOA Rich Menu";
  document.getElementById("chatbar-text").value = "選單";
  document.getElementById("image-upload").value = "";
  canvas.width = DISPLAY_WIDTH;
  canvas.height = Math.round(DISPLAY_WIDTH * 843 / ORIGINAL_WIDTH);
  placeholder.classList.remove("hidden");
  localStorage.removeItem(ACTIVE_DRAFT_KEY);
  render();
  renderDraftGallery();
  setNotice("已建立空白選單，請上傳底圖。");
}

async function deleteDraft(id, name) {
  if (!window.confirm(`確定刪除「${name}」的本機草稿？`)) return;
  await deleteMenuRecord(id);
  if (state.activeDraftId === id) newMenu(true);
  else await renderDraftGallery();
}

function createThumbnail() {
  const width = 240;
  const height = Math.max(81, Math.round(width * canvas.height / canvas.width));
  const thumb = document.createElement("canvas");
  thumb.width = width;
  thumb.height = height;
  thumb.getContext("2d").drawImage(canvas, 0, 0, width, height);
  return thumb.toDataURL("image/jpeg", 0.78);
}

function createDraftId() {
  return globalThis.crypto?.randomUUID?.() || `menu-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function migrateLegacyDraft() {
  const legacy = localStorage.getItem(LEGACY_DRAFT_KEY);
  if (!legacy || localStorage.getItem(`${LEGACY_DRAFT_KEY}_migrated`)) return;
  const payload = JSON.parse(legacy);
  if (payload?.imageBase64 && payload?.richMenuConfig) {
    await putMenuRecord({
      id: createDraftId(),
      payload,
      thumbnailBase64: payload.imageBase64,
      richMenuId: "",
      updatedAt: Date.now()
    });
  }
  localStorage.setItem(`${LEGACY_DRAFT_KEY}_migrated`, "1");
}

function openDraftDatabase() {
  if (draftDbPromise) return draftDbPromise;
  draftDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DRAFT_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DRAFT_STORE)) {
        request.result.createObjectStore(DRAFT_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return draftDbPromise;
}

async function useDraftStore(mode, action) {
  const database = await openDraftDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(DRAFT_STORE, mode);
    const request = action(transaction.objectStore(DRAFT_STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function putMenuRecord(record) { return useDraftStore("readwrite", (store) => store.put(record)); }
function getMenuRecord(id) { return useDraftStore("readonly", (store) => store.get(id)); }
function deleteMenuRecord(id) { return useDraftStore("readwrite", (store) => store.delete(id)); }
async function listMenuRecords() {
  const items = await useDraftStore("readonly", (store) => store.getAll());
  return items.sort((left, right) => right.updatedAt - left.updatedAt);
}

function updateDeployState() {
  deployButton.disabled = !(state.entitlement?.allowed && state.image && state.areas.length);
}

function pointFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: clamp(Math.round((event.clientX - rect.left) / rect.width * ORIGINAL_WIDTH), 0, ORIGINAL_WIDTH),
    y: clamp(Math.round((event.clientY - rect.top) / rect.height * state.originalHeight), 0, state.originalHeight)
  };
}

function normalizeRect(start, end) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y)
  };
}

function defaultAction(type) {
  if (type === "message") return { type, text: "" };
  if (type === "postback") return { type, data: "", displayText: "" };
  if (type === "richmenuswitch") return { type, richMenuAliasId: "", data: "" };
  return { type: "uri", uri: "https://" };
}
function actionValue(action) {
  if (action.type === "richmenuswitch") return action.richMenuAliasId || "";
  return action.uri ?? action.text ?? action.data ?? "";
}
function setActionValue(action, value) {
  if (action.type === "uri") action.uri = value;
  else if (action.type === "message") action.text = value;
  else if (action.type === "richmenuswitch") action.richMenuAliasId = value;
  else action.data = value;
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function setNotice(message, tone = "") {
  notice.className = `notice ${tone}`.trim();
  notice.textContent = message;
}
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("圖片讀取失敗"));
    reader.readAsDataURL(file);
  });
}
function decodeImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("圖片格式無法解析"));
    image.src = source;
  });
}
function send(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) return reject(new Error("LINEOA 背景服務未連線"));
      if (!response?.ok) return reject(new Error(response?.message || "圖文選單操作失敗"));
      resolve(response);
    });
  });
}
