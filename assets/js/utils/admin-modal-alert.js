/**
 * Inline alert helpers for admin modals (paired with page toast).
 */

/**
 * @param {HTMLElement | null | undefined} alertEl
 * @param {string} message
 * @param {boolean} [isError]
 */
export function setModalAlert(alertEl, message = "", isError = false) {
  if (!alertEl) return;
  const text = String(message || "").trim();
  if (!text) {
    clearModalAlert(alertEl);
    return;
  }
  alertEl.hidden = false;
  alertEl.textContent = text;
  alertEl.classList.toggle("is-error", isError);
  alertEl.setAttribute("role", "alert");
}

/**
 * @param {HTMLElement | null | undefined} alertEl
 */
export function clearModalAlert(alertEl) {
  if (!alertEl) return;
  alertEl.hidden = true;
  alertEl.textContent = "";
  alertEl.classList.remove("is-error");
}

/**
 * @param {string} selector
 * @param {string} message
 * @param {boolean} [isError]
 */
export function setModalAlertById(selector, message = "", isError = false) {
  const el = document.querySelector(selector);
  setModalAlert(el, message, isError);
}

/**
 * Ensures admin toast appears above modal overlays.
 * @param {HTMLElement | null | undefined} statusEl
 */
export function ensureAdminToastHost(statusEl) {
  if (!statusEl) return;
  if (statusEl.parentElement !== document.body) {
    document.body.appendChild(statusEl);
  }
  statusEl.style.position = "fixed";
  statusEl.style.top = "80px";
  statusEl.style.left = "50%";
  statusEl.style.transform = "translateX(-50%)";
  statusEl.style.zIndex = "11000";
  statusEl.style.pointerEvents = "none";
}
