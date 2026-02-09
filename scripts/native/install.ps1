param(
  [Parameter(Mandatory = $true)]
  [string]$ExtensionId
)

if ([string]::IsNullOrWhiteSpace($ExtensionId)) {
  Write-Error "Usage: install.ps1 <extension-id>"
  exit 2
}

if ($ExtensionId -notmatch "^[a-p]{32}$") {
  Write-Error "Invalid extension ID format. Expected 32 characters (a-p)."
  exit 2
}

$localAppData = $env:LOCALAPPDATA
if (-not $localAppData -and $env:USERPROFILE) {
  $localAppData = Join-Path $env:USERPROFILE "AppData\\Local"
}
if (-not $localAppData) {
  Write-Error "LOCALAPPDATA is not set. Unable to locate NativeMessagingHosts directory."
  exit 3
}

$manifestDir = Join-Path $localAppData "Google\\Chrome\\User Data\\NativeMessagingHosts"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$hostScript = Join-Path $scriptDir "host.cjs"

if (-not (Test-Path $hostScript)) {
  Write-Error "Native host script not found at $hostScript"
  exit 4
}

$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodePath) {
  $candidates = @(
    "C:\\Program Files\\nodejs\\node.exe",
    "C:\\Program Files (x86)\\nodejs\\node.exe"
  )
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      $nodePath = $candidate
      break
    }
  }
}
if (-not $nodePath) {
  Write-Error "Node.js not found in PATH."
  exit 4
}

New-Item -ItemType Directory -Path $manifestDir -Force | Out-Null

$wrapperPath = Join-Path $manifestDir "com.opendevbrowser.native.cmd"
$wrapperContent = "@echo off`r`n""$nodePath"" ""$hostScript""`r`n"
Set-Content -Path $wrapperPath -Value $wrapperContent -Encoding ASCII

$manifestPath = Join-Path $manifestDir "com.opendevbrowser.native.json"
$manifest = @{
  name = "com.opendevbrowser.native"
  description = "OpenDevBrowser native messaging host"
  path = $wrapperPath
  type = "stdio"
  allowed_origins = @("chrome-extension://$ExtensionId/")
} | ConvertTo-Json -Depth 3

Set-Content -Path $manifestPath -Value $manifest -Encoding ASCII

$regPath = "HKCU:\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.opendevbrowser.native"
New-Item -Path $regPath -Force | Out-Null
New-ItemProperty -Path $regPath -Name "(Default)" -Value $manifestPath -PropertyType String -Force | Out-Null

Write-Output "Native host installed at $manifestPath"
