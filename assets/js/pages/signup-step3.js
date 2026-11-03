import { signupState } from "/assets/js/features/signup/state.js";
import { step3Form, goToStep, showStatus } from "./signup-common.js";
import {
  validateName,
  validatePhone,
  validatePassword,
  validatePasswordConfirm,
} from "/assets/js/utils/validation.js";
import { formatGrade, normalizeGrade } from "/assets/js/utils/grade.js";

const SIGNUP_GRADE_VALUES = ["1", "2", "3", "4", "5", "6", "7"];
const MEMBER_PURPOSE_LABELS = {
  parent: "학부모",
  general: "일반",
};
const MEMBER_SIGNUP_SOURCE_VALUES = ["search", "friend", "sns", "ad", "other"];

function normalized(value) {
  return String(value || "").trim().toLowerCase();
}

function getSelectedUserType() {
  if (signupState.userType === "student" || signupState.userType === "member") {
    return signupState.userType;
  }
  return "";
}

function requiresMemberSignupSource(memberPurpose) {
  return memberPurpose === "general";
}

function isVerificationStateValidForStep3() {
  const verifiedEmail = normalized(signupState.verifiedEmail);
  const targetEmail = normalized(signupState.verification.targetEmail);
  const step2EmailInput = document.getElementById("email");
  const step2EmailValue = normalized(step2EmailInput?.value);

  if (!["student", "member"].includes(signupState.userType)) return false;
  if (!signupState.isEmailVerified || !signupState.verification.verified) return false;
  if (!verifiedEmail) return false;
  if (targetEmail && targetEmail !== verifiedEmail) return false;
  if (step2EmailInput && step2EmailValue && step2EmailValue !== verifiedEmail) return false;
  return true;
}

function ensureStep3VerificationStateOrRedirect() {
  if (isVerificationStateValidForStep3()) return true;

  showStatus("이메일 인증 상태를 확인할 수 없습니다. 2단계 인증부터 다시 진행해 주세요.", true);
  goToStep(2);
  return false;
}

function displayReviewInfo() {
  const formData = new FormData(step3Form);
  const userType = getSelectedUserType();

  const emailDisplay = document.getElementById("reviewEmail");
  if (emailDisplay) emailDisplay.textContent = signupState.verifiedEmail || "";

  const userTypeDisplay = document.getElementById("reviewUserType");
  if (userTypeDisplay) userTypeDisplay.textContent = userType === "member" ? "일반 회원" : "학생";

  const nameDisplay = document.getElementById("reviewName");
  const schoolDisplay = document.getElementById("reviewSchool");
  const gradeDisplay = document.getElementById("reviewGrade");
  const phoneDisplay = document.getElementById("reviewPhone");

  if (userType === "member") {
    const memberPurpose = formData.get("memberPurpose") || "";
    if (nameDisplay) nameDisplay.textContent = formData.get("memberName") || "";
    if (schoolDisplay) schoolDisplay.textContent = MEMBER_PURPOSE_LABELS[memberPurpose] || "";
    if (gradeDisplay) gradeDisplay.textContent = "";

    const memberPhoneInput = document.getElementById("memberPhone");
    if (phoneDisplay && memberPhoneInput) {
      phoneDisplay.textContent = memberPhoneInput.value.trim() || "";
    }
  } else {
    if (nameDisplay) nameDisplay.textContent = formData.get("name") || "";
    if (schoolDisplay) schoolDisplay.textContent = formData.get("school") || "";

    const grade = normalizeGrade(formData.get("grade"));
    if (gradeDisplay) gradeDisplay.textContent = formatGrade(grade);

    const phoneInput = document.getElementById("studentPhone");
    if (phoneDisplay && phoneInput) {
      phoneDisplay.textContent = phoneInput.value.trim() || "";
    }
  }

  const studentReviewSection = document.getElementById("studentReviewSection");
  const parentReviewSection = document.getElementById("parentReviewSection");
  if (studentReviewSection) studentReviewSection.classList.toggle("hidden", userType !== "student");
  if (parentReviewSection) parentReviewSection.classList.add("hidden");
}

function validateStep3Input() {
  const formData = new FormData(step3Form);
  const userType = getSelectedUserType();
  const password = (formData.get("password") || "").trim();
  const passwordConfirm = (formData.get("passwordConfirm") || "").trim();
  const verifiedEmail = normalized(signupState.verifiedEmail);

  let name = "";
  let school = "";
  let grade = "";
  let normalizedPhone = "";
  let memberPurpose = "";
  let signupSource = "";
  let signupSourceOther = "";

  if (userType === "member") {
    name = (formData.get("memberName") || "").trim();
    memberPurpose = (formData.get("memberPurpose") || "").trim();
    signupSource = (formData.get("memberSignupSource") || "").trim();
    signupSourceOther = (formData.get("memberSignupSourceOther") || "").trim();
  } else {
    name = (formData.get("name") || "").trim();
    school = (formData.get("school") || "").trim();
    grade = normalizeGrade(formData.get("grade"));
    signupSource = (formData.get("signupSource") || "").trim();
  }

  const nameValidation = validateName(name);
  if (!nameValidation.valid) {
    return { ok: false, message: nameValidation.message };
  }

  if (userType === "student") {
    if (!school) {
      return { ok: false, message: "학교를 선택해 주세요." };
    }

    if (!SIGNUP_GRADE_VALUES.includes(grade)) {
      return { ok: false, message: "학년을 선택해 주세요." };
    }
    if (signupSource && !MEMBER_SIGNUP_SOURCE_VALUES.includes(signupSource)) {
      return { ok: false, message: "가입 경로를 선택해 주세요." };
    }
  } else if (userType === "member") {
    if (!Object.prototype.hasOwnProperty.call(MEMBER_PURPOSE_LABELS, memberPurpose)) {
      return { ok: false, message: "가입 목적을 선택해 주세요." };
    }
    if (requiresMemberSignupSource(memberPurpose) && !MEMBER_SIGNUP_SOURCE_VALUES.includes(signupSource)) {
      return { ok: false, message: "가입 경로를 선택해 주세요." };
    }
    if (requiresMemberSignupSource(memberPurpose) && signupSource === "other" && !signupSourceOther) {
      return { ok: false, message: "기타 가입 경로를 입력해 주세요." };
    }
  } else {
    return { ok: false, message: "회원 유형을 다시 선택해 주세요.", step: 1 };
  }

  const phoneInput = document.getElementById(userType === "member" ? "memberPhone" : "studentPhone");
  const phoneRaw = phoneInput
    ? phoneInput.value.trim()
    : String(formData.get(userType === "member" ? "memberPhone" : "phone") || "").trim();
  if (!phoneRaw) {
    return { ok: false, message: "전화번호를 입력해 주세요." };
  }

  const phoneValidation = validatePhone(phoneRaw);
  if (!phoneValidation.valid) {
    return { ok: false, message: "올바른 전화번호를 입력해 주세요." };
  }
  normalizedPhone = phoneValidation.normalized || phoneRaw;

  if (!password) {
    return { ok: false, message: "비밀번호를 입력해 주세요." };
  }

  const passwordValidation = validatePassword(password);
  if (!passwordValidation.valid) {
    return { ok: false, message: passwordValidation.message };
  }

  if (!passwordConfirm) {
    return { ok: false, message: "비밀번호 확인을 입력해 주세요." };
  }

  const passwordConfirmValidation = validatePasswordConfirm(password, passwordConfirm);
  if (!passwordConfirmValidation.valid) {
    return { ok: false, message: passwordConfirmValidation.message };
  }

  if (!verifiedEmail) {
    return {
      ok: false,
      message: "인증된 이메일 정보를 확인할 수 없습니다. 2단계부터 다시 진행해 주세요.",
      step: 2,
    };
  }

  return {
    ok: true,
    payload: {
      name,
      school,
      grade,
      memberPurpose,
      signupSource,
      signupSourceOther,
      verifiedEmail,
      normalizedPhone,
      userType,
    },
  };
}

if (step3Form) {
  const submitButton = document.getElementById("signupSubmitButton");
  const syncSubmitButtonState = () => {
    if (!submitButton) return;
    submitButton.disabled = !isVerificationStateValidForStep3() || !validateStep3Input().ok;
  };

  step3Form.addEventListener("input", syncSubmitButtonState);
  step3Form.addEventListener("change", syncSubmitButtonState);
  document.addEventListener("signup:stepChanged", (event) => {
    if (event.detail?.step === 3) syncSubmitButtonState();
  });

  step3Form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!ensureStep3VerificationStateOrRedirect()) return;

    const validationResult = validateStep3Input();
    if (!validationResult.ok) {
      showStatus(validationResult.message, true);
      if (validationResult.step) {
        goToStep(validationResult.step);
      }
      return;
    }

    const { grade, verifiedEmail, normalizedPhone, userType } = validationResult.payload;

    if (userType === "student") {
      const gradeSelect = document.getElementById("studentGrade");
      if (gradeSelect) gradeSelect.value = grade;

      const phoneInput = document.getElementById("studentPhone");
      if (phoneInput) phoneInput.value = normalizedPhone;

      const studentEmailInput = document.getElementById("studentEmail");
      if (studentEmailInput) studentEmailInput.value = verifiedEmail;
    } else {
      const phoneInput = document.getElementById("memberPhone");
      if (phoneInput) phoneInput.value = normalizedPhone;

      const memberEmailInput = document.getElementById("memberEmail");
      if (memberEmailInput) memberEmailInput.value = verifiedEmail;
    }

    const hiddenVerifiedEmail = document.getElementById("verifiedEmail");
    if (hiddenVerifiedEmail) hiddenVerifiedEmail.value = verifiedEmail;

    goToStep(4);
  });

  syncSubmitButtonState();
}

const step3Element = document.getElementById("step3");

if (step3Element) {
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === "attributes" && mutation.attributeName === "class") {
        if (step3Element.classList.contains("active") && !step3Element.classList.contains("hidden")) {
          if (!ensureStep3VerificationStateOrRedirect()) return;
          displayReviewInfo();
        }
      }
    });
  });

  observer.observe(step3Element, {
    attributes: true,
    attributeFilter: ["class"],
  });
}

if (step3Element && step3Element.classList.contains("active")) {
  if (ensureStep3VerificationStateOrRedirect()) {
    displayReviewInfo();
  }
}
