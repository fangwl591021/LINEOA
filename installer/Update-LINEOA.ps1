[CmdletBinding()]
param(
  [string]$InstallRoot = (Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "LINEOA\Extension"),
  [string]$ArchiveUrl = "https://github.com/fangwl591021/LINEOA/archive/refs/heads/main.zip",
  [switch]$NoOpen
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$expectedName = "LINEOA 測試版"
$requiredFiles = @(
  "manifest.json",
  "background.js",
  "content.js",
  "styles.css",
  "popup.html",
  "popup.css",
  "popup.js",
  "TESTING.md"
)
$tempBase = [IO.Path]::GetTempPath()
$tempRoot = Join-Path $tempBase ("lineoa-update-" + [guid]::NewGuid().ToString("N"))
$archivePath = Join-Path $tempRoot "lineoa-main.zip"
$extractRoot = Join-Path $tempRoot "source"

function Write-Step([string]$Message) {
  Write-Host ("[LINEOA] " + $Message) -ForegroundColor Cyan
}

function Open-InstallHelp([string]$ExtensionPath) {
  if ($NoOpen) { return }

  Start-Process explorer.exe -ArgumentList @($ExtensionPath)
  $chromeCandidates = @(
    (Join-Path ${env:ProgramFiles} "Google\Chrome\Application\chrome.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
    (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

  if ($chromeCandidates.Count -gt 0) {
    Start-Process -FilePath $chromeCandidates[0] -ArgumentList @("chrome://extensions/")
  } else {
    Write-Host "請手動開啟 chrome://extensions" -ForegroundColor Yellow
  }
}

try {
  Write-Step "下載最新版本"
  New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
  Invoke-WebRequest -UseBasicParsing -Uri $ArchiveUrl -OutFile $archivePath
  Expand-Archive -LiteralPath $archivePath -DestinationPath $extractRoot

  $sourceManifest = Get-ChildItem -LiteralPath $extractRoot -Recurse -Filter manifest.json -File |
    Where-Object { $_.Directory.Name -eq "extension" } |
    Select-Object -First 1
  if (-not $sourceManifest) {
    throw "下載內容缺少 extension\manifest.json"
  }

  $sourceExtension = $sourceManifest.Directory.FullName
  $manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $sourceManifest.FullName | ConvertFrom-Json
  if ($manifest.manifest_version -ne 3 -or $manifest.name -ne $expectedName) {
    throw "下載內容不是預期的 LINEOA Manifest V3 擴充功能"
  }
  if ($manifest.content_scripts[0].matches -notcontains "https://chat.line.biz/*") {
    throw "下載內容缺少 LINE 聊天室權限"
  }

  foreach ($fileName in $requiredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $sourceExtension $fileName))) {
      throw "下載內容缺少必要檔案：$fileName"
    }
  }

  Write-Step ("安裝版本 " + $manifest.version)
  New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
  Copy-Item -Path (Join-Path $sourceExtension "*") -Destination $InstallRoot -Recurse -Force

  $installedManifestPath = Join-Path $InstallRoot "manifest.json"
  $installedManifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $installedManifestPath | ConvertFrom-Json
  if ($installedManifest.version -ne $manifest.version) {
    throw "安裝後版本驗證失敗"
  }

  Write-Host ""
  Write-Host ("LINEOA " + $manifest.version + " 已更新完成") -ForegroundColor Green
  Write-Host ("固定資料夾：" + $InstallRoot)
  Write-Host "第一次：在 chrome://extensions 選擇「載入未封裝項目」。"
  Write-Host "之後更新：只要按 LINEOA 卡片上的「重新載入」。"
  Open-InstallHelp $InstallRoot
} finally {
  $resolvedTemp = [IO.Path]::GetFullPath($tempRoot)
  $resolvedBase = [IO.Path]::GetFullPath($tempBase)
  if ($resolvedTemp.StartsWith($resolvedBase, [StringComparison]::OrdinalIgnoreCase) -and
      (Split-Path -Leaf $resolvedTemp).StartsWith("lineoa-update-")) {
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force -ErrorAction SilentlyContinue
  }
}
