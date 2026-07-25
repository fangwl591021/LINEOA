import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));
const background = readFileSync(new URL("../extension/background.js", import.meta.url), "utf8");
const content = readFileSync(new URL("../extension/content.js", import.meta.url), "utf8");
const popup = readFileSync(new URL("../extension/popup.js", import.meta.url), "utf8");
const optionsHtml = readFileSync(new URL("../extension/options.html", import.meta.url), "utf8");
const optionsJs = readFileSync(new URL("../extension/options.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../extension/styles.css", import.meta.url), "utf8");
const testing = readFileSync(new URL("../extension/TESTING.md", import.meta.url), "utf8");

test("extension uses a narrow Manifest V3 boundary", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.1.6");
  assert.deepEqual(manifest.permissions, ["storage", "activeTab"]);
  assert.deepEqual(manifest.host_permissions, ["https://line-oa.fangwl591021.workers.dev/*"]);
  assert.deepEqual(manifest.content_scripts[0].matches, [
    "https://manager.line.biz/*",
    "https://chat.line.biz/*"
  ]);
  assert.equal(manifest.content_scripts[0].all_frames, undefined);
  assert.equal(manifest.action.default_popup, "popup.html");
  assert.deepEqual(manifest.options_ui, { page: "options.html", open_in_tab: true });
  assert.doesNotMatch(background, /chrome\.action\.onClicked/);
  assert.match(popup, /https:\/\/line-oa\.fangwl591021\.workers\.dev\/app/);
});

test("integration settings stay in the private extension surface", () => {
  assert.match(optionsHtml, /LINE Login Channel ID/);
  assert.match(optionsHtml, /LINE Login Channel secret/);
  assert.match(optionsHtml, /LINE Bot Channel access token/);
  assert.match(optionsHtml, /LINE Bot Channel secret/);
  assert.match(optionsHtml, /type="password"/);
  assert.match(background, /lineoa_integration_settings/);
  assert.match(background, /settingsSummary/);
  assert.match(background, /openOptionsPage/);
  assert.doesNotMatch(optionsJs, /console\./);
  assert.doesNotMatch(content, /lineBotChannelAccessToken|lineLoginChannelSecret/);
});

test("session token remains behind the extension background worker", () => {
  assert.match(background, /chrome\.storage\.local/);
  assert.match(background, /credentials: "omit"/);
  assert.match(background, /referrerPolicy: "no-referrer"/);
  assert.doesNotMatch(content, /lineoa_token/);
  assert.doesNotMatch(content, /authorization/i);
  assert.doesNotMatch(background, /contact|avatar|conversationKey/i);
});

test("content workflow follows the active chat and has three display modes", () => {
  assert.match(content, /data-action="scan"/);
  assert.match(content, /startConversationTracking/);
  assert.match(content, /location\.pathname/);
  assert.match(content, /avatar\?\.currentSrc/);
  assert.match(content, /LINE UID/);
  assert.match(content, /scanVisibleConversation\(\{ automatic: true \}\)/);
  assert.match(content, /navigator\.clipboard\.writeText/);
  assert.match(content, /\["float", "side", "full"\]/);
  assert.doesNotMatch(content, /\.click\(\)/);
  assert.doesNotMatch(content, /scrollIntoView|window\.scroll|scrollTo/);
  assert.match(styles, /\[data-mode="float"\]/);
  assert.match(styles, /\[data-mode="side"\]/);
  assert.match(styles, /\[data-mode="full"\]/);
  assert.match(content, /mode: "float"/);
  assert.match(content, /lineoa_layout_version/);
  assert.match(content, /lineoa-admin-sidebar/);
  assert.match(content, /工作總覽/);
  assert.match(content, /聊天室監控/);
  assert.match(content, /知識庫/);
  assert.match(content, /帳戶方案/);
  assert.match(content, /toggle-admin-group/);
  assert.match(content, /串接設定/);
  assert.doesNotMatch(content, /action\.fangwl591021\.workers\.dev/);
});

test("chat.line.biz has a visible central-chat fallback", () => {
  assert.match(content, /location\.hostname === "chat\.line\.biz"/);
  assert.match(content, /document\.querySelectorAll\("p, span, div"\)/);
  assert.match(content, /rect\.left < chatLeft \|\| rect\.right > panelLeft/);
  assert.match(content, /element\.closest\('button, a, input, textarea, select, nav, header/);
  assert.match(content, /isInterfaceText/);
});
test("test instructions state the privacy and no-send boundaries", () => {
  assert.match(testing, /不讀取 Cookie、LINE Token/);
  assert.match(testing, /不捲動聊天頁、不填入輸入框、不點擊傳送、不自動發送/);
  assert.match(testing, /聊天文字、聯絡人 UID、名稱與頭貼只在目前瀏覽器頁面使用/);
});
