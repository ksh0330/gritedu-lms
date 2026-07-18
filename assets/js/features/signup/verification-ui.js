/**
 * 인증번호 UI 상태 관리
 * 버튼 상태, 타이머, 안내 문구 등을 한곳에서 다룹니다.
 */

import { signupState, VERIFICATION_EXPIRES_SECONDS } from "./state.js";

function formatTimer(seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const mins = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function setSendMetaText(sendMetaEl, text = "", state = "") {
  if (!sendMetaEl) return;

  if (text) {
    sendMetaEl.classList.remove("hidden");
    sendMetaEl.textContent = text;
    sendMetaEl.style.color = "";
  } else {
    sendMetaEl.classList.add("hidden");
    sendMetaEl.textContent = "";
    sendMetaEl.style.color = "";
  }

  sendMetaEl.dataset.state = state;
}

export function updateVerificationUI() {
  const sendBtn = document.getElementById("sendVerificationBtn");
  const verifyBtn = document.getElementById("verifyCodeBtn");
  const verificationCodeInput = document.getElementById("verificationCode");
  const verificationTimer = document.getElementById("verificationTimer");
  const timerProgress = document.getElementById("timerProgress");
  const timerProgressBar = document.getElementById("timerProgressBar");
  const emailInput = document.getElementById("email");

  if (!sendBtn) return;

  const sendBtnText = sendBtn.querySelector(".send-btn-text");
  const verifyBtnText = verifyBtn?.querySelector(".verify-btn-text");
  const verifyCheckIcon = verifyBtn?.querySelector(".verify-check-icon");
  const sendMeta = document.querySelector(".send-btn-timer");

  const verification = signupState.verification || {};
  const isVerified = verification.verified === true;
  const isSending = verification.isSending === true;
  const isVerifying = verification.isVerifying === true;
  const hasSent = Boolean(verification.sentAt);
  const resendRemaining = hasSent ? signupState.getResendRemainingTime() : 0;
  const isCooldownActive = hasSent && resendRemaining > 0;
  const shouldLockEmailInput = isVerified || isSending || isVerifying || isCooldownActive;

  if (emailInput) {
    emailInput.disabled = shouldLockEmailInput;
    emailInput.readOnly = shouldLockEmailInput;
  }

  if (isVerified) {
    sendBtn.disabled = true;
    if (sendBtnText) sendBtnText.textContent = "발송 완료";
    setSendMetaText(sendMeta, "");

    if (verifyBtn) {
      verifyBtn.disabled = true;
      if (verifyBtnText) verifyBtnText.textContent = "인증 완료";
      if (verifyCheckIcon) verifyCheckIcon.classList.add("hidden");
    }

    if (verificationCodeInput) {
      verificationCodeInput.disabled = true;
      verificationCodeInput.readOnly = true;
      verificationCodeInput.style.backgroundColor = "var(--bg-secondary)";
    }

    if (verificationTimer) {
      verificationTimer.textContent = "";
      verificationTimer.classList.add("hidden");
    }
    if (timerProgress) timerProgress.classList.add("hidden");
    return;
  }

  if (isSending) {
    sendBtn.disabled = true;
    if (sendBtnText) sendBtnText.textContent = "발송 중...";
    setSendMetaText(sendMeta, "", "");

    if (verifyBtn) {
      verifyBtn.disabled = true;
      if (verifyBtnText) verifyBtnText.textContent = "인증확인";
      if (verifyCheckIcon) verifyCheckIcon.classList.add("hidden");
    }
    return;
  }

  if (isVerifying) {
    const resendRemaining = hasSent ? signupState.getResendRemainingTime() : 0;
    if (sendBtnText) {
      if (!hasSent) sendBtnText.textContent = "인증번호 발송";
      else if (resendRemaining > 0) sendBtnText.textContent = "재발송";
      else sendBtnText.textContent = "인증번호 재발송";
    }
    sendBtn.disabled = true;

    if (verifyBtn) {
      verifyBtn.disabled = true;
      if (verifyBtnText) verifyBtnText.textContent = "확인 중...";
      if (verifyCheckIcon) verifyCheckIcon.classList.add("hidden");
    }
    return;
  }

  if (!hasSent) {
    sendBtn.disabled = false;
    if (sendBtnText) sendBtnText.textContent = "인증번호 발송";

    if (sendMeta?.dataset.state === "sending" || sendMeta?.dataset.state === "timer") {
      setSendMetaText(sendMeta, "");
    }

    if (verifyBtn) {
      verifyBtn.disabled = true;
      if (verifyBtnText) verifyBtnText.textContent = "인증확인";
      if (verifyCheckIcon) verifyCheckIcon.classList.add("hidden");
    }

    if (verificationTimer) {
      verificationTimer.textContent = "";
      verificationTimer.classList.add("hidden");
      verificationTimer.classList.remove("warning");
    }
    if (timerProgress) timerProgress.classList.add("hidden");
    if (timerProgressBar) timerProgressBar.classList.remove("warning");
    return;
  }

  const expirationRemaining = signupState.getExpirationRemainingTime();

  if (resendRemaining > 0) {
    sendBtn.disabled = true;
    if (sendBtnText) sendBtnText.textContent = "재발송";
    setSendMetaText(sendMeta, `재발송까지 ${formatTimer(resendRemaining)} 남았습니다.`, "timer");
  } else {
    sendBtn.disabled = false;
    if (sendBtnText) sendBtnText.textContent = "인증번호 재발송";
    setSendMetaText(sendMeta, "재발송할 수 있습니다.", "timer");
  }

  if (verifyBtn) {
    const canVerify = Boolean(verificationCodeInput && verificationCodeInput.value.trim().length === 6);
    verifyBtn.disabled = !canVerify;
    if (verifyBtnText) verifyBtnText.textContent = "인증확인";
    if (verifyCheckIcon) verifyCheckIcon.classList.add("hidden");
  }

  if (expirationRemaining > 0) {
    if (verificationTimer) {
      verificationTimer.classList.remove("hidden");
      verificationTimer.textContent = `인증번호 유효시간: ${formatTimer(expirationRemaining)}`;
      verificationTimer.classList.toggle("warning", expirationRemaining <= 60);
    }

    if (timerProgress && timerProgressBar) {
      const progress = (expirationRemaining / VERIFICATION_EXPIRES_SECONDS) * 100;
      timerProgress.classList.remove("hidden");
      timerProgressBar.style.width = `${progress}%`;
      timerProgressBar.classList.toggle("warning", expirationRemaining <= 60);
    }
    return;
  }

  if (verificationTimer) {
    verificationTimer.classList.remove("hidden");
    verificationTimer.classList.add("warning");
    verificationTimer.textContent = "인증번호가 만료되었습니다. 다시 발송해 주세요.";
  }
  if (timerProgress) timerProgress.classList.add("hidden");
  if (timerProgressBar) timerProgressBar.classList.remove("warning");
}

export function startVerificationTimer(targetEmail = null) {
  if (signupState.verification.timerId) {
    clearInterval(signupState.verification.timerId);
  }

  signupState.setVerificationSent(targetEmail);
  updateVerificationUI();

  signupState.verification.timerId = setInterval(() => {
    const remaining = signupState.getExpirationRemainingTime();
    if (remaining <= 0 && signupState.verification.timerId) {
      clearInterval(signupState.verification.timerId);
      signupState.verification.timerId = null;
    }
    updateVerificationUI();
  }, 1000);
}

export function stopVerificationTimer() {
  if (!signupState.verification.timerId) return;
  clearInterval(signupState.verification.timerId);
  signupState.verification.timerId = null;
}
