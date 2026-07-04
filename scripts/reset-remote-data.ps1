param(
  [switch]$Yes
)

$ErrorActionPreference = 'Stop'
$expected = 'WIPE_REMOTE_DATA'

if (-not $Yes) {
  Write-Host 'This will delete remote app data from the linked Supabase project.' -ForegroundColor Yellow
  Write-Host 'It keeps schema, migrations, and auth.users intact.' -ForegroundColor Yellow
  $confirmation = Read-Host "Type $expected to continue"
  if ($confirmation -ne $expected) {
    Write-Host 'Cancelled.'
    exit 1
  }
}

supabase db query --linked --file scripts/reset-remote-data.sql
