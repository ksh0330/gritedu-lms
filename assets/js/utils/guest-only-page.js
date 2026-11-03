// /assets/js/utils/guest-only-page.js
// 로그인·회원가입처럼 비로그인 사용자 전용 화면. 이미 로그인된 사용자가 직접 주소·뒤로가기·앞으로가기·
// 새로고침·bfcache 복원으로 들어오면 폼을 보여 주지 않고 역할별 화면으로 replace 이동한다(방문 기록에 남기지 않음).
// head 인라인 스크립트가 html 에 guest-auth-checking 을 붙여 확인 중 폼을 숨기고, CSS 가 2.5초 뒤 자동으로 다시 보인다(JS 실패 대비).
import { authPersistenceReady, getCurrentUserWithWait, getDashboardUrl, getUserRole } from "/assets/js/firebase-init.js";

export const GUEST_AUTH_CHECKING_CLASS = "guest-auth-checking";

/** 같은 출처의 경로만 허용하는 next 파라미터(열린 리다이렉트 방지). */
export function getSafeNextUrl(search = location.search, origin = location.origin) {
  const raw = new URLSearchParams(search).get("next");
  if (!raw) return "";
  try {
    const target = new URL(raw, origin);
    if (target.origin !== origin || !target.pathname.startsWith("/")) return "";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "";
  }
}

/** 로그인된 사용자의 이동 대상. 비로그인·역할 없음이면 "" (화면을 그대로 보여 준다). */
export async function resolveSignedInRedirect({ getUser, getRole, getDashboard, search, origin }) {
  const user = await getUser();
  if (!user) return "";
  const role = await getRole(user);
  if (!role) return "";
  return getSafeNextUrl(search, origin) || getDashboard(role);
}

function reveal() {
  document.documentElement.classList.remove(GUEST_AUTH_CHECKING_CLASS);
}

async function checkAndRedirect() {
  try {
    await authPersistenceReady;
    const target = await resolveSignedInRedirect({
      getUser: () => getCurrentUserWithWait(),
      getRole: getUserRole,
      getDashboard: getDashboardUrl,
      search: location.search,
      origin: location.origin,
    });
    if (target) {
      location.replace(target);
      return;
    }
  } catch (error) {
    console.warn("[guest-only-page] signed-in check failed:", error?.code || error);
  }
  reveal();
}

export function initGuestOnlyPage() {
  checkAndRedirect();
  // 뒤로가기로 bfcache 에서 복원되면 스크립트가 다시 실행되지 않으므로 여기서 다시 확인한다.
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    document.documentElement.classList.add(GUEST_AUTH_CHECKING_CLASS);
    checkAndRedirect();
  });
}
