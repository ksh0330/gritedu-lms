/**
 * HTML 유틸리티 함수
 * 프로젝트 전반에서 사용되는 HTML 관련 헬퍼 함수들
 */

/**
 * HTML 특수 문자를 이스케이프하여 XSS 공격 방지
 * @param {string} text - 이스케이프할 텍스트
 * @returns {string} 이스케이프된 HTML 문자열
 */
export function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/**
 * HTML을 안전하게 정제 (스크립트 태그 제거, 이벤트 핸들러 제거)
 * @param {string} html - 정제할 HTML 문자열
 * @returns {string} 정제된 HTML 문자열
 */
export function sanitizeHtml(html) {
  if (!html) return "";
  const div = document.createElement("div");
  div.innerHTML = html;
  
  // script, style 태그 제거
  div.querySelectorAll("script, style").forEach(el => el.remove());
  
  // 이벤트 핸들러 속성 제거 (onclick, onerror 등)
  div.querySelectorAll("*").forEach(el => {
    [...el.attributes].forEach(attr => {
      if (/^on/i.test(attr.name)) {
        el.removeAttribute(attr.name);
      }
    });
  });
  
  return div.innerHTML;
}

/**
 * URL을 안전하게 검증 및 정제
 * @param {string} url - 검증할 URL
 * @returns {string} 안전한 URL 또는 빈 문자열
 */
export function sanitizeUrl(url) {
  if (!url) return "";
  
  const allowedProtocols = ["http:", "https:", "mailto:", "tel:"];
  
  try {
    const urlObj = new URL(url, window.location.origin);
    if (allowedProtocols.includes(urlObj.protocol)) {
      return url;
    }
  } catch (e) {
    // 상대 경로 허용
    if (url.startsWith("/") || url.startsWith("./") || url.startsWith("../")) {
      return url;
    }
  }
  
  return "";
}
