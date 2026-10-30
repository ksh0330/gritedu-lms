#Requires -Version 5.1
<#
.SYNOPSIS
  Runs the read-only review phases with Claude Code, Codex CLI and Antigravity (Gemini) CLI.

.EXAMPLE
  # Phase 1: three independent audits in parallel  -> .review/runs/<RunId>/01-audit-*.md
  .\tools\agents\run-review.ps1 -Phase audit
  # Phase 2: rotation cross-verify (claude->codex, codex->gemini, gemini->claude)
  .\tools\agents\run-review.ps1 -Phase verify
  # Phase 3: Claude merges everything into REPORT.md + IMPROVEMENT_PLAN.md
  .\tools\agents\run-review.ps1 -Phase synthesize
  # 1 -> 2 -> 3 in one go
  .\tools\agents\run-review.ps1 -Phase all
  # Review a fix branch with a different agent than the implementer
  .\tools\agents\run-review.ps1 -Phase review-diff -Branch fix/WP-01 -Reviewer codex
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('audit', 'verify', 'synthesize', 'review-diff', 'all')]
  [string]$Phase,
  [string]$RunId,
  [ValidateSet('claude', 'codex', 'gemini')]
  [string[]]$Only = @('claude', 'codex', 'gemini'),
  [switch]$Sequential,
  [string]$Branch,
  [string]$Base = 'main',
  [ValidateSet('claude', 'codex', 'gemini')]
  [string]$Reviewer = 'claude'
)
$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'common.ps1')
Set-Utf8Console
Set-Location $Root

# ---------------------------------------------------------------- run folder
if (-not $RunId) {
  if ($Phase -in @('audit', 'all')) { $RunId = Get-Date -Format 'yyyyMMdd-HHmm' }
  else { $RunId = Get-LatestRunId }
}
if (-not $RunId) { throw 'RunId를 찾을 수 없습니다. 먼저 -Phase audit 을 실행하거나 -RunId 를 지정하세요.' }
$RunDir = Join-Path $Root ".review\runs\$RunId"
$RunRel = ".review/runs/$RunId"
New-Item -ItemType Directory -Force -Path $RunDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $RunDir 'logs') | Out-Null

# ---------------------------------------------------------------- worker (runs in a job or inline)
$Worker = {
  param($Root, $Agent, $Exe, [string[]]$ArgList, $OutFile, $LogFile, [bool]$CaptureStdout, $RunId)
  $ErrorActionPreference = 'Continue'
  Set-Location $Root
  $enc = New-Object System.Text.UTF8Encoding($false)
  [Console]::OutputEncoding = $enc
  $OutputEncoding = $enc
  $env:GRIT_AGENT_MODE = 'audit'      # read by .agents/hooks/*.mjs
  $env:GRIT_RUN_ID = $RunId
  $t0 = Get-Date
  if ($CaptureStdout) {
    $lines = & $Exe @ArgList 2> $LogFile
    $code = $LASTEXITCODE
    [System.IO.File]::WriteAllText($OutFile, (($lines | ForEach-Object { "$_" }) -join "`n"), $enc)
  } else {
    & $Exe @ArgList *> $LogFile
    $code = $LASTEXITCODE
  }
  [pscustomobject]@{
    Agent    = $Agent
    ExitCode = $code
    Minutes  = [math]::Round(((Get-Date) - $t0).TotalMinutes, 1)
    Out      = $OutFile
  }
}

# ---------------------------------------------------------------- command builders
$ClaudeReadTools = 'Read,Grep,Glob,Bash(git log:*),Bash(git show:*),Bash(git diff:*),Bash(git status:*),Bash(npm run check:*)'

function New-AgentJobSpec([string]$Agent, [string]$PhaseKey, [string]$Instruction, [string]$OutName) {
  $exe = Resolve-AgentExe $Agent
  if (-not $exe) { Write-Warn2 "$Agent CLI를 찾지 못해 건너뜁니다."; return $null }
  $cfg = $AgentConfig[$Agent]
  $model = $cfg.Model[$PhaseKey]
  $effort = $cfg.Effort[$PhaseKey]
  $out = Join-Path $RunDir $OutName
  $log = Join-Path $RunDir ("logs\" + [IO.Path]::GetFileNameWithoutExtension($OutName) + '.log')
  $capture = $true

  switch ($Agent) {
    'claude' {
      if ($PhaseKey -eq 'synthesize') {
        $allowed = "$ClaudeReadTools,Write(./.review/**),Edit(./.review/**)"
        $denied = 'NotebookEdit,WebFetch,WebSearch'
      } else {
        $allowed = $ClaudeReadTools
        $denied = 'Write,Edit,MultiEdit,NotebookEdit,WebFetch,WebSearch'
      }
      $args2 = @('-p', $Instruction, '--model', $model, '--effort', $effort,
                 '--output-format', 'text', '--allowedTools', $allowed, '--disallowedTools', $denied)
    }
    'codex' {
      # -o writes the final message to the report file; stdout/stderr go to the log
      $args2 = @('exec', '-C', $Root, '-m', $model, '-c', "model_reasoning_effort=$effort",
                 '-s', 'read-only', '--color', 'never', '-o', $out, $Instruction)
      $capture = $false
    }
    'gemini' {
      if ($GeminiCli -eq 'agy') {
        $args2 = @('-p', $Instruction, '--model', $model, '--effort', $effort,
                   '--output-format', 'text', '--print-timeout', $GeminiPrintTimeout)
      } else {
        $args2 = @('-p', $Instruction, '-m', $model, '--output-format', 'text')
      }
    }
  }
  [pscustomobject]@{ Agent = $Agent; Exe = $exe; Args = $args2; Out = $out; Log = $log; Capture = $capture; Model = $model; Effort = $effort }
}

function Invoke-Specs($Specs, [string]$Label) {
  $Specs = @($Specs | Where-Object { $_ })
  if ($Specs.Count -eq 0) { Write-Warn2 '실행할 에이전트가 없습니다.'; return @() }
  foreach ($s in $Specs) { Write-Host ("  - {0,-6} model={1} effort={2} -> {3}" -f $s.Agent, $s.Model, $s.Effort, (Split-Path $s.Out -Leaf)) }

  $results = @()
  if ($Sequential -or $Specs.Count -eq 1) {
    foreach ($s in $Specs) {
      Write-Host "  ... $($s.Agent) 실행 중 (로그: $($s.Log))"
      $results += & $Worker $Root $s.Agent $s.Exe $s.Args $s.Out $s.Log $s.Capture $RunId
    }
  } else {
    $jobs = foreach ($s in $Specs) {
      Start-Job -Name "$Label-$($s.Agent)" -ScriptBlock $Worker -ArgumentList $Root, $s.Agent, $s.Exe, $s.Args, $s.Out, $s.Log, $s.Capture, $RunId
    }
    $t0 = Get-Date
    while (@($jobs | Where-Object { $_.State -eq 'Running' }).Count -gt 0) {
      Wait-Job -Job @($jobs | Where-Object { $_.State -eq 'Running' }) -Any -Timeout 60 | Out-Null
      $running = ($jobs | Where-Object { $_.State -eq 'Running' } | ForEach-Object { $_.Name -replace "^$Label-", '' }) -join ', '
      if ($running) { Write-Host ("  ... {0:N0}분 경과, 실행 중: {1}" -f ((Get-Date) - $t0).TotalMinutes, $running) }
    }
    $results = $jobs | Receive-Job
    $jobs | Remove-Job -Force
  }

  foreach ($r in $results) {
    $size = 0
    if (Test-Path $r.Out) { $size = (Get-Item $r.Out).Length }
    if ($r.ExitCode -eq 0 -and $size -gt 500) {
      Write-Ok ("{0,-6} {1}분  {2}  ({3:N0} bytes)" -f $r.Agent, $r.Minutes, (Split-Path $r.Out -Leaf), $size)
    } else {
      Write-Warn2 ("{0,-6} exit={1} size={2}  → 로그 확인: logs\{3}.log" -f $r.Agent, $r.ExitCode, $size, [IO.Path]::GetFileNameWithoutExtension($r.Out))
    }
  }
  return $results
}

function Save-RunMeta([string]$PhaseName) {
  $metaPath = Join-Path $RunDir 'run.json'
  $meta = [ordered]@{}
  if (Test-Path $metaPath) {
    try { (Get-Content $metaPath -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $meta[$_.Name] = $_.Value } } catch {}
  }
  $meta['runId'] = $RunId
  $meta["$PhaseName.at"] = (Get-Date).ToString('s')
  $meta["$PhaseName.head"] = (git rev-parse HEAD 2>$null)
  $meta["$PhaseName.branch"] = (git rev-parse --abbrev-ref HEAD 2>$null)
  $meta["$PhaseName.dirtyFiles"] = @(git status --porcelain 2>$null | Where-Object { $_ -notmatch '\.review/' }).Count
  $json = ($meta | ConvertTo-Json -Depth 5)
  [System.IO.File]::WriteAllText($metaPath, $json, (New-Object System.Text.UTF8Encoding($false)))
}

# ---------------------------------------------------------------- phases
function Invoke-Audit {
  Write-Step "Phase 1 · 독립 감사 (RUN_ID=$RunId)"
  $dirty = @(git status --porcelain 2>$null | Where-Object { $_ -notmatch '\.review/' })
  if ($dirty.Count -gt 0) { Write-Warn2 "커밋되지 않은 변경 $($dirty.Count)개. 보고서 줄 번호는 현재 작업 트리 기준입니다." }
  Save-RunMeta 'audit'
  $specs = foreach ($a in $Only) {
    $instr = "Read the file .review/prompts/01-audit-$a.md in this repository and follow it exactly. RUN_ID=$RunId. Do not modify any files. Your final message is saved verbatim as the report."
    New-AgentJobSpec $a 'audit' $instr "01-audit-$a.md"
  }
  Invoke-Specs $specs 'audit' | Out-Null
}

function Invoke-Verify {
  Write-Step "Phase 2 · 교차검증 (RUN_ID=$RunId)"
  Save-RunMeta 'verify'
  $specs = foreach ($a in $Only) {
    $target = $VerifyTarget[$a]
    $targetRel = "$RunRel/01-audit-$target.md"
    if (-not (Test-Path (Join-Path $Root $targetRel))) { Write-Warn2 "$a : 대상 보고서 없음 ($targetRel) → 건너뜀"; continue }
    $instr = "Read .review/prompts/02-verify.md and follow it exactly. You are $a. TARGET_REPORT=$targetRel RUN_ID=$RunId. Do not modify any files. Your final message is saved verbatim as the report."
    New-AgentJobSpec $a 'verify' $instr "02-verify-$a.md"
  }
  Invoke-Specs $specs 'verify' | Out-Null
}

function Invoke-Synthesize {
  Write-Step "Phase 3 · 종합 (Claude, RUN_ID=$RunId)"
  Save-RunMeta 'synthesize'
  $instr = "Read .review/prompts/03-synthesize.md and follow it exactly. OUTPUT_DIR=$RunRel RUN_ID=$RunId. Write REPORT.md and IMPROVEMENT_PLAN.md only inside OUTPUT_DIR."
  $spec = New-AgentJobSpec 'claude' 'synthesize' $instr '03-synthesize.log.md'
  Invoke-Specs @($spec) 'synth' | Out-Null

  # Fallback: if the files were not written, split them out of the final message.
  $report = Join-Path $RunDir 'REPORT.md'
  $plan = Join-Path $RunDir 'IMPROVEMENT_PLAN.md'
  $final = Join-Path $RunDir '03-synthesize.log.md'
  if ((-not (Test-Path $report) -or -not (Test-Path $plan)) -and (Test-Path $final)) {
    $text = [System.IO.File]::ReadAllText($final)
    $m = [regex]::Match($text, '(?s)<<<REPORT\.md>>>(.*?)<<<IMPROVEMENT_PLAN\.md>>>(.*)$')
    if ($m.Success) {
      $enc = New-Object System.Text.UTF8Encoding($false)
      [System.IO.File]::WriteAllText($report, $m.Groups[1].Value.Trim(), $enc)
      [System.IO.File]::WriteAllText($plan, $m.Groups[2].Value.Trim(), $enc)
      Write-Ok 'REPORT.md / IMPROVEMENT_PLAN.md 를 최종 응답에서 분리 저장'
    }
  }
  foreach ($f in @($report, $plan)) {
    if (Test-Path $f) { Write-Ok $f } else { Write-Warn2 "생성되지 않음: $f" }
  }
}

function Invoke-ReviewDiff {
  if (-not $Branch) { throw '-Branch 를 지정하세요 (예: -Branch fix/WP-01)' }
  Write-Step "Phase 5 · diff 교차 리뷰: $Branch (리뷰어 $Reviewer)"
  $safe = ($Branch -replace '[\\/:*?"<>|]', '_')
  $instr = "Read .review/prompts/05-review-diff.md and follow it exactly. You are $Reviewer. BRANCH=$Branch BASE=$Base PLAN=$RunRel/IMPROVEMENT_PLAN.md. Do not modify any files. Your final message is saved verbatim as the review."
  $spec = New-AgentJobSpec $Reviewer 'review-diff' $instr "05-review-$safe-$Reviewer.md"
  Invoke-Specs @($spec) 'review' | Out-Null
}

switch ($Phase) {
  'audit'       { Invoke-Audit }
  'verify'      { Invoke-Verify }
  'synthesize'  { Invoke-Synthesize }
  'review-diff' { Invoke-ReviewDiff }
  'all'         { Invoke-Audit; Invoke-Verify; Invoke-Synthesize }
}

Write-Host ''
Write-Step "결과 폴더: $RunDir"
Get-ChildItem $RunDir -File | Sort-Object Name | ForEach-Object { Write-Host ("  {0,-40} {1,10:N0} bytes" -f $_.Name, $_.Length) }
