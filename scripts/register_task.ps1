# 註冊 Windows 工作排程,每天 20:00 執行 run_daily.ps1(和 menmap 同一時間)。
# 手動執行一次即可:  powershell -ExecutionPolicy Bypass -File scripts\register_task.ps1
# 移除:  Unregister-ScheduledTask -TaskName "RentmapDailySync" -Confirm:$false
# 立即測試:  Start-ScheduledTask -TaskName RentmapDailySync

$repo = Split-Path -Parent $PSScriptRoot
$script = Join-Path $repo "scripts\run_daily.ps1"

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-ExecutionPolicy Bypass -NonInteractive -File `"$script`"" `
    -WorkingDirectory $repo

$trigger = New-ScheduledTaskTrigger -Daily -At 8:00PM
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -WakeToRun `
    -DontStopOnIdleEnd `
    -ExecutionTimeLimit (New-TimeSpan -Hours 3)

Register-ScheduledTask `
    -TaskName "RentmapDailySync" `
    -Description "rentmap(租屋筆記)每日採集:591 + 好房,雙北" `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Force | Out-Null

Write-Host "已註冊 'RentmapDailySync'(每天 20:00)。立即測試:Start-ScheduledTask -TaskName RentmapDailySync"
