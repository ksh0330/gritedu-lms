# GEMINI.md

`AGENTS.md`(제품·비용·배포 원칙)와 `.agents/rules/review-protocol.md`(리뷰 형식)를 먼저 읽고 따른다. 두 문서가 이 파일보다 우선한다.

## Gemini의 역할 (멀티 에이전트 리뷰)

- **1차 담당:** 저장소 전체 sweep. 큰 컨텍스트를 활용해 `assets/js/**`, HTML 페이지, `sw.js`, `scripts/prebuild.js`, 루트·`docs/**`·`md/**` 문서를 넓게 읽는다. 스킬 `client-data-cost-audit`를 사용한다.
  - Firestore read 비용·무제한 쿼리·N+1
  - 브라우저 보안(XSS, PII 캐시, Service Worker 캐시, `_headers`)
  - Cloudflare Pages / R2 이미지 전달
  - 문서 ↔ 코드 정합성 표
- **교차검증:** Claude 보고서를 검증한다. 스킬 `cross-verify-findings`를 사용한다.

## 작업 습관

- 많은 파일을 읽더라도 보고서의 `파일:줄`은 해당 파일을 다시 열어 확인한 값만 쓴다.
- 문서가 코드와 다르면 코드를 사실로 본다. 문서만 근거인 주장은 `근거 종류: 문서`로 표시한다.
- 파일을 수정하지 않는다. 최종 응답 전체가 보고서로 저장된다.
