# ──────────────────────────────────────────────────────────────────
#  Bundly — bulk-upload local cache files to the Render persistent disk.
#  Run from anywhere; bootstraps the production server with hours of
#  enrichment data so users get instant search results from day one.
#
#  Usage:
#    .\scripts\upload-cache-to-render.ps1 `
#       -Url https://bundly.co `
#       -AdminPassword 'YourAdminPassword'
#
#  Optional: -DryRun shows what would be uploaded without sending.
# ──────────────────────────────────────────────────────────────────

param(
    [Parameter(Mandatory=$true)] [string] $Url,
    [Parameter(Mandatory=$true)] [string] $AdminPassword,
    [switch] $DryRun
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Web   # for UrlEncode
$Url = $Url.TrimEnd("/")
$projectDir = (Get-Item $PSScriptRoot).Parent.FullName

Write-Host "═══════════════════════════════════════════════════════"
Write-Host " Bundly — Cache Bootstrap"
Write-Host "  source : $projectDir"
Write-Host "  target : $Url"
Write-Host "  dryrun : $DryRun"
Write-Host "═══════════════════════════════════════════════════════"
Write-Host ""

# ── Step 1: log in to admin to get a JWT ─────────────────────────
Write-Host "→ Authenticating as admin..."
try {
    $loginResp = Invoke-RestMethod `
        -Uri "$Url/api/admin/login" `
        -Method Post `
        -Body (@{ password = $AdminPassword } | ConvertTo-Json) `
        -ContentType "application/json"
    $token = $loginResp.token
    if (-not $token) { throw "Login response missing token" }
    Write-Host "✓ Logged in. Token expires in $($loginResp.expiresIn ?? '?')"
} catch {
    Write-Error "Admin login failed: $_"
    exit 1
}

# ── Step 2: build list of files to upload ───────────────────────
# Order matters: small JSON caches first, then product-db (large),
# so search works as soon as core caches arrive.
$patterns = @(
    @{ rel = "bundly-db.json";                 path = (Join-Path $projectDir "bundly-db.json") },
    @{ rel = "zap-categories.json";            path = (Join-Path $projectDir "zap-categories.json") },
    @{ rel = "zap-prices.json";                path = (Join-Path $projectDir "zap-prices.json") },
    @{ rel = "ksp-cache.json";                 path = (Join-Path $projectDir "ksp-cache.json") },
    @{ rel = "zap-wizard.json";                path = (Join-Path $projectDir "zap-wizard.json") },
    @{ rel = "zap-filters-cache.json";         path = (Join-Path $projectDir "zap-filters-cache.json") },
    @{ rel = "product-images-cache.json";      path = (Join-Path $projectDir "product-images-cache.json") },
    @{ rel = "product-descriptions-cache.json"; path = (Join-Path $projectDir "product-descriptions-cache.json") }
)

$files = @()
foreach ($p in $patterns) {
    if (Test-Path $p.path) {
        $files += $p
    } else {
        Write-Host "  (skip — missing: $($p.rel))" -ForegroundColor DarkGray
    }
}

# product-db/{slug}/{products,meta}.json + images/*
$productDbDir = Join-Path $projectDir "product-db"
if (Test-Path $productDbDir) {
    Get-ChildItem $productDbDir -Directory | ForEach-Object {
        $slug = $_.Name
        foreach ($name in @("products.json", "meta.json")) {
            $f = Join-Path $_.FullName $name
            if (Test-Path $f) {
                $files += @{ rel = "product-db/$slug/$name"; path = $f }
            }
        }
        $imgDir = Join-Path $_.FullName "images"
        if (Test-Path $imgDir) {
            Get-ChildItem $imgDir -File -Include *.jpg,*.jpeg,*.png,*.webp,*.gif | ForEach-Object {
                $files += @{ rel = "product-db/$slug/images/$($_.Name)"; path = $_.FullName }
            }
        }
    }
}

# product-img/{slug}/* (downloaded retail images)
$productImgDir = Join-Path $projectDir "product-img"
if (Test-Path $productImgDir) {
    Get-ChildItem $productImgDir -Directory | ForEach-Object {
        $slug = $_.Name
        Get-ChildItem $_.FullName -File -Include *.jpg,*.jpeg,*.png,*.webp,*.gif | ForEach-Object {
            $files += @{ rel = "product-img/$slug/$($_.Name)"; path = $_.FullName }
        }
    }
}

# Tally
$totalBytes = 0
foreach ($f in $files) {
    $totalBytes += (Get-Item $f.path).Length
}
$totalMB = [math]::Round($totalBytes / 1MB, 1)
Write-Host ""
Write-Host "→ $($files.Count) file(s), $totalMB MB total to upload."
Write-Host ""

if ($DryRun) {
    Write-Host "[DRY-RUN] Would upload:"
    $files | ForEach-Object {
        $mb = [math]::Round((Get-Item $_.path).Length / 1KB, 1)
        Write-Host ("    {0,8} KB  {1}" -f $mb, $_.rel)
    }
    exit 0
}

# ── Step 3: upload each file via raw POST ───────────────────────
$success = 0; $failed = 0; $i = 0
$startTime = Get-Date

foreach ($f in $files) {
    $i++
    $bytes = [System.IO.File]::ReadAllBytes($f.path)
    $kb = [math]::Round($bytes.Length / 1KB, 1)
    $pct = [math]::Round(100 * $i / $files.Count, 1)
    Write-Host -NoNewline ("[{0,5:F1}%] ({1,4}/{2}) {3,8} KB  {4} ... " -f $pct, $i, $files.Count, $kb, $f.rel)

    try {
        $relEnc = [System.Web.HttpUtility]::UrlEncode($f.rel)
        $resp = Invoke-RestMethod `
            -Uri "$Url/api/admin/upload-file?path=$relEnc" `
            -Method Post `
            -Headers @{ Authorization = "Bearer $token" } `
            -ContentType "application/octet-stream" `
            -Body $bytes
        if ($resp.ok) {
            Write-Host "✓" -ForegroundColor Green
            $success++
        } else {
            Write-Host "✗ $($resp.error)" -ForegroundColor Red
            $failed++
        }
    } catch {
        Write-Host "✗ $_" -ForegroundColor Red
        $failed++
    }
}

$elapsed = (Get-Date) - $startTime
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════"
Write-Host (" Done in {0:F1}s — uploaded {1}, failed {2}." -f $elapsed.TotalSeconds, $success, $failed)
Write-Host " Tip: trigger /api/admin/reload-product-db to make"
Write-Host " the server pick up the new product-db data immediately."
Write-Host "═══════════════════════════════════════════════════════"
