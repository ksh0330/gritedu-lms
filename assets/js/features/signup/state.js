/**
 * Signup 상태 관리 모듈
 * signupState, step 관리, DOM 참조
 */

// DOM 요소 참조
export const step1 = () => document.getElementById("step1");
export const step2 = () => document.getElementById("step2");
export const step3 = () => document.getElementById("step3");
export const step4 = () => document.getElementById("step4");
export const step1Form = () => document.getElementById("step1Form");
export const step2Form = () => document.getElementById("step2Form");
export const step3Form = () => document.getElementById("step3Form");
export const statusMsg = () => document.getElementById("signupStatus");

export const VERIFICATION_EXPIRES_SECONDS = 5 * 60;
export const VERIFICATION_RESEND_COOLDOWN_SECONDS = 60;

// Signup 상태
export const signupState = {
  currentStep: 1,
  userType: null,
  verifiedEmail: null,
  isEmailVerified: false,
  // 인증번호 타이머 상태
  verification: {
    sentAt: null,        // 인증번호 발송 시각 (timestamp)
    expiresAt: null,     // 인증번호 만료 시각 (timestamp)
    targetEmail: null,   // 인증번호를 발송한 이메일 (변경 감지용)
    verified: false,    // 인증 완료 여부
    isSending: false,    // 인증번호 발송 중 여부
    isVerifying: false,  // 인증번호 확인 중 여부
    timerId: null,       // 타이머 ID (clearInterval용)
    resendCooldown: VERIFICATION_RESEND_COOLDOWN_SECONDS  // 재전송 쿨다운 (초) - 1분
  },
  reset() {
    this.currentStep = 1;
    this.userType = null;
    this.verifiedEmail = null;
    this.isEmailVerified = false;
    this.resetVerification();
  },
  resetVerification() {
    this.verifiedEmail = null;
    this.isEmailVerified = false;
    if (this.verification.timerId) {
      clearInterval(this.verification.timerId);
    }
    this.verification = {
      sentAt: null,
      expiresAt: null,
      targetEmail: null,
      verified: false,
      isSending: false,
      isVerifying: false,
      timerId: null,
      resendCooldown: VERIFICATION_RESEND_COOLDOWN_SECONDS  // 재전송 쿨다운 (초) - 1분
    };
  },
  // 인증번호 발송 기록
  setVerificationSent(email = null) {
    const now = Date.now();
    this.verification.sentAt = now;
    this.verification.expiresAt = now + (VERIFICATION_EXPIRES_SECONDS * 1000); // 5분
    this.verification.targetEmail = email ? String(email).trim().toLowerCase() : null;
    this.verification.verified = false;
    this.verification.isSending = false;
  },
  // 인증 완료 기록
  setVerificationVerified() {
    this.verification.verified = true;
    this.verification.isVerifying = false;
    if (this.verification.timerId) {
      clearInterval(this.verification.timerId);
      this.verification.timerId = null;
    }
  },
  // 재전송 가능 여부 확인
  canResend() {
    if (this.verification.verified) return false;
    if (!this.verification.sentAt) return true;
    const now = Date.now();
    const elapsed = Math.floor((now - this.verification.sentAt) / 1000);
    return elapsed >= this.verification.resendCooldown;
  },
  // 재전송까지 남은 시간 (초)
  getResendRemainingTime() {
    if (!this.verification.sentAt) return 0;
    const now = Date.now();
    const elapsed = Math.floor((now - this.verification.sentAt) / 1000);
    return Math.max(0, this.verification.resendCooldown - elapsed);
  },
  // 인증번호 만료까지 남은 시간 (초)
  getExpirationRemainingTime() {
    if (!this.verification.expiresAt) return 0;
    const now = Date.now();
    const remaining = Math.floor((this.verification.expiresAt - now) / 1000);
    return Math.max(0, remaining);
  }
};

export const getUserType = () => signupState.userType;
export const getVerifiedEmail = () => signupState.verifiedEmail;
