"use strict";

const MANAGER_URL = "https://manager.line.biz/";
const CHAT_URL = "https://chat.line.biz/";
const APP_URL = "https://line-oa.fangwl591021.workers.dev/app";
const primaryButton = document.getElementById("open-manager");
const reloadButton = document.getElementById("reload-page");
const installedVersion = chrome.runtime.getManifest().version;
document.getElementById("installed-version").textContent = `免審查測試版 v${installedVersion}`;

function isLinePage(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["manager.line.biz", "chat.line.biz"].includes(url.hostname);
  } catch { return false; }
}

chrome.runtime.sendMessage({ type: "lineoa:runtime-info" }, response => {
  document.getElementById("background-status").textContent = chrome.runtime.lastError || !response?.ok
    ? "背景連線失敗：仍可使用下方重整按鈕。若重整無效，請到擴充功能管理頁查看「錯誤」。"
    : `背景連線正常 · v${response.version}`;
});

chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  const currentUrl = String(tab?.url || "");
  const active = isLinePage(currentUrl);
  reloadButton.disabled = !active;
  document.getElementById("status").textContent = active
    ? "LINEOA 已在目前的 LINE OA 頁面啟用。"
    : "請開啟 LINE OA Manager，LINEOA 才會顯示。";
  primaryButton.textContent = active ? "關閉" : "開啟 LINE OA Manager";
  primaryButton.dataset.active = active ? "true" : "false";
  if (active) {
    chrome.tabs.sendMessage(tab.id, { type: "lineoa:panel-version" }, response => {
      document.getElementById("status").textContent = chrome.runtime.lastError || !response?.version
        ? `已安裝 v${installedVersion}，目前面板未回應或仍為舊版。請按「重整目前 LINE 頁面」。`
        : response.version !== installedVersion
          ? `已安裝 v${installedVersion}／面板 v${response.version}，請重整目前 LINE 頁面。`
          : `LINEOA 面板 v${response.version}，版本一致。`;
    });
  }
});

reloadButton.addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!isLinePage(tab?.url)) {
      document.getElementById("status").textContent = "請先切回要重整的 LINE 聊天頁。";
      return;
    }
    if (!window.confirm("重整目前 LINE 頁面？未送出的文字可能遺失，請先複製保存。")) return;
    chrome.tabs.reload(tab.id, {}, () => {
      if (chrome.runtime.lastError) document.getElementById("status").textContent = "無法重整，請回到 LINE 頁面按 F5。";
      else window.close();
    });
  });
});

primaryButton.addEventListener("click", () => {
  if (primaryButton.dataset.active === "true") {
    window.close();
    return;
  }
  chrome.tabs.create({ url: MANAGER_URL });
});

document.getElementById("open-app").addEventListener("click", () => {
  chrome.tabs.create({ url: APP_URL });
});

document.getElementById("open-settings").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  window.close();
});
