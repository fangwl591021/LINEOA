# LINEOA 免審查測試版

## 安裝

1. 解壓縮 `LINEOA-extension-v0.1.0.zip`。
2. 在 Chrome 開啟 `chrome://extensions`。
3. 開啟右上角「開發人員模式」。
4. 點選「載入未封裝項目」。
5. 選擇解壓縮後、內含 `manifest.json` 的資料夾。
6. 開啟 `https://manager.line.biz/`。

## 測試流程

1. 在 LINEOA 側欄登入或免費註冊。
2. 至 LINEOA 網站建立至少一筆知識。
3. 回到 LINE OA Manager 並開啟聊天室。
4. 點選「同步知識庫」。
5. 點選「讀取目前可見對話並比對」。
6. 確認可見文字預覽正確，再人工複製建議。

## 安全邊界

- 只在 `https://manager.line.biz/*` 載入。
- 只有使用者按下比對按鈕時，才讀取目前視窗內可見文字。
- 聊天文字只在瀏覽器內與已下載的知識庫比對，不回傳 LINEOA API。
- 不讀取 Cookie、LINE Token 或 LINE Authorization Header。
- 不捲動聊天頁、不填入輸入框、不點擊傳送、不自動發送。
- LINEOA 登入權杖只保存在 Chrome 擴充功能自己的儲存空間。

## 更新

下載新版、取代原資料夾後，在 `chrome://extensions` 對 LINEOA 點選「重新載入」。
