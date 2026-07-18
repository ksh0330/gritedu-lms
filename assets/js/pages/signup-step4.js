import { auth, authPersistenceReady, db } from "/assets/js/firebase-init.js";
import {
  createUserWithEmailAndPassword,
  signOut,
  deleteUser
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { saveMember, saveStudent } from "/assets/js/features/signup/firestore.js";
import { signupState } from "/assets/js/features/signup/state.js";
import { LEGAL_POLICY_VERSION } from "/assets/js/utils/legal-policy.js";
import { step3Form, step4Form, showStatus, goToStep } from "./signup-common.js";
import {
  validateName,
  validatePhone,
  validatePassword,
  validatePasswordConfirm,
} from "/assets/js/utils/validation.js";
import { normalizeGrade } from "/assets/js/utils/grade.js";

let processSignupInFlight = false;
const SIGNUP_GRADE_VALUES = ["1", "2", "3", "4", "5", "6", "7"];
const MEMBER_PURPOSE_VALUES = ["parent", "general"];
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

async function loadLatestSignupSettings() {
  try {
    const result = await getDoc(doc(db, "settings", "signup"));
    const settings = result.exists() ? result.data() : {};
    const enabled = settings.enabled !== false;
    return {
      enabled,
      studentEnabled: enabled && settings.studentEnabled !== false,
      memberEnabled: enabled && settings.memberEnabled !== false
    };
  } catch (error) {
    console.warn("[signup-step4] signup settings reload failed:", error);
    return {
      enabled: true,
      studentEnabled: true,
      memberEnabled: true
    };
  }
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

function setStep4ViewState(state, payload = {}) {
  const titleEl = document.getElementById("step4Title");
  const descEl = document.getElementById("step4Desc");
  const successIcon = document.getElementById("successIcon");
  const successInfo = document.getElementById("successInfo");
  const step4Actions = document.getElementById("step4Actions");

  if (state === "processing") {
    if (titleEl) titleEl.textContent = "가입 처리 중";
    if (descEl) descEl.textContent = "회원 정보를 저장하고 있습니다. 잠시만 기다려 주세요.";
    if (successIcon) successIcon.classList.add("hidden");
    if (successInfo) successInfo.textContent = "";
    if (step4Actions) step4Actions.classList.add("hidden");
    return;
  }

  if (state === "success") {
    const name = payload.name || "";
    const email = payload.email || "";
    if (titleEl) titleEl.textContent = "가입완료";
    if (descEl) descEl.textContent = "회원가입이 완료되었습니다. 로그인 화면으로 이동해 주세요.";
    if (successIcon) successIcon.classList.remove("hidden");
    if (successInfo) {
      successInfo.textContent = `${name}님, 회원가입이 완료되었습니다.\n이메일: ${email}`;
    }
    if (step4Actions) step4Actions.classList.remove("hidden");
  }
}

function buildSignupPayload(formData) {
  const userType = getSelectedUserType();
  const emailForAuth = normalized(signupState.verifiedEmail);
  const targetEmail = normalized(signupState.verification.targetEmail);
  const step2EmailInput = document.getElementById("email");
  const step2EmailValue = normalized(step2EmailInput?.value);

  const name = userType === "member"
    ? (formData.get("memberName") || "").trim()
    : (formData.get("name") || "").trim();
  const school = userType === "student" ? (formData.get("school") || "").trim() : "";
  const grade = userType === "student" ? normalizeGrade(formData.get("grade")) : "";
  const studentSignupSource = userType === "student" ? (formData.get("signupSource") || "").trim() : "";
  const memberPurpose = userType === "member" ? (formData.get("memberPurpose") || "").trim() : "";
  const memberSignupSource = userType === "member" ? (formData.get("memberSignupSource") || "").trim() : "";
  const memberSignupSourceOther = userType === "member"
    ? (formData.get("memberSignupSourceOther") || "").trim()
    : "";
  const password = (formData.get("password") || "").trim();
  const passwordConfirm = (formData.get("passwordConfirm") || "").trim();
  const phoneInput = document.getElementById(userType === "member" ? "memberPhone" : "studentPhone");
  const phoneRaw = phoneInput
    ? phoneInput.value.trim()
    : String(formData.get(userType === "member" ? "memberPhone" : "phone") || "").trim();
  const phoneValidation = validatePhone(phoneRaw);
  const termsAgreed = document.getElementById("agreeTerms")?.checked === true;
  const privacyAgreed = document.getElementById("agreePrivacy")?.checked === true;
  const marketingChecked = document.getElementById("agreeMarketing")?.checked === true;
  const marketingConsent = {
    sms: marketingChecked,
    email: marketingChecked,
    policyVersion: LEGAL_POLICY_VERSION
  };

  if (!["student", "member"].includes(signupState.userType)) {
    return { ok: false, message: "회원 유형을 다시 선택해 주세요.", step: 1 };
  }
  if (!signupState.isEmailVerified || !signupState.verification.verified || !emailForAuth) {
    return { ok: false, message: "이메일 인증 정보가 없습니다. 2단계부터 다시 진행해 주세요.", step: 2 };
  }
  if (targetEmail && targetEmail !== emailForAuth) {
    return { ok: false, message: "인증된 이메일 정보가 변경되었습니다. 2단계 인증부터 다시 진행해 주세요.", step: 2 };
  }
  if (step2EmailInput && step2EmailValue && step2EmailValue !== emailForAuth) {
    return { ok: false, message: "인증된 이메일과 현재 이메일이 다릅니다. 2단계 인증부터 다시 진행해 주세요.", step: 2 };
  }

  const nameValidation = validateName(name);
  if (!nameValidation.valid) {
    return { ok: false, message: nameValidation.message, step: 3 };
  }
  if (userType === "student") {
    if (!school) {
      return { ok: false, message: "학교를 선택해주세요.", step: 3 };
    }
    if (!SIGNUP_GRADE_VALUES.includes(grade)) {
      return { ok: false, message: "학년을 선택해 주세요.", step: 3 };
    }
    if (studentSignupSource && !MEMBER_SIGNUP_SOURCE_VALUES.includes(studentSignupSource)) {
      return { ok: false, message: "가입 경로를 선택해 주세요.", step: 3 };
    }
  } else {
    if (!MEMBER_PURPOSE_VALUES.includes(memberPurpose)) {
      return { ok: false, message: "가입 목적을 선택해 주세요.", step: 3 };
    }
    if (requiresMemberSignupSource(memberPurpose) && !MEMBER_SIGNUP_SOURCE_VALUES.includes(memberSignupSource)) {
      return { ok: false, message: "가입 경로를 선택해 주세요.", step: 3 };
    }
    if (requiresMemberSignupSource(memberPurpose) && memberSignupSource === "other" && !memberSignupSourceOther) {
      return { ok: false, message: "기타 가입 경로를 입력해 주세요.", step: 3 };
    }
  }
  if (!phoneRaw) {
    return { ok: false, message: "전화번호를 입력해 주세요.", step: 3 };
  }
  if (!phoneValidation.valid) {
    return { ok: false, message: "올바른 전화번호를 입력해 주세요.", step: 3 };
  }
  if (!termsAgreed || !privacyAgreed) {
    return { ok: false, message: "필수 약관 동의 상태를 확인할 수 없습니다. 2단계부터 다시 진행해 주세요.", step: 2 };
  }

  if (!password) {
    return { ok: false, message: "비밀번호를 입력해 주세요.", step: 3 };
  }
  const passwordValidation = validatePassword(password);
  if (!passwordValidation.valid) {
    return { ok: false, message: passwordValidation.message, step: 3 };
  }
  if (!passwordConfirm) {
    return { ok: false, message: "비밀번호를 다시 입력해 주세요.", step: 3 };
  }
  const passwordConfirmValidation = validatePasswordConfirm(password, passwordConfirm);
  if (!passwordConfirmValidation.valid) {
    return { ok: false, message: passwordConfirmValidation.message, step: 3 };
  }

  return {
    ok: true,
    payload: {
      emailForAuth,
      name,
      school,
      grade,
      studentSignupSource,
      memberPurpose,
      memberSignupSource,
      memberSignupSourceOther,
      password,
      phone: phoneValidation.normalized || phoneRaw,
      privacyAgreed,
      termsAgreed,
      marketingConsent,
      userType,
    },
  };
}

function formatAuthError(error) {
  const code = error?.code || "";
  const msg = error?.message || "";

  if (code === "auth/invalid-credential" || code === "auth/wrong-password") {
    return "이메일 또는 비밀번호가 올바르지 않습니다.";
  }
  if (code === "auth/invalid-password") {
    return "비밀번호가 올바르지 않습니다. 영문, 숫자, 특수문자를 각각 포함해 8자 이상 입력해 주세요.";
  }

  if (msg && !/^Firebase:/i.test(msg)) return msg;

  if (code.startsWith("auth/")) {
    return msg.replace(/^Firebase:\s*/i, "").replace(/\s*\(auth\/[^)]+\)\s*\.?$/i, "").trim() || `인증 오류 (${code})`;
  }
  if (code.startsWith("functions/")) {
    return msg.replace(/^Firebase:\s*/i, "").replace(/\s*\(functions\/[^)]+\)\s*\.?$/i, "").trim() || `서버 오류 (${code})`;
  }
  return msg || "회원가입에 실패했습니다.";
}

async function processSignup() {
  if (processSignupInFlight) return;
  processSignupInFlight = true;

  let uid = null;
  let signupFinishedOk = false;

  const formData = new FormData(step3Form);
  const signupValidation = buildSignupPayload(formData);

  const submitBtn =
    step4Form?.querySelector('button[type="submit"]') ||
    document.querySelector("#step4 button[type='submit']");

  if (submitBtn) {
    submitBtn.disabled = true;
    const buttonText = submitBtn.querySelector(".button-text");
    const buttonSpinner = submitBtn.querySelector(".button-spinner");
    if (buttonText) buttonText.textContent = "가입 중...";
    if (buttonSpinner) buttonSpinner.classList.remove("hidden");
  }

  const resetSubmitBtn = () => {
    if (submitBtn) {
      submitBtn.disabled = false;
      const buttonText = submitBtn.querySelector(".button-text");
      const buttonSpinner = submitBtn.querySelector(".button-spinner");
      if (buttonText) buttonText.textContent = "가입하기";
      if (buttonSpinner) buttonSpinner.classList.add("hidden");
    }
  };

  setStep4ViewState("processing");

  try {
    if (!signupValidation.ok) {
      showStatus(signupValidation.message || "회원가입 정보를 확인해 주세요.", true);
      goToStep(signupValidation.step || 3);
      resetSubmitBtn();
      return;
    }

    const {
      emailForAuth,
      name,
      school,
      grade,
      studentSignupSource,
      memberPurpose,
      memberSignupSource,
      memberSignupSourceOther,
      password,
      phone,
      privacyAgreed,
      termsAgreed,
      marketingConsent,
      userType,
    } = signupValidation.payload;
    const phoneInput = document.getElementById(userType === "member" ? "memberPhone" : "studentPhone");
    if (phoneInput) phoneInput.value = phone;

    const latestSignupSettings = await loadLatestSignupSettings();
    const disabledMessage = getSignupDisabledMessage(latestSignupSettings, userType);
    if (disabledMessage) {
      showStatus(disabledMessage, true);
      goToStep(1);
      resetSubmitBtn();
      return;
    }

    await authPersistenceReady;
    const userCredential = await createUserWithEmailAndPassword(auth, emailForAuth, password);
    uid = userCredential.user.uid;

    let authReady = false;
    let attempts = 0;
    const maxAttempts = 20;

    while (!authReady && attempts < maxAttempts) {
      if (auth.currentUser && auth.currentUser.uid === uid) {
        try {
          await auth.currentUser.getIdToken(true);
          authReady = true;
        } catch (_error) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          attempts++;
        }
      } else {
        await new Promise((resolve) => setTimeout(resolve, 200));
        attempts++;
      }
    }

    if (!authReady) {
      throw new Error("인증 상태 준비 실패");
    }

    let saveResult;
    if (userType === "member") {
      saveResult = await saveMember(uid, {
        name,
        email: emailForAuth,
        phone,
        memberPurpose,
        signupSource: memberSignupSource || undefined,
        signupSourceOther: memberSignupSourceOther || undefined,
        privacyAgreed,
        termsAgreed,
        marketingConsent,
      });
    } else {
      const note = "";
      saveResult = await saveStudent(uid, {
        name,
        email: emailForAuth,
        school,
        grade,
        phone,
        note,
        signupSource: studentSignupSource,
        privacyAgreed,
        termsAgreed,
        marketingConsent
      });
    }

    if (!saveResult?.canonicalSaved) {
      throw new Error(userType === "member" ? "회원 정보 저장에 실패했습니다." : "학생 정보 저장에 실패했습니다.");
    }

    try {
      await signOut(auth);
    } catch (signOutError) {
      console.warn("로그아웃 실패:", signOutError);
    }

    signupFinishedOk = true;

    setStep4ViewState("success", { name, email: emailForAuth });
    showStatus("", false);
  } catch (error) {
    console.error("회원가입 실패:", error);

    if (!signupFinishedOk && uid && auth.currentUser && auth.currentUser.uid === uid) {
      try {
        await deleteUser(auth.currentUser);
      } catch (deleteError) {
        console.warn("Auth 사용자 삭제 실패 (무시):", deleteError);
      }
    }

    let errorMsg = formatAuthError(error);

    if (error.code) {
      switch (error.code) {
        case "auth/email-already-in-use":
          errorMsg = "이미 사용 중인 이메일입니다. 다른 이메일 주소로 회원가입해 주세요.";
          break;
        case "auth/invalid-email":
          errorMsg = "올바른 이메일 형식이 아닙니다. 이메일 주소에 @ 기호가 필요합니다.";
          break;
        case "auth/weak-password":
          errorMsg = "비밀번호가 너무 약합니다. 영문, 숫자, 특수문자를 각각 포함해 8자 이상 입력해 주세요.";
          break;
        case "auth/operation-not-allowed":
          errorMsg = "현재 이메일 회원가입을 이용할 수 없습니다. 학원으로 문의해 주세요.";
          break;
        case "auth/network-request-failed":
          errorMsg = "네트워크 오류가 발생했습니다. 인터넷 연결을 확인해 주세요.";
          break;
        case "auth/too-many-requests":
          errorMsg = "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.";
          break;
        default:
          if (error.code.includes("permission")) {
            errorMsg = "권한 오류가 발생했습니다. 관리자에게 문의해 주세요.";
            console.error("권한 오류 상세:", {
              code: error.code,
              message: error.message,
              stack: error.stack
            });
          } else if (error.code.includes("unavailable") || error.code.includes("deadline-exceeded")) {
            errorMsg = "서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.";
          } else if (error.code.includes("failed-precondition")) {
            errorMsg = "요청 처리에 실패했습니다. 입력 정보를 다시 확인해 주세요.";
          } else if (error.code.includes("already-exists")) {
            errorMsg = "이미 존재하는 데이터입니다. 관리자에게 문의해 주세요.";
          } else if (
            error.code &&
            !error.code.startsWith("auth/") &&
            !error.code.startsWith("functions/")
          ) {
            errorMsg = `회원가입에 실패했습니다. (${error.code})`;
          }
      }
    }

    setStep4ViewState("processing");

    if (!signupFinishedOk) {
      goToStep(3);
    }

    showStatus(errorMsg, true);
    resetSubmitBtn();
  } finally {
    processSignupInFlight = false;
  }
}

if (step4Form) {
  step4Form.addEventListener("submit", async (e) => {
    e.preventDefault();
    await processSignup();
  });
}

export function initStep4() {
  const step4Element = document.getElementById("step4");
  if (!step4Element) return;

  const triggerSignupIfActive = () => {
    if (step4Element.classList.contains("active") && !step4Element.classList.contains("hidden")) {
      setStep4ViewState("processing");
      processSignup();
    }
  };

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === "attributes" && mutation.attributeName === "class") {
        triggerSignupIfActive();
      }
    });
  });

  observer.observe(step4Element, {
    attributes: true,
    attributeFilter: ["class"]
  });

  triggerSignupIfActive();
}

