$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  npm.cmd install
  npx.cmd cap sync android
  Write-Host "Android project synced. Build debug APK with: .\android\gradlew.bat -p android assembleDebug"
} finally {
  Pop-Location
}
