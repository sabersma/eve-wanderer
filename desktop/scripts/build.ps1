#Requires -Version 5.1
<#
.SYNOPSIS
    构建 Wanderer 桌面客户端安装包（仅 Windows）。

.DESCRIPTION
    执行 npm install + tauri build，然后把 NSIS/MSI 安装包复制到 dist\v<版本>\，
    生成 SHA256SUMS.txt，并把安装包和校验文件打包为
    dist\Wanderer_<版本>_x64.zip（默认）。

    发布构建不应设置 WANDERER_SERVER_URL：它只用于开发时跳过首次设置页。

.PARAMETER SkipInstall
    跳过 npm install。依赖已安装时可加快构建。

.PARAMETER Clean
    构建前执行 cargo clean。会显著增加构建时间。

.PARAMETER OutputDir
    分发包输出目录，默认为 desktop\dist。

.PARAMETER NoDist
    只构建，不复制安装包、不生成 SHA256、不打包 zip。

.PARAMETER NoZip
    照常复制安装包和生成 SHA256，但不生成 zip 压缩包。

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\build.ps1

.EXAMPLE
    .\scripts\build.ps1 -SkipInstall -NoDist

.EXAMPLE
    .\scripts\build.ps1 -OutputDir D:\release\wanderer
#>
[CmdletBinding()]
param(
    [switch]$SkipInstall,
    [switch]$Clean,
    [string]$OutputDir = '',
    [switch]$NoDist,
    [switch]$NoZip
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Step {
    param([string]$Message)

    Write-Host ''
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Note {
    param([string]$Message)

    Write-Host "    $Message" -ForegroundColor DarkGray
}

function Fail {
    param([string]$Message)

    throw "构建失败：$Message"
}

function Resolve-CommandPath {
    param([string[]]$Names)

    foreach ($name in $Names) {
        $command = Get-Command $name -ErrorAction SilentlyContinue
        if ($null -ne $command -and -not [string]::IsNullOrEmpty($command.Source)) {
            return $command.Source
        }
    }

    return $null
}

function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments = @()
    )

    if ($Arguments.Count -gt 0) {
        Write-Note ("{0} {1}" -f $FilePath, ($Arguments -join ' '))
    }
    else {
        Write-Note $FilePath
    }

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        Fail "$FilePath 退出码为 $LASTEXITCODE"
    }
}

function Get-Installer {
    param(
        [string]$Directory,
        [string]$Filter
    )

    if (-not (Test-Path -LiteralPath $Directory)) {
        return $null
    }

    return Get-ChildItem -LiteralPath $Directory -Filter $Filter -File -ErrorAction SilentlyContinue |
        Sort-Object -Property LastWriteTime -Descending |
        Select-Object -First 1
}

function New-ReleaseZip {
    param(
        [Parameter(Mandatory = $true)][string]$VersionDir,
        [Parameter(Mandatory = $true)][string]$OutputDir,
        [Parameter(Mandatory = $true)][string]$Version,
        [Parameter(Mandatory = $true)][string[]]$FileNames
    )

    $zipPath = Join-Path $OutputDir "Wanderer_${Version}_x64.zip"
    if (Test-Path -LiteralPath $zipPath) {
        Remove-Item -LiteralPath $zipPath -Force
    }

    $files = @()
    foreach ($name in $FileNames) {
        $path = Join-Path $VersionDir $name
        if (Test-Path -LiteralPath $path) {
            $files += $path
        }
    }

    if ($files.Count -eq 0) {
        Fail '没有找到可打包的分发文件。'
    }

    Compress-Archive -LiteralPath $files -DestinationPath $zipPath -CompressionLevel Optimal
    return $zipPath
}

if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
    Fail '此脚本只能在 Windows 上运行。Tauri 安装包需要 Windows + MSVC 工具链，不能从 WSL/Linux 交叉编译。'
}

$DesktopDir = Split-Path -Parent $PSScriptRoot
$TauriDir = Join-Path $DesktopDir 'src-tauri'
$TauriConfigPath = Join-Path $TauriDir 'tauri.conf.json'
$PackageJsonPath = Join-Path $DesktopDir 'package.json'
$TauriCliPath = Join-Path $DesktopDir 'node_modules\.bin\tauri.cmd'

foreach ($path in @($TauriConfigPath, $PackageJsonPath)) {
    if (-not (Test-Path -LiteralPath $path)) {
        Fail "找不到 $path，请确认脚本位于 desktop\scripts\ 下。"
    }
}

$tauriConfig = Get-Content -LiteralPath $TauriConfigPath -Raw | ConvertFrom-Json
$versionProperty = $tauriConfig.PSObject.Properties['version']
if ($null -eq $versionProperty -or [string]::IsNullOrWhiteSpace([string]$versionProperty.Value)) {
    Fail 'tauri.conf.json 中没有 version 字段。'
}
$version = [string]$versionProperty.Value

$packageJson = Get-Content -LiteralPath $PackageJsonPath -Raw | ConvertFrom-Json
$packageVersionProperty = $packageJson.PSObject.Properties['version']
if ($null -ne $packageVersionProperty -and [string]$packageVersionProperty.Value -ne $version) {
    Write-Warning "版本号不一致：tauri.conf.json = $version，package.json = $($packageVersionProperty.Value)。安装包版本以 tauri.conf.json 为准。"
}

if (Test-Path Env:\WANDERER_SERVER_URL) {
    $devServerUrl = $env:WANDERER_SERVER_URL
    if (-not [string]::IsNullOrWhiteSpace($devServerUrl)) {
        Fail @"
检测到 WANDERER_SERVER_URL=$devServerUrl。
该变量只用于开发时跳过首次设置页，发布构建前请先清除：
    Remove-Item Env:\WANDERER_SERVER_URL
"@
    }
}

Write-Step '检查构建环境'

$npm = Resolve-CommandPath @('npm.cmd', 'npm')
if ($null -eq $npm) {
    Fail '找不到 npm。请安装 Node.js 20+，并重新打开 PowerShell。'
}

$node = Resolve-CommandPath @('node.exe', 'node')
if ($null -ne $node) {
    $nodeVersion = (& $node -v).Trim()
    Write-Note "Node.js $nodeVersion"
    if ($nodeVersion -match '^v(\d+)\.' -and [int]$Matches[1] -lt 20) {
        Write-Warning "Node.js $nodeVersion 低于建议的 20.x，构建可能失败。"
    }
}
else {
    Write-Warning '找不到 node，无法检查 Node.js 版本。'
}

$cargo = Resolve-CommandPath @('cargo.exe', 'cargo')
if ($null -eq $cargo) {
    Fail '找不到 cargo。请安装 Rust stable（MSVC 工具链），并重新打开 PowerShell。'
}

$rustc = Resolve-CommandPath @('rustc.exe', 'rustc')
if ($null -eq $rustc) {
    Fail '找不到 rustc。请确认 Rust 工具链安装完整。'
}

$rustInfo = & $rustc -vV
$hostLine = $rustInfo | Where-Object { $_ -like 'host:*' } | Select-Object -First 1
if ($null -eq $hostLine) {
    Fail '无法读取 rustc 的 host 信息。'
}
Write-Note $hostLine
if ($hostLine -notlike '*windows*') {
    Fail "当前 Rust 工具链的 host 不是 Windows（$hostLine）。请在 Windows 上使用 MSVC 工具链构建。"
}

if ($SkipInstall -and -not (Test-Path -LiteralPath $TauriCliPath)) {
    Fail "指定了 -SkipInstall，但找不到 $TauriCliPath。请先运行 npm install。"
}

Push-Location -LiteralPath $DesktopDir
try {
    if (-not $SkipInstall) {
        Write-Step '安装 npm 依赖'
        Invoke-Native $npm install
    }

    if (-not (Test-Path -LiteralPath $TauriCliPath)) {
        Fail '未找到 @tauri-apps/cli，请检查 npm install 是否成功。'
    }

    if ($Clean) {
        Write-Step '清理 Rust 构建缓存（cargo clean）'
        Push-Location -LiteralPath $TauriDir
        try {
            Invoke-Native $cargo clean
        }
        finally {
            Pop-Location
        }
    }

    Write-Step "构建安装包（版本 $version）"
    $startedAt = Get-Date
    Invoke-Native $npm run build
    $elapsed = (Get-Date) - $startedAt
}
catch {
    Write-Host ''
    Write-Host '构建失败。常见原因：' -ForegroundColor Red
    Write-Host '  - 未安装 Visual Studio Build Tools 的「使用 C++ 的桌面开发」工作负载或 Windows SDK'
    Write-Host '  - Rust 工具链不是 MSVC（x86_64-pc-windows-msvc）'
    Write-Host '  - 网络不可用，npm 或 crates 依赖下载失败'
    throw
}
finally {
    Pop-Location
}

Write-Step '检查构建产物'

$bundleDir = Join-Path $TauriDir 'target\release\bundle'
$nsisInstaller = Get-Installer -Directory (Join-Path $bundleDir 'nsis') -Filter '*-setup.exe'
$msiInstaller = Get-Installer -Directory (Join-Path $bundleDir 'msi') -Filter '*.msi'

if ($null -eq $nsisInstaller) {
    Fail "未找到 NSIS 安装包（$bundleDir\nsis）。请检查上方的构建输出。"
}

if ($nsisInstaller.Name -notlike "*$version*") {
    Write-Warning "安装包文件名与版本号不一致：$($nsisInstaller.Name)（配置版本 $version）。"
}

if ($null -eq $msiInstaller) {
    Write-Warning "未找到 MSI 安装包（$bundleDir\msi）。如果只需要 NSIS，可以忽略。"
}
elseif ($msiInstaller.Name -notlike "*$version*") {
    Write-Warning "MSI 文件名与版本号不一致：$($msiInstaller.Name)（配置版本 $version）。"
}

Write-Note "NSIS：$($nsisInstaller.FullName)"
if ($null -ne $msiInstaller) {
    Write-Note "MSI： $($msiInstaller.FullName)"
}

$hashFile = $null
$versionDir = $null
$zipPath = $null
$zipHashFile = $null

if (-not $NoDist) {
    if ([string]::IsNullOrWhiteSpace($OutputDir)) {
        $OutputDir = Join-Path $DesktopDir 'dist'
    }
    $OutputDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputDir)
    $versionDir = Join-Path $OutputDir "v$version"

    Write-Step "复制分发包到 $versionDir"
    New-Item -ItemType Directory -Path $versionDir -Force | Out-Null

    $installers = @($nsisInstaller)
    if ($null -ne $msiInstaller) {
        $installers += $msiInstaller
    }

    $hashLines = New-Object System.Collections.Generic.List[string]
    foreach ($installer in $installers) {
        $destination = Join-Path $versionDir $installer.Name
        Copy-Item -LiteralPath $installer.FullName -Destination $destination -Force

        $hash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
        $sizeMb = [Math]::Round($installer.Length / 1MB, 1)
        $hashLines.Add("$hash  $($installer.Name)")

        Write-Note ("{0}  {1} MB" -f $installer.Name, $sizeMb)
    }

    $hashFile = Join-Path $versionDir 'SHA256SUMS.txt'
    Set-Content -LiteralPath $hashFile -Value $hashLines.ToArray() -Encoding ASCII

    if (-not $NoZip) {
        Write-Step '生成 zip 分发包'

        $zipFileNames = @($installers | ForEach-Object { $_.Name }) + @('SHA256SUMS.txt')
        try {
            $zipPath = New-ReleaseZip -VersionDir $versionDir -OutputDir $OutputDir -Version $version -FileNames $zipFileNames
        }
        catch {
            Fail "生成 zip 失败：$($_.Exception.Message)"
        }

        $zipHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
        $zipHashFile = "${zipPath}.sha256"
        Set-Content -LiteralPath $zipHashFile -Value "$zipHash  $(Split-Path -Leaf $zipPath)" -Encoding ASCII

        $zipSizeMb = [Math]::Round((Get-Item -LiteralPath $zipPath).Length / 1MB, 1)
        Write-Note ("{0}  {1} MB" -f (Split-Path -Leaf $zipPath), $zipSizeMb)
    }
}

$minutes = [int][Math]::Floor($elapsed.TotalMinutes)
$seconds = [int]$elapsed.Seconds

Write-Host ''
Write-Host '构建完成' -ForegroundColor Green
Write-Note "版本：$version"
Write-Note "耗时：$minutes 分 $seconds 秒"

if ($null -ne $versionDir) {
    Write-Note "分发包：$versionDir"
    Write-Note "SHA256：$hashFile"
}

if ($null -ne $zipPath) {
    Write-Note "压缩包：$zipPath"
    Write-Note "压缩包 SHA256：$zipHashFile"
}

Write-Host ''
Write-Host '发布前提醒：' -ForegroundColor Yellow
Write-Host '  - 安装包未签名时会触发 SmartScreen；对外分发前请配置代码签名。'
Write-Host '  - 分发前确认服务端已部署 /desktop 路由和最新前端资源。'
Write-Host '  - 同一个安装包发给所有成员，不要在安装包里写死服务器地址。'
Write-Host '  - 对外分发推荐直接发 zip（内含安装包和 SHA256SUMS.txt）。'
