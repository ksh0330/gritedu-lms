// 선택 목록 관리 패널을 '오른쪽 모달 보조 패널(drawer)'로 여는 점진 향상 도우미.
//
// 의미(semantics): 열려 있는 동안 페이지 위에 겹쳐 뜨는 모달 dialog 이다. 인라인 펼침(details)이 아니다.
//   - 패널 요소에 role="dialog" aria-modal="true" aria-labelledby 를 붙이고, 배경 backdrop 과 Tab 순환, Escape, 닫은 뒤 트리거 포커스 복귀를 제공한다.
//   - 패널은 HTML 에서부터 hidden 상태의 dialog 이고, 트리거 버튼은 첫 화면부터 보인다. 패널 안쪽 DOM을 옮기거나 다시 만들지 않는다.
//   - 이 모듈은 열기/닫기 상태만 다룬다. DB 조회·저장·listener 를 만들지 않으며, 닫아도 초안은 지우지 않는다.

const FOCUSABLE = "a[href], button, input:not([type='hidden']), select, textarea, summary, [tabindex]:not([tabindex='-1'])";

/**
 * 저장이 진행되는 동안 패널 조작을 막는다. 저장이 끝나면 초안이 저장값으로 교체되므로 그 사이의 변경은 사라지기 때문이다.
 * 끝나면 저장 버튼으로 포커스를 돌려준다.
 */
export function setCatalogPanelSaving(panel, saving, saveButton = null) {
  if (!panel) return;
  panel.inert = Boolean(saving);
  if (saving) panel.setAttribute?.("aria-busy", "true");
  else {
    panel.removeAttribute?.("aria-busy");
    saveButton?.focus?.({ preventScroll: true });
  }
}

export function initCatalogDrawer({ panel, openButton, titleId, doc = globalThis.document, onOpen = null, onClose = null } = {}) {
  if (!panel || !openButton || !doc) return null;

  const backdrop = doc.createElement("div");
  backdrop.className = "admin-catalog-drawer-backdrop";
  backdrop.hidden = true;
  backdrop.setAttribute("data-catalog-drawer-backdrop", "");
  panel.before(backdrop);

  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  if (titleId) panel.setAttribute("aria-labelledby", titleId);
  openButton.setAttribute("aria-expanded", "false");

  let lastTrigger = null;
  let active = false;

  // 접힌 영역이나 display:none 인 요소는 포커스를 받을 수 없다.
  const focusables = () => Array.from(panel.querySelectorAll(FOCUSABLE))
    .filter((el) => !el.disabled && !el.hidden
      && (typeof el.getClientRects !== "function" || el.getClientRects().length > 0));

  function sync() {
    const shouldBeOpen = !panel.hidden;
    if (shouldBeOpen === active) return;
    active = shouldBeOpen;
    backdrop.hidden = !active;
    openButton.setAttribute("aria-expanded", active ? "true" : "false");
    doc.body.classList.toggle("modal-open", active);
    if (active) {
      const title = titleId ? doc.getElementById(titleId) : null;
      if (title) {
        if (!title.hasAttribute("tabindex")) title.setAttribute("tabindex", "-1");
        title.focus({ preventScroll: true });
      }
      onOpen?.();
    } else {
      (lastTrigger?.isConnected ? lastTrigger : openButton).focus?.();
      lastTrigger = null;
      onClose?.();
    }
  }

  function open() {
    if (!panel.hidden) return;
    // Safari 등은 버튼을 눌러도 포커스를 주지 않아 body 가 잡힐 수 있으므로 이때는 트리거로 돌아간다.
    const current = doc.activeElement;
    lastTrigger = current instanceof globalThis.HTMLElement && current !== doc.body ? current : openButton;
    panel.hidden = false;
    sync();
  }

  function close() {
    if (panel.hidden) return;
    panel.hidden = true;
    sync();
  }

  openButton.addEventListener("click", open);
  backdrop.addEventListener("click", close);
  panel.addEventListener("click", (event) => {
    if (event.target.closest?.("[data-catalog-drawer-close]")) close();
  });
  doc.addEventListener("keydown", (event) => {
    if (!active) return;
    // 확인창이 위에 떠 있으면 그 창이 Escape/Tab 을 처리한다.
    if (doc.querySelector(".admin-confirm-modal")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusables();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const current = doc.activeElement;
    const outside = !panel.contains(current);
    // 열린 직후 포커스가 있는 제목(tabindex=-1)은 목록에 없다. 이때 Shift+Tab 이 패널 밖으로 나가지 않게 마지막으로 보낸다.
    const beforeFirst = current === first || outside || current?.getAttribute?.("tabindex") === "-1";
    if (event.shiftKey && beforeFirst) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (current === last || outside)) {
      event.preventDefault();
      first.focus();
    }
  });

  return { open, close, isOpen: () => active };
}
