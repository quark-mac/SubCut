param(
    [string]$Python = $env:WEBUI_PYTHON,
    [int]$Port = 8765,
    [string]$Workspace = "",
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
if (-not $Python) {
    $Python = Join-Path $Root 'env\python.exe'
    if (-not (Test-Path $Python)) {
        # A Git worktree can reuse the primary checkout's existing environment.
        $Common = & git -C $Root rev-parse --path-format=absolute --git-common-dir
        if ($LASTEXITCODE -eq 0) {
            $Python = Join-Path (Split-Path $Common -Parent) 'env\python.exe'
        }
    }
}
if (-not (Test-Path $Python -PathType Leaf)) {
    throw 'Existing Python not found. Set WEBUI_PYTHON or pass -Python <absolute python.exe path>.'
}
$Arguments = @('-m', 'webui', '--port', "$Port")
if ($Workspace) { $Arguments += @('--workspace', [System.IO.Path]::GetFullPath($Workspace)) }
if ($NoBrowser) { $Arguments += '--no-browser' }
Push-Location $Root
try {
    & $Python @Arguments
    if ($LASTEXITCODE -ne 0) { throw "WebUI exited with code $LASTEXITCODE" }
} finally { Pop-Location }
