// /assets/js/pages/login.js
// 로그인
import { auth, authPersistenceReady, getUserRole, getDashboardUrl, signOut } from "/assets/js/firebase-init.js";
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";

const form = document.getElementById("loginForm");
const loginStatus = document.getElementById("loginStatus");
const loginButton = form?.querySelector('button[type="submit"]');

function getSafeNextUrl() {
  const raw = new URLSearchParams(location.search).get("next");
  if (!raw) return "";
  try {
    const target = new URL(raw, location.origin);
    if (target.origin !== location.origin || !target.pathname.startsWith("/")) return "";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "";
  }
}

// 로그인 폼 제출 처리
if (form) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    if (email && password) {
      if (loginButton && loginButton.disabled) {
        return;
      }

      if (loginButton) {
        loginButton.disabled = true;
        loginButton.style.pointerEvents = "none";
        loginButton.style.cursor = "not-allowed";
        const buttonText = loginButton.querySelector(".button-text");
        const buttonSpinner = loginButton.querySelector(".button-spinner");
        if (buttonText) buttonText.textContent = "로그인 중...";
        if (buttonSpinner) buttonSpinner.classList.remove("hidden");
      }
      if (loginStatus) {
        loginStatus.textContent = "로그인 중입니다...";
        loginStatus.style.color = "#666";
      }

      try {
        await authPersistenceReady;
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const currentUser = userCredential.user;

        if (loginStatus) {
          loginStatus.textContent = "로그인 성공! 역할 확인 중...";
          loginStatus.style.color = "var(--success-color)";
        }

        await currentUser.getIdToken();
        const role = await getUserRole(currentUser);

        if (!role) {
          await signOut(auth);
          throw new Error("계정 정보를 찾을 수 없습니다. 학원으로 문의해 주세요.");
        }

        const nextUrl = getSafeNextUrl();

        const redirectUrl = nextUrl || getDashboardUrl(role);

        location.href = redirectUrl;
      } catch (error) {
        console.error("로그인 실패:", error);
        if (loginButton) {
          loginButton.disabled = false;
          loginButton.style.pointerEvents = "";
          loginButton.style.cursor = "";
          const buttonText = loginButton.querySelector(".button-text");
          const buttonSpinner = loginButton.querySelector(".button-spinner");
          if (buttonText) buttonText.textContent = "로그인";
          if (buttonSpinner) buttonSpinner.classList.add("hidden");
        }
        if (loginStatus) {
          let errorMessage = "로그인에 실패했습니다.";

          if (error?.code) {
            switch (error.code) {
              case "auth/user-not-found":
              case "auth/wrong-password":
              case "auth/invalid-credential":
                errorMessage =
                  "이메일 또는 비밀번호를 다시 확인해 주세요.";
                break;
              case "auth/invalid-email":
                errorMessage =
                  "올바른 이메일 형식이 아닙니다. 이메일 주소에 @ 기호가 필요합니다.";
                break;
              case "auth/user-disabled":
                errorMessage =
                  "이 계정은 비활성화되었습니다. 학원으로 문의해 주세요.";
                break;
              case "auth/too-many-requests":
                errorMessage =
                  "너무 많은 로그인 시도가 있었습니다. 잠시 후 다시 시도해 주세요.";
                break;
              case "auth/network-request-failed":
                errorMessage =
                  "네트워크 연결을 확인해 주세요. 인터넷 연결이 불안정할 수 있습니다.";
                break;
              default:
                errorMessage = "로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.";
            }
          } else if (error?.message === "계정 정보를 찾을 수 없습니다. 학원으로 문의해 주세요.") {
            errorMessage = error.message;
          }

          loginStatus.textContent = errorMessage;
          loginStatus.style.color = "var(--error-color)";

          const emailInput = document.getElementById("email");
          const passwordInput = document.getElementById("password");
          const isCredentialError =
            error?.code === "auth/user-not-found" ||
            error?.code === "auth/wrong-password" ||
            error?.code === "auth/invalid-credential";

          if (error?.code === "auth/invalid-email") {
            if (emailInput) {
              emailInput.style.borderColor = "var(--error-color)";
              emailInput.style.borderWidth = "2px";
              emailInput.focus();
              setTimeout(() => {
                emailInput.style.borderColor = "";
                emailInput.style.borderWidth = "";
              }, 3000);
            }
          } else if (isCredentialError) {
            if (emailInput) {
              emailInput.style.borderColor = "var(--error-color)";
              emailInput.style.borderWidth = "2px";
            }
            if (passwordInput) {
              passwordInput.style.borderColor = "var(--error-color)";
              passwordInput.style.borderWidth = "2px";
            }
            if (emailInput) {
              emailInput.focus();
            } else if (passwordInput) {
              passwordInput.focus();
            }
            setTimeout(() => {
              if (emailInput) {
                emailInput.style.borderColor = "";
                emailInput.style.borderWidth = "";
              }
              if (passwordInput) {
                passwordInput.style.borderColor = "";
                passwordInput.style.borderWidth = "";
              }
            }, 3000);
          }
        }
      }
    } else {
      if (loginStatus) {
        loginStatus.textContent = "이메일과 비밀번호를 입력해 주세요.";
        loginStatus.style.color = "var(--error-color)";
      }
    }
  });
}

