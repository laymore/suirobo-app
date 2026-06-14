# ─────────────────────────────────────────────────────────────────────────────
# Deploy Suirobo Skill Factory to Walrus Sites (Windows PowerShell)
#
# Yêu cầu:
#   - Walgo đã cài (site-builder ở ~/.walgo/bin/)
#   - Ví Sui có WAL token
#
# Cách dùng:
#   .\deploy-walrus.ps1 publish
#   .\deploy-walrus.ps1 update -SiteId 0x...
#   .\deploy-walrus.ps1 sitemap -SiteId 0x...
# ─────────────────────────────────────────────────────────────────────────────

param(
    [Parameter(Position=0)]
    [ValidateSet('publish','update','sitemap','build')]
    [string]$Action = 'publish',

    [string]$SiteId = '',
    [int]$Epochs = 60
)

$ErrorActionPreference = 'Stop'

# Đường dẫn site-builder của Walgo
$siteBuilder = "$env:USERPROFILE\.walgo\bin\site-builder.exe"
if (-not (Test-Path $siteBuilder)) {
    $siteBuilder = "site-builder"  # fallback nếu trong PATH
}

$projectDir = $PSScriptRoot
$distDir    = Join-Path $projectDir "dist"

# ─── 1. Build ────────────────────────────────────────────────────────────────
Write-Host "Building Suirobo app..." -ForegroundColor Cyan
Push-Location $projectDir
npm run build
if ($LASTEXITCODE -ne 0) { Write-Host "Build failed" -ForegroundColor Red; exit 1 }
Pop-Location

if (-not (Test-Path "$distDir\index.html")) {
    Write-Host "Cannot find dist\index.html" -ForegroundColor Red
    exit 1
}

# ─── 2. Ensure ws-resources.json ───────────────────────────────────────────
$wsResources = Join-Path $distDir "ws-resources.json"
if (-not (Test-Path $wsResources)) {
    Write-Host "Creating default ws-resources.json..." -ForegroundColor Yellow
    $jsonContent = "{`n  `"routes`": { `"/*`": `"/index.html`" },`n  `"metadata`": { `"name`": `"Suirobo Skill Factory`" }`n}"
    $jsonContent | Out-File -FilePath $wsResources -Encoding ascii
}

# ─── 3. Action ───────────────────────────────────────────────────────────────
switch ($Action) {
    'build' {
        Write-Host "Build done at: $distDir" -ForegroundColor Green
    }
    'publish' {
        Write-Host "Publishing to Walrus (epochs=$Epochs)..." -ForegroundColor Cyan
        & $siteBuilder publish $distDir --epochs $Epochs
        Write-Host "Done! Save Site Object ID from output." -ForegroundColor Green
    }
    'update' {
        if (-not $SiteId) {
            Write-Host "Need -SiteId. Example: .\deploy-walrus.ps1 update -SiteId 0x..." -ForegroundColor Red
            exit 1
        }
        Write-Host "Updating site $SiteId..." -ForegroundColor Cyan
        & $siteBuilder update $distDir $SiteId --epochs $Epochs
        Write-Host "Updated! URL remains the same." -ForegroundColor Green
    }
    'sitemap' {
        if (-not $SiteId) {
            Write-Host "Need -SiteId" -ForegroundColor Red
            exit 1
        }
        & $siteBuilder sitemap $SiteId
    }
}
