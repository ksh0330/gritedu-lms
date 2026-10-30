let hideTimer = null;
let lastMessage = "";
let lastType = "";
let lastShownAt = 0;

function restartHideTimer(status) {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    status.classList.remove("is-visible");
    status.textContent = "";
    status.hidden = true;
  }, 2700);
}

export function showAdminToast(message, isError = false) {
  const text = String(message || "").trim();
  if (!text) return null;

  let status = document.getElementById("statusMsg");
  if (!status) {
    status = document.createElement("div");
    status.id = "statusMsg";
    document.body.appendChild(status);
  } else if (status.parentElement !== document.body) {
    document.body.appendChild(status);
  }

  status.classList.add("admin-work-status");
  status.style.removeProperty("opacity");
  status.style.removeProperty("pointer-events");
  status.style.removeProperty("min-width");
  status.style.removeProperty("max-width");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");

  const type = isError ? "error" : "success";
  const now = Date.now();
  if (status.classList.contains("is-visible") && text === lastMessage && type === lastType && now - lastShownAt < 700) {
    lastShownAt = now;
    restartHideTimer(status);
    return status;
  }
  lastMessage = text;
  lastType = type;
  lastShownAt = now;
  status.hidden = false;
  status.textContent = text;
  status.classList.toggle("is-error", isError);
  status.classList.add("is-visible");
  status.setAttribute("role", isError ? "alert" : "status");
  restartHideTimer(status);
  return status;
}
