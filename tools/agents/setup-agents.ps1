#Requires -Version 5.1
<#
.SYNOPSIS
  One-time setup for the Claude / Codex / Gemini review kit.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\agents\setup-agents.ps1 -InstallDeps
#>
[CmdletBinding()]
param(
  [switch]$InstallDeps   # run npm ci (root + functions) so agents can run the existing checks read-only
)
# 'Continue': PowerShell 5.1 turns native stderr into terminating errors under 'Stop'.
$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'common.ps1')
Set-Utf8Console
Set-Location $Root

Write-Step "Repository: $Root"
foreach ($f in @('AGENTS.md', 'firestore.rules', 'functions\index.js', '.agents\rules\review-protocol.md')) {
  if (-not (Test-Path $f)) { throw "필수 파일이 없습니다: $f  (저장소 루트에 kit을 풀었는지 확인)" }
}
Write-Ok 'kit files present'

# ------------------------------------------------------------ CLIs
Write-Step 'CLI check'
foreach ($tool in @('git', 'node', 'npm', 'claude', 'codex', $GeminiCli)) {
  $exe = Get-Command $tool -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($exe) {
    $v = (& $tool --version 2>&1 | Select-Object -First 1)
    Write-Ok "$tool  $v"
  } else {
    Write-Warn2 "$tool 을(를) 찾을 수 없습니다."
  }
}
if (-not (Get-Command $GeminiCli -ErrorAction SilentlyContinue) -and (Get-Command gemini -ErrorAction SilentlyContinue)) {
  Write-Warn2 "agy 없이 legacy 'gemini' CLI만 있습니다. Argon은 Antigravity CLI(agy) 기준입니다."
  Write-Warn2 "  설치: irm https://antigravity.google/cli/install.ps1 | iex   (또는 tools\agents\common.ps1 의 GeminiCli='gemini')"
}
$nodeMajor = 0
try { $nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0]) } catch {}
if ($nodeMajor -lt 18) { Write-Warn2 'Node 18+ 필요 (훅 스크립트와 저장소 검사가 node로 실행됩니다).' }

# ------------------------------------------------------------ skills -> .claude/skills
Write-Step 'Sync skills: .agents/skills -> .claude/skills'
$src = Join-Path $Root '.agents\skills'
$dst = Join-Path $Root '.claude\skills'
New-Item -ItemType Directory -Force -Path $dst | Out-Null
Get-ChildItem $src -Directory | ForEach-Object {
  $target = Join-Path $dst $_.Name
  if (Test-Path $target) { Remove-Item $target -Recurse -Force }
  Copy-Item $_.FullName -Destination $dst -Recurse
  Write-Ok $_.Name
}

# ------------------------------------------------------------ folders / gitignore
New-Item -ItemType Directory -Force -Path (Join-Path $Root '.review\runs') | Out-Null
$gi = Join-Path $Root '.gitignore'
$giText = ''
if (Test-Path $gi) { $giText = Get-Content $gi -Raw }
$add = @()
foreach ($line in @('.claude/settings.local.json', '.claude/skills/')) {
  if ($giText -notmatch [regex]::Escape($line)) { $add += $line }
}
if ($add.Count -gt 0) {
  Add-Content -Path $gi -Value ("`n# multi-agent review kit (generated / personal)`n" + ($add -join "`n")) -Encoding utf8
  Write-Ok ".gitignore += $($add -join ', ')"
}

# ------------------------------------------------------------ dependencies
Write-Step 'Dependencies'
if ($InstallDeps) {
  npm ci
  if ($LASTEXITCODE -ne 0) { throw 'npm ci 실패' }
  npm --prefix functions ci
  if ($LASTEXITCODE -ne 0) { throw 'functions npm ci 실패' }
} else {
  if (-not (Test-Path 'node_modules')) { Write-Warn2 'node_modules 없음 → -InstallDeps 로 다시 실행하면 에이전트가 기존 검사를 돌릴 수 있습니다.' }
  if (-not (Test-Path 'functions\node_modules')) { Write-Warn2 'functions\node_modules 없음' }
}

# ------------------------------------------------------------ hook smoke test
Write-Step 'Hook smoke test'
$env:GRIT_AGENT_MODE = 'audit'
$blocked = '{"tool_name":"Bash","tool_input":{"command":"firebase deploy --only firestore:rules"},"cwd":"."}' | node .agents\hooks\guard.mjs 2>$null
if ($LASTEXITCODE -eq 2) { Write-Ok 'guard blocks firebase deploy' } else { Write-Warn2 "guard 동작 확인 실패 (exit $LASTEXITCODE)" }
'{"tool_name":"Read","tool_input":{"file_path":"firestore.rules"},"cwd":"."}' | node .agents\hooks\guard.mjs 2>$null
if ($LASTEXITCODE -eq 0) { Write-Ok 'guard allows normal reads' } else { Write-Warn2 "guard가 일반 읽기를 막음 (exit $LASTEXITCODE)" }
Remove-Item Env:GRIT_AGENT_MODE -ErrorAction SilentlyContinue

# ------------------------------------------------------------ manual steps
Write-Host ''
Write-Step '사람이 한 번 해야 하는 일'
Write-Host @"
  1) Claude Code : 이 폴더에서 'claude' 를 한 번 대화형으로 실행 → 폴더 신뢰(trust) 승인
                   → '/hooks' 로 SessionStart / PreToolUse 훅이 보이는지 확인 → 종료
  2) Codex CLI   : 이 폴더에서 'codex' 를 한 번 실행 → 프로젝트 trust 승인 (미신뢰면 AGENTS.md·.codex 설정이 로드되지 않음)
                   → '/hooks' 에서 프로젝트 훅 2개를 trust → '/status' 로 model=gpt-6.1-sol 확인 → 종료
  3) Antigravity : 'agy' 로그인 후 'agy models' 로 Argon slug 확인
                   → 다르면 tools\agents\common.ps1 의 gemini Model 값을 수정
  4) 첫 실행     : powershell -ExecutionPolicy Bypass -File tools\agents\run-review.ps1 -Phase audit
"@
