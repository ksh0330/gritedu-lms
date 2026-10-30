#Requires -Version 5.1
<#
.SYNOPSIS
  Implements ONE approved work package (WP-xx) on its own branch with one agent, interactively.
.EXAMPLE
  .\tools\agents\run-fix.ps1 -Package WP-01 -Agent claude      # Rules/Auth package
  .\tools\agents\run-fix.ps1 -Package WP-02 -Agent codex       # Functions/scripts package
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^WP-[\w-]+$')][string]$Package,
  [Parameter(Mandatory = $true)][ValidateSet('claude', 'codex', 'gemini')][string]$Agent,
  [string]$RunId,
  [string]$Base = 'main'
)
$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'common.ps1')
Set-Utf8Console
Set-Location $Root

if (-not $RunId) { $RunId = Get-LatestRunId }
$PlanRel = ".review/runs/$RunId/IMPROVEMENT_PLAN.md"
if (-not (Test-Path (Join-Path $Root $PlanRel))) { throw "계획 파일이 없습니다: $PlanRel  (먼저 -Phase synthesize)" }
if (-not (Select-String -Path (Join-Path $Root $PlanRel) -Pattern ([regex]::Escape($Package)) -Quiet)) {
  throw "$PlanRel 에 $Package 항목이 없습니다."
}

# ---------------------------------------------------------------- clean tree + branch
$dirty = @(git status --porcelain | Where-Object { $_ -notmatch '\.review/' })
if ($dirty.Count -gt 0) {
  $dirty | ForEach-Object { Write-Host "    $_" }
  throw '작업 트리에 커밋되지 않은 변경이 있습니다. 정리한 뒤 다시 실행하세요 (.review/ 는 제외).'
}
$branch = "fix/$Package"
git show-ref --verify --quiet "refs/heads/$branch"
if ($LASTEXITCODE -eq 0) { git switch $branch } else { git switch -c $branch $Base }
if ($LASTEXITCODE -ne 0) { throw "브랜치 전환 실패: $branch" }
Write-Ok "branch: $branch (base $Base)"

# ---------------------------------------------------------------- launch interactive agent
$exe = Resolve-AgentExe $Agent
if (-not $exe) { throw "$Agent CLI를 찾을 수 없습니다." }
$model = $AgentConfig[$Agent].Model['fix']
$effort = $AgentConfig[$Agent].Effort['fix']
$instr = "Read .review/prompts/04-fix.md and follow it exactly. PACKAGE=$Package PLAN=$PlanRel. Present your plan first and wait for my confirmation before editing."

$env:GRIT_AGENT_MODE = 'fix'
$env:GRIT_RUN_ID = $RunId
Write-Step "$Agent 실행 (model=$model effort=$effort, GRIT_AGENT_MODE=fix). 종료하면 diff 요약을 보여 줍니다."
try {
  switch ($Agent) {
    'claude' { & $exe --model $model --effort $effort $instr }
    'codex'  { & $exe -m $model -c "model_reasoning_effort=$effort" -s workspace-write -a on-request $instr }
    'gemini' {
      Set-Clipboard -Value $instr
      Write-Warn2 '시작 지시문을 클립보드에 복사했습니다. agy 화면에 붙여넣기(Ctrl+V) 하세요.'
      if ($GeminiCli -eq 'agy') { & $exe --model $model --effort $effort } else { & $exe -m $model }
    }
  }
} finally {
  Remove-Item Env:GRIT_AGENT_MODE -ErrorAction SilentlyContinue
  Remove-Item Env:GRIT_RUN_ID -ErrorAction SilentlyContinue
}

# ---------------------------------------------------------------- summary + next steps
Write-Host ''
Write-Step '변경 요약'
git status --short
git diff --stat
$reviewer = switch ($Agent) { 'claude' { 'codex' } default { 'claude' } }
Write-Host @"

다음 단계 (사람이 실행):
  1) git diff 로 직접 확인
  2) 교차 리뷰 : .\tools\agents\run-review.ps1 -Phase review-diff -Branch $branch -Reviewer $reviewer -RunId $RunId
     (커밋 전이면 리뷰어가 작업 트리 diff를 봅니다)
  3) 통과 시   : git add -A; git commit -m "fix($Package): ..."
  4) 배포      : IMPROVEMENT_PLAN 의 배포 단위만 (static=push / rules=npm run deploy:rules / functions=해당 함수만)
  5) 운영 확인 후 docs/MAINTENANCE_LOG.md 상태를 Deployed → Verified 로 갱신
"@
