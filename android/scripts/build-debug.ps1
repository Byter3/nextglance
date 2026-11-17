param([string]$JavaHome, [string]$SdkRoot)
$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$client = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $JavaHome) { $JavaHome = $env:JAVA_HOME }
if (-not $JavaHome) {
    $candidate = Get-ChildItem (Join-Path $workspace '.runtime/android-jdk') -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-Path (Join-Path $_.FullName 'bin/jlink.exe') } | Select-Object -First 1
    if ($candidate) { $JavaHome = $candidate.FullName }
}
if (-not $JavaHome -or -not (Test-Path (Join-Path $JavaHome 'bin/jlink.exe'))) { throw 'Set JAVA_HOME to a complete JDK 21 installation (including jlink), or pass -JavaHome.' }
if (-not $SdkRoot) { $SdkRoot = $env:ANDROID_HOME }
if (-not $SdkRoot) { $SdkRoot = Join-Path $workspace '.runtime/android-sdk' }
if (-not (Test-Path (Join-Path $SdkRoot 'platforms/android-36/android.jar'))) { throw 'Install Android SDK platform 36 and set ANDROID_HOME, or pass -SdkRoot.' }
$env:JAVA_HOME = (Resolve-Path $JavaHome).Path
$env:ANDROID_HOME = (Resolve-Path $SdkRoot).Path
$env:GRADLE_USER_HOME = Join-Path $workspace '.runtime/android-gradle'
Push-Location $workspace
try {
    & pnpm --filter '@nextspace/android' sync
    if ($LASTEXITCODE -ne 0) { throw 'Android web build or native sync failed.' }
    & (Join-Path $client 'android/gradlew.bat') -p (Join-Path $client 'android') --no-daemon :app:assembleDebug :app:testDebugUnitTest
    if ($LASTEXITCODE -ne 0) { throw 'Android APK compilation failed.' }
    $release = Join-Path $client 'release'
    New-Item -ItemType Directory -Force -Path $release | Out-Null
    $version = (Get-Content (Join-Path $client 'package.json') -Raw | ConvertFrom-Json).version
    $destination = Join-Path $release "NextGlance-$version-Android-debug.apk"
    Copy-Item -LiteralPath (Join-Path $client 'android/app/build/outputs/apk/debug/app-debug.apk') -Destination $destination
    Write-Output "Debug APK: $destination"
} finally { Pop-Location }
