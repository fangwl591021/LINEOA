# LINEOA 免審查測試版

## 安裝

1. 解壓縮 `LINEOA-extension-v0.1.7.zip`。
2. 在 Chrome 開啟 `chrome://extensions`。
3. 開啟右上角「開發人員模式」。
4. 點選「載入未封裝項目」。
5. 選擇解壓縮後、內含 `manifest.json` 的資料夾。
6. 開啟 `https://manager.line.biz/`。

## 測試流程

1. 在 LINEOA 側欄登入或免費註冊。
2. 至 LINEOA 網站建立至少一筆知識。
3. 回到 LINE OA Manager 並開啟聊天室。
4. 點選左側任一聯絡人，確認 LINEOA 自動更新對方名稱、頭貼與 UID。
5. 再切換另一位聯絡人，確認 LINEOA 自動重新讀取目前可見對話並比對。
6. 確認可見文字預覽正確，再人工複製建議；按鈕只作為手動重新讀取。
7. 切換全版後確認「服務中心／管理工具」可以收合。
8. 進入「串接設定」，確認可填寫四項 LINE API 參數，既有 secret/token 不會回填。

## 安全邊界

- 只在 LINE 官方管理頁 `https://manager.line.biz/*` 與聊天室 `https://chat.line.biz/*` 載入。
- 使用者切換聊天室後，自動讀取目前視窗內可見文字並於本機比對。
- 聊天文字、聯絡人 UID、名稱與頭貼只在目前瀏覽器頁面使用，不回傳 LINEOA API。
- 不讀取 Cookie、LINE Token 或 LINE Authorization Header。
- 不捲動聊天頁、不填入輸入框、不點擊傳送、不自動發送。
- LINEOA 登入權杖與使用者填寫的 LINE API 參數只保存在 Chrome 擴充功能自己的儲存空間。
- secret/token 不會回填至設定表單，也不會放入 LINE 聊天頁 DOM。
- 切換為全版時顯示 ACTION 風格的 LINEOA 管理介面；聊天室監控是其中一個功能頁。

## 更新

下載新版、取代原資料夾後，在 `chrome://extensions` 對 LINEOA 點選「重新載入」。
