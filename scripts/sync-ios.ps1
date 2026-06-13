$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  npm.cmd install
  npx.cmd cap sync ios
  Write-Host "iOS project synced. Open ios/App/App.xcodeproj on macOS with Xcode to build an IPA."
} finally {
  Pop-Location
}
