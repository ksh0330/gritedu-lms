---
name: cross-verify-findings
description: Independently verify another agent's review findings against the actual code, rejecting false positives and correcting severity. Use in the verify phase or whenever asked to check someone else's audit report or code review.
---

# 다른 에이전트 발견 사항 교차검증

목표는 **오탐 제거와 심각도 보정**이다. 원 보고서의 논리를 따라가지 말고, 각 항목을 코드에서 처음부터 다시 확인한다.

## 절차 (항목마다)

1. 인용된 `파일:줄`을 직접 연다. 발췌가 실제 코드와 다르거나 줄 번호가 틀리면 기록한다.
2. 주변 맥락(호출부, 상위 rules 함수, 다른 match 블록, 테스트)을 확인한다. 다른 곳에서 이미 막혀 있으면 오탐이다.
3. 시나리오를 단계별로 재현해 본다. Rules라면 실제 요청(`request.auth`, `request.resource.data`)을 가정해 평가한다.
4. `docs/MAINTENANCE_LOG.md`와 `docs/audits/FIRESTORE_SECURITY_CRUD_MASTER_AUDIT.md`에 이미 기록·해결된 항목인지 확인한다.
5. 판정한다.

## 판정 값

| 판정 | 의미 |
|---|---|
| `CONFIRMED` | 코드로 확인됨. 등급 유지 |
| `ADJUSTED` | 문제는 있으나 등급·범위·개선안이 다름 (새 등급과 이유) |
| `REJECTED` | 오탐. 반박 근거 `파일:줄` 필수 |
| `DUPLICATE` | 기존 기록 또는 다른 ID와 중복 (어느 것과) |
| `NEEDS-RUNTIME` | Emulator 테스트나 운영 확인 없이는 판단 불가 (확인 방법을 구체적으로) |

## 출력 형식

```markdown
## 판정 요약
| 원 ID | 원 등급 | 판정 | 새 등급 | 한 줄 이유 |

## 항목별 상세
### CX-003 → ADJUSTED (P1 → P2)
- 확인한 위치: ...
- 근거: ...
- 개선안 보완: ...

## 이 영역에서 원 보고서가 놓친 것 (최대 5개)
(review-protocol 형식, ID 접두사는 본인 것 사용)
```

- 판정을 내리기 어렵다고 모두 `NEEDS-RUNTIME`으로 미루지 않는다. 코드만으로 결론이 나는 것은 결론을 낸다.
- 원 보고서 작성자를 평가하는 문장은 쓰지 않는다. 코드에 대한 사실만 쓴다.
