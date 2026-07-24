import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const updater = readFileSync(new URL("../installer/Update-LINEOA.ps1", import.meta.url), "utf8");
const launcher = readFileSync(new URL("../installer/Update-LINEOA.cmd", import.meta.url), "utf8");
const instructions = readFileSync(new URL("../installer/README.md", import.meta.url), "utf8");

test("one-click updater uses the official LINEOA main branch and a stable local folder", () => {
  assert.match(updater, /fangwl591021\/LINEOA\/archive\/refs\/heads\/main\.zip/);
  assert.match(updater, /GetFolderPath\("LocalApplicationData"\)/);
  assert.match(updater, /"LINEOA\\Extension"/);
  assert.match(launcher, /Update-LINEOA\.ps1/);
});

test("updater validates the extension before copying it", () => {
  assert.match(updater, /\$expectedName = "LINEOA 測試版"/);
  assert.match(updater, /\$manifest\.manifest_version -ne 3/);
  assert.match(updater, /https:\/\/chat\.line\.biz\/\*/);
  assert.match(updater, /foreach \(\$fileName in \$requiredFiles\)/);
  assert.match(updater, /Copy-Item/);
});

test("updater cleanup is limited to its generated temp directory", () => {
  assert.match(updater, /StartsWith\(\$resolvedBase/);
  assert.match(updater, /StartsWith\("lineoa-update-"\)/);
  assert.doesNotMatch(updater, /Remove-Item[^]*\$InstallRoot/);
  assert.match(instructions, /不要移除擴充功能，也不要更換固定資料夾/);
});
