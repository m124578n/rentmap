# 註冊 Windows 工作排程:每日採集拆成四組、四個時段,每組量小(對站方友善、失敗影響小)。
# 手動執行一次即可:  powershell -ExecutionPolicy Bypass -File scripts\register_task.ps1
# 移除全部:  Get-ScheduledTask | ? { $_.TaskName -like "RentmapSync-*" } | Unregister-ScheduledTask -Confirm:$false
# 立即測試一組:  Start-ScheduledTask -TaskName RentmapSync-Taipei

$repo = Split-Path -Parent $PSScriptRoot
$script = Join-Path $repo "scripts\run_daily.ps1"

# 名稱 → (group, 時間, 說明)
$jobs = @(
    @{ Name = "RentmapSync-Housefun";  Group = "housefun";  At = "12:30PM"; Desc = "好房列表 2+2 頁 + 重抓 15 筆(約 40 次載入,避開 403)" },
    @{ Name = "RentmapSync-Taipei";    Group = "taipei";    At = "8:00PM";  Desc = "591 台北三種房型列表 + 新物件" },
    @{ Name = "RentmapSync-NewTaipei"; Group = "newtaipei"; At = "9:30PM";  Desc = "591 新北三種房型列表 + 新物件" },
    @{ Name = "RentmapSync-Recheck";   Group = "recheck";   At = "11:00PM"; Desc = "591 活躍物件重抓最多 150 筆(下架 / 漲跌價)" }
)

# 舊的單一排程
Unregister-ScheduledTask -TaskName "RentmapDailySync" -Confirm:$false -ErrorAction SilentlyContinue

foreach ($j in $jobs) {
    $action = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument "-ExecutionPolicy Bypass -NonInteractive -File `"$script`" -Group $($j.Group)" `
        -WorkingDirectory $repo
    $trigger = New-ScheduledTaskTrigger -Daily -At $j.At
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Hours 1)
    Register-ScheduledTask -TaskName $j.Name -Description "rentmap:$($j.Desc)" -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
    Write-Host "已註冊 $($j.Name)(每天 $($j.At),group=$($j.Group))"
}
