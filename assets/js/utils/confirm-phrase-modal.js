let activeConfirmPhraseModal = null;

function removeModal(modal) {
  if (!modal) return;
  modal.remove();
  if (activeConfirmPhraseModal === modal) activeConfirmPhraseModal = null;
}

export function requestPhraseConfirmation({
  title,
  message,
  phrase,
  confirmLabel = "확인",
  pendingMessage = "처리 중입니다.",
  notifyError = null,
} = {}) {
  removeModal(activeConfirmPhraseModal);

  return new Promise((resolve) => {
    const modal = document.createElement("div");
    modal.className = "confirm-phrase-modal";
    modal.style.cssText = "position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(15,23,42,.72)";
    modal.innerHTML = `
      <section role="dialog" aria-modal="true" aria-labelledby="confirmPhraseTitle" style="width:min(560px,100%);max-height:90vh;overflow:auto;border-radius:16px;background:var(--card,#fff);color:var(--text,#111827);box-shadow:0 24px 70px rgba(0,0,0,.35)">
        <header style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:20px 22px;border-bottom:1px solid var(--border,#e5e7eb)">
          <h2 id="confirmPhraseTitle" style="margin:0;font-size:20px"></h2>
          <button type="button" data-confirm-close aria-label="닫기" style="border:0;background:transparent;color:inherit;font-size:26px;line-height:1;cursor:pointer">×</button>
        </header>
        <div style="padding:22px">
          <p data-confirm-message style="margin:0 0 18px;white-space:pre-line;line-height:1.65"></p>
          <label for="confirmPhraseInput" style="display:block;margin-bottom:7px;font-weight:700">확인 문구 입력</label>
          <input id="confirmPhraseInput" type="text" autocomplete="off" spellcheck="false" style="width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid var(--border,#d1d5db);border-radius:9px;background:var(--bg,#fff);color:inherit;font:inherit">
          <p style="margin:8px 0 0;font-size:13px;color:var(--muted,#64748b)">아래 문구를 정확히 입력하세요: <strong data-confirm-phrase></strong></p>
          <p data-confirm-feedback role="status" aria-live="polite" hidden style="margin:14px 0 0;padding:10px 12px;border-radius:9px;font-weight:700"></p>
        </div>
        <footer style="display:flex;justify-content:flex-end;gap:8px;padding:16px 22px;border-top:1px solid var(--border,#e5e7eb)">
          <button type="button" class="btn" data-confirm-cancel>취소</button>
          <button type="button" class="btn danger" data-confirm-submit></button>
        </footer>
      </section>`;

    const heading = modal.querySelector("#confirmPhraseTitle");
    const messageElement = modal.querySelector("[data-confirm-message]");
    const phraseElement = modal.querySelector("[data-confirm-phrase]");
    const input = modal.querySelector("#confirmPhraseInput");
    const feedback = modal.querySelector("[data-confirm-feedback]");
    const submit = modal.querySelector("[data-confirm-submit]");
    const cancelButtons = modal.querySelectorAll("[data-confirm-cancel],[data-confirm-close]");
    heading.textContent = String(title || "확인");
    messageElement.textContent = String(message || "");
    phraseElement.textContent = String(phrase || "");
    input.placeholder = String(phrase || "");
    submit.textContent = String(confirmLabel || "확인");

    const setFeedback = (text, type = "error") => {
      feedback.textContent = text || "";
      feedback.hidden = !text;
      feedback.style.color = type === "error" ? "#b91c1c" : type === "success" ? "#15803d" : "#1d4ed8";
      feedback.style.background = type === "error" ? "rgba(220,38,38,.08)" : type === "success" ? "rgba(22,163,74,.1)" : "rgba(37,99,235,.08)";
    };
    const close = (result = null) => {
      removeModal(modal);
      resolve(result);
    };
    const cancel = () => close(null);

    cancelButtons.forEach((button) => button.addEventListener("click", cancel));
    modal.addEventListener("click", (event) => {
      if (event.target === modal) cancel();
    });
    modal.addEventListener("keydown", (event) => {
      if (event.key === "Escape") cancel();
      if (event.key === "Enter" && event.target === input) submit.click();
    });
    input.addEventListener("input", () => setFeedback(""));
    submit.addEventListener("click", () => {
      if (input.value.trim() !== String(phrase || "")) {
        const errorMessage = "확인 문구가 일치하지 않습니다.";
        setFeedback(errorMessage, "error");
        if (typeof notifyError === "function") notifyError(errorMessage);
        input.focus();
        input.select();
        return;
      }
      submit.disabled = true;
      cancelButtons.forEach((button) => { button.disabled = true; });
      input.disabled = true;
      setFeedback(pendingMessage, "info");
      resolve({
        close: () => removeModal(modal),
        success(text) {
          setFeedback(text, "success");
          setTimeout(() => removeModal(modal), 700);
        },
        error(text) {
          setFeedback(text, "error");
          submit.disabled = false;
          cancelButtons.forEach((button) => { button.disabled = false; });
          input.disabled = false;
          input.focus();
        },
      });
    });

    document.body.appendChild(modal);
    activeConfirmPhraseModal = modal;
    setTimeout(() => input.focus(), 0);
  });
}
