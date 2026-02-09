$localAppData = $env:LOCALAPPDATA
if (-not $localAppData -and $env:USERPROFILE) {
  $localAppData = Join-Path $env:USERPROFILE "AppData\\Local"
}
if (-not $localAppData) {
  Write-Error "LOCALAPPDATA is not set. Unable to locate NativeMessagingHosts directory."
  exit 3
}

$manifestDir = Join-Path $localAppData "Google\\Chrome\\User Data\\NativeMessagingHosts"
$manifestPath = Join-Path $manifestDir "com.opendevbrowser.native.json"
$wrapperPath = Join-Path $manifestDir "com.opendevbrowser.native.cmd"

Remove-Item -Path $manifestPath -Force -ErrorAction SilentlyContinue | Out-Null
Remove-Item -Path $wrapperPath -Force -ErrorAction SilentlyContinue | Out-Null

$regPath = "HKCU:\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.opendevbrowser.native"
Remove-Item -Path $regPath -Recurse -Force -ErrorAction SilentlyContinue | Out-Null

$tempDir = [System.IO.Path]::GetTempPath()
Get-ChildItem -Path $tempDir -Filter "opendevbrowser-*.token" -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
Get-ChildItem -Path $tempDir -Filter "opendevbrowser-*.sock" -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
Remove-Item -Path (Join-Path $tempDir "opendevbrowser-native.log") -Force -ErrorAction SilentlyContinue | Out-Null

Write-Output "Native host uninstalled."
