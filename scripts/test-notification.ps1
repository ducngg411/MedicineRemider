param(
  [string]$CronSecret = $env:CRON_SECRET,
  [string]$Title = "Test nhac thuoc",
  [string]$Body = "Neu thay thong bao nay la Web Push chay ngon roi."
)

$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

if (-not $CronSecret) {
  throw "Missing CRON_SECRET. Run: `$env:CRON_SECRET='secret-cua-may'; .\scripts\test-notification.ps1"
}

$envPath = Join-Path $PSScriptRoot "..\.env.local"
if (-not (Test-Path $envPath)) {
  throw "Cannot find .env.local"
}

$supabaseUrl = $null
Get-Content $envPath | ForEach-Object {
  if ($_ -match "^VITE_SUPABASE_URL=(.+)$") {
    $supabaseUrl = $Matches[1].Trim()
  }
}

if (-not $supabaseUrl) {
  throw "Missing VITE_SUPABASE_URL in .env.local"
}

$endpoint = "$supabaseUrl/functions/v1/send-test-notification"
$payload = @{
  title = $Title
  body = $Body
} | ConvertTo-Json -Compress
$payloadBytes = [System.Text.Encoding]::UTF8.GetBytes($payload)

Write-Host "Sending test notification via $endpoint"

$response = Invoke-RestMethod `
  -Method Post `
  -Uri $endpoint `
  -Headers @{ Authorization = "Bearer $CronSecret" } `
  -ContentType "application/json; charset=utf-8" `
  -Body $payloadBytes

$response | ConvertTo-Json -Depth 8
