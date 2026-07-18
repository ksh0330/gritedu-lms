/**
 * 회원가입 폼 실시간 검증 모듈
 * 이름, 전화번호, 비밀번호 필드에 실시간 검증 추가
 */

import { validateName, validatePhone, formatKoreanPhone, validatePassword, validatePasswordConfirm } from "/assets/js/utils/validation.js";

/**
 * 필드 에러 표시
 */
function showFieldError(input, message) {
  clearFieldError(input);
  
  input.style.borderColor = "var(--error-color)";
  input.style.borderWidth = "2px";
  
  const errorElement = document.createElement("small");
  errorElement.className = "field-error";
  errorElement.style.color = "var(--error-color)";
  errorElement.style.display = "block";
  errorElement.style.marginTop = "4px";
  errorElement.style.fontSize = "13px";
  errorElement.textContent = message;
  
  input.parentNode.appendChild(errorElement);
}

/**
 * 필드 에러 제거
 */
function clearFieldError(input) {
  input.style.borderColor = "";
  input.style.borderWidth = "";
  
  const errorElement = input.parentNode.querySelector(".field-error");
  if (errorElement) {
    errorElement.remove();
  }
}

/**
 * 이름 입력 필드에 실시간 검증 추가
 */
function setupNameValidation() {
  const nameInputs = [
    document.getElementById("studentName"),
    document.getElementById("memberName")
  ].filter(Boolean);

  nameInputs.forEach((nameInput) => {
    nameInput.addEventListener("blur", function() {
      if (this.disabled) return;
      const validation = validateName(this.value);
      if (!validation.valid) {
        showFieldError(this, validation.message);
      } else {
        clearFieldError(this);
      }
    });

    nameInput.addEventListener("input", function() {
      clearFieldError(this);
    });
  });
}

/**
 * 비밀번호 입력 필드에 실시간 검증 추가
 */
function setupPasswordValidation() {
  const passwordInput = document.getElementById("password");
  const passwordConfirmInput = document.getElementById("passwordConfirm");
  
  // 비밀번호 검증
  if (passwordInput) {
    passwordInput.addEventListener("blur", function() {
      const validation = validatePassword(this.value);
      if (!validation.valid) {
        showFieldError(this, validation.message);
      } else {
        clearFieldError(this);
      }
      // 비밀번호 확인도 다시 검증
      if (passwordConfirmInput && passwordConfirmInput.value.trim()) {
        const confirmValidation = validatePasswordConfirm(this.value, passwordConfirmInput.value);
        if (!confirmValidation.valid) {
          showFieldError(passwordConfirmInput, confirmValidation.message);
        } else {
          clearFieldError(passwordConfirmInput);
        }
      }
    });
    
    passwordInput.addEventListener("input", function() {
      clearFieldError(this);
      // 비밀번호 입력 시 비밀번호 확인도 다시 검증
      if (passwordConfirmInput && passwordConfirmInput.value.trim()) {
        const confirmValidation = validatePasswordConfirm(this.value, passwordConfirmInput.value);
        if (!confirmValidation.valid) {
          showFieldError(passwordConfirmInput, confirmValidation.message);
        } else {
          clearFieldError(passwordConfirmInput);
        }
      }
    });
  }
  
  // 비밀번호 확인 검증
  if (passwordConfirmInput) {
    passwordConfirmInput.addEventListener("blur", function() {
      const password = passwordInput?.value || "";
      const validation = validatePasswordConfirm(password, this.value);
      if (!validation.valid) {
        showFieldError(this, validation.message);
      } else {
        clearFieldError(this);
      }
    });
    
    passwordConfirmInput.addEventListener("input", function() {
      const password = passwordInput?.value || "";
      if (password.trim()) {
        const validation = validatePasswordConfirm(password, this.value);
        if (!validation.valid && this.value.trim()) {
          showFieldError(this, validation.message);
        } else {
          clearFieldError(this);
        }
      } else {
        clearFieldError(this);
      }
    });
  }
}

/**
 * 전화번호 입력 필드에 실시간 검증 추가
 */
function setupPhoneValidation() {
  const phoneInputs = [
    document.getElementById("studentPhone"),
    document.getElementById("memberPhone")
  ].filter(Boolean);

  phoneInputs.forEach((phoneInput) => {
    phoneInput.addEventListener("blur", function() {
      if (this.disabled) return;
      const validation = validatePhone(this.value);
      if (!validation.valid) {
        showFieldError(this, validation.message);
      } else if (validation.normalized) {
        this.value = validation.normalized;
        clearFieldError(this);
      }
    });
  });
}

/**
 * 폼 제출 전 최종 검증
 */
function setupFormValidation() {
  // Step3 제출 검증/진행은 signup-step3.js가 단일 권한으로 처리한다.
  // 이 모듈은 blur/input 기반의 필드 단위 피드백만 담당한다.
}

/**
 * 초기화
 */
export function initSignupValidation() {
  // DOM이 로드된 후 실행
  const init = () => {
    setupNameValidation();
    setupPhoneValidation();
    setupPasswordValidation();
    setupFormValidation();
  };
  
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    // 3단계가 이미 표시되어 있을 수 있으므로 약간의 지연 후 초기화
    setTimeout(init, 100);
  }
}
