# Bundly - one-command deploy.
# Stages all local changes, commits with a description, pushes to GitHub.
# Render auto-builds and goes live in ~90 seconds.
#
# Usage from C:\Users\User\groupbuy-app\:
#   .\deploy.ps1

$msg = Read-Host "תיאור השינוי (Enter ל-'update')"
if (-not $msg) { $msg = "update" }

git add .

# Skip the commit if nothing changed; otherwise the script "fails" misleadingly.
$status = git status --porcelain
if (-not $status) {
    Write-Host ""
    Write-Host "  אין שינויים מקומיים לדחוף." -ForegroundColor Yellow
    Write-Host "  שינויים ב-Render Environment לא דורשים git push." -ForegroundColor DarkGray
    Write-Host ""
    exit 0
}

git commit -m $msg
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "  Commit failed." -ForegroundColor Red
    exit 1
}

git push origin main
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "  Push failed. Check your connection / GitHub auth." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "  Pushed. Render will deploy in ~90 seconds." -ForegroundColor Green
Write-Host "  Live status: https://dashboard.render.com" -ForegroundColor DarkGray
Write-Host ""
