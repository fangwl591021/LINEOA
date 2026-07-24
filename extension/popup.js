"use strict";

const MANAGER_URL = "https://manager.line.biz/";
const CHAT_URL = "https://chat.line.biz/";
const APP_URL = "https://line-oa.fangwl591021.workers.dev/app";
const primaryButton = document.getElementById("open-manager");

chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  const currentUrl = String(tab?.url || "");
  const active = currentUrl.startsWith(MANAGER_URL) || currentUrl.startsWith(CHAT_URL);
  document.getElementById("status").textContent = active
    ? "LINEOA 已在目前的 LINE OA 頁面啟用。"
    : "請開啟 LINE OA Manager，LINEOA 才會顯示。";
  primaryButton.textContent = active ? "關閉" : "開啟 LINE OA Manager";
  primaryButton.dataset.active = active ? "true" : "false";
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