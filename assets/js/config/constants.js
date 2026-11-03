/**
 * 애플리케이션 전역 상수
 * 하드 코딩된 값들을 중앙에서 관리
 */

// Toast 메시지 표시 시간 (밀리초)
export const TOAST_DURATION = {
  DEFAULT: 3000,    // 기본 표시 시간
  SUCCESS: 3000,    // 성공 메시지
  ERROR: 4000,      // 에러 메시지 (더 길게 표시)
  WARNING: 3500,    // 경고 메시지
  INFO: 3000        // 정보 메시지
};

// Toast 애니메이션 시간 (밀리초)
export const TOAST_ANIMATION = {
  HIDE_DELAY: 300   // 숨김 애니메이션 지연 시간
};

// 일반적인 지연 시간 (밀리초)
export const DELAY = {
  SHORT: 1000,      // 짧은 지연 (1초)
  MEDIUM: 2000,     // 중간 지연 (2초)
  LONG: 3000,       // 긴 지연 (3초)
  VERY_LONG: 5000   // 매우 긴 지연 (5초)
};

// 재시도 관련 상수
export const RETRY = {
  DEFAULT_DELAY: 1000,  // 기본 재시도 지연 시간
  MAX_ATTEMPTS: 3        // 최대 재시도 횟수
};

