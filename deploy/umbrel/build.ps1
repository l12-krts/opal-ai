# Builds Opal's images for the Umbrel (linux/arm64) and saves them as tarballs in
# deploy/umbrel/out/, ready for deploy.ps1. Needs Docker Desktop; arm64 runs under emulation,
# so a first build takes a while.
#   .\deploy\umbrel\build.ps1                 # all images
#   .\deploy\umbrel\build.ps1 -Only web       # some: web, search, tunnel, sandbox
# Images are named opal-umbrel/<name>:latest so they never replace the local amd64 dev images.
param([ValidateSet('web', 'search', 'tunnel', 'sandbox')][string[]]$Only)

# Docker writes progress to stderr, which Windows PowerShell would turn into errors; failures
# are caught through $LASTEXITCODE instead.
$ErrorActionPreference = 'Continue'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$here = $PSScriptRoot
$out = Join-Path $here 'out'
New-Item -ItemType Directory -Force $out | Out-Null

$runnerDist = "$root\apps\runner\dist"
if ((-not $Only -or $Only -contains 'web') -and -not (Get-ChildItem $runnerDist -Filter 'opal-runner-*.AppImage' -ErrorAction SilentlyContinue)) {
  throw "No runner AppImages in $runnerDist. Run 'npm run appimage' in apps\runner first."
}

$images = [ordered]@{
  web     = @('-f', "$here\web.Dockerfile", '--build-context', "deploy=$here", '--build-context', "runnerdist=$runnerDist", "$root\apps\web")
  search  = @('-f', "$here\search.Dockerfile", "$root\searxng")
  tunnel  = @('-f', "$here\tunnel.Dockerfile", "$here")
  sandbox = @("$root\sandbox")
}

foreach ($name in $images.Keys) {
  if ($Only -and $Only -notcontains $name) { continue }
  $tag = "opal-umbrel/${name}:latest"
  Write-Host "==> building $tag (linux/arm64)"
  & docker buildx build --platform linux/arm64 --load -t $tag @($images[$name])
  if ($LASTEXITCODE -ne 0) { throw "build failed: $name" }
  $tar = Join-Path $out "$name.tar"
  Write-Host "==> saving $tar"
  & docker save -o $tar $tag
  if ($LASTEXITCODE -ne 0) { throw "save failed: $name" }
}
Write-Host "Done. Tarballs are in $out"
