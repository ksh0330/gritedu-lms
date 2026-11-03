/**
 * Signup 검증 모듈
 * 입력 검증, 전화번호 포맷팅, 학년 변환
 */

import { validatePassword, validatePasswordConfirm } from "/assets/js/utils/validation.js";
import { normalizeGrade } from "/assets/js/utils/grade.js";

/**
 * 전화번호 포맷팅 (010-XXXX-XXXX)
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
 * 전화번호 포맷팅 설정 (input 이벤트 리스너)
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
 * 학년 계산 (생성일 기준으로 자동 증가)
 */
export function calculateGrade(grade, createdAt) {
  const gradeCode = normalizeGrade(grade);
  if (!gradeCode) {
    return "";
  }

  if (!createdAt) {
    return gradeCode;
  }

  const gradeNum = parseInt(gradeCode, 10);
  if (isNaN(gradeNum)) {
    return "";
  }

  if (createdAt && typeof createdAt.toDate === "function") {
    const now = new Date();
    const createdDate = createdAt.toDate();
    const monthsDiff =
      12 * (now.getFullYear() - createdDate.getFullYear()) +
      (now.getMonth() - createdDate.getMonth());
    const adjustedGrade = gradeNum + Math.floor(monthsDiff / 12);

    return adjustedGrade >= 1 && adjustedGrade <= 7 ? String(adjustedGrade) : "";
  }

  return gradeCode;
}

/**
 * 자녀 학년 변환 (숫자 → "중3", "고1" 등)
 */
export function convertChildGrade(grade) {
  if (!grade || grade === "") {
    return "";
  }

  if (
    typeof grade === "string" &&
    (grade.includes("중") || grade.includes("고") || grade === "졸업")
  ) {
    return grade;
  }

  const gradeNum = parseInt(grade);
  if (isNaN(gradeNum)) {
    return grade;
  }

  const gradeMap = {
    3: "중3",
    4: "고1",
    5: "고2",
    6: "고3"
  };

  return gradeMap[gradeNum] || grade;
}

/**
 * 비밀번호 검증
 */
export function validatePasswordInput(password) {
  return validatePassword(password);
}

/**
 * 비밀번호 확인 검증
 */
export function validatePasswordConfirmInput(password, passwordConfirm) {
  return validatePasswordConfirm(password, passwordConfirm);
}

/**
 * 비밀번호 형식 검증 (정규식)
 */
export function validatePasswordFormat(password) {
  return /^(?=.*[A-Za-z])(?=.*\d)(?=.*[!@#$%&*_;:,.\/?])[A-Za-z\d!@#$%&*_;:,.\/?]{8,}$/.test(
    password
  );
}
