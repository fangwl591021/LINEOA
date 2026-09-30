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

export const adminAccountClientScript = `const ADMIN_ACCOUNT_FORM = ${JSON.stringify(formHtml)};` + String.raw`
function bindAdminAccountForm() {
  if (state.user?.role !== "admin") return;
  $("content").insertAdjacentHTML("afterbegin", ADMIN_ACCOUNT_FORM);
  const form = $("admin-create-form"), feedback = $("admin-create-status");
  let creating = false;
  $("admin-create-open").onclick = () => { form.classList.remove("hidden"); form.elements.displayName.focus(); };
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
    table.querySelectorAll("tbody tr").forEach((row, index) => {
      const cell = document.createElement("td"); cell.textContent = state.adminUsers[index]?.monitored_line_oa || "尚未指定"; row.appendChild(cell);
    });
  }
}
`;
