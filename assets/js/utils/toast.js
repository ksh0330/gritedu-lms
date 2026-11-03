import { TOAST_DURATION, TOAST_ANIMATION } from "/assets/js/config/constants.js";
import { escapeHtml } from "/assets/js/utils/html.js";

(function () {
  "use strict";

  let lastToastKey = "";
  let lastToastAt = 0;

  function createToastContainer() {
    let container = document.getElementById("toast-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "toast-container";
      container.setAttribute("aria-live", "polite");
      document.body.appendChild(container);
    }
    return container;
  }

  function showToast(message, type = "info", duration = TOAST_DURATION.DEFAULT) {
    const normalizedMessage = String(message || "").trim();
    if (!normalizedMessage) return null;

    const now = Date.now();
    const toastKey = `${type}:${normalizedMessage}`;
    if (toastKey === lastToastKey && now - lastToastAt < 700) return null;
    lastToastKey = toastKey;
    lastToastAt = now;

    const container = createToastContainer();

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.setAttribute("role", type === "error" ? "alert" : "status");

    let accentColor = "var(--brand, #3b82f6)";

    if (type === "success") {
      accentColor = "var(--success, #10b981)";
    } else if (type === "error") {
      accentColor = "var(--error, #ef4444)";
    } else if (type === "warning") {
      accentColor = "var(--warning, #f59e0b)";
    }

    // 레이아웃 말고 색상만 JS에서 제어
    toast.style.setProperty("--toast-accent", accentColor);

    toast.innerHTML = `
      <span class="toast-message">${escapeHtml(normalizedMessage)}</span>
      <button class="toast-close" aria-label="닫기">×</button>
    `;

    const closeBtn = toast.querySelector(".toast-close");
    closeBtn.addEventListener("click", function () {
      hideToast(toast);
    });

    container.appendChild(toast);

    // 등장 애니메이션
    requestAnimationFrame(function () {
      toast.style.opacity = "1";
      toast.style.transform = "translateY(0)";
    });

    if (duration > 0) {
      setTimeout(function () {
        hideToast(toast);
      }, duration);
    }

    return toast;
  }

  function hideToast(toast) {
    if (!toast || !toast.parentElement) return;
    toast.style.opacity = "0";
    toast.style.transform = "translateY(12px)";
    setTimeout(function () {
      if (toast.parentElement) {
        toast.parentElement.removeChild(toast);
      }
    }, TOAST_ANIMATION.HIDE_DELAY);
  }

  // public API
  window.toast = function (message, type = "info", duration = TOAST_DURATION.DEFAULT) {
    return showToast(message, type, duration);
  };
  window.toast.success = function (message, duration = TOAST_DURATION.SUCCESS) {
    return showToast(message, "success", duration);
  };
  window.toast.error = function (message, duration = TOAST_DURATION.ERROR) {
    return showToast(message, "error", duration);
  };
  window.toast.warning = function (message, duration = TOAST_DURATION.WARNING) {
    return showToast(message, "warning", duration);
  };
  window.toast.info = function (message, duration = TOAST_DURATION.INFO) {
    return showToast(message, "info", duration);
  };
})();
