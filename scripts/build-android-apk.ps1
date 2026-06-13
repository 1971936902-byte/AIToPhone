$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  npm.cmd install
  npx.cmd cap sync android
  if (-not (Get-Command java -ErrorAction SilentlyContinue)) {
    Write-Host "Java JDK was not found. Install Android Studio or a JDK first."
    Write-Host "After setup, rerun: powershell -ExecutionPolicy Bypass -File .\scripts\build-android-apk.ps1"
    exit 1
  }
  & .\android\gradlew.bat -p android assembleDebug
  $apk = Join-Path $root "android\app\build\outputs\apk\debug\app-debug.apk"
  if (Test-Path $apk) {
    Write-Host "APK built:"
    Write-Host $apk
  } else {
    Write-Host "Build finished, but APK was not found at expected path:"
    Write-Host $apk
  }
} finally {
  Pop-Location
}
