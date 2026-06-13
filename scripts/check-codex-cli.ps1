$ErrorActionPreference = "Continue"

Write-Host "Checking Codex CLI..."

$cmd = Get-Command codex.cmd -ErrorAction SilentlyContinue
if (-not $cmd) {
  Write-Host "Codex CLI was not found in PATH."
  Write-Host ""
  Write-Host "Install it with the official Windows command:"
  Write-Host 'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"'
  exit 1
}

Write-Host ("Found codex.cmd at: {0}" -f $cmd.Source)

try {
  $version = & codex.cmd --version 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Host "codex.cmd exists, but it did not run successfully:"
    Write-Host $version
    exit 2
  }
  Write-Host ("Version: {0}" -f $version)
} catch {
  Write-Host "codex.cmd exists, but PowerShell could not execute it:"
  Write-Host $_.Exception.Message
  exit 2
}

Write-Host ""
Write-Host "Codex CLI looks usable."
Write-Host "Next command:"
Write-Host "codex.cmd app-server --listen ws://127.0.0.1:4500"
