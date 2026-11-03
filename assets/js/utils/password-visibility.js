const PASSWORD_VISIBLE_LABEL = "비밀번호 숨기기";
const PASSWORD_HIDDEN_LABEL = "비밀번호 보기";

export function setupPasswordVisibilityToggles(root = document) {
  root.querySelectorAll("[data-password-toggle]").forEach((button) => {
    if (button.dataset.passwordToggleReady === "true") return;

    const inputId = button.getAttribute("aria-controls");
    const input = inputId ? document.getElementById(inputId) : null;
    if (!input) return;

    const syncState = () => {
      const isVisible = input.type === "text";
      const visibleIcon = button.querySelector("[data-password-visible-icon]");
      const hiddenIcon = button.querySelector("[data-password-hidden-icon]");
      button.setAttribute("aria-label", isVisible ? PASSWORD_VISIBLE_LABEL : PASSWORD_HIDDEN_LABEL);
      button.setAttribute("aria-pressed", String(isVisible));
      visibleIcon?.toggleAttribute("hidden", !isVisible);
      hiddenIcon?.toggleAttribute("hidden", isVisible);
      if (visibleIcon) visibleIcon.style.display = isVisible ? "block" : "none";
      if (hiddenIcon) hiddenIcon.style.display = isVisible ? "none" : "block";
    };

    button.dataset.passwordToggleReady = "true";
    button.addEventListener("click", () => {
      const selectionStart = input.selectionStart;
      const selectionEnd = input.selectionEnd;
      input.type = input.type === "password" ? "text" : "password";
      syncState();
      input.focus({ preventScroll: true });
      if (selectionStart !== null && selectionEnd !== null) {
        input.setSelectionRange(selectionStart, selectionEnd);
      }
    });
    syncState();
  });
}
