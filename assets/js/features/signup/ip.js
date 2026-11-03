/**
 * IP 조회 모듈
 * ipify 호출 (실패 시 null 반환, 회원가입은 계속 진행)
 */

/**
 * IP 주소 조회 (ipify)
 * @returns {Promise<string|null>} IP 주소 또는 null (실패 시)
 */
export async function fetchUserIP() {
  try {
    const response = await fetch("https://api.ipify.org?format=json", {
      method: "GET",
      headers: {
        "Accept": "application/json"
      },
      // 타임아웃 설정 (5초)
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data.ip || null;
  } catch (error) {
    // 네트워크 오류, CORS 오류, 타임아웃 등 모든 오류는 조용히 처리
    console.debug("IP 조회 실패 (무시됨):", error);
    return null;
  }
}
