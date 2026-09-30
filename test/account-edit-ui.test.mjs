import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

test("account editor opens saved values, cancels without writes and submits only editable fields", async () => {
  const nodes = new Map();
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, { hidden: true, value: "", textContent: "", innerHTML: "", events: {},
      addEventListener(type, callback) { this.events[type] = callback; }, focus() {},
      reportValidity() { return true; }, reset() { for (const el of Object.values(this.elements || {})) el.value = ""; }
    });
    return nodes.get(id);
  }
  for (const id of ["create-form", "edit-form"]) {
    node(id).elements = Object.fromEntries(["email", "displayName", "companyName", "monitoredLineOa", "password", "confirmPassword"].map(name => [name, { value: "", focus() {} }]));
  }
  let user = { id: "test-user", email: "sample@example.invalid", display_name: "原本姓名", company_name: "原公司", monitored_line_oa: "@old", updated_at: "v1", role: "user", plan: "free", status: "active" };
  const writes = [], confirms = [];
  const context = vm.createContext({
    document: { getElementById: node, querySelectorAll: () => [] },
    window: { addEventListener() {}, close() {} },
    confirm: message => { confirms.push(message); return true; },
    chrome: { runtime: { sendMessage: async message => {
      if (message.type.endsWith(":list")) return { ok: true, users: [{ ...user }] };
      writes.push(message);
      user = { ...user, display_name: message.body.displayName, company_name: message.body.companyName, monitored_line_oa: message.body.monitoredLineOa, updated_at: "v2" };
      return { ok: true };
    } } }
  });
  vm.runInContext(readFileSync(new URL("../extension/accounts.js", import.meta.url), "utf8"), context);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(node("users").innerHTML, /data-edit="test-user"/);
  const clickEdit = () => node("users").onclick({ target: { closest: () => ({ dataset: { edit: user.id } }) } });
  clickEdit();
  const form = node("edit-form");
  assert.equal(form.hidden, false);
  assert.equal(form.elements.displayName.value, "原本姓名");
  form.elements.displayName.value = "取消的修改";
  form.events.input();
  node("cancel-edit").onclick();
  assert.equal(form.hidden, true);
  assert.equal(writes.length, 0);
  assert.equal(confirms.length, 1);
  clickEdit();
  form.elements.displayName.value = "修改姓名";
  form.elements.companyName.value = "";
  form.elements.monitoredLineOa.value = "@new";
  form.events.input();
  // Refreshing the list must not replace the edit's original revision or unsaved input.
  user.updated_at = "changed-elsewhere";
  await node("refresh").onclick();
  assert.equal(form.elements.displayName.value, "修改姓名");
  await form.events.submit({ preventDefault() {} });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].type, "lineoa:accounts:update");
  assert.deepEqual(JSON.parse(JSON.stringify(writes[0].body)), { id: "test-user", expectedUpdatedAt: "v1", displayName: "修改姓名", companyName: "", monitoredLineOa: "@new" });
  assert.equal(form.hidden, true);
  assert.match(node("status").textContent, /帳戶資料已更新/);
  assert.match(node("users").innerHTML, /修改姓名/);
});
