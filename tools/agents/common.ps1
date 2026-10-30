# Shared settings for the multi-agent review scripts. Edit models / effort here.
# Dot-sourced by setup-agents.ps1, run-review.ps1, run-fix.ps1 (PowerShell 5.1+ / 7+).

$script:Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

# ---------------------------------------------------------------- models
# claude : Claude Code  (opus = Claude Opus 5.5)          effort: low|medium|high|xhigh|max
# codex  : Codex CLI    (gpt-6.1-sol = GPT-6.1 Sol)       effort: low|medium|high|xhigh|max
# gemini : Antigravity CLI 'agy' (Gemini 4 Argon)         effort: low|medium|high
#          check the exact slugs with:  agy models
$script:AgentConfig = @{
  claude = @{
    Model  = @{ audit = 'opus'; verify = 'opus'; synthesize = 'opus'; 'review-diff' = 'opus'; fix = 'opus' }
    Effort = @{ audit = 'xhigh'; verify = 'high'; synthesize = 'xhigh'; 'review-diff' = 'high'; fix = 'high' }
  }
  codex = @{
    Model  = @{ audit = 'gpt-6.1-sol'; verify = 'gpt-6.1-sol'; 'review-diff' = 'gpt-6.1-sol'; fix = 'gpt-6.1-sol' }
    Effort = @{ audit = 'xhigh'; verify = 'medium'; 'review-diff' = 'high'; fix = 'high' }
  }
  gemini = @{
    Model  = @{ audit = 'gemini-4-argon-high'; verify = 'gemini-4-argon-medium'; 'review-diff' = 'gemini-4-argon-high'; fix = 'gemini-4-argon-high' }
    Effort = @{ audit = 'high'; verify = 'medium'; 'review-diff' = 'high'; fix = 'high' }
  }
}

# 'agy' (Antigravity CLI, Gemini CLI successor) or 'gemini' (legacy Gemini CLI)
$script:GeminiCli = 'agy'
# agy headless default timeout is 5m; a whole-repo audit needs much longer
$script:GeminiPrintTimeout = '45m'

# Cross-verification rotation: verifier -> author of the report it checks
$script:VerifyTarget = @{ claude = 'codex'; codex = 'gemini'; gemini = 'claude' }

# ---------------------------------------------------------------- helpers
function Set-Utf8Console {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [Console]::OutputEncoding = $enc
  [Console]::InputEncoding = $enc
  $global:OutputEncoding = $enc
}

function Resolve-AgentExe([string]$Agent) {
  $name = switch ($Agent) { 'claude' { 'claude' } 'codex' { 'codex' } 'gemini' { $script:GeminiCli } default { $Agent } }
  # prefer .exe/.cmd over .ps1 shims (execution policy and argument quoting are more predictable)
  foreach ($cand in @("$name.exe", "$name.cmd", $name)) {
    $c = Get-Command $cand -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($c) { return $c.Source }
  }
  return $null
}

function Get-LatestRunId {
  $runs = Join-Path $script:Root '.review\runs'
  if (-not (Test-Path $runs)) { return $null }
  $d = Get-ChildItem $runs -Directory | Sort-Object Name -Descending | Select-Object -First 1
  if ($d) { return $d.Name } else { return $null }
}

function Write-Step([string]$m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Write-Ok([string]$m)   { Write-Host "  [OK] $m" -ForegroundColor Green }
function Write-Warn2([string]$m){ Write-Host "  [!!] $m" -ForegroundColor Yellow }
