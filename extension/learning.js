"use strict";
const list = document.querySelector("#drafts");
const status = document.querySelector("#status");
let rows = [], dirty = false, busy = false;
const escapeHtml = value => String(value || "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
async function send(action, fields = {}) {
  const response = await chrome.runtime.sendMessage({ type: `lineoa:learning:${action}`, ...fields });
  if (!response?.ok) throw new Error(response?.message || "操作失敗，請稍後再試");
  return response;
}
async function load() {
  if (busy || (dirty && !confirm("尚有未儲存的修改，要放棄並重新整理嗎？"))) return;
  try { rows = (await send("list")).items; dirty = false; render(); status.textContent = `共 ${rows.length} 筆本機草稿紀錄`; }
  catch (error) { status.textContent = error.message; }
}
function render() {
  const filter = document.querySelector("#filter").value;
  const shown = rows.filter(row => filter === "all" || row.status === filter);
  list.innerHTML = shown.length ? shown.map(row => `<article data-id="${escapeHtml(row.id)}">
    <small>${escapeHtml(row.createdAt)} · 官方帳號 ${escapeHtml(row.oa)} · ${row.status === "approved" ? "已加入題庫" : "待人工確認"}</small>
    <label>分類<input name="category" maxlength="80" value="${escapeHtml(row.category)}"></label>
    <label>問題（請改寫為通用問題）<textarea name="question" maxlength="500">${escapeHtml(row.question)}</textarea></label>
    <label>答案（以客服確認的資訊為準）<textarea name="answer" maxlength="4000">${escapeHtml(row.answer)}</textarea></label>
    ${row.status === "pending" ? `<label><input type="checkbox" name="reviewed"> 已確認問答配對、內容正確，並已移除個資與個案資訊</label><div class="actions"><button data-action="save">儲存修正</button><button data-action="approve" class="primary">確認加入題庫</button><button data-action="delete">捨棄草稿</button></div>` : `<p>正式 QA 請至 <a href="https://line-oa.fangwl591021.workers.dev/app" target="_blank" rel="noreferrer">知識庫</a> 編輯。</p><button data-action="delete">移除此本機紀錄（不刪除題庫）</button>`}
  </article>`).join("") : "<p>目前沒有草稿。回到聊天室，開啟對話學習並讓客戶問題及客服回覆同時出現在畫面上。</p>";
  for (const article of list.querySelectorAll("article")) {
    if (rows.find(row => row.id === article.dataset.id)?.status === "approved") {
      article.querySelectorAll("input,textarea").forEach(input => { input.readOnly = true; });
    }
  }
}
list.addEventListener("input", event => {
  dirty = true;
  if (event.target.name !== "reviewed") {
    const reviewed = event.target.closest("article").querySelector('[name="reviewed"]');
    if (reviewed) reviewed.checked = false;
  }
});
list.addEventListener("click", async event => {
  const button = event.target.closest("button[data-action]");
  if (!button || busy) return;
  const article = button.closest("article");
  const action = button.dataset.action;
  if (action === "delete" && !confirm("確定移除此本機草稿紀錄？")) return;
  const body = Object.fromEntries([...article.querySelectorAll("input:not([type=checkbox]),textarea")].map(input => [input.name, input.value]));
  busy = true;
  article.querySelectorAll("button").forEach(item => { item.disabled = true; });
  try {
    await send(action, { id: article.dataset.id, body, reviewed: article.querySelector('[name="reviewed"]')?.checked === true });
    const row = rows.find(item => item.id === article.dataset.id);
    if (action === "delete") { rows = rows.filter(item => item !== row); article.remove(); }
    else {
      Object.assign(row, body);
      if (action === "approve") { row.status = "approved"; article.remove(); }
    }
    // Do not rerender other cards: their unsaved edits must survive this operation.
    dirty = [...list.querySelectorAll("article")].some(card => {
      const row = rows.find(item => item.id === card.dataset.id);
      return [...card.querySelectorAll("input:not([type=checkbox]),textarea")].some(input => input.value !== row?.[input.name]);
    });
    status.textContent = action === "approve" ? "已確認加入題庫；回聊天室按「同步知識庫」即可比對。" : action === "save" ? "修正已儲存於本機" : "本機紀錄已移除";
  } catch (error) { status.textContent = error.message; }
  finally { busy = false; article.querySelectorAll("button").forEach(item => { item.disabled = false; }); }
});
document.querySelector("#refresh").onclick = load;
document.querySelector("#filter").onchange = () => {
  if (dirty) { status.textContent = "請先儲存修正，再按重新整理套用篩選。"; return; }
  render();
};
document.querySelector("#back").onclick = () => { if (!busy && (!dirty || confirm("尚有未儲存修改，確定關閉？"))) { dirty = false; window.close(); } };
window.addEventListener("beforeunload", event => { if (dirty || busy) { event.preventDefault(); event.returnValue = ""; } });
load();
