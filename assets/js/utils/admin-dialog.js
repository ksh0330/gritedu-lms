let activeDialog = null;

function removeDialog(dialog, result) {
  if (!dialog) return;
  dialog.remove();
  if (activeDialog === dialog) activeDialog = null;
  dialog._resolve?.(result);
}

export function openAdminConfirm(options = {}) {
  if (activeDialog) removeDialog(activeDialog, false);
  const dialog = document.createElement("div");
  dialog.className = "modal admin-confirm-modal is-open";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  const title = String(options.title || "확인");
  const message = String(options.message || "계속 진행하시겠습니까?");
  dialog.innerHTML = `
    <div class="modal-content admin-confirm-modal__content">
      <div class="modal-header"><h2></h2><button type="button" class="modal-close" data-admin-confirm="cancel" aria-label="닫기">&times;</button></div>
      <p class="admin-confirm-modal__message"></p>
      <div class="admin-confirm-modal__actions">
        <button type="button" class="btn" data-admin-confirm="cancel"></button>
        <button type="button" class="btn ${options.danger ? "danger" : "primary"}" data-admin-confirm="ok"></button>
      </div>
    </div>`;
  dialog.querySelector("h2").textContent = title;
  dialog.querySelector(".admin-confirm-modal__message").textContent = message;
  dialog.querySelector('[data-admin-confirm="cancel"]:not(.modal-close)').textContent = options.cancelLabel || "취소";
  dialog.querySelector('[data-admin-confirm="ok"]').textContent = options.confirmLabel || "확인";
  document.body.appendChild(dialog);
  activeDialog = dialog;
  const promise = new Promise((resolve) => { dialog._resolve = resolve; });
  dialog.addEventListener("click", (event) => {
    const action = event.target.closest("[data-admin-confirm]")?.dataset.adminConfirm;
    if (action === "ok") removeDialog(dialog, true);
    else if (action === "cancel" || event.target === dialog) removeDialog(dialog, false);
  });
  dialog.querySelector('[data-admin-confirm="ok"]')?.focus();
  return promise;
}

function formState(form) {
  if (!form) return "";
  const controls = Array.from(form.querySelectorAll("input, select, textarea, [contenteditable='true']"));
  return JSON.stringify(controls.map((control, index) => ({
    key: control.name || control.id || `${control.tagName}:${index}`,
    type: control.type || control.tagName,
    value: control.isContentEditable ? control.innerHTML : control.type === "checkbox" || control.type === "radio" ? control.checked : control.value,
  })));
}

export function createFormDirtyTracker(form) {
  let baseline = formState(form);
  return {
    capture() { baseline = formState(form); },
    isDirty() { return baseline !== formState(form); },
  };
}

export async function confirmDiscardIfDirty(tracker) {
  if (!tracker?.isDirty()) return true;
  return openAdminConfirm({
    title: "변경사항 확인",
    message: "저장하지 않은 변경사항이 있습니다. 편집을 종료하시겠습니까?",
    cancelLabel: "계속 편집",
    confirmLabel: "변경사항 버리기",
    danger: true,
  });
}
