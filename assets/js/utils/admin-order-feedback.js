// 관리자 순서 변경 피드백 공통 도우미.
// - 이동한 행을 잠깐 강조하고(.is-order-moved), 새 위치를 aria-live 영역에 알린다.
// - 저장 전 초안(draft)과 저장된 값(persisted)을 문구로 구분한다. 저장 성공은 호출자가 실제 쓰기 완료 뒤에만 알린다.
// DB 조회·저장·listener를 만들지 않는다. 화면에 이미 있는 DOM과 페이지 메모리 값만 다룬다.

export const ORDER_MOVED_CLASS = "is-order-moved";
export const ORDER_FLASH_MS = 1800;
const LIVE_REGION_ID = "adminOrderLive";
const flashTimers = new WeakMap();
const announceTimers = new WeakMap();

/** 페이지에 보이는 상태 줄이 없을 때 쓰는 화면 밖 aria-live 영역. */
function getLiveRegion(doc) {
  if (!doc?.body) return null;
  let region = doc.getElementById(LIVE_REGION_ID);
  if (!region) {
    region = doc.createElement("div");
    region.id = LIVE_REGION_ID;
    region.className = "sr-only";
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    region.setAttribute("aria-atomic", "true");
    doc.body.appendChild(region);
  }
  return region;
}

/**
 * 순서 이동 결과를 알린다. statusEl(role=status 인 보이는 줄)이 있으면 거기에, 없으면 화면 밖 영역에 쓴다.
 * 같은 문구를 연속으로 알려도 다시 읽히도록 한 번 비운 뒤 채운다.
 */
export function announceOrderChange(message, { statusEl = null, doc = globalThis.document } = {}) {
  const target = statusEl || getLiveRegion(doc);
  if (!target) return;
  clearTimeout(announceTimers.get(target));
  target.textContent = "";
  announceTimers.set(target, setTimeout(() => { target.textContent = message; }, 30));
}

/** 보이는 상태 줄을 비운다(저장 완료·새로 불러오기 뒤 '저장 전' 안내가 남지 않게). */
export function clearOrderStatus(statusEl) {
  if (!statusEl) return;
  clearTimeout(announceTimers.get(statusEl));
  statusEl.textContent = "";
}

/** 이동 안내 문구. persisted=false 는 아직 저장되지 않은 로컬 초안이라는 뜻이다. */
export function describeOrderMove({ label, index, total, persisted = false, saveHint = "" }) {
  const name = String(label || "항목").trim() || "항목";
  const position = `${total}개 중 ${index + 1}번째`;
  if (persisted) return `‘${name}’ 순서를 ${position}로 옮기고 저장했습니다.`;
  const hint = saveHint ? ` ${saveHint}` : "";
  return `‘${name}’을(를) ${position}로 옮겼습니다. 아직 저장 전 변경입니다.${hint}`;
}

/** 이동한 행을 잠깐 강조한다. 애니메이션은 CSS에서 reduced-motion을 따르며 class는 타이머로 제거한다. */
export function flashMovedRow(row, { duration = ORDER_FLASH_MS, scroll = true } = {}) {
  if (!row?.classList) return;
  row.classList.add(ORDER_MOVED_CLASS);
  clearTimeout(flashTimers.get(row));
  flashTimers.set(row, setTimeout(() => row.classList.remove(ORDER_MOVED_CLASS), duration));
  if (scroll && typeof row.scrollIntoView === "function") row.scrollIntoView({ block: "nearest" });
}

/**
 * 다시 그린 뒤에도 키보드 사용자가 같은 방향 이동 버튼에서 이어서 조작하도록 포커스를 되돌린다.
 * 맨 위/아래에 도달해 버튼이 비활성화되면 반대 방향 버튼으로 옮긴다.
 */
export function restoreMoveFocus(row, selectors = []) {
  if (!row?.querySelector) return false;
  for (const selector of selectors) {
    const control = row.querySelector(selector);
    if (control && !control.disabled) {
      control.focus({ preventScroll: true });
      return true;
    }
  }
  return false;
}

/** 이동 피드백 일괄 적용: 행 강조 + 포커스 복귀 + 안내. */
export function applyOrderMoveFeedback({ row, message, statusEl = null, focusSelectors = [], doc = globalThis.document }) {
  flashMovedRow(row);
  restoreMoveFocus(row, focusSelectors);
  announceOrderChange(message, { statusEl, doc });
}

/** 저장 전 변경 배지. dirty 가 아니면 숨긴다(저장 성공 문구는 만들지 않는다). */
export function setDraftBadge(badge, dirty, dirtyText = "저장 전 변경 있음") {
  if (!badge) return;
  badge.dataset.draftState = dirty ? "dirty" : "clean";
  badge.textContent = dirty ? dirtyText : "";
  badge.hidden = !dirty;
}

/** 순서와 선택 필드를 포함해 두 목록이 다른지 비교한다. 입력 객체는 변경하지 않는다. */
export function isListDirty(current, saved, pick = (item) => item) {
  const sign = (list) => JSON.stringify((Array.isArray(list) ? list : []).map((item) => pick(item)));
  return sign(current) !== sign(saved);
}

/** 선택 목록 태그(학년·연도·학교·과목 등)에서 field/value 에 해당하는 행(.admin-catalog-tag)을 찾는다. */
export function findCatalogTagRow(host, field, value) {
  const buttons = Array.from(host?.querySelectorAll?.("[data-catalog-move]") || []);
  const match = buttons.find((button) => button.dataset.catalogField === field && button.dataset.catalogValue === value);
  return match?.closest?.(".admin-catalog-tag") || null;
}

/**
 * 선택 목록 태그 이동 직후 호출한다. list 는 이동이 반영된 초안 배열이다.
 * 선택 목록은 '목록 저장'을 눌러야 반영되는 로컬 초안이므로 문구에 저장 전임을 밝힌다.
 */
export function reportCatalogTagMove({ host, field, value, list, direction, statusEl = null, saveHint = "‘목록 저장’을 눌러야 반영됩니다.", doc = globalThis.document }) {
  const index = (list || []).indexOf(value);
  if (index < 0) return;
  const other = direction === "up" ? "down" : "up";
  applyOrderMoveFeedback({
    row: findCatalogTagRow(host, field, value),
    message: describeOrderMove({ label: value, index, total: list.length, saveHint }),
    statusEl,
    focusSelectors: [`[data-catalog-move="${direction}"]`, `[data-catalog-move="${other}"]`],
    doc,
  });
}

/** 항목을 뺀 뒤 포커스를 잃지 않도록 같은 자리(없으면 마지막) 행의 제어로, 행이 없으면 fallback 으로 옮긴다. */
export function focusAfterRowRemoved(rows, index, controlSelector, fallback = null) {
  const list = Array.from(rows || []);
  const row = list[Math.min(index, list.length - 1)];
  const control = row?.querySelector?.(controlSelector);
  (control && !control.disabled ? control : fallback)?.focus?.({ preventScroll: true });
}

/** 선택 목록 태그 추가 직후: 새 행을 강조하고 저장 전임을 알린다. */
export function reportCatalogTagAdded({ host, field, value, statusEl = null, saveHint = "‘목록 저장’을 눌러야 반영됩니다.", doc = globalThis.document }) {
  flashMovedRow(findCatalogTagRow(host, field, value));
  announceOrderChange(`‘${value}’을(를) 목록 끝에 추가했습니다. 아직 저장 전 변경입니다. ${saveHint}`, { statusEl, doc });
}

/** 선택 목록 태그 제거 직후: 포커스를 옮기고 '목록에서 뺐을 뿐 기존 데이터는 그대로'임을 알린다. */
export function reportCatalogTagRemoved({ host, value, index, statusEl = null, fallback = null, saveHint = "‘목록 저장’을 눌러야 반영됩니다.", doc = globalThis.document }) {
  focusAfterRowRemoved(host?.querySelectorAll?.(".admin-catalog-tag"), index, ".admin-catalog-tag__remove", fallback);
  announceOrderChange(`‘${value}’을(를) 목록에서 뺐습니다. 아직 저장 전 변경입니다. ${saveHint}`, { statusEl, doc });
}

/** 이름을 고쳐 목록을 다시 그린 뒤, 포커스가 사라졌을 때만 같은 입력으로 되돌린다. */
export function restoreFocusAfterRename(findInput, doc = globalThis.document) {
  const active = doc?.activeElement;
  if (active && active !== doc.body && active.isConnected !== false) return;
  findInput?.()?.focus?.({ preventScroll: true });
}
