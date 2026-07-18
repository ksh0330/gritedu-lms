/**
 * Signup 페이지 엔트리 포인트
 * 모든 signup 관련 로직을 여기서 통합 관리
 */

// 기존 signup.js를 import하여 모든 로직을 그대로 사용
import "/assets/js/pages/signup.js";

// 폼 검증 초기화
import { initSignupValidation } from "./form-validation.js";

// 검증 초기화 (signup.js 로드 후 실행)
initSignupValidation();
