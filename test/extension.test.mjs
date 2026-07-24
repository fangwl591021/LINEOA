import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));
const background = readFileSync(new URL("../extension/background.js", import.meta.url), "utf8");
const content = readFileSync(new URL("../extension/content.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../extension/styles.css", import.meta.url), "utf8");
const testing = readFileSync(new URL("../extension/TESTING.md", import.meta.url), "utf8");

test("extension uses a narrow Manifest V3 boundary", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["storage", "activeTab"]);
  assert.deepEqual(manifest.host_permissions, ["https://line-oa.fangwl591021.workers.dev/*"]);
  assert.deepEqual(manifest.content_scripts[0].matches, ["https://manager.line.biz/*"]);
  assert.equal(manifest.content_scripts[0].all_frames, undefined);
});

test("session token remains behind the extension background worker", () => {
  assert.match(background, /chrome\.storage\.local/);
  assert.match(background, /credentials: "omit"/);
  assert.match(background, /referrerPolicy: "no-referrer"/);
  assert.doesNotMatch(content, /lineoa_token/);
  assert.doesNotMatch(content, /authorization/i);
});

test("content workflow is manual and has three display modes", () => {
  assert.match(content, /data-action="scan"/);
  assert.match(content, /navigator\.clipboard\.writeText/);
  assert.match(content, /\["float", "side", "full"\]/);
  assert.doesNotMatch(content, /\.click\(\)/);
  assert.doesNotMatch(content, /scrollIntoView|window\.scroll|scrollTo/);
  assert.match(styles, /\[data-mode="float"\]/);
  assert.match(styles, /\[data-mode="side"\]/);
  assert.match(styles, /\[data-mode="full"\]/);
});

test("test instructions state the privacy and no-send boundaries", () => {
  assert.match(testing, /不讀取 Cookie、LINE Token/);
  assert.match(testing, /不捲動聊天頁、不填入輸入框、不點擊傳送、不自動發送/);
  assert.match(testing, /聊天文字只在瀏覽器內/);
});
