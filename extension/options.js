"use strict";

const form = document.getElementById("integration-form");
const statusBox = document.getElementById("status");
const fields = {
  lineLoginChannelId: document.getElementById("line-login-channel-id"),
  lineLoginChannelSecret: document.getElementById("line-login-channel-secret"),
  lineBotChannelAccessToken: document.getElementById("line-bot-access-token"),
  lineBotChannelSecret: document.getElementById("line-bot-channel-secret")
};
const stateElements = {
  lineLoginChannelId: document.getElementById("line-login-channel-id-state"),
  lineLoginChannelSecret: document.getElementById("line-login-secret-state"),
  lineBotChannelAccessToken: document.getElementById("line-bot-token-state"),
  lineBotChannelSecret: document.getElementById("line-bot-secret-state")
};
const validators = {
  lineLoginChannelId: (value) => /^\d{10,20}$/.test(value),
  lineLoginChannelSecret: (value) => /^[A-Za-z0-9]{32}$/.test(value),
  lineBotChannelAccessToken: (value) => value.length >= 20 && !/\s/.test(value),
  lineBotChannelSecret: (value) => /^[A-Za-z0-9]{32}$/.test(value)
};

loadSettings();

for (const [name, input] of Object.entries(fields)) {
  input.addEventListener("input", () => renderValidation(name));
}

for (const button of document.querySelectorAll("[data-toggle-secret]")) {
  button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.toggleSecret);
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    button.textContent = showing ? "顯示" : "隱藏";
    button.setAttribute("aria-label", `${showing ? "顯示" : "隱藏"} ${input.name}`);
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  renderAllValidation();
  if (!Object.entries(fields).every(([name, input]) => validators[name](input.value.trim()))) {
    setStatus("請先修正紅字標示的參數格式。", "error");
    return;
  }
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
    populateFields(response.values);
    renderAllValidation();
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
    populateFields(response.values);
    renderAllValidation();
    setStatus("所有串接參數已清除。", "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

document.getElementById("cancel-settings").addEventListener("click", () => {
  if (window.history.length > 1) {
    window.history.back();
    return;
  }
  window.close();
});

async function loadSettings() {
  try {
    const response = await send({ type: "lineoa:settings:get" });
    populateFields(response.values);
    renderAllValidation();
    setStatus("已讀取已儲存參數；Secret／Token 預設遮蔽。", "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function populateFields(values = {}) {
  for (const [name, input] of Object.entries(fields)) {
    input.value = String(values[name] || "");
  }
}

function renderAllValidation() {
  for (const name of Object.keys(fields)) renderValidation(name);
}

function renderValidation(name) {
  const value = fields[name].value.trim();
  const state = stateElements[name];
  const valid = validators[name](value);
  state.className = `validation ${valid ? "valid" : "invalid"}`;
  state.textContent = valid ? "格式正確" : value ? "格式不正確" : "尚未填寫";
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
