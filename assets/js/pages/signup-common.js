import { signupState } from "/assets/js/features/signup/state.js";
import { updateVerificationUI, stopVerificationTimer } from "/assets/js/features/signup/verification-ui.js";

// DOM 요소 참조
export const step1 = document.getElementById("step1");
export const step2 = document.getElementById("step2");
export const step3 = document.getElementById("step3");
export const step4 = document.getElementById("step4");
export const step1Form = document.getElementById("step1Form");
export const step2Form = document.getElementById("step2Form");
export const step3Form = document.getElementById("step3Form");
export const step4Form = document.getElementById("step4Form");
export const statusMsg = document.getElementById("signupStatus");

function normalized(value) {
  return String(value || "").trim().toLowerCase();
}

function isVerifiedEmailStateCoherent() {
  const verified = signupState.verification.verified === true && signupState.isEmailVerified === true;
  if (!verified) return false;

  const verifiedEmail = normalized(signupState.verifiedEmail);
  const targetEmail = normalized(signupState.verification.targetEmail);
  const emailInput = document.getElementById("email");
  const emailInputValue = normalized(emailInput?.value);

  if (!verifiedEmail) return false;
  if (targetEmail && targetEmail !== verifiedEmail) return false;
  if (emailInput && emailInputValue && emailInputValue !== verifiedEmail) return false;
  return true;
}

function ensureVerificationReset(clearMessage = false) {
  if (window.resetEmailVerificationState) {
    window.resetEmailVerificationState();
  } else {
    signupState.resetVerification();
    updateVerificationUI();
  }

  if (clearMessage) {
    showStatus("", false);
  }
}

/**
 * 단계 이동 함수
 */
export function goToStep(step) {
  if ((step === 3 || step === 4) && !isVerifiedEmailStateCoherent()) {
    showStatus("이메일 인증이 필요합니다. 인증 단계부터 다시 진행해 주세요.", true);
    step = 2;
  }

  try {
    [step1, step2, step3, step4].forEach((s) => {
      if (s) {
        s.classList.remove("active");
        s.classList.add("hidden");
      }
    });

    const stepItems = document.querySelectorAll(".step-item");
    const stepConnectors = document.querySelectorAll(".step-connector");

    stepItems.forEach((item, index) => {
      try {
        const stepNum = index + 1;
        item.classList.remove("active", "completed");
        if (stepNum < step) {
          item.classList.add("completed");
        } else if (stepNum === step) {
          item.classList.add("active");
        }
      } catch (err) {
        console.debug("단계 표시 업데이트 오류:", err);
      }
    });

    stepConnectors.forEach((connector, index) => {
      try {
        connector.classList.remove("completed");
        if (step > index + 1) {
          connector.classList.add("completed");
        }
      } catch (err) {
        console.debug("단계 연결선 업데이트 오류:", err);
      }
    });

    showStatus("", false);

    const verificationStatus = document.getElementById("verificationStatus");
    if (verificationStatus) {
      verificationStatus.textContent = "";
      verificationStatus.style.color = "";
    }
  } catch (err) {
    console.error("goToStep 오류:", err);
    // 에러가 발생해도 기본 단계 표시는 시도
    try {
      if (step === 1 && step1) {
        step1.classList.add("active");
        step1.classList.remove("hidden");
      } else if (step === 2 && step2) {
        step2.classList.add("active");
        step2.classList.remove("hidden");
      } else if (step === 3 && step3) {
        step3.classList.add("active");
        step3.classList.remove("hidden");
      } else if (step === 4 && step4) {
        step4.classList.add("active");
        step4.classList.remove("hidden");
      }
    } catch (fallbackErr) {
      console.error("단계 표시 복구 실패:", fallbackErr);
    }
  }

  try {
    if (step === 2) {
      // 검증 상태가 불완전/불일치하면 안전하게 초기화
      if (!isVerifiedEmailStateCoherent()) {
        ensureVerificationReset();
      }
      // UI 업데이트는 updateVerificationUI()로 통합 처리
      updateVerificationUI();
    } else if (step === 1) {
      // 1단계로 이동할 때 완전히 초기화
      ensureVerificationReset(true);
    }
  } catch (step2Err) {
    console.debug("2단계 초기화 오류 (무시됨):", step2Err);
  }

  try {
    if (step === 1 && step1) {
      step1.classList.add("active");
      step1.classList.remove("hidden");
    } else if (step === 2 && step2) {
      step2.classList.add("active");
      step2.classList.remove("hidden");
    } else if (step === 3 && step3) {
      step3.classList.add("active");
      step3.classList.remove("hidden");
    } else if (step === 4 && step4) {
      step4.classList.add("active");
      step4.classList.remove("hidden");
    }

    signupState.currentStep = step;
    document.dispatchEvent(new CustomEvent("signup:stepChanged", { detail: { step } }));
    if (step === 2) {
      document.dispatchEvent(new CustomEvent("signup:step2"));
    }
    
    // 스크롤 이동도 에러 처리
    try {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (scrollErr) {
      // 스크롤 실패는 무시
      window.scrollTo(0, 0);
    }
  } catch (err) {
    console.error("단계 활성화 오류:", err);
    // 최소한 현재 단계는 업데이트
    signupState.currentStep = step;
  }
}

/**
 * 상태 메시지 표시 함수
 */
export function showStatus(message, isError) {
  if (statusMsg) {
    statusMsg.textContent = message;
    statusMsg.style.color = isError ? "var(--error-color)" : "var(--success-color)";
  }
}

/**
 * 전화번호 포맷팅 함수
 */
export function formatPhoneNumber(value) {
  const digits = value.replace(/[^\d]/g, "");
  if (digits.length <= 3) {
    return digits;
  } else if (digits.length <= 7) {
    return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  } else if (digits.length <= 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  } else {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`;
  }
}

/**
 * 전화번호 포맷팅 설정 함수
 */
export function setupPhoneFormatting() {
  try {
    document.querySelectorAll('input[type="tel"]').forEach((input) => {
      if (input.dataset.phoneFormatted) {
        return;
      }

      input.dataset.phoneFormatted = "true";
      const hint = input.parentElement?.querySelector(".phone-format-hint");

      input.addEventListener("input", (e) => {
        try {
          const value = e.target.value;
          const cursorPos = e.target.selectionStart;
          const formatted = formatPhoneNumber(value);
          e.target.value = formatted;

          // 포맷팅 힌트 표시/숨김
          if (hint) {
            if (value && value !== formatted) {
              hint.style.display = "block";
              setTimeout(() => {
                if (hint) hint.style.display = "none";
              }, 2000);
            } else {
              hint.style.display = "none";
            }
          }

          const lengthDiff = formatted.length - value.length;
          const newCursorPos = Math.max(
            0,
            Math.min(cursorPos + lengthDiff, formatted.length)
          );

          setTimeout(() => {
            try {
              e.target.setSelectionRange(newCursorPos, newCursorPos);
            } catch (err) {
              // setSelectionRange 실패는 무시 (읽기 전용 필드 등)
            }
          }, 0);
        } catch (err) {
          // 전화번호 포맷팅 오류는 무시
          console.debug("전화번호 포맷팅 오류:", err);
        }
      });

      input.addEventListener("focus", (e) => {
        // 포커스 시 힌트 표시
        if (hint && !e.target.value) {
          hint.style.display = "block";
        }
      });

      input.addEventListener("blur", (e) => {
        try {
          const formatted = formatPhoneNumber(e.target.value);
          e.target.value = formatted;
          // 포커스 해제 시 힌트 숨김
          if (hint) {
            hint.style.display = "none";
          }
        } catch (err) {
          // 전화번호 포맷팅 오류는 무시
          console.debug("전화번호 포맷팅 오류:", err);
        }
      });
    });
  } catch (err) {
    // setupPhoneFormatting 오류는 무시
    console.debug("전화번호 포맷팅 설정 오류:", err);
  }
}

/**
 * 회원가입 페이지 초기화 함수
 */
export function initializeSignupPage() {
  showStatus("", false);
  const verificationStatus = document.getElementById("verificationStatus");
  if (verificationStatus) {
    verificationStatus.textContent = "";
    verificationStatus.style.color = "";
  }
  signupState.reset();
  stopVerificationTimer();
  goToStep(1);
  updateVerificationUI();
}
