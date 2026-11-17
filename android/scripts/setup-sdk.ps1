param(
    [Parameter(Mandatory = $true)][string]$JavaHome,
    [switch]$AcceptLicenses
)
$ErrorActionPreference = 'Stop'
if (-not $AcceptLicenses) { throw 'Read the Android SDK license at https://developer.android.com/studio#command-tools and rerun with -AcceptLicenses to install.' }
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$sdkRoot = Join-Path $workspace '.runtime/android-sdk'
$archive = Join-Path $workspace '.runtime/android-command-tools.zip'
$bootstrap = Join-Path $sdkRoot 'bootstrap'
$env:JAVA_HOME = (Resolve-Path $JavaHome).Path
New-Item -ItemType Directory -Force -Path $sdkRoot | Out-Null
$expected = '90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a'
if (-not (Test-Path $archive) -or (Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) {
    Invoke-WebRequest -Uri 'https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip' -OutFile $archive
}
if ((Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Android command-line tools checksum did not match the published checksum.' }
$manager = Join-Path $bootstrap 'cmdline-tools/bin/sdkmanager.bat'
if (-not (Test-Path $manager)) { Expand-Archive -LiteralPath $archive -DestinationPath $bootstrap }
1..10 | ForEach-Object { 'y' } | & $manager "--sdk_root=$sdkRoot" 'platform-tools' 'platforms;android-36' 'build-tools;36.0.0'
if ($LASTEXITCODE -ne 0) { throw 'Android SDK installation failed.' }
Write-Output "Android SDK installed at $sdkRoot"
Write-Output 'Set ANDROID_HOME to this path for Gradle builds. No global environment settings were changed.'
