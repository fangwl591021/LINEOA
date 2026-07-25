# LINEOA SaaS

LINEOA 是以 Chrome 擴充功能作為工作入口的 LINE OA 客服輔助平台。

第一階段免費版：

- 安裝擴充功能後註冊帳號，自動啟用免費方案。
- 不需要 LINE Messaging API、Channel Secret、Access Token 或 Webhook。
- 只讀取目前 LINE OA 網頁上可見的聊天內容。
- 每位免費使用者可建立最多 100 筆知識庫。
- 知識比對與建議回覆在擴充功能內執行，不會自動發送 LINE 訊息。
- 介面提供懸浮、側欄、三欄全螢幕三種狀態。

## 專案結構

```text
src/worker.js             Cloudflare Worker API 與 SaaS 管理介面
migrations/0001_initial.sql
extension/                Manifest V3 Chrome 擴充功能
test/                     契約測試
```

## 免審查測試版安裝

1. 下載並解壓縮 LINEOA 擴充功能測試版。
2. 開啟 `chrome://extensions`。
3. 啟用「開發人員模式」。
4. 點選「載入未封裝項目」，選擇內含 `manifest.json` 的 `extension/` 資料夾。
5. 開啟 `https://manager.line.biz/`。

選擇帳號並切換至聊天室後，網址會變成 `https://chat.line.biz/`；LINEOA 會繼續載入，不會把使用者帶回帳號目錄。

完整測試與隱私邊界請參考 `extension/TESTING.md`。

## 固定資料夾與一鍵更新

第一次下載 `installer/` 後，雙擊 `Update-LINEOA.cmd`。更新器會把最新版安裝到：

```text
%LOCALAPPDATA%\LINEOA\Extension
```

只需第一次在 `chrome://extensions` 載入這個固定資料夾。以後雙擊相同更新器，再對 LINEOA 按「重新載入」，不必移除、換資料夾或重新登入。

完整說明請參考 `installer/README.md`。

## 部署前

1. 建立 D1：`wrangler d1 create lineoa_saas`
2. 將回傳的 `database_id` 填入 `wrangler.toml`
3. 套用 migration：`wrangler d1 migrations apply lineoa_saas --remote`
4. 視需要設定 `ADMIN_EMAILS`
5. 執行 `wrangler deploy`

正式網址預計為 `https://line-oa.fangwl591021.workers.dev/`。

## 圖文選單付費功能

- 擴充功能提供 `menu.html` 圖文選單編輯器，支援上傳 LINE 規格圖片、劃定 URI／文字／Postback 區域並部署。
- 首次開啟圖文選單時開始 30 天試用。
- 試用結束後年費為 NT$199；管理員可在確認收款後透過受保護的啟用 API 延長一年。
- LINE Bot Channel access token 僅保存在 Chrome 擴充功能儲存空間，部署時由背景程式直接送往 LINE API，不寫入 D1。
