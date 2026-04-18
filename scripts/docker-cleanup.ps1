# Docker disk cleanup — run when Docker vDisk grows too large.
# Usage: powershell -File scripts/docker-cleanup.ps1
#
# Safe to run regularly: keeps your running containers and named volumes,
# only removes unused images, build cache, and compacts the vDisk.

Write-Host "=== Docker disk cleanup ===" -ForegroundColor Cyan

Write-Host "`n[1/4] Current Docker disk usage:" -ForegroundColor Yellow
docker system df

Write-Host "`n[2/4] Pruning unused images, containers, and build cache..." -ForegroundColor Yellow
docker system prune -a -f --filter "until=24h"

Write-Host "`n[3/4] Shutting down Docker Desktop to compact vDisk..." -ForegroundColor Yellow
Get-Process "Docker Desktop" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 5
wsl --shutdown 2>$null

Write-Host "`n[4/4] Compacting vDisk (this may take a few minutes)..." -ForegroundColor Yellow
$vhdx = "$env:LOCALAPPDATA\Docker\wsl\disk\docker_data.vhdx"
if (Test-Path $vhdx) {
    $sizeBefore = (Get-Item $vhdx).Length / 1GB
    Write-Host "Size before: $([math]::Round($sizeBefore, 2)) GB"

    $diskpartScript = @"
select vdisk file="$vhdx"
attach vdisk readonly
compact vdisk
detach vdisk
exit
"@
    $diskpartScript | diskpart | Out-Null

    $sizeAfter = (Get-Item $vhdx).Length / 1GB
    Write-Host "Size after:  $([math]::Round($sizeAfter, 2)) GB" -ForegroundColor Green
    Write-Host "Freed:       $([math]::Round($sizeBefore - $sizeAfter, 2)) GB" -ForegroundColor Green
} else {
    Write-Host "vDisk not found at $vhdx — nothing to compact." -ForegroundColor Red
}

Write-Host "`n=== Done ===" -ForegroundColor Cyan
Write-Host "Restart Docker Desktop manually when ready." -ForegroundColor Yellow
