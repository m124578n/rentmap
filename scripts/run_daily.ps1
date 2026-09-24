# 每日採集:git pull → (lock 有變才 npm install)→ collector sync(掃 searches.json 的搜尋條件 + 重抓活躍物件偵測下架 / 漲跌價)。
# 由 Windows 工作排程器分四個時段觸發(見 register_task.ps1),每次帶 -Group。log 在 data/logs/{date}-sync-{group}.log。
#
# 尚未部署前,RENTMAP_API 是本機 http://localhost:5173:這支腳本會自己把 dev server 拉起來、跑完再關掉。
# 部署後把 .env 的 RENTMAP_API 改成正式站網址,就不會再碰 dev server。

param([string]$Group = "")   # taipei | newtaipei | recheck | housefun;空 = 全部(舊行為)

$ErrorActionPreference = "Continue"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONIOENCODING = "utf-8"

# 跑的期間不讓電腦閒置自動睡眠
$power = Add-Type -Namespace Rentmap -Name Power -PassThru -MemberDefinition `
    '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'
$null = $power::SetThreadExecutionState([uint32]2147483649)

$logDir = Join-Path $repo "data\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format "yyyy-MM-dd"
$suffix = if ($Group) { "-$Group" } else { "" }
$log = Join-Path $logDir "$stamp-sync$suffix.log"

function Log {
    param([Parameter(ValueFromPipeline = $true)] $line)
    process {
        $text = if ($line -is [System.Management.Automation.ErrorRecord]) { $line.Exception.Message } else { "$line" }
        Write-Host $text
        $text | Out-File -FilePath $log -Append -Encoding utf8
    }
}

"=== rentmap daily sync [$Group] @ $(Get-Date -Format o) ===" | Log

# 第一步:拉最新程式(其他機器或 Claude 推上去的改動)。ff-only 失敗就照舊版跑,不擋採集。
# package-lock 有變才 npm install(不然每天白跑)。
$lockBefore = (Get-FileHash (Join-Path $repo "package-lock.json") -ErrorAction SilentlyContinue).Hash
"--- git pull ---" | Log
try { & git pull --ff-only 2>&1 | Log } catch { "!! git pull 失敗:$_" | Log }
$lockAfter = (Get-FileHash (Join-Path $repo "package-lock.json") -ErrorAction SilentlyContinue).Hash
if ($lockBefore -ne $lockAfter) {
    "package-lock 有變,npm install" | Log
    try { & npm install --no-audit --no-fund 2>&1 | Log } catch { "!! npm install 失敗:$_" | Log }
}

# 讀 .env 的 RENTMAP_API
$api = "http://localhost:5173"
$envFile = Join-Path $repo ".env"
if (Test-Path $envFile) {
    foreach ($l in Get-Content $envFile) { if ($l -match '^RENTMAP_API=(.+)$') { $api = $Matches[1].Trim() } }
}
$isLocal = $api -match '^https?://localhost'

# 本機模式:dev server 沒開就自己開(隱藏視窗),跑完關掉
$devProc = $null
if ($isLocal) {
    $up = $false
    try { $null = Invoke-WebRequest -Uri "$api/api/health" -UseBasicParsing -TimeoutSec 3; $up = $true } catch {}
    if (-not $up) {
        "dev server 沒開,啟動 vite dev" | Log
        $devProc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx vite dev" -WorkingDirectory $repo -WindowStyle Hidden -PassThru
        for ($i = 0; $i -lt 60; $i++) {
            Start-Sleep -Seconds 1
            try { $null = Invoke-WebRequest -Uri "$api/api/health" -UseBasicParsing -TimeoutSec 2; $up = $true; break } catch {}
        }
        if (-not $up) { "!! dev server 起不來,放棄" | Log; exit 1 }
    }
}

"--- collect sync ---" | Log
try {
    if ($Group) { & npm run collect -- sync "--group=$Group" 2>&1 | Log } else { & npm run collect -- sync 2>&1 | Log }
} catch {
    "!! sync 失敗:$_" | Log
}

if ($devProc) {
    "關閉 dev server" | Log
    # cmd /c 起的子樹:把佔 5173 的 node 一起殺
    Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
    Stop-Process -Id $devProc.Id -Force -ErrorAction SilentlyContinue
}

$null = $power::SetThreadExecutionState([uint32]2147483648)
"=== done @ $(Get-Date -Format o) ===" | Log
