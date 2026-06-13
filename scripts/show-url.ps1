$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env"
if (-not (Test-Path $envFile)) {
  Write-Host "Missing .env. Copy .env.example to .env first."
  exit 1
}

$envMap = @{}
Get-Content $envFile | ForEach-Object {
  if ($_ -match "^\s*#" -or $_ -notmatch "=") { return }
  $parts = $_ -split "=", 2
  $envMap[$parts[0].Trim()] = $parts[1].Trim()
}

$port = if ($envMap.PORT) { $envMap.PORT } else { "8787" }
$token = $envMap.AUTH_TOKEN

$ips = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object {
    $_.IPAddress -notlike "127.*" -and
    $_.IPAddress -notlike "169.254.*" -and
    $_.IPAddress -notlike "172.16.*" -and
    $_.IPAddress -notlike "172.17.*" -and
    $_.IPAddress -notlike "172.18.*" -and
    $_.IPAddress -notlike "172.19.*" -and
    $_.IPAddress -notlike "172.20.*" -and
    $_.IPAddress -notlike "172.21.*" -and
    $_.IPAddress -notlike "172.22.*" -and
    $_.IPAddress -notlike "172.23.*" -and
    $_.IPAddress -notlike "172.24.*" -and
    $_.IPAddress -notlike "172.25.*" -and
    $_.IPAddress -notlike "172.26.*" -and
    $_.IPAddress -notlike "172.27.*" -and
    $_.IPAddress -notlike "172.28.*" -and
    $_.IPAddress -notlike "172.29.*" -and
    $_.IPAddress -notlike "172.30.*" -and
    $_.IPAddress -notlike "172.31.*"
  } |
  Sort-Object @{
    Expression = {
      if ($_.IPAddress -like "100.*") { 0 }
      elseif ($_.IPAddress -like "192.168.*") { 1 }
      elseif ($_.IPAddress -like "10.*") { 2 }
      else { 3 }
    }
  }, InterfaceAlias |
  Select-Object InterfaceAlias, IPAddress

Write-Host ""
Write-Host "AIToPhone access URLs:"
foreach ($ip in $ips) {
  Write-Host ("  {0}: http://{1}:{2}/?token={3}" -f $ip.InterfaceAlias, $ip.IPAddress, $port, $token)
}
Write-Host ""
Write-Host "Use the Tailscale 100.x address when you do not want public exposure."
Write-Host "Use the 192.168.x.x address only when the iPhone and Windows are on the same Wi-Fi/LAN."
