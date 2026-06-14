$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot

function Use-JavaIfNeeded {
  if (Get-Command java -ErrorAction SilentlyContinue) {
    return
  }

  $candidates = @(
    "$env:JAVA_HOME\bin\java.exe",
    "C:\Program Files\Android\Android Studio\jbr\bin\java.exe"
  )

  $searchRoots = @(
    "C:\Program Files\Java",
    "C:\Program Files\Eclipse Adoptium",
    "C:\Program Files\Microsoft",
    "C:\Program Files\Common Files\Oracle\Java"
  )

  foreach ($searchRoot in $searchRoots) {
    if (Test-Path $searchRoot) {
      $candidates += Get-ChildItem -Path $searchRoot -Recurse -Filter java.exe -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty FullName
    }
  }

  $javaExe = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
  if (-not $javaExe) {
    Write-Host "Java JDK was not found. Install Android Studio or JDK 21 first."
    Write-Host "After setup, rerun: powershell -ExecutionPolicy Bypass -File .\scripts\build-android-apk.ps1"
    exit 1
  }

  $javaBin = Split-Path -Parent $javaExe
  if ((Split-Path -Leaf $javaBin) -ieq "bin") {
    $env:JAVA_HOME = Split-Path -Parent $javaBin
  } elseif ($env:JAVA_HOME) {
    Remove-Item Env:\JAVA_HOME
  }
  $env:Path = "$javaBin;$env:Path"
  Write-Host "Using Java from: $javaExe"
}

Push-Location $root
try {
  npm.cmd install
  npx.cmd cap sync android
  Use-JavaIfNeeded
  java -version
  & .\android\gradlew.bat -p android assembleDebug
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
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
