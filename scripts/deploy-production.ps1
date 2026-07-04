param(
  [switch]$ResetData,
  [switch]$DeployFrontend
)

$ErrorActionPreference = 'Stop'

npm run build

supabase db push --yes

if ($ResetData) {
  & "$PSScriptRoot\reset-remote-data.ps1" -Yes
}

supabase functions deploy extract-prescription
supabase functions deploy register-push-subscription
supabase functions deploy send-due-reminders
supabase functions deploy cleanup-temp-images
supabase functions deploy send-test-notification

if ($DeployFrontend) {
  npx vercel --prod
}
