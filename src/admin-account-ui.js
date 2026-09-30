const formHtml = `<section class="panel" style="margin:0 0 22px">
  <div class="panel-head"><h2>新增用戶帳戶</h2><button id="admin-create-open" class="btn btn-primary" type="button">新增帳戶</button></div>
  <form id="admin-create-form" class="panel-body hidden" autocomplete="off">
    <div style="position:sticky;top:74px;background:white;padding:8px 0;z-index:4"><button id="admin-create-cancel" class="btn" type="button">取消／返回用戶名單</button></div>
    <div class="field"><label for="au-name">姓名（必填）</label><input id="au-name" name="displayName" required minlength="2" maxlength="80"></div>
    <div class="field"><label for="au-email">Email（必填）</label><input id="au-email" name="email" type="email" required maxlength="254"></div>
    <div class="field"><label for="au-company">公司／品牌</label><input id="au-company" name="companyName" maxlength="120"></div>
    <div class="field"><label for="au-line">監控 LINE@（必填）</label><input id="au-line" name="monitoredLineOa" placeholder="@abc1234" required maxlength="101" pattern="@[a-zA-Z0-9._\\-]{1,100}"></div>
    <p class="muted">填寫 LINE ID，不是聊天室網址或 Token。此欄只記錄指定監控對象，尚未驗證歸屬；實際監控仍需登入有權限的 LINE OA 後台。</p>
    <div class="field"><label for="au-password">初始密碼</label><input id="au-password" name="password" type="password" required minlength="8" maxlength="200" autocomplete="new-password"></div>
    <div class="field"><label for="au-confirm">確認密碼</label><input id="au-confirm" name="confirmPassword" type="password" required minlength="8" maxlength="200" autocomplete="new-password"></div>
    <p class="muted">新帳戶固定為一般用戶／免費方案，不授予平台管理員權限。不自動寄信，請自行安全交付初始密碼。</p>
    <button id="admin-create-submit" class="btn btn-primary" type="submit">確認新增帳戶</button>
  </form><p id="admin-create-status" class="panel-body" role="status" aria-live="polite"></p>
</section>`;

const editHtml = `<section id="admin-edit-panel" class="panel hidden" style="margin:0 0 22px">
  <div class="panel-head"><h2>編輯帳戶</h2></div>
  <form id="admin-edit-form" class="panel-body" autocomplete="off">
    <div style="position:sticky;top:74px;background:white;padding:8px 0;z-index:4"><button id="admin-edit-cancel" class="btn" type="button">取消編輯／返回用戶名單</button></div>
    <div class="field"><label>Email（不可於此修改）</label><input name="email" readonly></div>
    <div class="field"><label>姓名（必填）</label><input name="displayName" required minlength="2" maxlength="80"></div>
    <div class="field"><label>公司／品牌</label><input name="companyName" maxlength="120"></div>
    <div class="field"><label>監控 LINE@（必填）</label><input name="monitoredLineOa" required maxlength="101" pattern="@[a-zA-Z0-9._\\-]{1,100}" placeholder="@abc1234"></div>
    <p class="muted">只修改帳戶資料，不改 Email、密碼、角色、狀態或方案。LINE@ 不是 LINE 官方帳號授權。</p>
    <button class="btn btn-primary" type="submit">儲存修改</button>
  </form>
</section>`;

export const adminAccountClientScript = `const ADMIN_ACCOUNT_FORM = ${JSON.stringify(formHtml + editHtml)};` + String.raw`
function bindAdminAccountForm() {
  if (state.user?.role !== "admin") return;
  $("content").insertAdjacentHTML("afterbegin", ADMIN_ACCOUNT_FORM);
  const form = $("admin-create-form"), feedback = $("admin-create-status");
  let creating = false;
  let editing = null;
  const editForm = $("admin-edit-form"), editPanel = $("admin-edit-panel");
  function closeEdit() {
    if (creating || (editing && !confirm("取消編輯並清除未儲存資料？"))) return false;
    editing = null; editForm.reset(); editPanel.classList.add("hidden"); return true;
  }
  $("admin-edit-cancel").onclick = closeEdit;
  $("admin-create-open").onclick = () => { if (!closeEdit()) return; form.classList.remove("hidden"); form.elements.displayName.focus(); };
  editForm.onsubmit = async event => {
    event.preventDefault();
    if (creating || !editing || !editForm.reportValidity()) return;
    const body = { displayName: editForm.elements.displayName.value, companyName: editForm.elements.companyName.value,
      monitoredLineOa: editForm.elements.monitoredLineOa.value, expectedUpdatedAt: editing.updated_at };
    creating = true; editForm.querySelectorAll("button").forEach(button => button.disabled = true);
    let saved = false;
    try {
      const result = await request("/api/admin/users/" + encodeURIComponent(editing.id), { method: "PATCH", body: JSON.stringify(body) });
      saved = true;
      if (state.user.id === result.user.id) state.user = result.user;
      editing = null; editForm.reset(); editPanel.classList.add("hidden");
      await render(); $("admin-create-status").textContent = "帳戶資料已更新，密碼、權限與方案保持不變。";
    } catch (error) {
      feedback.textContent = saved ? "修改已儲存，但名單更新失敗，請重新整理。" : error.message + "。資料衝突時請取消、重新整理後再編輯。";
    } finally { creating = false; editForm.querySelectorAll("button").forEach(button => button.disabled = false); }
  };
  $("admin-create-cancel").onclick = () => {
    if (creating || !confirm("取消新增並清除表單資料？")) return;
    form.reset(); form.classList.add("hidden"); feedback.textContent = "已取消，未建立帳戶";
  };
  form.onsubmit = async event => {
    event.preventDefault();
    if (creating || !form.reportValidity()) return;
    if (form.elements.password.value !== form.elements.confirmPassword.value) { feedback.textContent = "兩次密碼不一致"; return; }
    const body = Object.fromEntries(new FormData(form)); delete body.confirmPassword;
    creating = true; form.querySelectorAll("button").forEach(button => button.disabled = true);
    let created = false;
    try {
      await request("/api/admin/users", { method: "POST", body: JSON.stringify(body) });
      created = true; form.reset();
      await render();
      $("admin-create-status").textContent = "帳戶已建立，監控 LINE@ 已保存；請自行安全交付初始密碼。你的管理員登入保持不變。";
    } catch (error) {
      form.elements.password.value = ""; form.elements.confirmPassword.value = "";
      if (created) form.classList.add("hidden");
      feedback.textContent = created ? "帳戶已建立，但名單更新失敗，請重新整理名單，勿重複新增。" : error.message + "。連線異常時請先查閱名單確認結果；重試需重新輸入密碼。";
    } finally {
      body.password = ""; creating = false; form.querySelectorAll("button").forEach(button => button.disabled = false);
    }
  };
  const table = $("content").querySelector("table");
  if (table) {
    const heading = document.createElement("th"); heading.textContent = "監控 LINE@";
    table.querySelector("thead tr").appendChild(heading);
    const actionHeading = document.createElement("th"); actionHeading.textContent = "操作";
    table.querySelector("thead tr").appendChild(actionHeading);
    table.querySelectorAll("tbody tr").forEach((row, index) => {
      const cell = document.createElement("td"); cell.textContent = state.adminUsers[index]?.monitored_line_oa || "尚未指定"; row.appendChild(cell);
      const action = document.createElement("td"), button = document.createElement("button");
      button.type = "button"; button.className = "btn"; button.textContent = "編輯";
      button.onclick = () => {
        if (creating || !closeEdit()) return;
        if (!form.classList.contains("hidden") && !confirm("取消新增並改為編輯此帳戶？")) return;
        form.reset(); form.classList.add("hidden");
        editing = state.adminUsers[index];
        editForm.elements.email.value = editing.email;
        editForm.elements.displayName.value = editing.display_name;
        editForm.elements.companyName.value = editing.company_name || "";
        editForm.elements.monitoredLineOa.value = editing.monitored_line_oa || "";
        editPanel.classList.remove("hidden"); editForm.elements.displayName.focus(); feedback.textContent = "";
      };
      action.appendChild(button); row.appendChild(action);
    });
  }
}
`;
