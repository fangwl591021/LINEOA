"use strict";

const MANAGER_URL = "https://manager.line.biz/";
const APP_URL = "https://line-oa.fangwl591021.workers.dev/app";

chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  const active = String(tab?.url || "").startsWith(MANAGER_URL);
  document.getElementById("status").textContent = active
    ? "LINEOA 已在目前的 LINE OA Manager 頁面啟用。"
    : "請開啟 LINE OA Manager，LINEOA 才會顯示。";
});

document.getElementById("open-manager").addEventListener("click", () => {
  chrome.tabs.create({ url: MANAGER_URL });
});

document.getElementById("open-app").addEventListener("click", () => {
  chrome.tabs.create({ url: APP_URL });
});
