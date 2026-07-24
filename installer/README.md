# LINEOA 固定資料夾與一鍵更新器

## 第一次安裝

1. 解壓縮更新器 ZIP，保留整個資料夾。
2. 雙擊 `Update-LINEOA.cmd`。
3. 更新器會將最新版安裝到：
   `%LOCALAPPDATA%\LINEOA\Extension`
4. 在 Chrome 開啟 `chrome://extensions`。
5. 開啟「開發人員模式」。
6. 點選「載入未封裝項目」，選擇上述固定資料夾。

## 以後更新

1. 雙擊同一個 `Update-LINEOA.cmd`。
2. 更新完成後，在 `chrome://extensions` 對 LINEOA 按「重新載入」。
3. 不要移除擴充功能，也不要更換固定資料夾。

維持相同資料夾可保留相同的開發版擴充功能身分與 LINEOA 登入儲存空間。

## 更新來源與安全

- 更新來源固定為 `fangwl591021/LINEOA` 的 `main` 分支。
- 使用 HTTPS 下載 GitHub 原始碼。
- 安裝前驗證名稱、Manifest V3、聊天室網域與必要檔案。
- 只覆蓋 `%LOCALAPPDATA%\LINEOA\Extension`，不清除其他資料夾。
- 更新器不讀取 Chrome Cookie、LINE Token 或 LINEOA 密碼。
