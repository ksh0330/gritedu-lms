/**
 * 통일된 에러 핸들링 유틸리티
 * 프로젝트 전반에서 일관된 에러 처리를 위한 헬퍼 함수들
 */
import { TOAST_DURATION, DELAY } from "/assets/js/config/constants.js";

/**
 * 에러 타입별 사용자 친화적 메시지 매핑
 */
const ERROR_MESSAGES = {
  // Firebase 에러
  'permission-denied': '접근 권한이 없습니다. 관리자에게 문의하세요.',
  'unauthenticated': '로그인이 필요합니다.',
  'not-found': '요청한 데이터를 찾을 수 없습니다.',
  'already-exists': '이미 존재하는 데이터입니다.',
  'failed-precondition': '요청을 처리할 수 없는 상태입니다.',
  'aborted': '요청이 취소되었습니다.',
  'out-of-range': '요청 범위를 벗어났습니다.',
  'unimplemented': '아직 구현되지 않은 기능입니다.',
  'internal': '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
  'unavailable': '서비스를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.',
  'data-loss': '데이터 손실이 발생했습니다.',
  'deadline-exceeded': '요청 시간이 초과되었습니다.',
  
  // 일반 에러
  'network-error': '네트워크 연결을 확인해 주세요.',
  'timeout': '요청 시간이 초과되었습니다.',
  'unknown': '알 수 없는 오류가 발생했습니다.',
};

/**
 * 에러 객체에서 에러 코드 추출
 * @param {Error|Object} error - 에러 객체
 * @returns {string} 에러 코드
 */
function getErrorCode(error) {
  if (!error) return 'unknown';
  
  // Firebase 에러 코드
  if (error.code) return error.code;
  
  // 네트워크 에러
  if (error.message && error.message.includes('network')) return 'network-error';
  if (error.message && error.message.includes('timeout')) return 'timeout';
  
  return 'unknown';
}

/**
 * 에러 코드에 해당하는 사용자 친화적 메시지 반환
 * @param {string} code - 에러 코드
 * @param {string} fallback - 기본 메시지
 * @returns {string} 사용자 친화적 메시지
 */
function getUserMessage(code, fallback = '오류가 발생했습니다. 잠시 후 다시 시도해 주세요.') {
  return ERROR_MESSAGES[code] || fallback;
}

/**
 * 에러를 처리하고 사용자에게 표시
 * @param {Error|Object} error - 에러 객체
 * @param {string} context - 에러 발생 컨텍스트 (선택사항)
 * @param {Object} options - 옵션
 * @param {boolean} options.showToast - 토스트 메시지 표시 여부
 * @param {boolean} options.logError - 콘솔에 에러 로깅 여부
 * @param {Function} options.onError - 커스텀 에러 핸들러
 * @returns {string} 사용자 친화적 메시지
 */
export function handleError(error, context = '', options = {}) {
  const {
    showToast = true,
    logError = true,
    onError = null,
  } = options;
  
  const code = getErrorCode(error);
  const message = getUserMessage(code);
  
  // 콘솔 로깅
  if (logError) {
    const logContext = context ? `[${context}]` : '';
    console.error(`${logContext}`, error);
    
    // 에러 상세 정보
    if (error.code) {
      console.error(`에러 코드: ${error.code}`);
    }
    if (error.message) {
      console.error(`에러 메시지: ${error.message}`);
    }
    if (error.stack) {
      console.error(`스택 트레이스:`, error.stack);
    }
  }
  
  // 커스텀 핸들러 실행
  if (onError && typeof onError === 'function') {
    try {
      onError(error, code, message);
    } catch (handlerError) {
      console.error('에러 핸들러 실행 중 오류:', handlerError);
    }
  }
  
  // 토스트 메시지 표시
  if (showToast) {
    // toast 유틸리티가 있는 경우 사용
    if (typeof window !== 'undefined' && window.toast) {
      window.toast.error(message, TOAST_DURATION.ERROR);
    } else if (typeof window !== 'undefined' && window.toast?.error) {
      window.toast.error(message, TOAST_DURATION.ERROR);
    } else {
      // toast가 없는 경우 alert 사용
      console.warn('Toast 유틸리티를 찾을 수 없습니다. alert를 사용합니다.');
      alert(message);
    }
  }
  
  return message;
}

/**
 * 비동기 함수를 에러 핸들링과 함께 실행
 * @param {Function} asyncFn - 비동기 함수
 * @param {string} context - 컨텍스트
 * @param {Object} options - 옵션
 * @returns {Promise} 실행 결과
 */
export async function safeAsync(asyncFn, context = '', options = {}) {
  try {
    return await asyncFn();
  } catch (error) {
    handleError(error, context, options);
    throw error; // 에러를 다시 throw하여 호출자가 처리할 수 있도록
  }
}

/**
 * Firebase 에러를 처리
 * @param {Error} error - Firebase 에러
 * @param {string} context - 컨텍스트
 * @param {Object} options - 옵션
 * @returns {string} 사용자 친화적 메시지
 */
export function handleFirebaseError(error, context = '', options = {}) {
  return handleError(error, `Firebase ${context}`, options);
}

/**
 * 네트워크 에러를 처리
 * @param {Error} error - 네트워크 에러
 * @param {string} context - 컨텍스트
 * @param {Object} options - 옵션
 * @returns {string} 사용자 친화적 메시지
 */
export function handleNetworkError(error, context = '', options = {}) {
  return handleError(error, `Network ${context}`, {
    ...options,
    showToast: true,
  });
}

/**
 * 권한 에러를 처리
 * @param {Error} error - 권한 에러
 * @param {string} context - 컨텍스트
 * @param {Object} options - 옵션
 * @returns {string} 사용자 친화적 메시지
 */
export function handlePermissionError(error, context = '', options = {}) {
  const message = handleError(error, `Permission ${context}`, {
    ...options,
    showToast: true,
  });
  
  // 권한 에러인 경우 로그인 페이지로 리다이렉트
  if (error.code === 'permission-denied' || error.code === 'unauthenticated') {
    if (typeof window !== 'undefined') {
      setTimeout(() => {
        window.location.href = '/members/login.html';
      }, DELAY.MEDIUM);
    }
  }
  
  return message;
}

/**
 * 에러 메시지 커스터마이징
 * @param {string} code - 에러 코드
 * @param {string} message - 커스텀 메시지
 */
export function setCustomErrorMessage(code, message) {
  ERROR_MESSAGES[code] = message;
}

/**
 * 통일된 에러 메시지 UI 생성
 * @param {string} message - 에러 메시지
 * @param {Object} options - 옵션
 * @param {boolean} options.showReloadButton - 새로고침 버튼 표시 여부
 * @param {string} options.title - 에러 제목 (기본: "오류가 발생했습니다")
 * @returns {string} HTML 문자열
 */
export function createErrorUI(message, options = {}) {
  const {
    showReloadButton = true,
    title = '오류가 발생했습니다'
  } = options;
  
  const escapedTitle = escapeHtml(title);
  const escapedMessage = escapeHtml(message);
  
  let reloadButton = '';
  if (showReloadButton) {
    reloadButton = `
      <button class="btn primary" onclick="window.location.reload()" style="padding:12px 24px;font-size:14px;min-height:44px;" aria-label="페이지 새로고침">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:6px;">
          <polyline points="23 4 23 10 17 10"></polyline>
          <polyline points="1 20 1 14 7 14"></polyline>
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
        </svg>
        페이지 새로고침
      </button>
    `;
  }
  
  return `
    <div class="error-state" style="text-align:center;padding:60px 40px;">
      <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--error-color)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin:0 auto 20px;opacity:0.7;">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
      <h3 style="font-size:20px;font-weight:700;color:var(--text);margin:0 0 12px;">${escapedTitle}</h3>
      <p style="font-size:15px;color:var(--muted);margin:0 0 24px;line-height:1.7;">${escapedMessage}</p>
      ${reloadButton}
    </div>
  `;
}

/**
 * 간단한 에러 메시지 UI 생성 (새로고침 버튼 없음)
 * @param {string} message - 에러 메시지
 * @returns {string} HTML 문자열
 */
export function createSimpleErrorUI(message) {
  const escapedMessage = escapeHtml(message);
  return `<div class="muted" style="text-align:center;padding:40px;">${escapedMessage}</div>`;
}

/**
 * HTML 이스케이프 유틸리티 (에러 핸들러 내부 사용)
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 기본 export
export default {
  handleError,
  safeAsync,
  handleFirebaseError,
  handleNetworkError,
  handlePermissionError,
  setCustomErrorMessage,
  getUserMessage,
  getErrorCode,
  createErrorUI,
  createSimpleErrorUI,
};

