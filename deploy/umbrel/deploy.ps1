# Loads the arm64 images from deploy/umbrel/out/ into Portainer's Docker on the Umbrel, then
# creates or updates the "opal" stack with deploy/umbrel/docker-compose.yml and .env.umbrel.
# Run it yourself (it needs your Portainer access token, which it never prints):
#   .\deploy\umbrel\deploy.ps1                   # load every tarball in out/, then deploy
#   .\deploy\umbrel\deploy.ps1 -Only web         # load just some images, then deploy
#   .\deploy\umbrel\deploy.ps1 -SkipImages       # only push compose/env changes
# The token is read from $env:PORTAINER_API_KEY, or asked for.
param(
  [string]$Portainer = 'http://umbrel.local:9000',
  [ValidateSet('web', 'search', 'tunnel', 'sandbox')][string[]]$Only,
  [switch]$SkipImages,
  [string]$StackName = 'opal'
)

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$envFile = Join-Path $here '.env.umbrel'
if (-not (Test-Path $envFile)) { throw "Missing $envFile. Run make-env.ps1 first." }

$key = $env:PORTAINER_API_KEY
if (-not $key) {
  $s = Read-Host 'Portainer access token (ptr_...)' -AsSecureString
  $key = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}
$headers = @{ 'X-API-Key' = $key }

# Windows PowerShell allows only 2 open connections per server and can keep finished ones
# busy, which leaves a later request waiting forever. Lift the limit, don't reuse connections,
# and give every call a deadline.
[Net.ServicePointManager]::DefaultConnectionLimit = 32
[Net.ServicePointManager]::Expect100Continue = $false

function Invoke-Portainer([string]$Method, [string]$Path, $Body) {
  $req = @{ Method = $Method; Uri = "$Portainer$Path"; Headers = $headers; UseBasicParsing = $true
    DisableKeepAlive = $true; TimeoutSec = 120 }
  if ($null -ne $Body) {
    $req.Body = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 8 -Compress))
    $req.ContentType = 'application/json'
  }
  Invoke-RestMethod @req
}

# Portainer's local Docker environment (the docker-in-docker daemon on the Umbrel).
$endpoint = Invoke-Portainer GET '/api/endpoints' | Where-Object { $_.Type -eq 1 } | Select-Object -First 1
if (-not $endpoint) { throw 'No local Docker environment found in Portainer.' }
$eid = $endpoint.Id
$docker = "/api/endpoints/$eid/docker"
Write-Host "Portainer environment: $($endpoint.Name) (id $eid)"

if (-not $SkipImages) {
  $tars = Get-ChildItem (Join-Path $here 'out') -Filter '*.tar' |
    Where-Object { -not $Only -or $Only -contains $_.BaseName }
  if (-not $tars) { throw 'No image tarballs in out/. Run build.ps1 first.' }
  foreach ($t in $tars) {
    Write-Host ("==> loading {0} ({1:N0} MB)" -f $t.Name, ($t.Length / 1MB))
    # -T streams the file instead of reading it into memory.
    & curl.exe -sS --fail-with-body -X POST -T $t.FullName -H "X-API-Key: $key" -H 'Content-Type: application/x-tar' `
      "$Portainer$docker/images/load?quiet=1" | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "loading $($t.Name) failed" }
  }
  # Remove the old image layers that the new tags replaced.
  Invoke-Portainer POST "$docker/images/prune?filters=$([uri]::EscapeDataString('{"dangling":["true"]}'))" $null | Out-Null
}

$envList = @()
foreach ($line in Get-Content $envFile) {
  if ($line -match '^\s*([A-Za-z0-9_]+)=(.*)$') {
    $envList += @{ name = $Matches[1]; value = $Matches[2] }
  }
}
$compose = Get-Content -Raw (Join-Path $here 'docker-compose.yml')

$stack = Invoke-Portainer GET '/api/stacks' | Where-Object { $_.Name -eq $StackName -and $_.EndpointId -eq $eid }
if ($stack) {
  Write-Host "==> updating stack $StackName (id $($stack.Id))"
  Invoke-Portainer PUT "/api/stacks/$($stack.Id)?endpointId=$eid" @{
    stackFileContent = $compose; env = $envList; prune = $true; pullImage = $false
  } | Out-Null
} else {
  Write-Host "==> creating stack $StackName"
  Invoke-Portainer POST "/api/stacks/create/standalone/string?endpointId=$eid" @{
    name = $StackName; stackFileContent = $compose; env = $envList
  } | Out-Null
}
# Portainer deploys in the background; follow the containers until they settle.
$filter = [uri]::EscapeDataString("{`"label`":[`"com.docker.compose.project=$StackName`"]}")
$deadline = (Get-Date).AddMinutes(4)
do {
  Start-Sleep -Seconds 10
  $cs = @(Invoke-Portainer GET "$docker/containers/json?all=1&filters=$filter" $null)
  $line = ($cs | ForEach-Object { "$($_.Labels.'com.docker.compose.service')=$($_.Status)" }) -join '  '
  Write-Host "    $line"
  $settled = $cs.Count -ge 4 -and -not ($cs | Where-Object { $_.State -ne 'running' -or $_.Status -match 'starting' })
} until ($settled -or (Get-Date) -gt $deadline)
if ($settled) { Write-Host 'Deployed. Open https://opal.tailefea70.ts.net' }
else { Write-Warning 'Not all containers are up yet. Check Portainer -> Stacks -> opal for details.' }
