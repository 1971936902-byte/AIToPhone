$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$script:Root = Split-Path -Parent $PSScriptRoot
$script:EnvFile = Join-Path $script:Root ".env"
$script:ExampleEnvFile = Join-Path $script:Root ".env.example"

function Ensure-EnvFile {
  if (-not (Test-Path $script:EnvFile)) {
    if (Test-Path $script:ExampleEnvFile) {
      Copy-Item $script:ExampleEnvFile $script:EnvFile
    } else {
      Set-Content -Path $script:EnvFile -Value @(
        "HOST=0.0.0.0",
        "PORT=8787",
        "AUTH_TOKEN=change-this-long-random-token",
        "CODEX_COMMAND=codex.cmd",
        "CODEX_APP_SERVER_PORT=4500",
        "CODEX_APPROVAL_POLICY=never",
        "CODEX_SANDBOX=danger-full-access"
      ) -Encoding UTF8
    }
  }
}

function Read-EnvMap {
  Ensure-EnvFile
  $map = @{}
  Get-Content $script:EnvFile | ForEach-Object {
    if ($_ -match "^\s*#" -or $_ -notmatch "=") { return }
    $parts = $_ -split "=", 2
    $map[$parts[0].Trim()] = $parts[1].Trim()
  }
  return $map
}

function Write-EnvMap($map) {
  $lines = @(
    "HOST=$($map.HOST)",
    "PORT=$($map.PORT)",
    "AUTH_TOKEN=$($map.AUTH_TOKEN)",
    "CODEX_COMMAND=$($map.CODEX_COMMAND)",
    "CODEX_APP_SERVER_PORT=$($map.CODEX_APP_SERVER_PORT)",
    "CODEX_APPROVAL_POLICY=$($map.CODEX_APPROVAL_POLICY)",
    "CODEX_SANDBOX=$($map.CODEX_SANDBOX)"
  )
  Set-Content -Path $script:EnvFile -Value $lines -Encoding UTF8
}

function Get-ConfiguredPort($map) {
  if ($map.PORT) { return $map.PORT }
  return "8787"
}

function Get-ConfiguredToken($map) {
  if ($map.AUTH_TOKEN) { return $map.AUTH_TOKEN }
  return ""
}

function Get-AccessUrls($map) {
  $port = Get-ConfiguredPort $map
  $token = Get-ConfiguredToken $map
  $ips = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object {
      $_.IPAddress -notlike "127.*" -and
      $_.IPAddress -notlike "169.254.*" -and
      $_.IPAddress -notmatch "^172\.(1[6-9]|2[0-9]|3[0-1])\."
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

  $urls = @()
  foreach ($ip in $ips) {
    $urls += "{0}: http://{1}:{2}/?token={3}" -f $ip.InterfaceAlias, $ip.IPAddress, $port, $token
  }
  return $urls
}

function Stop-AIToPhoneGateway {
  $processes = Get-CimInstance Win32_Process |
    Where-Object { $_.CommandLine -like "*server/index.mjs*" }

  foreach ($process in $processes) {
    if ($process.ProcessId -ne $PID) {
      Stop-Process -Id $process.ProcessId -ErrorAction SilentlyContinue
    }
  }
}

function Start-AIToPhoneGateway {
  Start-Process -FilePath "npm.cmd" -ArgumentList "start" -WorkingDirectory $script:Root -WindowStyle Hidden
}

function Restart-AIToPhoneGateway {
  Stop-AIToPhoneGateway
  Start-AIToPhoneGateway
  Start-Sleep -Seconds 2
}

function Invoke-AIToPhoneApi($path) {
  $map = Read-EnvMap
  $port = Get-ConfiguredPort $map
  $token = Get-ConfiguredToken $map
  $headers = @{ Authorization = "Bearer $token" }
  return Invoke-RestMethod -Uri "http://127.0.0.1:$port$path" -Headers $headers -TimeoutSec 15
}

function Test-AIToPhoneStatus {
  try {
    $status = Invoke-AIToPhoneApi "/api/status"
    return $status.codex
  } catch {
    return [pscustomobject]@{
      connected = $false
      initialized = $false
      lastError = $_.Exception.Message
    }
  }
}

function Trigger-CodexConnection {
  try {
    Invoke-AIToPhoneApi "/api/account" | Out-Null
  } catch {
    # /api/status will show the actionable error after this attempt.
  }
}

function New-Label($text, $x, $y) {
  $label = New-Object System.Windows.Forms.Label
  $label.Text = $text
  $label.Location = New-Object System.Drawing.Point($x, $y)
  $label.Size = New-Object System.Drawing.Size(130, 24)
  return $label
}

function New-TextBox($x, $y, $width = 360) {
  $box = New-Object System.Windows.Forms.TextBox
  $box.Location = New-Object System.Drawing.Point($x, $y)
  $box.Size = New-Object System.Drawing.Size($width, 24)
  return $box
}

function Append-Log($box, $text) {
  $box.AppendText("[$(Get-Date -Format HH:mm:ss)] $text`r`n")
}

function Update-UrlBox($urlBox) {
  $map = Read-EnvMap
  $urlBox.Text = (Get-AccessUrls $map) -join "`r`n"
}

function Show-Status($statusLabel, $logBox) {
  $status = Test-AIToPhoneStatus
  if ($status.connected -and $status.initialized) {
    $statusLabel.Text = "CodeX connected"
    $statusLabel.ForeColor = [System.Drawing.Color]::DarkGreen
    Append-Log $logBox "CodeX WebSocket connected: $($status.url)"
  } else {
    $statusLabel.Text = "CodeX disconnected"
    $statusLabel.ForeColor = [System.Drawing.Color]::Firebrick
    Append-Log $logBox "CodeX disconnected: $($status.lastError)"
  }
}

$envMap = Read-EnvMap

$form = New-Object System.Windows.Forms.Form
$form.Text = "AIToPhone Control Panel"
$form.Size = New-Object System.Drawing.Size(720, 680)
$form.StartPosition = "CenterScreen"
$form.MinimumSize = New-Object System.Drawing.Size(680, 620)

$title = New-Object System.Windows.Forms.Label
$title.Text = "AIToPhone Local Gateway"
$title.Font = New-Object System.Drawing.Font("Segoe UI", 15, [System.Drawing.FontStyle]::Bold)
$title.Location = New-Object System.Drawing.Point(18, 14)
$title.Size = New-Object System.Drawing.Size(360, 34)
$form.Controls.Add($title)

$statusLabel = New-Object System.Windows.Forms.Label
$statusLabel.Text = "Status not checked"
$statusLabel.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
$statusLabel.Location = New-Object System.Drawing.Point(500, 22)
$statusLabel.Size = New-Object System.Drawing.Size(180, 24)
$form.Controls.Add($statusLabel)

$hostBox = New-TextBox 160 66
$hostBox.Text = if ($envMap.HOST) { $envMap.HOST } else { "0.0.0.0" }
$portBox = New-TextBox 160 98 120
$portBox.Text = if ($envMap.PORT) { $envMap.PORT } else { "8787" }
$tokenBox = New-TextBox 160 130
$tokenBox.Text = if ($envMap.AUTH_TOKEN) { $envMap.AUTH_TOKEN } else { "" }
$tokenBox.UseSystemPasswordChar = $true
$commandBox = New-TextBox 160 162
$commandBox.Text = if ($envMap.CODEX_COMMAND) { $envMap.CODEX_COMMAND } else { "codex.cmd" }
$codexPortBox = New-TextBox 160 194 120
$codexPortBox.Text = if ($envMap.CODEX_APP_SERVER_PORT) { $envMap.CODEX_APP_SERVER_PORT } else { "4500" }

$approvalBox = New-Object System.Windows.Forms.ComboBox
$approvalBox.Location = New-Object System.Drawing.Point(160, 226)
$approvalBox.Size = New-Object System.Drawing.Size(180, 24)
$approvalBox.DropDownStyle = "DropDownList"
[void]$approvalBox.Items.AddRange(@("never", "on-request"))
$approvalBox.SelectedItem = if ($envMap.CODEX_APPROVAL_POLICY) { $envMap.CODEX_APPROVAL_POLICY } else { "never" }

$sandboxBox = New-Object System.Windows.Forms.ComboBox
$sandboxBox.Location = New-Object System.Drawing.Point(160, 258)
$sandboxBox.Size = New-Object System.Drawing.Size(220, 24)
$sandboxBox.DropDownStyle = "DropDownList"
[void]$sandboxBox.Items.AddRange(@("danger-full-access", "workspace-write", "read-only"))
$sandboxBox.SelectedItem = if ($envMap.CODEX_SANDBOX) { $envMap.CODEX_SANDBOX } else { "danger-full-access" }

$form.Controls.Add((New-Label "Gateway Host" 24 68))
$form.Controls.Add($hostBox)
$form.Controls.Add((New-Label "Gateway Port" 24 100))
$form.Controls.Add($portBox)
$form.Controls.Add((New-Label "Access Token" 24 132))
$form.Controls.Add($tokenBox)
$form.Controls.Add((New-Label "CodeX Command" 24 164))
$form.Controls.Add($commandBox)
$form.Controls.Add((New-Label "CodeX Port" 24 196))
$form.Controls.Add($codexPortBox)
$form.Controls.Add((New-Label "Approval Policy" 24 228))
$form.Controls.Add($approvalBox)
$form.Controls.Add((New-Label "Sandbox" 24 260))
$form.Controls.Add($sandboxBox)

$saveButton = New-Object System.Windows.Forms.Button
$saveButton.Text = "Save Config"
$saveButton.Location = New-Object System.Drawing.Point(24, 306)
$saveButton.Size = New-Object System.Drawing.Size(110, 34)
$form.Controls.Add($saveButton)

$restartButton = New-Object System.Windows.Forms.Button
$restartButton.Text = "One-click Connect"
$restartButton.Location = New-Object System.Drawing.Point(148, 306)
$restartButton.Size = New-Object System.Drawing.Size(124, 34)
$form.Controls.Add($restartButton)

$statusButton = New-Object System.Windows.Forms.Button
$statusButton.Text = "Check Status"
$statusButton.Location = New-Object System.Drawing.Point(286, 306)
$statusButton.Size = New-Object System.Drawing.Size(110, 34)
$form.Controls.Add($statusButton)

$stopButton = New-Object System.Windows.Forms.Button
$stopButton.Text = "Stop Gateway"
$stopButton.Location = New-Object System.Drawing.Point(410, 306)
$stopButton.Size = New-Object System.Drawing.Size(110, 34)
$form.Controls.Add($stopButton)

$showTokenButton = New-Object System.Windows.Forms.Button
$showTokenButton.Text = "Show Token"
$showTokenButton.Location = New-Object System.Drawing.Point(534, 306)
$showTokenButton.Size = New-Object System.Drawing.Size(110, 34)
$form.Controls.Add($showTokenButton)

$urlLabel = New-Object System.Windows.Forms.Label
$urlLabel.Text = "Phone URLs"
$urlLabel.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
$urlLabel.Location = New-Object System.Drawing.Point(24, 360)
$urlLabel.Size = New-Object System.Drawing.Size(220, 24)
$form.Controls.Add($urlLabel)

$copyButton = New-Object System.Windows.Forms.Button
$copyButton.Text = "Copy URLs"
$copyButton.Location = New-Object System.Drawing.Point(534, 354)
$copyButton.Size = New-Object System.Drawing.Size(110, 30)
$form.Controls.Add($copyButton)

$urlBox = New-Object System.Windows.Forms.TextBox
$urlBox.Location = New-Object System.Drawing.Point(24, 390)
$urlBox.Size = New-Object System.Drawing.Size(620, 78)
$urlBox.Multiline = $true
$urlBox.ScrollBars = "Vertical"
$urlBox.ReadOnly = $true
$form.Controls.Add($urlBox)

$logLabel = New-Object System.Windows.Forms.Label
$logLabel.Text = "Log"
$logLabel.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
$logLabel.Location = New-Object System.Drawing.Point(24, 482)
$logLabel.Size = New-Object System.Drawing.Size(220, 24)
$form.Controls.Add($logLabel)

$logBox = New-Object System.Windows.Forms.TextBox
$logBox.Location = New-Object System.Drawing.Point(24, 512)
$logBox.Size = New-Object System.Drawing.Size(620, 100)
$logBox.Multiline = $true
$logBox.ScrollBars = "Vertical"
$logBox.ReadOnly = $true
$form.Controls.Add($logBox)

$saveButton.Add_Click({
  $map = @{
    HOST = $hostBox.Text.Trim()
    PORT = $portBox.Text.Trim()
    AUTH_TOKEN = $tokenBox.Text.Trim()
    CODEX_COMMAND = $commandBox.Text.Trim()
    CODEX_APP_SERVER_PORT = $codexPortBox.Text.Trim()
    CODEX_APPROVAL_POLICY = [string]$approvalBox.SelectedItem
    CODEX_SANDBOX = [string]$sandboxBox.SelectedItem
  }
  Write-EnvMap $map
  Update-UrlBox $urlBox
  Append-Log $logBox "Configuration saved to .env"
})

$restartButton.Add_Click({
  try {
    Append-Log $logBox "Restarting gateway..."
    $saveButton.PerformClick()
    Restart-AIToPhoneGateway
    Trigger-CodexConnection
    Show-Status $statusLabel $logBox
    Update-UrlBox $urlBox
  } catch {
    Append-Log $logBox "Connect failed: $($_.Exception.Message)"
  }
})

$statusButton.Add_Click({
  Show-Status $statusLabel $logBox
  Update-UrlBox $urlBox
})

$stopButton.Add_Click({
  Stop-AIToPhoneGateway
  $statusLabel.Text = "Gateway stopped"
  $statusLabel.ForeColor = [System.Drawing.Color]::DimGray
  Append-Log $logBox "Gateway stopped"
})

$showTokenButton.Add_Click({
  $tokenBox.UseSystemPasswordChar = -not $tokenBox.UseSystemPasswordChar
  if ($tokenBox.UseSystemPasswordChar) {
    $showTokenButton.Text = "Show Token"
  } else {
    $showTokenButton.Text = "Hide Token"
  }
})

$copyButton.Add_Click({
  Update-UrlBox $urlBox
  if ($urlBox.Text.Trim()) {
    [System.Windows.Forms.Clipboard]::SetText($urlBox.Text)
    Append-Log $logBox "Phone URLs copied"
  }
})

Update-UrlBox $urlBox
Show-Status $statusLabel $logBox
[void]$form.ShowDialog()
