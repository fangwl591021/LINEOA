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

完整測試與隱私邊界請參考 `extension/TESTING.md`。

## 部署前

1. 建立 D1：`wrangler d1 create lineoa_saas`
2. 將回傳的 `database_id` 填入 `wrangler.toml`
3. 套用 migration：`wrangler d1 migrations apply lineoa_saas --remote`
4. 視需要設定 `ADMIN_EMAILS`
5. 執行 `wrangler deploy`

正式網址預計為 `https://line-oa.fangwl591021.workers.dev/`。
