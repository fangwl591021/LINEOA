"use strict";
const form = document.getElementById("create-form");
const editForm = document.getElementById("edit-form");
const status = document.getElementById("status");
let busy = false, dirty = false;
let users = [], editing = null;
const escapeHtml = value => String(value || "").replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));
function notice(text, error = false) { status.textContent = text; status.className = error ? "error" : ""; }
async function send(type, body) {
  const response = await chrome.runtime.sendMessage({ type: `lineoa:accounts:${type}`, body });
  if (!response?.ok) throw new Error(response?.message || "無法完成操作，請檢查登入或連線");
  return response;
}
async function load() {
  const data = await send("list");
  document.getElementById("workspace").hidden = false;
  users = data.users || [];
  document.getElementById("users").innerHTML = users.map(user => `<tr>
    <td>${escapeHtml(user.display_name)}<small>${escapeHtml(user.email)}</small></td>
    <td>${escapeHtml(user.company_name || "—")}</td><td>${escapeHtml(user.monitored_line_oa || "尚未指定")}</td>
    <td>${user.role === "admin" ? "管理員" : "一般用戶"}／${escapeHtml(user.plan)}</td><td>${escapeHtml(user.status)}</td>
    <td><button type="button" data-edit="${escapeHtml(user.id)}">編輯</button></td></tr>`).join("") || '<tr><td colspan="6">目前沒有帳戶</td></tr>';
}
function setBusy(value) { busy = value; document.querySelectorAll("button").forEach(button => { button.disabled = value; }); }
function cancel() {
  if (busy || (dirty && !confirm("要取消並清除未儲存資料嗎？"))) return false;
  form.reset(); form.hidden = true; editForm.reset(); editForm.hidden = true;
  editing = null; dirty = false; return true;
}
document.getElementById("new-account").onclick = () => { if (!cancel()) return; form.hidden = false; form.elements.displayName.focus(); };
document.getElementById("cancel-create").onclick = cancel;
document.getElementById("cancel-edit").onclick = cancel;
document.getElementById("users").onclick = event => {
  const button = event.target.closest("[data-edit]");
  if (!button || busy) return;
  const user = users.find(item => item.id === button.dataset.edit);
  if (!user || !cancel()) return;
  editing = { id: user.id, expectedUpdatedAt: user.updated_at };
  editForm.elements.email.value = user.email;
  editForm.elements.displayName.value = user.display_name;
  editForm.elements.companyName.value = user.company_name || "";
  editForm.elements.monitoredLineOa.value = user.monitored_line_oa || "";
  editForm.hidden = false; editForm.elements.displayName.focus();
  notice("編輯後請按儲存修改；取消不會寫入資料。");
};
editForm.addEventListener("input", () => { dirty = true; });
editForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (busy || !editing || !editForm.reportValidity()) return;
  const body = { ...editing, displayName: editForm.elements.displayName.value,
    companyName: editForm.elements.companyName.value, monitoredLineOa: editForm.elements.monitoredLineOa.value };
  setBusy(true);
  let saved = false;
  try {
    await send("update", body); saved = true;
    editForm.reset(); editForm.hidden = true; editing = null; dirty = false;
    await load(); notice("帳戶資料已更新。密碼、權限與方案保持不變。");
  } catch (error) {
    notice(saved ? "修改已儲存，但名單更新失敗，請按重新整理。" : error.message + "。若提示資料已更新，請取消編輯、重新整理後再編輯。", true);
  } finally { setBusy(false); }
});
document.getElementById("close-page").onclick = () => { if (cancel()) window.close(); };
document.getElementById("refresh").onclick = async () => {
  if (busy) return;
  setBusy(true);
  try { await load(); notice("名單已更新，未儲存的表單保持不變。"); } catch (error) { notice(error.message, true); }
  finally { setBusy(false); }
};
form.addEventListener("input", () => { dirty = true; });
form.addEventListener("submit", async event => {
  event.preventDefault();
  if (busy || !form.reportValidity()) return;
  if (form.elements.password.value !== form.elements.confirmPassword.value) { notice("兩次密碼不一致", true); return; }
  const body = Object.fromEntries(new FormData(form));
  delete body.confirmPassword;
  setBusy(true);
  let created = false;
  try {
    const result = await send("create", body);
    created = true;
    form.reset(); form.hidden = true; dirty = false;
    notice(`已建立 ${result.user.email}，指定監控 ${result.user.monitoredLineOa}。請由你安全交付初始密碼；系統沒有寄信，也未切換你的登入身分。`);
    await load();
  } catch (error) {
    // Never keep a password in storage, logs or a failed form.
    form.elements.password.value = ""; form.elements.confirmPassword.value = "";
    notice(created ? "帳戶已建立，但名單更新失敗；請按重新整理，不要重複新增。" : `${error.message}。若連線中斷，請先重新整理名單確認是否已建立；重試需重新輸入密碼。`, true);
  } finally { body.password = ""; setBusy(false); }
});
window.addEventListener("beforeunload", event => { if (busy || dirty) { event.preventDefault(); event.returnValue = ""; } });
load().then(() => notice("可建立一般免費用戶帳戶。監控 LINE@ 為指定資料，非權限驗證。")).catch(error => notice(error.message, true));
