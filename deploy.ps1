# Deploy Google Sites to Moodle naar Firebase + Cloud Run
# Gebruik: .\deploy.ps1 -ProjectId "jouw-project-id"

param(
    [Parameter(Mandatory=$true)]
    [string]$ProjectId,
    [string]$Region = "europe-west1",
    [string]$ServiceName = "google-sites-to-moodle"
)

$ErrorActionPreference = "Stop"

Write-Host "=== Deploy naar Firebase project: $ProjectId ===" -ForegroundColor Cyan

# 1. Update .firebaserc
(Get-Content .firebaserc) -replace "JOUW-FIREBASE-PROJECT-ID", $ProjectId | Set-Content .firebaserc
Write-Host "✓ .firebaserc bijgewerkt" -ForegroundColor Green

# 2. Build en push Docker image naar Artifact Registry
$ImageUrl = "$Region-docker.pkg.dev/$ProjectId/cloud-run-source-deploy/$ServiceName"

Write-Host "`nStap 1: Docker image bouwen en pushen..." -ForegroundColor Yellow
gcloud builds submit --tag $ImageUrl --project $ProjectId

# 3. Deploy naar Cloud Run
Write-Host "`nStap 2: Deployen naar Cloud Run..." -ForegroundColor Yellow
gcloud run deploy $ServiceName `
    --image $ImageUrl `
    --platform managed `
    --region $Region `
    --allow-unauthenticated `
    --memory 2Gi `
    --cpu 2 `
    --timeout 300 `
    --project $ProjectId

# 4. Deploy Firebase Hosting
Write-Host "`nStap 3: Firebase Hosting deployen..." -ForegroundColor Yellow
firebase deploy --only hosting --project $ProjectId

Write-Host "`n=== Deploy klaar! ===" -ForegroundColor Green
Write-Host "Frontend: https://$ProjectId.web.app" -ForegroundColor Cyan
