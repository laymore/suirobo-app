# Self-Sign Suirobo Agent with Team Autobots certificate
# Run: powershell -ExecutionPolicy Bypass -File sign_agent.ps1

$ErrorActionPreference = 'Stop'

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Exe        = Join-Path $ProjectDir 'dist-agent\suirobo-agent.exe'
$CertDir    = Join-Path $ProjectDir 'dist-agent\cert'
$CertPath   = Join-Path $CertDir 'TeamAutobots.pfx'
$CrtPath    = Join-Path $CertDir 'TeamAutobots.crt'
$Password   = 'autobots-dev-2026'

if (-not (Test-Path $CertDir)) { New-Item -ItemType Directory -Path $CertDir | Out-Null }

# 1. Create self-signed cert if not exists
$CertSubject = 'Team Autobots'
$existingCert = Get-ChildItem -Path Cert:\CurrentUser\My | Where-Object { $_.Subject -like "*CN=$CertSubject*" } | Select-Object -First 1

if (-not $existingCert) {
    Write-Host "[KEY] Creating self-signed certificate Team Autobots..." -ForegroundColor Cyan
    $cert = New-SelfSignedCertificate `
        -Subject "CN=$CertSubject, O=Team Autobots, C=VN" `
        -Type CodeSigningCert `
        -KeyAlgorithm RSA `
        -KeyLength 2048 `
        -HashAlgorithm SHA256 `
        -KeyExportPolicy Exportable `
        -NotAfter (Get-Date).AddYears(3) `
        -CertStoreLocation 'Cert:\CurrentUser\My'

    Write-Host "   Thumbprint: $($cert.Thumbprint)" -ForegroundColor Gray

    $pwd = ConvertTo-SecureString -String $Password -Force -AsPlainText
    Export-PfxCertificate -Cert $cert -FilePath $CertPath -Password $pwd | Out-Null
    Write-Host "   [OK] PFX: $CertPath" -ForegroundColor Green

    Export-Certificate -Cert $cert -FilePath $CrtPath | Out-Null
    Write-Host "   [OK] CRT: $CrtPath" -ForegroundColor Green
} else {
    Write-Host "[OK] Cert Team Autobots exists - Thumbprint: $($existingCert.Thumbprint)" -ForegroundColor Green
    $cert = $existingCert
}

# 2. Sign exe
if (-not (Test-Path $Exe)) {
    Write-Host "[ERR] Exe not found: $Exe" -ForegroundColor Red
    exit 1
}

Write-Host "`n[SIGN] Signing $Exe..." -ForegroundColor Cyan
Set-AuthenticodeSignature `
    -FilePath $Exe `
    -Certificate $cert `
    -TimestampServer 'http://timestamp.digicert.com' `
    -HashAlgorithm SHA256

# 3. Verify
$sig = Get-AuthenticodeSignature -FilePath $Exe
Write-Host "`n[INFO] Signature info:" -ForegroundColor Cyan
Write-Host "   Status:        $($sig.Status)"
Write-Host "   StatusMessage: $($sig.StatusMessage)"
Write-Host "   SignerCert:    $($sig.SignerCertificate.Subject)"
if ($sig.TimeStamperCertificate) {
    Write-Host "   TimeStamper:   $($sig.TimeStamperCertificate.Subject)"
}
Write-Host ""

if ($sig.Status -eq 'Valid' -or $sig.Status -eq 'UnknownError') {
    Write-Host "[OK] Exe signed with Team Autobots" -ForegroundColor Green
    Write-Host ""
    Write-Host "=====================================================" -ForegroundColor Yellow
    Write-Host "  How users bypass SmartScreen:" -ForegroundColor Yellow
    Write-Host "=====================================================" -ForegroundColor Yellow
    Write-Host "  1. Download TeamAutobots.crt together with exe"
    Write-Host "  2. User double-clicks .crt - Install Certificate"
    Write-Host "  3. Choose Local Machine - Trusted Publishers"
    Write-Host "  4. Run exe - SmartScreen will not warn"
    Write-Host ""
    Write-Host "  Or simpler: just click 'Run anyway'"
    Write-Host "  Properties will show publisher 'Team Autobots'"
} else {
    Write-Host "[!] Status: $($sig.Status) - check log above" -ForegroundColor Yellow
}
