(function () {
  "use strict";

  const SERVICE_WORKER_URL = "/sw.js";
  const SERVICE_WORKER_SCOPE = "/";

  function isLocalhost(hostname) {
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]"
    );
  }

  function canRegisterServiceWorker() {
    return (
      "serviceWorker" in navigator &&
      (window.isSecureContext || isLocalhost(window.location.hostname))
    );
  }

  function warnRegistrationFailure(error) {
    if (window.console && typeof window.console.warn === "function") {
      window.console.warn("[pwa] Service worker registration failed:", error);
    }
  }

  if (!canRegisterServiceWorker()) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(SERVICE_WORKER_URL, { scope: SERVICE_WORKER_SCOPE })
      .catch(warnRegistrationFailure);
  });
})();
