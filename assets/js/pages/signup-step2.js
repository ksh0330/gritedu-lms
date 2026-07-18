import { app } from "/assets/js/firebase-init.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-functions.js";
import { signupState } from "/assets/js/features/signup/state.js";
import { updateVerificationUI, startVerificationTimer } from "/assets/js/features/signup/verification-ui.js";
import { step2Form, goToStep, showStatus, setupPhoneFormatting } from "./signup-common.js";
import { loadSchoolCsvArrayBuffer } from "/assets/js/utils/school-csv.js";

const functions = getFunctions(app, "us-central1");
const sendVerificationCodeFn = httpsCallable(functions, "sendVerificationCode");
const verifyEmailCodeFn = httpsCallable(functions, "verifyEmailCode");

function formatCallableMessage(err) {
  let m = err?.message || "오류가 발생했습니다.";
  m = m.replace(/^Firebase:\s*/, "");
  m = m.replace(/\s*\(functions\/[^)]+\)\s*\.?$/i, "").trim();
  return m || "오류가 발생했습니다.";
}

function formatSecondsToMMSS(totalSeconds) {
  const secs = Math.max(0, Number(totalSeconds) || 0);
  const mm = Math.floor(secs / 60);
  const ss = secs % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function getCallableCode(err) {
  return String(err?.code || "").toLowerCase();
}

function toFriendlyVerificationMessage(err, phase = "send") {
  const code = getCallableCode(err);
  const raw = formatCallableMessage(err);

  if (phase === "send") {
    if (code.includes("already-exists")) {
      return "이미 가입된 이메일입니다. 로그인하거나 학원으로 문의해 주세요.";
    }
    if (code.includes("invalid-argument")) {
      return "올바른 이메일 형식을 입력해 주세요.";
    }
    if (code.includes("resource-exhausted") || code.includes("too-many-requests")) {
      return raw || "재전송 요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요.";
    }
    if (code.includes("failed-precondition")) {
      return raw || "이메일 인증 요청을 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.";
    }
    if (code.includes("unavailable")) {
      return "인증 메일 발송이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.";
    }
    return raw || "인증번호 발송 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
  }

  if (code.includes("invalid-argument")) {
    return "인증번호 6자리를 정확히 입력해 주세요.";
  }
  if (code.includes("resource-exhausted") || code.includes("too-many-requests")) {
    return raw || "인증번호 입력 오류가 반복되어 인증이 잠시 제한되었습니다. 인증번호를 다시 발송해 주세요.";
  }
  if (code.includes("not-found")) {
    return "인증번호를 찾을 수 없습니다. 인증번호를 다시 발송해 주세요.";
  }
  if (code.includes("deadline-exceeded")) {
    return "인증번호가 만료되었습니다. 다시 발송해 주세요.";
  }
  if (code.includes("failed-precondition")) {
    if (raw.includes("일치")) {
      return "인증번호가 일치하지 않습니다. 다시 입력해 주세요.";
    }
    return raw || "인증번호를 다시 발송한 뒤 확인해 주세요.";
  }
  return raw || "인증번호 확인 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
}

// 약관 내용
const termsContent = {
  terms: `이 약관은 그릿에듀 웹사이트 및 온라인 학습 서비스 이용과 관련하여 회사와 이용자의 권리, 의무 및 책임사항을 정합니다.

회사는 학원 안내, 강좌 정보, 회원 계정, 온라인 강좌 수강 연결, 오프라인 반/수업 정보 확인, 학습 진도 확인 등 교육 관련 온라인 기능을 제공합니다.

회원은 타인의 정보 도용, 허위 정보 입력, 서비스 운영 방해, 콘텐츠 무단 복제 및 배포를 해서는 안 됩니다.

서비스에서 제공되는 콘텐츠는 개인 학습 목적 범위에서만 이용할 수 있으며, 무단 복제, 배포, 판매, 공유는 제한됩니다.

온라인 결제, 전용 앱, 푸시 알림, 학생별 자료실 및 회원 전용 파일 다운로드 기능은 현재 제공하지 않습니다.

자세한 내용은 사이트 하단의 이용약관에서 확인할 수 있습니다.`,
  privacy: `개인정보 수집 및 이용 동의(필수)

1. 수집 항목
- 공통: 이름, 이메일 주소, 비밀번호, 휴대전화번호, 필수 약관 동의 기록
- 학생 회원: 학교명, 학년, 가입 경로
- 일반/학부모 회원: 회원 유형 또는 가입 목적, 가입 경로
- 서비스 운영 및 보안 기록: 이메일 인증 기록, 가입 시도 기록, 접속 및 오류 기록 등

2. 수집 및 이용 목적
- 회원가입 의사 확인, 이메일 인증, 본인 식별, 로그인 및 계정 관리
- 온라인 강좌 수강 연결, 오프라인 반/수업 정보 확인, 학습 현황 관리
- 학부모 회원의 자녀 연결 및 연결 자녀 학습 현황 확인
- 문의 응대, 공지 전달, 서비스 운영 및 부정 이용 방지

3. 보유 및 이용 기간
회원 계정 정보는 회원 탈퇴 또는 이용계약 종료 시까지 보관합니다. 단, 관계 법령, 분쟁 대응, 부정 이용 방지 등 정당한 보존 사유가 있는 정보는 해당 사유가 종료될 때까지 보관할 수 있습니다.

4. 동의 거부 권리
개인정보 수집 및 이용에 동의하지 않을 권리가 있습니다. 다만 필수 항목에 동의하지 않으면 회원가입과 서비스 이용이 제한됩니다.

자세한 내용은 개인정보처리방침에서 확인할 수 있습니다.`
,
  marketing: `광고성 정보 수신 동의(선택)

광고성 정보 수신 동의는 선택이며, 동의하지 않아도 회원가입과 온라인 학습 서비스 이용에는 제한이 없습니다.
동의한 경우 학원 소식, 신규 강좌, 설명회, 이벤트, 입시 및 학습 정보, 상담 안내를 문자 또는 이메일로 받을 수 있습니다.
동의는 학생/회원 대시보드의 광고성 정보 수신 설정 화면 또는 학원 문의를 통해 철회할 수 있습니다.
현재 가입 화면에서는 문자와 이메일 수신 동의가 함께 적용됩니다.`
};

// 약관 보기 버튼 이벤트
document.querySelectorAll(".terms-view-btn").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    const termsType = btn.getAttribute("data-terms");
    const content = document.querySelector(
      `.terms-item-content[data-terms="${termsType}"]`
    );

    if (content) {
      if (!content.textContent.trim()) {
        content.textContent = termsContent[termsType] || "약관 내용이 없습니다.";
      }

      if (content.classList.contains("hidden")) {
        document.querySelectorAll(".terms-item-content").forEach((c) => {
          if (c !== content) {
            c.classList.add("hidden");
          }
        });

        document.querySelectorAll(".terms-view-btn").forEach((b) => {
          if (b !== btn) {
            b.textContent = "보기";
          }
        });

        content.classList.remove("hidden");
        btn.textContent = "닫기";
      } else {
        content.classList.add("hidden");
        btn.textContent = "보기";
      }
    }
  });
});

// 약관 동의 체크박스 처리
const agreeAll = document.getElementById("agreeAll");
const agreeTerms = document.getElementById("agreeTerms");
const agreePrivacy = document.getElementById("agreePrivacy");
const agreeMarketing = document.getElementById("agreeMarketing");

function syncAgreeAllCheckbox() {
  if (!agreeAll || !agreeTerms || !agreePrivacy) return;
  const optionalMarketingChecked = agreeMarketing?.checked === true;
  agreeAll.checked = agreeTerms.checked && agreePrivacy.checked && optionalMarketingChecked;
  agreeAll.indeterminate = !agreeAll.checked && (agreeTerms.checked || agreePrivacy.checked || optionalMarketingChecked);
}

if (agreeAll) {
  agreeAll.addEventListener("change", (e) => {
    agreeAll.indeterminate = false;
    agreeTerms.checked = e.target.checked;
    agreePrivacy.checked = e.target.checked;
    if (agreeMarketing) {
      agreeMarketing.checked = e.target.checked;
      agreeMarketing.indeterminate = false;
    }
  });

  [agreeTerms, agreePrivacy].forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      syncAgreeAllCheckbox();
    });
  });
}

if (agreeMarketing) {
  agreeMarketing.addEventListener("change", () => {
    agreeMarketing.indeterminate = false;
    syncAgreeAllCheckbox();
  });
}

/**
 * 이메일이 Firebase Auth에 이미 등록되어 있는지 확인
 * (fetchSignInMethodsForEmail은 열거 방지/제공자 제한으로 누락될 수 있어 Admin과 동일한 Callable 사용)
 */
function setStep2SubmitPending(isPending) {
  isStep2SubmitInFlight = isPending;
  const submitBtn = step2Form?.querySelector('button[type="submit"]');
  if (!submitBtn) return;

  if (!submitBtn.dataset.defaultText) {
    submitBtn.dataset.defaultText = submitBtn.textContent || "";
  }

  if (isPending) {
    submitBtn.disabled = true;
    submitBtn.style.pointerEvents = "none";
    submitBtn.textContent = `${submitBtn.dataset.defaultText}...`;
    const backBtn = document.getElementById("backToStep1");
    if (backBtn) backBtn.disabled = true;
    return;
  }

  submitBtn.disabled = false;
  submitBtn.style.pointerEvents = "auto";
  submitBtn.textContent = submitBtn.dataset.defaultText;
  const backBtn = document.getElementById("backToStep1");
  if (backBtn) backBtn.disabled = false;
}

function setStep2SubmitDisabled(disabled) {
  const submitBtn = step2Form?.querySelector('button[type="submit"]');
  if (!submitBtn) return;
  submitBtn.disabled = disabled;
  submitBtn.style.pointerEvents = disabled ? "none" : "auto";
}

function setBackToStep1Disabled(disabled) {
  const backBtn = document.getElementById("backToStep1");
  if (backBtn) backBtn.disabled = disabled;
}

function isVerificationBusy() {
  return signupState.verification.isSending || signupState.verification.isVerifying;
}

function syncStep2InteractionLock() {
  const locked = isVerificationBusy();
  setStep2SubmitDisabled(locked);
  setBackToStep1Disabled(locked);
}

function setVerificationSending(isSending) {
  signupState.verification.isSending = isSending;
  syncStep2InteractionLock();
}

function setVerificationChecking(isChecking) {
  signupState.verification.isVerifying = isChecking;
  syncStep2InteractionLock();
}

function resetEmailVerificationState(options = {}) {
  const { clearEmailInput = true, clearStatusMessage = true } = options;

  isStep2SubmitInFlight = false;
  signupState.resetVerification();

  if (verificationCodeGroup) {
    verificationCodeGroup.classList.add("hidden");
  }
  if (verificationCodeInput) {
    verificationCodeInput.value = "";
    verificationCodeInput.disabled = false;
    verificationCodeInput.readOnly = false;
    verificationCodeInput.style.backgroundColor = "";
  }

  const emailInput = document.getElementById("email");
  if (emailInput) {
    if (clearEmailInput) {
      emailInput.value = "";
    }
    emailInput.disabled = false;
    emailInput.readOnly = false;
  }

  const sendBtnSpinner = sendVerificationBtn?.querySelector(".send-btn-spinner");
  const verifyBtnSpinner = verifyCodeBtn?.querySelector(".verify-btn-spinner");
  const sendBtnTimer = document.querySelector(".send-btn-timer");
  if (sendBtnSpinner) sendBtnSpinner.classList.add("hidden");
  if (verifyBtnSpinner) verifyBtnSpinner.classList.add("hidden");
  if (sendBtnTimer) {
    sendBtnTimer.classList.add("hidden");
    sendBtnTimer.textContent = "";
    sendBtnTimer.dataset.state = "";
  }

  if (clearStatusMessage && verificationStatus) {
    verificationStatus.textContent = "";
    verificationStatus.style.color = "";
  }

  syncStep2InteractionLock();
  updateVerificationUI();
}

// 이메일 인증번호 발송 및 검증 (Cloud Functions)
const sendVerificationBtn = document.getElementById("sendVerificationBtn");
const verifyCodeBtn = document.getElementById("verifyCodeBtn");
const verificationCodeGroup = document.getElementById("verificationCodeGroup");
const verificationStatus = document.getElementById("verificationStatus");
const verificationCodeInput = document.getElementById("verificationCode");
const emailInput = document.getElementById("email");
let autoAdvanceTimerId = null;
let isStep2SubmitInFlight = false;

function setSendStatusMessage(message = "", isError = false) {
  const sendStatus = document.querySelector(".send-btn-timer");
  if (!sendStatus) {
    showStatus(message, isError);
    return;
  }

  if (!message) {
    sendStatus.textContent = "";
    sendStatus.dataset.state = "";
    sendStatus.style.color = "";
    sendStatus.classList.add("hidden");
    return;
  }

  sendStatus.textContent = message;
  sendStatus.dataset.state = isError ? "error" : "info";
  sendStatus.style.color = isError
    ? "var(--error-color)"
    : "var(--info-color, var(--text-secondary))";
  sendStatus.classList.remove("hidden");
}

function showStep2Error(message) {
  const shouldUseCodeStatus =
    verificationCodeGroup && !verificationCodeGroup.classList.contains("hidden");

  if (shouldUseCodeStatus && verificationStatus) {
    verificationStatus.textContent = message;
    verificationStatus.style.color = "var(--error-color)";
    showStatus("", false);
    return;
  }

  setSendStatusMessage(message, true);
  showStatus("", false);
}

window.resetEmailVerificationState = function resetEmailVerificationStateGlobal() {
  resetEmailVerificationState({ clearEmailInput: true, clearStatusMessage: true });
};

if (emailInput) {
  emailInput.addEventListener("input", () => {
    if (signupState.verification.verified) return;

    const targetEmail = (signupState.verification.targetEmail || "").trim().toLowerCase();
    const currentEmail = emailInput.value.trim().toLowerCase();
    if (!targetEmail) return;
    if (currentEmail === targetEmail) return;

    resetEmailVerificationState({ clearEmailInput: false, clearStatusMessage: false });
    if (verificationStatus) {
      verificationStatus.textContent = "이메일이 변경되었습니다. 인증번호를 다시 발송해 주세요.";
      verificationStatus.style.color = "var(--info-color, var(--text-secondary))";
    }
  });
}

if (verificationCodeInput) {
  verificationCodeInput.addEventListener("input", () => updateVerificationUI());
}

if (sendVerificationBtn) {
  sendVerificationBtn.addEventListener("click", async () => {
    if (signupState.verification.verified || isVerificationBusy() || isStep2SubmitInFlight) {
      return;
    }

    const disabledMessage = getSignupDisabledMessage(getSelectedUserType());
    if (disabledMessage) {
      showStep2Error(disabledMessage);
      goToStep(1);
      return;
    }
    const signupType = getSelectedUserType();
    if (signupType !== "student" && signupType !== "member") {
      showStep2Error("회원 유형을 다시 선택해 주세요.");
      goToStep(1);
      return;
    }
    signupState.userType = signupType;

    const emailRaw = document.getElementById("email")?.value.trim();
    if (!emailRaw) {
      showStep2Error("이메일을 입력해 주세요.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
      showStep2Error("올바른 이메일 형식을 입력해 주세요.");
      return;
    }
    const normalizedEmail = emailRaw.toLowerCase();
    if (autoAdvanceTimerId) {
      clearTimeout(autoAdvanceTimerId);
      autoAdvanceTimerId = null;
    }

    if (
      signupState.verification.sentAt &&
      !signupState.verification.verified &&
      !signupState.canResend()
    ) {
      const remainingSeconds = signupState.getResendRemainingTime();
      const waiting = formatSecondsToMMSS(remainingSeconds);
      const msg = `인증번호 재발송은 1분 간격으로 가능합니다. ${waiting} 후 다시 시도해 주세요.`;
      setSendStatusMessage(msg, false);
      showStatus("", false);
      updateVerificationUI();
      return;
    }

    const previousTarget = (signupState.verification.targetEmail || "").trim().toLowerCase();
    if (previousTarget && previousTarget !== normalizedEmail) {
      resetEmailVerificationState({ clearEmailInput: false, clearStatusMessage: false });
    }

    const sendBtnText = sendVerificationBtn.querySelector(".send-btn-text");
    const sendBtnSpinner = sendVerificationBtn.querySelector(".send-btn-spinner");
    setVerificationSending(true);
    sendVerificationBtn.disabled = true;
    if (sendBtnText) sendBtnText.textContent = "발송 중...";
    if (sendBtnSpinner) sendBtnSpinner.classList.remove("hidden");
    setSendStatusMessage("인증번호를 발송하고 있습니다.", false);
    showStatus("", false);

    try {
      await sendVerificationCodeFn({
        email: normalizedEmail,
        signupType,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent || "unknown" : "unknown",
      });

      signupState.verifiedEmail = null;
      signupState.isEmailVerified = false;
      if (verificationCodeGroup) {
        verificationCodeGroup.classList.remove("hidden");
      }
      if (verificationCodeInput) {
        verificationCodeInput.value = "";
        verificationCodeInput.disabled = false;
        try {
          verificationCodeInput.focus();
        } catch (_) {}
      }

      startVerificationTimer(normalizedEmail);

      if (verificationStatus) {
        verificationStatus.textContent =
          "인증번호를 이메일로 발송했습니다. 수신까지 1~3분 정도 소요될 수 있으니 메일함과 스팸함을 확인해 주세요.";
        verificationStatus.style.color = "var(--success-color)";
      }
      setSendStatusMessage("", false);
      showStatus("", false);
    } catch (err) {
      console.error("[signup-step2] sendVerificationCode failed:", {
        code: err?.code,
        message: err?.message
      });
      const message = toFriendlyVerificationMessage(err, "send");
      setSendStatusMessage(message || "인증번호 발송 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", true);
      showStatus("", false);
    } finally {
      if (sendBtnSpinner) sendBtnSpinner.classList.add("hidden");
      setVerificationSending(false);
      updateVerificationUI();
    }
  });
} else {
  console.error("[signup-step2] send verification button not found");
  showStep2Error("회원가입 인증 화면을 초기화하지 못했습니다. 새로고침 후 다시 시도해 주세요.");
}

if (verifyCodeBtn) {
  verifyCodeBtn.addEventListener("click", async () => {
    if (signupState.verification.verified || isVerificationBusy() || isStep2SubmitInFlight) return;

    const email = document.getElementById("email")?.value.trim().toLowerCase();
    const code = (document.getElementById("verificationCode")?.value.trim()) || "";

    if (!email) {
      showStep2Error("이메일을 입력해 주세요.");
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      if (verificationStatus) {
        verificationStatus.textContent = "인증번호 6자리를 입력해 주세요.";
        verificationStatus.style.color = "var(--error-color)";
      }
      return;
    }

    const targetEmail = (signupState.verification.targetEmail || "").trim().toLowerCase();
    if (targetEmail && targetEmail !== email) {
      const msg = "인증번호를 발송한 이메일과 현재 입력한 이메일이 다릅니다. 다시 발송해 주세요.";
      if (verificationStatus) {
        verificationStatus.textContent = msg;
        verificationStatus.style.color = "var(--error-color)";
      }
      showStatus("", false);
      return;
    }

    const verifyBtnSpinner = verifyCodeBtn.querySelector(".verify-btn-spinner");
    setVerificationChecking(true);
    verifyCodeBtn.disabled = true;
    if (verifyBtnSpinner) verifyBtnSpinner.classList.remove("hidden");
    if (verificationStatus) {
      verificationStatus.textContent = "인증번호를 확인하고 있습니다...";
      verificationStatus.style.color = "var(--info-color, var(--text-secondary))";
    }

    let shouldAutoAdvance = false;

    try {
      await verifyEmailCodeFn({ email, code });
      signupState.verifiedEmail = email;
      signupState.isEmailVerified = true;
      signupState.setVerificationVerified();
      if (verificationStatus) {
        verificationStatus.textContent = "이메일 인증이 완료되었습니다. 잠시 후 다음 단계로 이동합니다.";
        verificationStatus.style.color = "var(--success-color)";
      }
      showStatus("", false);
      shouldAutoAdvance = !!(agreeTerms.checked && agreePrivacy.checked);
      if (!shouldAutoAdvance) {
        showStatus("이메일 인증이 완료되었습니다. 필수 약관 동의 후 다음 단계로 이동해 주세요.", false);
      }
    } catch (err) {
      console.error(err);
      const code = getCallableCode(err);
      const message = toFriendlyVerificationMessage(err, "verify");
      if (verificationStatus) {
        verificationStatus.textContent = message;
        verificationStatus.style.color = "var(--error-color)";
      }
      showStatus("", false);
      if (code.includes("resource-exhausted")) {
        if (verificationCodeInput) {
          verificationCodeInput.value = "";
        }
        if (verificationStatus) {
          verificationStatus.textContent = `${message} 인증번호를 다시 발송한 뒤 진행해 주세요.`;
          verificationStatus.style.color = "var(--error-color)";
        }
      }
    } finally {
      if (verifyBtnSpinner) verifyBtnSpinner.classList.add("hidden");
      setVerificationChecking(false);
      updateVerificationUI();

      if (shouldAutoAdvance && step2Form && signupState.verification.verified) {
        if (autoAdvanceTimerId) {
          clearTimeout(autoAdvanceTimerId);
        }
        autoAdvanceTimerId = setTimeout(() => {
          if (signupState.verification.verified && !isVerificationBusy()) {
            step2Form.requestSubmit();
          }
        }, 250);
      }
    }
  });
}

// Step 2 폼 제출 처리 (약관 동의 + 이메일 인증 + 정보 입력)
function normalizeSignupType(value) {
  if (value === "student") return "student";
  if (value === "member" || value === "parent" || value === "general") return "member";
  return "";
}

function getSelectedUserType() {
  const stateType = normalizeSignupType(signupState.userType);
  if (stateType) return stateType;

  const checkedInput = document.querySelector('input[name="userType"]:checked');
  const checkedType = normalizeSignupType(checkedInput?.value);
  if (checkedType) return checkedType;

  const hiddenType = normalizeSignupType(document.getElementById("userType")?.value);
  if (hiddenType) return hiddenType;

  return "";
}

function syncStep2UserTypeLabel() {
  const label = document.getElementById("step2UserTypeLabel");
  if (!label) return;

  const userType = getSelectedUserType();
  if (userType === "student") {
    label.textContent = "학생 ";
  } else if (userType === "member") {
    label.textContent = "일반 ";
  } else {
    label.textContent = "";
  }
}

function getSignupSettings() {
  return window.signupSettings || {
    enabled: true,
    studentEnabled: true,
    memberEnabled: true,
  };
}

function getSignupDisabledMessage(userType) {
  const settings = getSignupSettings();
  if (userType !== "student" && userType !== "member") return "회원 유형을 다시 선택해 주세요.";
  if (settings.enabled === false) return "현재 회원가입이 일시 중단되어 있습니다.";
  if (userType === "student" && settings.studentEnabled === false) {
    return "현재 학생 회원가입이 일시 중단되어 있습니다.";
  }
  if (userType === "member" && settings.memberEnabled === false) {
    return "현재 학부모/일반 회원가입이 일시 중단되어 있습니다.";
  }
  return "";
}

function setFieldsEnabled(containerId, enabled) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.classList.toggle("hidden", !enabled);
  container.querySelectorAll("input, select, textarea, button").forEach((field) => {
    field.disabled = !enabled;
  });
}

function syncMemberSignupSourceFields() {
  const purpose = document.getElementById("memberPurpose")?.value || "";
  const sourceGroup = document.getElementById("memberSignupSourceGroup");
  const sourceSelect = document.getElementById("memberSignupSource");
  const sourceOtherGroup = document.getElementById("memberSignupSourceOtherGroup");
  const sourceOtherInput = document.getElementById("memberSignupSourceOther");
  const needsSignupSource = purpose === "general";
  const needsSourceOther = needsSignupSource && sourceSelect?.value === "other";

  if (sourceGroup && sourceSelect) {
    sourceGroup.classList.toggle("hidden", !needsSignupSource);
    sourceSelect.disabled = !needsSignupSource;
    sourceSelect.required = needsSignupSource;
    if (!needsSignupSource) sourceSelect.value = "";
  }

  if (sourceOtherGroup && sourceOtherInput) {
    sourceOtherGroup.classList.toggle("hidden", !needsSourceOther);
    sourceOtherInput.disabled = !needsSourceOther;
    sourceOtherInput.required = needsSourceOther;
    if (!needsSourceOther) sourceOtherInput.value = "";
  }
}

function syncStep3FieldsForUserType(userType) {
  const isMember = userType === "member";
  setFieldsEnabled("studentFields", !isMember);
  setFieldsEnabled("memberFields", isMember);

  if (isMember) {
    const memberEmailInput = document.getElementById("memberEmail");
    if (memberEmailInput) memberEmailInput.value = signupState.verifiedEmail || "";
    syncMemberSignupSourceFields();
  } else {
    const studentEmailInput = document.getElementById("studentEmail");
    if (studentEmailInput) studentEmailInput.value = signupState.verifiedEmail || "";
  }

  const ut = document.getElementById("userType");
  if (ut) ut.value = userType;
}

document.getElementById("memberPurpose")?.addEventListener("change", syncMemberSignupSourceFields);
document.getElementById("memberSignupSource")?.addEventListener("change", syncMemberSignupSourceFields);
document.addEventListener("signup:userTypeChanged", syncStep2UserTypeLabel);
document.addEventListener("signup:ready", syncStep2UserTypeLabel);
document.addEventListener("signup:step2", syncStep2UserTypeLabel);
syncStep2UserTypeLabel();

const step2Container = document.getElementById("step2");
if (step2Container) {
  const step2Observer = new MutationObserver(() => {
    if (step2Container.classList.contains("active")) {
      syncStep2UserTypeLabel();
    }
  });
  step2Observer.observe(step2Container, { attributes: true, attributeFilter: ["class"] });
}

if (step2Form) {
  step2Form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (isVerificationBusy()) {
      showStep2Error("이메일 인증 처리 중입니다. 잠시만 기다려 주세요.");
      return;
    }

    // 약관 동의 확인
    if (!agreeTerms.checked || !agreePrivacy.checked) {
      showStep2Error("필수 약관에 동의해 주세요.");
      return;
    }

    if (!signupState.isEmailVerified) {
      showStep2Error("이메일 인증번호를 발송한 뒤, 인증을 완료해 주세요.");
      return;
    }

    const email = signupState.verifiedEmail;
    if (!email) {
      showStep2Error("이메일을 입력해 주세요.");
      return;
    }

    // 3단계 진입 전 이메일 중복 체크 강화
    setStep2SubmitPending(true);

    try {
      document.getElementById("verifiedEmail").value = email;

      // 회원가입 설정 확인
      const userType = getSelectedUserType();
      const disabledMessage = getSignupDisabledMessage(userType);
      if (disabledMessage) {
        showStatus(disabledMessage, true);
        goToStep(1);
        return;
      }
      signupState.userType = userType;

      syncStep3FieldsForUserType(userType);

      // Step 2에서는 약관 동의와 이메일 인증만 확인하고 Step 3로 이동
      // 정보 입력은 Step 2 화면에서 계속 진행되지만, 검증은 Step 3에서 수행
      goToStep(3);
      setTimeout(() => {
        setupPhoneFormatting();
      }, 100);
    } catch (error) {
      console.error("3단계 진입 전 검증 실패:", error);
      showStep2Error("오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setStep2SubmitPending(false);
    }
  });
}

// 이전 단계로 돌아가기 버튼
const backToStep1 = document.getElementById("backToStep1");
if (backToStep1) {
  backToStep1.addEventListener("click", () => {
    if (autoAdvanceTimerId) {
      clearTimeout(autoAdvanceTimerId);
      autoAdvanceTimerId = null;
    }
    goToStep(1);
  });
}

// 학교 검색 기능 (학생용)
let schoolList = [];
const SCHOOL_CSV_HEADERS = {
  name: "학교명",
  type: "학교급",
  address: "주소",
};

let currentSchoolInputId = null;
const schoolSearchState = {
  currentPage: 1,
  itemsPerPage: 20,
  totalResults: 0,
  currentResults: []
};

function parseCsvRow(row) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < row.length; i += 1) {
    const char = row[i];

    if (char === '"') {
      if (inQuotes && row[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function scoreDecodedSchoolCsv(text) {
  if (!text || !text.trim()) return Number.NEGATIVE_INFINITY;

  let score = 0;
  if (text.includes("학교명")) score += 40;
  if (text.includes("학교급")) score += 20;
  if (text.includes("주소")) score += 20;

  const replacementCount = (text.match(/�/g) || []).length;
  score -= replacementCount * 5;

  return score;
}

function decodeSchoolCsvText(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const candidates = ["euc-kr", "utf-8"];

  let bestText = "";
  let bestScore = Number.NEGATIVE_INFINITY;

  candidates.forEach((encoding) => {
    try {
      const decoded = new TextDecoder(encoding).decode(bytes);
      const score = scoreDecodedSchoolCsv(decoded);
      if (score > bestScore) {
        bestScore = score;
        bestText = decoded;
      }
    } catch (_) {
      // Unsupported encoding in this browser/runtime: ignore and try next.
    }
  });

  if (!bestText) {
    bestText = new TextDecoder("utf-8").decode(bytes);
  }

  return bestText.replace(/^\uFEFF/, "");
}

function createHeaderIndexMap(headerColumns) {
  const map = {};
  headerColumns.forEach((header, index) => {
    const key = String(header || "").replace(/^\uFEFF/, "").trim();
    if (key) map[key] = index;
  });
  return map;
}

function getColumnValue(columns, headerIndexMap, headerName) {
  const index = headerIndexMap[headerName];
  if (!Number.isInteger(index)) return "";
  return String(columns[index] || "").trim();
}

function buildSchoolRecord(columns, headerIndexMap) {
  const name = getColumnValue(columns, headerIndexMap, SCHOOL_CSV_HEADERS.name);
  if (!name) return null;

  const schoolType = getColumnValue(columns, headerIndexMap, SCHOOL_CSV_HEADERS.type);
  const address = getColumnValue(columns, headerIndexMap, SCHOOL_CSV_HEADERS.address);
  const displayInfo = [schoolType, address]
    .filter(Boolean)
    .join(" | ");

  return {
    name,
    schoolType,
    address,
    displayInfo,
  };
}

async function initSchoolSearchForStep2() {
  try {
    const buffer = await loadSchoolCsvArrayBuffer();
    const csvText = decodeSchoolCsvText(buffer);
    const rows = csvText.split(/\r?\n/).filter((line) => line.trim());

    if (rows.length <= 1) {
      schoolList = [];
      return;
    }

    const headerColumns = parseCsvRow(rows[0]);
    const headerIndexMap = createHeaderIndexMap(headerColumns);

    schoolList = [];
    for (let i = 1; i < rows.length; i += 1) {
      const row = rows[i].trim();
      if (!row) continue;

      const columns = parseCsvRow(row);
      const school = buildSchoolRecord(columns, headerIndexMap);
      if (school) schoolList.push(school);
    }
  } catch (error) {
    console.error("학교 목록 로드 실패:", error);
  }
}

function searchSchools(query) {
  if (!query || query.trim().length < 1) {
    return [];
  }

  const searchTerm = query.trim().toLowerCase();
  return schoolList.filter((school) => {
    const schoolName = String(school.name || "").toLowerCase();
    return schoolName.includes(searchTerm);
  });
}

function decodeHtmlEntity(html) {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = html;
  return textarea.value;
}

function renderSearchResults(query, page = 1) {
  const resultsContainer = document.getElementById("schoolSearchResults");
  if (!resultsContainer) return;

  if (!query || query.trim().length < 1) {
    schoolSearchState.currentPage = 1;
    schoolSearchState.totalResults = 0;
    schoolSearchState.currentResults = [];
    resultsContainer.innerHTML =
      '<div class="school-search-empty">검색어를 입력해 주세요.</div>';
    return;
  }

  const results = searchSchools(query);
  schoolSearchState.totalResults = results.length;
  schoolSearchState.currentPage = page;

  if (results.length === 0) {
    schoolSearchState.currentResults = [];
    resultsContainer.innerHTML = `
      <div class="school-search-empty">
        검색 결과가 없습니다.<br>
        아래 "직접 입력" 버튼을 눌러 학교명을 직접 입력하세요.
      </div>
    `;
    return;
  }

  const start = (page - 1) * schoolSearchState.itemsPerPage;
  const end = start + schoolSearchState.itemsPerPage;
  const pageResults = results.slice(start, end);
  schoolSearchState.currentResults = pageResults;

  const totalPages = Math.ceil(results.length / schoolSearchState.itemsPerPage);
  let html = "";

  pageResults.forEach((school, index) => {
    const escapedName = school.name.replace(/'/g, "&#39;").replace(/"/g, "&quot;");
    html += `
      <div class="school-search-item" data-school="${escapedName}" data-index="${start + index}">
        <div class="school-search-item-name">${school.name}</div>
        <div class="school-search-item-info">${school.displayInfo}</div>
      </div>
    `;
  });

  if (totalPages > 1) {
    html += '<div class="school-search-pagination">';

    if (page > 1) {
      html += `<button type="button" class="school-search-page-btn" data-page="${page - 1}">이전</button>`;
    }

    const maxVisible = 5;
    let startPage = Math.max(1, page - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);

    if (endPage - startPage < maxVisible - 1) {
      startPage = Math.max(1, endPage - maxVisible + 1);
    }

    if (startPage > 1) {
      html += `<button type="button" class="school-search-page-btn" data-page="1">1</button>`;
      if (startPage > 2) {
        html += '<span class="school-search-page-ellipsis">...</span>';
      }
    }

    for (let i = startPage; i <= endPage; i++) {
      html +=
        i === page
          ? `<button type="button" class="school-search-page-btn active" data-page="${i}">${i}</button>`
          : `<button type="button" class="school-search-page-btn" data-page="${i}">${i}</button>`;
    }

    if (endPage < totalPages) {
      if (endPage < totalPages - 1) {
        html += '<span class="school-search-page-ellipsis">...</span>';
      }
      html += `<button type="button" class="school-search-page-btn" data-page="${totalPages}">${totalPages}</button>`;
    }

    if (page < totalPages) {
      html += `<button type="button" class="school-search-page-btn" data-page="${page + 1}">다음</button>`;
    }

    html += "</div>";
    html += `<div class="school-search-pagination-info">총 ${results.length}개 결과 (${page}/${totalPages} 페이지)</div>`;
  }

  resultsContainer.innerHTML = html;

  resultsContainer.querySelectorAll(".school-search-item").forEach((item, index) => {
    item.addEventListener("click", () => {
      const schoolName = item.getAttribute("data-school");
      selectSchool(schoolName);
    });

    item.addEventListener("mouseenter", () => {
      selectedSchoolIndex = index;
      const items = resultsContainer.querySelectorAll(".school-search-item");
      updateSchoolSelection(items);
    });
  });

  resultsContainer.querySelectorAll(".school-search-page-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const pageNum = parseInt(btn.getAttribute("data-page"));
      if (pageNum && pageNum !== page) {
        renderSearchResults(query, pageNum);
        resultsContainer.scrollTop = 0;
      }
    });
  });
}

let selectedSchoolIndex = -1;

function initSchoolSearchModal() {
  const searchInput = document.getElementById("schoolSearchInput");
  if (!searchInput) return;

  let timeout;
  searchInput.setAttribute("lang", "ko");

  searchInput.addEventListener("input", (e) => {
    const value = e.target.value;
    clearTimeout(timeout);
    selectedSchoolIndex = -1;
    timeout = setTimeout(() => {
      renderSearchResults(value);
    }, 100);
  });

  renderSearchResults("");

  searchInput.addEventListener("keydown", (e) => {
    const items = document.querySelectorAll(".school-search-item");
    
    if (e.key === "Enter") {
      e.preventDefault();
      if (selectedSchoolIndex >= 0 && items[selectedSchoolIndex]) {
        const schoolName = items[selectedSchoolIndex].getAttribute("data-school");
        if (schoolName) {
          selectSchool(schoolName);
        }
      } else {
        const firstItem = items[0];
        if (firstItem) {
          const schoolName = firstItem.getAttribute("data-school");
          if (schoolName) {
            selectSchool(schoolName);
          }
        }
      }
    } else if (e.key === "Escape") {
      closeSchoolSearchModal();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (items.length > 0) {
        selectedSchoolIndex = Math.min(selectedSchoolIndex + 1, items.length - 1);
        updateSchoolSelection(items);
        items[selectedSchoolIndex]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length > 0) {
        selectedSchoolIndex = Math.max(selectedSchoolIndex - 1, -1);
        updateSchoolSelection(items);
        if (selectedSchoolIndex >= 0) {
          items[selectedSchoolIndex]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
      }
    }
  });
}

function updateSchoolSelection(items) {
  items.forEach((item, index) => {
    if (index === selectedSchoolIndex) {
      item.style.backgroundColor = "var(--hover)";
      item.style.borderColor = "var(--brand)";
      item.style.borderWidth = "2px";
    } else {
      item.style.backgroundColor = "";
      item.style.borderColor = "";
      item.style.borderWidth = "";
    }
  });
}

async function initSchoolSearch() {
  await initSchoolSearchForStep2();
  initSchoolSearchModal();
}

window.openSchoolSearchModal = function (inputId) {
  currentSchoolInputId = inputId;

  const modal = document.getElementById("schoolSearchModal");
  const searchInput = document.getElementById("schoolSearchInput");
  const resultsContainer = document.getElementById("schoolSearchResults");

  if (modal && searchInput) {
    modal.classList.remove("hidden");
    searchInput.value = "";
    searchInput.setAttribute("lang", "ko");

    if (resultsContainer) {
      resultsContainer.innerHTML =
        '<div class="school-search-empty">검색어를 입력해 주세요.</div>';
    }

    setTimeout(() => {
      searchInput.focus();
      if (searchInput.setSelectionRange) {
        searchInput.setSelectionRange(0, 0);
      }
    }, 100);
  }
};

window.closeSchoolSearchModal = function () {
  const modal = document.getElementById("schoolSearchModal");
  if (modal) {
    modal.classList.add("hidden");
    currentSchoolInputId = null;
  }
};

window.selectDirectInput = function () {
  if (!currentSchoolInputId) return;

  const input = document.getElementById(currentSchoolInputId);
  if (input) {
    input.removeAttribute("readonly");
    input.style.cursor = "text";
    input.focus();
    closeSchoolSearchModal();
  }
};

window.selectSchool = function (schoolName) {
  if (!currentSchoolInputId) return;

  const input = document.getElementById(currentSchoolInputId);
  if (input) {
    const decodedName = decodeHtmlEntity(schoolName);
    input.value = decodedName;
    input.removeAttribute("readonly");
    input.style.cursor = "text";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    closeSchoolSearchModal();
  }
};

// 학교 검색 초기화
initSchoolSearch();

// 약관 동의 상태를 export하여 다른 단계에서 사용할 수 있도록 함
export { agreeTerms, agreePrivacy, agreeMarketing };

