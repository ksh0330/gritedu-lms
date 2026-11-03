const DEFAULT_IDLE_LABEL = "새로고침";
const DEFAULT_LOADING_LABEL = "새로고침 중...";

export function setAdminRefreshButtonState(button, loading, options = {}) {
  if (!button) return;

  const isLoading = Boolean(loading);
  const disabledWhenReady = Boolean(options.disabledWhenReady);
  button.disabled = isLoading || disabledWhenReady;
  button.textContent = isLoading
    ? options.loadingLabel || DEFAULT_LOADING_LABEL
    : options.idleLabel || DEFAULT_IDLE_LABEL;

  if (isLoading) button.setAttribute("aria-busy", "true");
  else button.removeAttribute("aria-busy");
}

export function initAdminReloadButtons(root = document) {
  root.querySelectorAll("[data-admin-refresh-reload]").forEach((button) => {
    if (button.dataset.adminRefreshBound === "1") return;
    button.dataset.adminRefreshBound = "1";
    button.addEventListener("click", () => {
      if (button.disabled) return;
      setAdminRefreshButtonState(button, true);
      window.location.reload();
    });
  });
}
