# RDAP-Q installer wrapper for Windows PowerShell.
# The implementation lives in bin/rdapq.js. A piped `irm | iex` launch is refused.
#Requires -Version 5.1
[CmdletBinding()]
param(
    [switch]$All,
    [switch]$Antigravity,
    [switch]$Claude,
    [switch]$Cline,
    [switch]$Copilot,
    [switch]$Codex,
    [switch]$Grok,
    [switch]$Goose,
    [switch]$Cursor,
    [switch]$Hermes,
    [switch]$Nemo,
    [switch]$GlobalOnly,
    [switch]$Force,
    [switch]$Quiet,
    [string]$Repo = "",
    [switch]$Help
)

$ErrorActionPreference = "Stop"

if (-not $PSCommandPath) {
    Write-Error "refusing a piped install (irm | iex). Use: npx rdap-q install --all`nOr clone the repo and run .\install.ps1 -All"
    exit 1
}

$ScriptDir = Split-Path -Parent $PSCommandPath
$Skill = Join-Path $ScriptDir "rdap-q-skill\SKILL.md"
$Cli = Join-Path $ScriptDir "bin\rdapq.js"

if (-not (Test-Path -LiteralPath $Skill) -or -not (Test-Path -LiteralPath $Cli)) {
    Write-Error "install.ps1 must be run from a full RDAP-Q checkout."
    exit 1
}

$Node = Get-Command node -ErrorAction SilentlyContinue
if (-not $Node) {
    Write-Error "Node.js >= 22 is required. Install Node, then re-run .\install.ps1 or use npx rdap-q."
    exit 1
}

$NodeMajor = [int](& node -p "process.versions.node.split('.')[0]")
if ($NodeMajor -lt 22) {
    Write-Error "Node.js >= 22 is required (found $(& node -v))."
    exit 1
}

$nodeArgs = @()
if ($Help) {
    $nodeArgs = @("--help")
} else {
    $nodeArgs = @("install")
    if ($All) { $nodeArgs += "--all" }
    if ($Antigravity) { $nodeArgs += "--antigravity" }
    if ($Claude) { $nodeArgs += "--claude" }
    if ($Cline) { $nodeArgs += "--cline" }
    if ($Copilot) { $nodeArgs += "--copilot" }
    if ($Codex) { $nodeArgs += "--codex" }
    if ($Grok) { $nodeArgs += "--grok" }
    if ($Goose) { $nodeArgs += "--goose" }
    if ($Cursor) { $nodeArgs += "--cursor" }
    if ($Hermes) { $nodeArgs += "--hermes" }
    if ($Nemo) { $nodeArgs += "--nemo" }
    if ($GlobalOnly) { $nodeArgs += "--global-only" }
    if ($Force) { $nodeArgs += "--force" }
    if ($Quiet) { $nodeArgs += "--quiet" }
    if ($Repo -ne "") { $nodeArgs += @("--repo", $Repo) }
}

& node $Cli @nodeArgs
exit $LASTEXITCODE
