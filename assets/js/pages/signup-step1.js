import { signupState } from "/assets/js/features/signup/state.js";
import { step1Form, goToStep, showStatus } from "./signup-common.js";

function step1UserTypeInput() {
  return step1Form?.querySelector('input[name="userType"]:checked');
}

function step1NextButton() {
  return document.getElementById("step1NextButton") || step1Form?.querySelector('button[type="submit"]');
}

function getSignupSettings() {
  return window.signupSettings || {
    enabled: true,
    studentEnabled: true,
    memberEnabled: true,
  };
}

function isSupportedUserType(userType) {
  return userType === "student" || userType === "member";
}

function getDefaultUserType(settings) {
  if (settings.studentEnabled !== false) return "student";
  if (settings.memberEnabled !== false) return "member";
  return "";
}

function isUserTypeAvailable(settings, userType) {
  if (settings.enabled === false) return false;
  if (userType === "student") return settings.studentEnabled !== false;
  if (userType === "member") return settings.memberEnabled !== false;
  return false;
}

function getUnavailableTypesMessage(settings) {
  if (settings.enabled === false) return "현재 회원가입이 일시 중단되어 있습니다.";
  if (settings.studentEnabled === false && settings.memberEnabled === false) {
    return "현재 선택 가능한 회원가입 유형이 없습니다. 학원에 문의해 주세요.";
  }
  return "";
}

function getSignupDisabledMessage(settings, userType) {
  if (settings.enabled === false) return "현재 회원가입이 일시 중단되어 있습니다.";
  if (userType === "student" && settings.studentEnabled === false) {
    return "현재 학생 회원가입이 일시 중단되어 있습니다.";
  }
  if (userType === "member" && settings.memberEnabled === false) {
    return "현재 학부모/일반 회원가입이 일시 중단되어 있습니다.";
  }
  return "";
}

function setSignupTypeCardVisibility(input, isVisible) {
  if (!input) return;
  const card = input.closest(".radio-label");
  input.disabled = !isVisible;
  if (!isVisible && input.checked) {
    input.checked = false;
  }
  if (card) {
    card.hidden = !isVisible;
    card.style.display = isVisible ? "" : "none";
  }
}

function applySignupTypeAvailability(settings) {
  const studentInput = document.getElementById("userTypeStudent");
  const memberInput = document.getElementById("userTypeMember");

  setSignupTypeCardVisibility(studentInput, isUserTypeAvailable(settings, "student"));
  setSignupTypeCardVisibility(memberInput, isUserTypeAvailable(settings, "member"));

  const currentType = signupState.userType;
  if (!isUserTypeAvailable(settings, currentType)) {
    signupState.userType = null;
  }

  const unavailableMessage = getUnavailableTypesMessage(settings);
  showStatus(unavailableMessage, settings.enabled === false);
}

function selectUserType(userType) {
  const targetType = isSupportedUserType(userType) ? userType : "";
  const targetInput = step1Form?.querySelector(`input[name="userType"][value="${targetType}"]`);
  if (targetInput && !targetInput.disabled) {
    targetInput.checked = true;
    signupState.userType = targetType;
  } else if (!targetType) {
    signupState.userType = null;
  }
  if (!signupState.userType) {
    step1Form?.querySelectorAll('input[name="userType"]').forEach((input) => {
      input.checked = false;
    });
  }
  syncStep1Selection();
  document.dispatchEvent(new CustomEvent("signup:userTypeChanged", { detail: { userType: signupState.userType } }));
}

function syncStep1Selection() {
  const checkedInput = step1Form?.querySelector('input[name="userType"]:checked');
  step1Form?.querySelectorAll(".radio-label").forEach((label) => {
    const input = label.querySelector('input[name="userType"]');
    label.classList.toggle("is-selected", Boolean(input && input === checkedInput));
  });
  return checkedInput;
}

function setStep2UserTypeLabel(userType) {
  const label = document.getElementById("step2UserTypeLabel");
  if (!label) return;
  label.textContent = userType === "student" ? "학생 " : userType === "member" ? "일반 " : "";
}

if (step1Form) {
  let isStep1Initialized = false;
  const nextButton = step1NextButton();
  if (nextButton) nextButton.disabled = true;

  (async () => {
    const settings = getSignupSettings();
    applySignupTypeAvailability(settings);
    selectUserType(getDefaultUserType(settings));
  })();

  document.addEventListener("signup:ready", () => {
    const settings = getSignupSettings();
    applySignupTypeAvailability(settings);

    selectUserType(getDefaultUserType(settings));
    isStep1Initialized = true;
    if (nextButton) nextButton.disabled = false;
  });

  step1Form.querySelectorAll('input[name="userType"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked && isSupportedUserType(input.value)) {
        signupState.userType = input.value;
        setStep2UserTypeLabel(input.value);
      }
      syncStep1Selection();
      document.dispatchEvent(new CustomEvent("signup:userTypeChanged", { detail: { userType: signupState.userType } }));
    });
  });

  step1Form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!isStep1Initialized) {
      showStatus("회원가입 화면을 준비 중입니다. 잠시 후 다시 시도해 주세요.", true);
      return;
    }

    const settings = getSignupSettings();
    const userTypeInput = step1UserTypeInput();
    const selectedType = userTypeInput?.value || signupState.userType;
    const unavailableMessage = getUnavailableTypesMessage(settings);
    if (unavailableMessage) {
      signupState.userType = null;
      showStatus(unavailableMessage, settings.enabled === false);
      return;
    }
    const disabledMessage = getSignupDisabledMessage(settings, selectedType);
    if (disabledMessage) {
      signupState.userType = null;
      showStatus(disabledMessage, true);
      return;
    }

    if (!userTypeInput || !userTypeInput.checked) {
      showStatus("회원 유형을 선택해 주세요.", true);
      return;
    }
    if (!isSupportedUserType(userTypeInput.value)) {
      showStatus("지원하지 않는 회원 유형입니다.", true);
      return;
    }
    if (!isUserTypeAvailable(settings, userTypeInput.value)) {
      signupState.userType = null;
      showStatus(getSignupDisabledMessage(settings, userTypeInput.value), true);
      return;
    }
    signupState.userType = userTypeInput.value;
    setStep2UserTypeLabel(userTypeInput.value);
    syncStep1Selection();
    document.dispatchEvent(new CustomEvent("signup:userTypeChanged", { detail: { userType: signupState.userType } }));
    goToStep(2);
  });
}
