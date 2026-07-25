"use strict";

const form = document.getElementById("integration-form");
const statusBox = document.getElementById("status");
const channelIdInput = document.getElementById("line-login-channel-id");
const secretState = document.getElementById("line-login-secret-state");
const tokenState = document.getElementById("line-bot-token-state");
const botSecretState = document.getElementById("line-bot-secret-state");

loadSettings();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("正在儲存設定…");
  const data = new FormData(form);
  try {
    const response = await send({
      type: "lineoa:settings:save",
      body: {
        lineLoginChannelId: data.get("lineLoginChannelId"),
        lineLoginChannelSecret: data.get("lineLoginChannelSecret"),
        lineBotChannelAccessToken: data.get("lineBotChannelAccessToken"),
        lineBotChannelSecret: data.get("lineBotChannelSecret")
      }
    });
    clearSecretInputs();
    renderState(response);
    setStatus("串接參數已安全儲存在這個 Chrome 使用者中。", "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

document.getElementById("clear-settings").addEventListener("click", async () => {
  if (!window.confirm("確定清除所有 LINE 串接參數？此動作無法復原。")) return;
  try {
    const response = await send({ type: "lineoa:settings:clear" });
    form.reset();
    renderState(response);
    setStatus("所有串接參數已清除。", "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

async function loadSettings() {
  try {
    const response = await send({ type: "lineoa:settings:get" });
    channelIdInput.value = response.values?.lineLoginChannelId || "";
    renderState(response);
    setStatus("已讀取設定狀態；既有 secret/token 不會顯示。", "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function renderState(response) {
  const configured = response.configured || {};
  secretState.textContent = configured.lineLoginChannelSecret ? "已設定；留空可保留" : "尚未設定";
  tokenState.textContent = configured.lineBotChannelAccessToken ? "已設定；留空可保留" : "尚未設定";
  botSecretState.textContent = configured.lineBotChannelSecret ? "已設定；留空可保留" : "尚未設定";
}

function clearSecretInputs() {
  document.getElementById("line-login-channel-secret").value = "";
  document.getElementById("line-bot-access-token").value = "";
  document.getElementById("line-bot-channel-secret").value = "";
}

function setStatus(message, tone = "") {
  statusBox.className = `status ${tone}`.trim();
  statusBox.textContent = message;
}

function send(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) return reject(new Error("LINEOA 背景服務未連線"));
      if (!response?.ok) return reject(new Error(response?.message || "LINEOA 設定操作失敗"));
      resolve(response);
    });
  });
}
