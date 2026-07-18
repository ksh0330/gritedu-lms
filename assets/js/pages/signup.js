import { auth, db } from "/assets/js/firebase-init.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

function normalizeSignupSettings(raw = {}) {
  const enabled = raw.enabled !== false;
  return {
    enabled,
    studentEnabled: enabled && raw.studentEnabled !== false,
    memberEnabled: enabled && raw.memberEnabled !== false,
  };
}

// 회원가입 설정 확인
async function checkSignupEnabled() {
  try {
    const result = await getDoc(doc(db, "settings", "signup"));
    const settings = normalizeSignupSettings(result.exists() ? result.data() : {
      enabled: true,
      studentEnabled: true,
      memberEnabled: true,
    });

    return settings;
  } catch (error) {
    console.error("회원가입 설정 확인 실패:", error);
    // 오류 시 기본값 반환 (회원가입 활성화)
    return {
      enabled: true,
      studentEnabled: true,
      memberEnabled: true,
    };
  }
}

function renderSignupDisabled(message) {
  document.body.innerHTML = `
    <div style="display:flex;justify-content:center;align-items:center;min-height:100vh;padding:20px;">
      <div style="text-align:center;max-width:500px;">
        <h1 style="margin-bottom:16px;">회원가입 일시 중단</h1>
        <p style="color:var(--muted);margin-bottom:24px;">${message}</p>
        <a href="/members/login.html" class="btn primary" style="display:inline-block;">로그인 페이지로 이동</a>
      </div>
    </div>
  `;
}

// 이미 로그인한 사용자는 홈으로 리다이렉트
if (auth.currentUser) {
  location.href = "/";
}

// 회원가입 설정 확인 및 적용
(async () => {
  try {
    const settings = await checkSignupEnabled();
  
    // 회원가입이 비활성화되어 있으면 안내 메시지 표시
    if (settings.enabled === false) {
      renderSignupDisabled("현재 회원가입이 일시 중단되어 있습니다.");
      return;
    }
    if (settings.studentEnabled === false && settings.memberEnabled === false) {
      renderSignupDisabled("현재 선택 가능한 회원가입 유형이 없습니다. 학원에 문의해 주세요.");
      return;
    }

    // 설정을 전역 변수로 저장하여 다른 파일에서 사용할 수 있도록 함
    window.signupSettings = settings;

    // 공통 함수 및 DOM 요소 import
    const { initializeSignupPage } = await import("./signup-common.js");

    // 각 단계별 로직 import
    await import("./signup-step1.js");
    await import("./signup-step2.js");
    await import("./signup-step3.js");
    const { initStep4 } = await import("./signup-step4.js");

    // 페이지 초기화
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        initializeSignupPage();
        initStep4();
        document.dispatchEvent(new CustomEvent("signup:ready"));
      });
    } else {
      initializeSignupPage();
      initStep4();
      document.dispatchEvent(new CustomEvent("signup:ready"));
    }
  } catch (error) {
    console.error("[signup] initialization failed:", error);
    const status = document.getElementById("signupStatus");
    if (status) {
      status.textContent = "회원가입 설정을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
      status.style.color = "var(--error-color)";
    }
  }
})();
