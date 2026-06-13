$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot

$processes = Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -like "*server/index.mjs*" }

foreach ($process in $processes) {
  if ($process.ProcessId -ne $PID) {
    Stop-Process -Id $process.ProcessId -ErrorAction SilentlyContinue
  }
}

Start-Process -FilePath npm.cmd -ArgumentList "start" -WorkingDirectory $root -WindowStyle Hidden
Start-Sleep -Seconds 1

Write-Host "AIToPhone server restarted."
& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "show-url.ps1")
