// /assets/js/pages/admin-popup.js
// 팝업창 관리 페이지 (여러 팝업 지원)
import { auth, db, requireRole, app } from "/assets/js/firebase-init.js";
import {
  doc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { getSettingDoc, invalidateSetting } from "/assets/js/utils/settings-cache.js";
import { escapeHtml } from "/assets/js/utils/html.js";
import {
  clearModalAlert,
  ensureAdminToastHost,
  setModalAlert,
} from "/assets/js/utils/admin-modal-alert.js";
import {
  PUBLIC_IMAGE_FIELD,
  normalizePublicImageUrl,
  isAllowedPublicImageUrl,
  isRemotePublicImageUrl,
  sanitizePopupContentHtml,
  getPopupImageValidationMessage,
} from "/assets/js/utils/public-image-url.js";
import {
  assignImageSrc,
  probeImageUrl,
  clearImageLoadGuards,
  isImageLoadExhausted,
  resetImageLoadGuard,
  bindGuardedImages,
} from "/assets/js/utils/image-load-guard.js";
import {
  POPUP_ALIGN_VALUES,
  createPopupTextItemId,
  normalizePopupAlign,
  normalizePopupTextItems,
  popupHasTextItems,
  buildPopupTextItemsHtml,
} from "/assets/js/utils/popup-text-items.js";

// 역할 가드: 관리자만 접근 가능
(async () => {
  try {
    await requireRole("admin", "/members/login.html");
  } catch (err) {
    // requireRole에서 이미 리다이렉션 처리됨
  }
})();

const $ = (s, r = document) => typeof s === 'string' ? r.querySelector(s) : s;
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

function setPopupModalAlert(message = "", isError = false) {
  setModalAlert($("#popupModalAlert"), message, isError);
}

function reportPopupError(message) {
  toast(message, true);
  setPopupModalAlert(message, true);
}

function toast(msg, err = false) {
  let el = $("#statusMsg");
  if (!el) {
    el = document.createElement("div");
    el.id = "statusMsg";
    document.body.appendChild(el);
  }
  ensureAdminToastHost(el);
  el.style.color = err ? "var(--error-color)" : "var(--success-color)";
  el.style.background = err ? "var(--error-bg)" : "var(--success-bg)";
  el.style.padding = "12px";
  el.style.borderRadius = "8px";
  el.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
  el.textContent = msg;
  el.style.opacity = "1";
  el.style.pointerEvents = "auto";
  if (err && $("#popupEditModal")?.style.display === "flex") {
    setPopupModalAlert(msg, true);
  }
  setTimeout(() => { 
    if (el.textContent === msg) {
      el.style.opacity = "0";
      el.style.pointerEvents = "none";
      setTimeout(() => {
        if (el.textContent === msg) {
          el.textContent = "";
          el.style.background = "";
          el.style.boxShadow = "";
        }
      }, 300);
    }
  }, 3000);
}

let allPopups = [];
let currentPopup = null;
let popupImagePathValidationToken = 0;
const popupImagePathValidationCache = new Map();
let popupImagePreviewTimer = 0;
let lastPopupPreviewImageUrl = '';
let lastPopupDetailPreviewKey = '';

const POSITION_PRESETS = new Set(["center", "top-left", "top-right", "bottom-left", "bottom-right", "custom"]);
const HOME_POPUP_CACHE_KEY = "grit-popup-cache";

function normalizeSafeLink(value) {
  const url = String(value || "").trim();
  if (!url) return "";
  if (/^\/(?!\/)/.test(url)) return url;
  if (/^https:\/\//i.test(url)) return url;
  return "";
}

function normalizePopupImagePath(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const preprocessed = raw
    .replace(/\\/g, "/")
    .replace(/(?:^|\/)(?:dist\/)?assets\/popup\/([^/]+\.webp)$/i, "/assets/popup/$1");
  return normalizePublicImageUrl(preprocessed, { field: PUBLIC_IMAGE_FIELD.popup, allowEmpty: true });
}

function isSafePopupImagePath(value) {
  return isAllowedPublicImageUrl(value, { field: PUBLIC_IMAGE_FIELD.popup, allowEmpty: true });
}

function getLocalDistPreviewPath(value) {
  const imageUrl = String(value || "").trim();
  if (/^\/assets\/popup\/[A-Za-z0-9._-]+\.webp$/i.test(imageUrl)) return imageUrl;
  return "";
}

function getPopupContentHtml() {
  return $("#popupContent")?.innerHTML.trim() || "";
}

function setPopupContentHtml(html) {
  const editor = $("#popupContent");
  if (editor) editor.innerHTML = html || "";
}

function getPopupTextItemsForEditor(popup = {}) {
  const items = normalizePopupTextItems(popup);
  if (items.length) return items;
  const temp = document.createElement("div");
  temp.innerHTML = String(popup.content || "");
  const text = temp.textContent.trim();
  if (!text) return [];
  return [{
    id: createPopupTextItemId(),
    text,
    linkUrl: String(popup.contentLinkUrl || "").trim(),
    align: "center",
    sortOrder: 0,
    enabled: true,
  }];
}

function readPopupTextItemsFromForm() {
  const count = parseInt($("#popupTextItemsCount")?.value || "0", 10) || 0;
  const items = [];
  for (let i = 0; i < count; i++) {
    items.push({
      id: $(`#popup-text-item-${i}-id`)?.value?.trim() || createPopupTextItemId(),
      text: $(`#popup-text-item-${i}-text`)?.value ?? "",
      linkUrl: $(`#popup-text-item-${i}-link`)?.value?.trim() || "",
      align: normalizePopupAlign($(`#popup-text-item-${i}-align`)?.value),
      sortOrder: i,
      enabled: $(`#popup-text-item-${i}-enabled`)?.checked !== false,
    });
  }
  return items;
}

function readPopupTextItemsForSave() {
  return readPopupTextItemsFromForm()
    .filter((item) => item.enabled !== false && String(item.text || "").trim())
    .map((item, index) => ({
      ...item,
      text: String(item.text || "").trim(),
      linkUrl: normalizeSafeLink(item.linkUrl) || "",
      align: normalizePopupAlign(item.align),
      sortOrder: index,
    }));
}

function renderPopupTextItemsEditor(items = []) {
  const container = $("#popupTextItemsList");
  const countInput = $("#popupTextItemsCount");
  if (!container || !countInput) return;

  countInput.value = String(items.length);
  if (!items.length) {
    container.innerHTML = '<p class="muted" style="margin:0;font-size:13px;">등록된 문구가 없습니다. 문구 추가 버튼을 눌러 주세요.</p>';
    return;
  }

  container.innerHTML = items.map((item, index) => {
    const alignOptions = ["left", "center", "right"]
      .map((align) => {
        const label = align === "left" ? "왼쪽" : align === "center" ? "가운데" : "오른쪽";
        const selected = normalizePopupAlign(item.align) === align ? "selected" : "";
        return `<option value="${align}" ${selected}>${label}</option>`;
      })
      .join("");
    return `
      <div class="popup-text-item-admin-row">
        <input type="hidden" id="popup-text-item-${index}-id" value="${escapeHtml(item.id || "")}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">
          <strong style="font-size:14px;">문구 ${index + 1}</strong>
          <div style="display:flex;gap:6px;align-items:center;">
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;">
              <input type="checkbox" id="popup-text-item-${index}-enabled" ${item.enabled !== false ? "checked" : ""}>
              사용
            </label>
            <button type="button" class="btn sm" data-popup-text-action="remove" data-text-index="${index}">삭제</button>
          </div>
        </div>
        <label for="popup-text-item-${index}-text">문구</label>
        <textarea id="popup-text-item-${index}-text" rows="2" placeholder="팝업에 표시할 문구" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:var(--card);color:var(--text);font-family:inherit;resize:vertical;">${escapeHtml(item.text || "")}</textarea>
        <div class="popup-text-item-admin-grid" style="margin-top:10px;">
          <div>
            <label for="popup-text-item-${index}-link">클릭 URL</label>
            <input type="text" id="popup-text-item-${index}-link" value="${escapeHtml(item.linkUrl || "")}" placeholder="/courses.html 또는 https://..." style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:var(--card);color:var(--text);">
          </div>
          <div>
            <label for="popup-text-item-${index}-align">정렬</label>
            <select id="popup-text-item-${index}-align" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:var(--card);color:var(--text);">${alignOptions}</select>
          </div>
          <div style="display:flex;gap:4px;">
            <button type="button" class="btn sm" data-popup-text-action="move-up" data-text-index="${index}" ${index === 0 ? "disabled" : ""} title="위로">↑</button>
            <button type="button" class="btn sm" data-popup-text-action="move-down" data-text-index="${index}" ${index === items.length - 1 ? "disabled" : ""} title="아래로">↓</button>
          </div>
        </div>
      </div>`;
  }).join("");
}

function bindPopupTextItemActions() {
  const form = $("#popupEditForm");
  if (!form || form.dataset.textItemsBound === "1") return;
  form.dataset.textItemsBound = "1";

  form.addEventListener("click", (event) => {
    const button = event.target.closest("[data-popup-text-action]");
    if (button) {
      event.preventDefault();
      const action = button.dataset.popupTextAction;
      const index = parseInt(button.dataset.textIndex || "0", 10);
      const items = readPopupTextItemsFromForm();
      if (action === "remove") {
        items.splice(index, 1);
      } else if (action === "move-up") {
        if (index <= 0) return;
        const [picked] = items.splice(index, 1);
        items.splice(index - 1, 0, picked);
      } else if (action === "move-down") {
        if (index >= items.length - 1) return;
        const [picked] = items.splice(index, 1);
        items.splice(index + 1, 0, picked);
      } else {
        return;
      }
      renderPopupTextItemsEditor(items);
      debounceUpdatePreview();
      return;
    }

    if (event.target.closest("#popupAddTextItemBtn")) {
      event.preventDefault();
      const items = readPopupTextItemsFromForm();
      items.push({
        id: createPopupTextItemId(),
        text: "",
        linkUrl: "",
        align: "center",
        sortOrder: items.length,
        enabled: true,
      });
      renderPopupTextItemsEditor(items);
      debounceUpdatePreview();
    }
  });

  form.addEventListener("input", (event) => {
    if (event.target.closest("#popupTextItemsList")) debounceUpdatePreview();
  });
  form.addEventListener("change", (event) => {
    if (event.target.closest("#popupTextItemsList")) debounceUpdatePreview();
  });
}

window.addPopupTextItem = function addPopupTextItem() {
  const items = readPopupTextItemsFromForm();
  items.push({
    id: createPopupTextItemId(),
    text: "",
    linkUrl: "",
    align: "center",
    sortOrder: items.length,
    enabled: true,
  });
  renderPopupTextItemsEditor(items);
  debounceUpdatePreview();
};

function getPopupDisplayTitle(popup = {}, index = 0) {
  const title = String(popup.title || "").trim();
  return title ? `${index + 1}. ${title}` : `팝업 ${index + 1}`;
}

function getPopupTypeLabel(popup = {}) {
  const hasImage = Boolean(String(popup.imageUrl || "").trim());
  const hasTextItems = popupHasTextItems(popup);
  const temp = document.createElement("div");
  temp.innerHTML = String(popup.content || "");
  const hasLegacyText = temp.textContent.trim().length > 0 || Boolean(temp.querySelector("img"));
  const hasText = hasTextItems || hasLegacyText;
  if (hasImage && hasText) return "이미지 + 문구";
  if (hasImage) return "이미지";
  if (hasText) return "문구";
  return "비어 있음";
}

function getPreparedPreviewSrc(imageUrl) {
  return imageUrl;
}

function showPopupImagePlaceholder(img, message = "이미지 준비 필요") {
  const wrapper = img?.closest("[data-popup-image-wrapper]");
  if (!wrapper) {
    if (img) img.style.display = "none";
    return;
  }

  img.style.display = "none";
  let placeholder = wrapper.querySelector("[data-popup-image-placeholder]");
  if (!placeholder) {
    placeholder = document.createElement("div");
    placeholder.setAttribute("data-popup-image-placeholder", "true");
    placeholder.style.cssText = "display:inline-flex;align-items:center;justify-content:center;min-width:160px;min-height:80px;max-width:200px;padding:12px;border:1px dashed var(--border);border-radius:8px;color:var(--muted);font-size:12px;text-align:center;background:var(--bg);";
    wrapper.insertBefore(placeholder, img);
  }
  placeholder.textContent = message;
}

function clearPopupImageValidationCache() {
  popupImagePathValidationCache.clear();
}

function setupImageFallback(img, originalPath, { hideOnFail = false, silentMissing = false, placeholderMessage = "이미지 준비 필요" } = {}) {
  if (!img) return;
  const fallbackPath = getLocalDistPreviewPath(originalPath);
  assignImageSrc(img, originalPath, {
    allowFallbackOnce: Boolean(fallbackPath),
    fallbackSrc: fallbackPath || '',
    onSuccess: () => {
      img.style.display = "";
      const wrapper = img.closest("[data-popup-image-wrapper]");
      wrapper?.querySelector("[data-popup-image-placeholder]")?.remove();
    },
    onGiveUp: () => {
      if (hideOnFail) showPopupImagePlaceholder(img, placeholderMessage);
      if (!silentMissing) {
        setPopupImagePathStatus(getPopupMissingPathMessage(), false);
      }
    },
  });
}

function validatePopupActualImagePath(imagePath) {
  const normalizedPath = normalizePopupImagePath(imagePath);
  const token = ++popupImagePathValidationToken;
  if (!normalizedPath) {
    setPopupImagePathStatus("R2 public URL 또는 rollback용 /assets/popup/*.webp 경로를 입력하세요.");
    return;
  }

  if (isRemotePublicImageUrl(normalizedPath)) {
    popupImagePathValidationCache.set(normalizedPath, 'ok');
    setPopupImagePathStatus("R2 public URL이 확인되었습니다. 저장 후 배포 없이 공개 사이트에 반영됩니다.", true);
    return;
  }

  const cached = popupImagePathValidationCache.get(normalizedPath);
  if (cached === 'ok') {
    setPopupImagePathStatus("이미지 URL이 확인되었습니다.", true);
    return;
  }
  if (cached === 'fail' || isImageLoadExhausted(normalizedPath)) {
    setPopupImagePathStatus(getPopupMissingPathMessage(), false);
    return;
  }

  setPopupImagePathStatus("이미지 URL을 확인 중입니다...");

  probeImageUrl(normalizedPath).then((ok) => {
    if (token !== popupImagePathValidationToken) return;
    popupImagePathValidationCache.set(normalizedPath, ok ? 'ok' : 'fail');
    if (ok) {
      setPopupImagePathStatus("이미지 URL이 확인되었습니다.", true);
      return;
    }
    setPopupImagePathStatus(getPopupMissingPathMessage(), false);
  });
}

function checkPopupAssetPathAvailable(imagePath) {
  const normalizedPath = normalizePopupImagePath(imagePath);
  if (!normalizedPath || isRemotePublicImageUrl(normalizedPath)) {
    return Promise.resolve(true);
  }
  if (!/^\/assets\/popup\/[A-Za-z0-9._-]+\.webp$/i.test(normalizedPath)) {
    return Promise.resolve(true);
  }
  if (popupImagePathValidationCache.get(normalizedPath) === 'ok') {
    return Promise.resolve(true);
  }
  if (popupImagePathValidationCache.get(normalizedPath) === 'fail' || isImageLoadExhausted(normalizedPath)) {
    return Promise.resolve(false);
  }
  return probeImageUrl(normalizedPath).then((ok) => {
    popupImagePathValidationCache.set(normalizedPath, ok ? 'ok' : 'fail');
    return ok;
  });
}

function setPopupImagePathStatus(message, ok = null) {
  const status = $("#popupImagePathStatus");
  if (!status) return;
  status.textContent = message || "";
  if (ok === true) {
    status.style.color = "var(--success-color)";
  } else if (ok === false) {
    status.style.color = "var(--error-color)";
  } else {
    status.style.color = "var(--muted)";
  }
}

function getPopupLocalPreviewMessage() {
  return "선택한 이미지 미리보기입니다. 실제 홈페이지 반영은 파일 배치 및 배포 후 가능합니다.";
}

function getPopupMissingPathMessage() {
  return "이미지 URL을 불러올 수 없습니다. R2 public URL 또는 rollback용 /assets/popup/*.webp 경로를 확인하세요.";
}

function clearPreparedPopupPreview() {
  setPopupImagePathStatus("");
}

function getPopupInvalidR2UrlMessage() {
  return "R2 public URL을 불러오지 못했습니다. URL과 객체 키(public/popup/*.webp)를 확인하세요.";
}

function createPopupId() {
  return `popup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function clearHomePopupCache() {
  try {
    localStorage.removeItem(HOME_POPUP_CACHE_KEY);
    localStorage.setItem("grit-popup-updated-at", String(Date.now()));
  } catch (_error) {
    // Cache clearing is best-effort; Firestore remains the source of truth.
  }
}

// 팝업 목록 로드
async function loadPopups() {
  try {
    const result = await getSettingDoc("popups");
    if (result.exists) {
      const data = result.data;
      allPopups = Array.isArray(data.popups) ? data.popups : [];
    } else {
      allPopups = [];
    }
    renderPopupList();
  } catch (error) {
    console.error("팝업 목록 로드 실패:", error);
    toast("팝업 목록 로드 실패: " + error.message, true);
  }
}

// 팝업 목록 렌더링
function renderPopupList() {
  const container = $("#popupListContainer");
  if (!container) return;
  
  if (allPopups.length === 0) {
    container.innerHTML = '<div class="muted" style="text-align:center;padding:40px;">등록된 팝업창이 없습니다. 위의 "팝업창 추가" 버튼을 클릭하여 추가하세요.</div>';
    return;
  }
  
  container.innerHTML = allPopups.map((popup, index) => {
    const enabled = popup.enabled === true;
    const position = getPositionLabel(popup.position || 'center');
    const createdAt = popup.createdAt ? (popup.createdAt.toDate ? popup.createdAt.toDate().toLocaleDateString('ko-KR') : new Date(popup.createdAt).toLocaleDateString('ko-KR')) : '-';
    const typeLabel = getPopupTypeLabel(popup);
    const displayTitle = getPopupDisplayTitle(popup, index);
    const canMoveUp = index > 0;
    const canMoveDown = index < allPopups.length - 1;
    
    return `
      <div class="popup-card" data-popup-index="${index}" draggable="true">
        <div class="popup-card-header">
          <div style="display:flex;align-items:center;gap:8px;">
            <div class="popup-drag-handle" style="cursor:move;color:var(--muted);padding:4px;display:flex;align-items:center;" title="드래그하여 순서 변경">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="9" cy="5" r="1"></circle><circle cx="9" cy="12" r="1"></circle><circle cx="9" cy="19" r="1"></circle>
                <circle cx="15" cy="5" r="1"></circle><circle cx="15" cy="12" r="1"></circle><circle cx="15" cy="19" r="1"></circle>
              </svg>
            </div>
            <h3 class="popup-card-title">${escapeHtml(displayTitle)}</h3>
          </div>
          <div class="popup-card-actions">
            <button class="btn sm" onclick="movePopup(${index}, -1)" ${canMoveUp ? "" : "disabled"} title="위로 이동">위</button>
            <button class="btn sm" onclick="movePopup(${index}, 1)" ${canMoveDown ? "" : "disabled"} title="아래로 이동">아래</button>
            <button class="btn sm ${enabled ? 'secondary' : 'primary'}" onclick="togglePopupEnabled(${index}, ${enabled})" title="${enabled ? '비활성화' : '활성화'}">
              ${enabled ? '비활성화' : '활성화'}
            </button>
            <button class="btn sm" onclick="openEditPopupModal(${index})">수정</button>
            <button class="btn sm warning" onclick="deletePopup(${index})">삭제</button>
          </div>
        </div>
        <div class="popup-card-body">
          <div class="popup-card-info">
            <strong>상태:</strong> 
            <span style="padding:4px 8px;border-radius:4px;font-size:12px;font-weight:600;display:inline-block;${enabled ? 'background:#10b981;color:#fff;' : 'background:var(--muted);color:#fff;'}">
              ${enabled ? '활성화됨' : '비활성화됨'}
            </span>
          </div>
          <div class="popup-card-info">
            <strong>위치:</strong> ${position}
          </div>
          <div class="popup-card-info">
            <strong>유형:</strong> ${escapeHtml(typeLabel)}
          </div>
          <div class="popup-card-info">
            <strong>순서:</strong> ${index + 1}
          </div>
          <div class="popup-card-info">
            <strong>등록일:</strong> ${createdAt}
          </div>
          ${popup.imageUrl ? `
            <div class="popup-card-info" style="grid-column:1/-1;">
              <strong>이미지:</strong> 
              <div style="margin-top:8px;" data-popup-image-wrapper>
                <img src="${escapeHtml(popup.imageUrl)}" alt="팝업 이미지" data-popup-image-path="${escapeHtml(popup.imageUrl)}" style="max-width:200px;max-height:150px;border-radius:8px;border:1px solid var(--border);object-fit:contain;">
                <div style="margin-top:4px;font-size:12px;color:var(--muted);word-break:break-all;">${escapeHtml(popup.imageUrl)}</div>
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
  
  container.querySelectorAll("img[data-popup-image-path]").forEach((img) => {
    setupImageFallback(img, img.dataset.popupImagePath || "", {
      hideOnFail: true,
      silentMissing: true,
      placeholderMessage: "이미지 준비 필요"
    });
  });

  // 드래그 앤 드롭 이벤트 초기화
  initPopupDragAndDrop();
}

function getPositionLabel(position) {
  const labels = {
    'center': '중앙',
    'top-left': '좌측 상단',
    'top-right': '우측 상단',
    'bottom-left': '좌측 하단',
    'bottom-right': '우측 하단',
    'custom': '사용자 지정(기존)'
  };
  return labels[position] || position;
}

async function savePopupOrder(message = "팝업 순서가 변경되었습니다.") {
  await setDoc(doc(db, "settings", "popups"), {
    popups: allPopups,
    updatedAt: serverTimestamp()
  }, { merge: true });
  invalidateSetting("popups");
  clearHomePopupCache();
  toast(message);
  await loadPopups();
}

window.movePopup = async function(index, direction) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= allPopups.length) return;
  const [item] = allPopups.splice(index, 1);
  allPopups.splice(nextIndex, 0, item);
  try {
    await savePopupOrder();
  } catch (error) {
    console.error("팝업 순서 변경 실패:", error);
    toast("팝업 순서 변경 실패: " + error.message, true);
    await loadPopups();
  }
};

// 팝업 목록 드래그 앤 드롭 초기화
function initPopupDragAndDrop() {
  const container = $("#popupListContainer");
  if (!container) return;
  
  const cards = container.querySelectorAll('.popup-card');
  cards.forEach(card => {
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/html', card.outerHTML);
      card.classList.add('dragging');
      card.style.opacity = '0.5';
    });
    
    card.addEventListener('dragend', (e) => {
      card.classList.remove('dragging');
      card.style.opacity = '1';
      // 드롭 표시 제거
      cards.forEach(c => {
        c.classList.remove('drag-over');
      });
    });
    
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      
      const afterElement = getDragAfterElement(container, e.clientY);
      const dragging = container.querySelector('.dragging');
      
      if (afterElement == null) {
        container.appendChild(dragging);
      } else {
        container.insertBefore(dragging, afterElement);
      }
      
      card.classList.add('drag-over');
    });
    
    card.addEventListener('dragleave', (e) => {
      card.classList.remove('drag-over');
    });
    
    card.addEventListener('drop', async (e) => {
      e.preventDefault();
      card.classList.remove('drag-over');
      
      const dragging = container.querySelector('.dragging');
      if (!dragging) return;
      
      // 새로운 순서 계산
      const newOrder = [];
      const cardElements = Array.from(container.querySelectorAll('.popup-card'));
      cardElements.forEach((cardEl, idx) => {
        const oldIndex = parseInt(cardEl.getAttribute('data-popup-index'));
        newOrder.push(allPopups[oldIndex]);
      });
      
      // 순서 업데이트
      allPopups = newOrder;
      
      // Firestore에 저장
      try {
        await savePopupOrder();
      } catch (error) {
        console.error("팝업 순서 변경 실패:", error);
        toast("팝업 순서 변경 실패: " + error.message, true);
        await loadPopups();
      }
    });
  });
}

// 드래그 위치 계산
function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.popup-card:not(.dragging)')];
  
  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    
    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

let popupFormDirty = false;

function requestDiscardPopupChanges() {
  const modal = $("#popupUnsavedConfirmModal");
  if (!modal) return Promise.resolve(false);
  modal.style.display = "flex";
  return new Promise((resolve) => {
    const finish = (discard) => {
      modal.style.display = "none";
      modal.removeEventListener("click", onClick);
      resolve(discard);
    };
    const onClick = (event) => {
      const action = event.target.closest("[data-popup-confirm]")?.dataset.popupConfirm;
      if (action === "discard") finish(true);
      else if (action === "cancel" || event.target === modal) finish(false);
    };
    modal.addEventListener("click", onClick);
  });
}

// 팝업 추가 모달 열기
window.openAddPopupModal = function() {
  currentPopup = null;
  openEditPopupModal();
};

// 팝업 수정 모달 열기
window.openEditPopupModal = function(index) {
  const modal = $("#popupEditModal");
  const form = $("#popupEditForm");
  if (!modal || !form) return;
  clearModalAlert($("#popupModalAlert"));
  if (index !== undefined && index !== null) {
    currentPopup = { ...allPopups[index], index };
  } else {
    currentPopup = null;
  }
  
  // 폼 초기화
  form.reset();
  clearImageLoadGuards();
  clearPopupImageValidationCache();
  lastPopupPreviewImageUrl = '';
  lastPopupDetailPreviewKey = '';
  $("#popupEditId").value = "";
  setPopupContentHtml("");
  renderPopupTextItemsEditor([]);
  clearPreparedPopupPreview();
  
  if (currentPopup) {
    // 수정 모드
    $("#popupModalTitle").textContent = "팝업창 수정";
    $("#popupEditEnabled").checked = currentPopup.enabled === true;
    $("#popupEditTitle").value = currentPopup.title || "";
    $("#popupEditPosition").value = POSITION_PRESETS.has(currentPopup.position) ? currentPopup.position : "center";
    $("#popupEditWidth").value = currentPopup.width || "auto";
    $("#popupEditHeight").value = currentPopup.height || "auto";
    $("#popupEditImageUrl").value = currentPopup.imageUrl || "";
    $("#popupEditImageLinkUrl").value = currentPopup.imageLinkUrl || "";
    $("#popupEditContentLinkUrl").value = currentPopup.contentLinkUrl || "";
    setPopupContentHtml(currentPopup.content || "");
    renderPopupTextItemsEditor(getPopupTextItemsForEditor(currentPopup));
    
    // 사용자 지정 위치 처리
    if (currentPopup.position === "custom" || (currentPopup.positionX && currentPopup.positionY)) {
      $("#popupEditPosition").value = "custom";
      $("#popupEditPositionX").value = currentPopup.positionX || "";
      $("#popupEditPositionY").value = currentPopup.positionY || "";
      $("#positionCustomGroup").style.display = "none";
      $("#positionCustomGroup").hidden = true;
    } else {
      $("#positionCustomGroup").style.display = "none";
      $("#positionCustomGroup").hidden = true;
    }
    
    // 이미지 미리보기
    updateImagePreviewNow();
    
    // 이미지 리사이즈 기능 초기화
    setTimeout(() => {
      initPopupEditorImages();
    }, 100);
  } else {
    // 추가 모드
    $("#popupModalTitle").textContent = "팝업창 추가";
    $("#popupEditEnabled").checked = false;
    $("#popupEditTitle").value = "";
    $("#popupEditPosition").value = "center";
    $("#popupEditWidth").value = "auto";
    $("#popupEditHeight").value = "auto";
    $("#popupEditImageUrl").value = "";
    $("#popupEditImageLinkUrl").value = "";
    $("#popupEditContentLinkUrl").value = "";
    setPopupContentHtml("");
    renderPopupTextItemsEditor([]);
    $("#popupImagePreview").style.display = "none";
    $("#positionCustomGroup").style.display = "none";
    $("#positionCustomGroup").hidden = true;
  }
  
  // 미리보기 업데이트
  updatePopupPreview();
  popupFormDirty = false;
  
  document.body.classList.add("modal-open");
  modal.style.display = "flex";
};

// 모달 닫기
window.closePopupModal = async function(force = false) {
  if (!force && popupFormDirty && !(await requestDiscardPopupChanges())) return;
  clearTimeout(popupImagePreviewTimer);
  clearTimeout(previewUpdateTimer);
  popupImagePreviewTimer = 0;
  previewUpdateTimer = null;
  lastPopupPreviewImageUrl = '';
  lastPopupDetailPreviewKey = '';
  const modal = $("#popupEditModal");
  if (modal) {
    modal.style.display = "none";
    document.body.classList.remove("modal-open");
  }
  clearModalAlert($("#popupModalAlert"));
  clearPreparedPopupPreview();
  currentPopup = null;
  popupFormDirty = false;
};

const popupDirtyForm = $("#popupEditForm");
if (popupDirtyForm && popupDirtyForm.dataset.dirtyTrackingBound !== "1") {
  popupDirtyForm.dataset.dirtyTrackingBound = "1";
  const markDirty = (event) => { if (event.isTrusted) popupFormDirty = true; };
  popupDirtyForm.addEventListener("input", markDirty);
  popupDirtyForm.addEventListener("change", markDirty);
  popupDirtyForm.addEventListener("click", (event) => {
    if (event.isTrusted && event.target.closest("[data-popup-text-action], #popupAddTextItemBtn")) popupFormDirty = true;
  });
}

// 위치 선택 변경 시 사용자 지정 옵션 표시/숨김
$("#popupEditPosition")?.addEventListener("change", (e) => {
  const positionCustomGroup = $("#positionCustomGroup");
  if (positionCustomGroup) {
    positionCustomGroup.style.display = "none";
    positionCustomGroup.hidden = true;
  }
  updatePopupPreview();
});

// 이미지 미리보기 업데이트
function updateImagePreviewNow() {
  const imageUrl = normalizePopupImagePath($("#popupEditImageUrl")?.value || "");
  const preview = $("#popupImagePreview");
  const previewImg = $("#popupImagePreviewImg");
  
  if (preview && previewImg) {
    if (imageUrl && imageUrl.trim()) {
      const originalPath = imageUrl.trim();
      const previewSrc = originalPath;
      if (
        originalPath === lastPopupPreviewImageUrl
        && (previewImg.dataset.loadState === 'ok' || previewImg.dataset.loadState === 'pending' || isImageLoadExhausted(previewSrc))
      ) {
        validatePopupActualImagePath(originalPath);
        return;
      }
      if (originalPath !== lastPopupPreviewImageUrl) {
        resetImageLoadGuard(previewSrc);
      }
      lastPopupPreviewImageUrl = originalPath;

      preview.style.display = "none";
      previewImg.removeAttribute("src");
      assignImageSrc(previewImg, previewSrc, {
        onSuccess: () => {
          preview.style.display = "block";
          setPopupImagePathStatus("이미지 URL이 확인되었습니다.", true);
        },
        onGiveUp: () => {
          preview.style.display = "none";
          previewImg.removeAttribute("src");
          setPopupImagePathStatus(
            isRemotePublicImageUrl(originalPath) ? getPopupInvalidR2UrlMessage() : getPopupMissingPathMessage(),
            false
          );
        },
      });
      validatePopupActualImagePath(originalPath);
    } else {
      preview.style.display = "none";
      previewImg.removeAttribute("src");
      previewImg.removeAttribute("data-load-key");
      previewImg.removeAttribute("data-load-state");
      lastPopupPreviewImageUrl = '';
      popupImagePathValidationToken++;
      setPopupImagePathStatus("공개 이미지 URL을 입력하세요.");
    }
  }
}

function updateImagePreview() {
  clearTimeout(popupImagePreviewTimer);
  popupImagePreviewTimer = window.setTimeout(() => {
    popupImagePreviewTimer = 0;
    updateImagePreviewNow();
  }, 150);
}

// 이미지 제거
window.clearPopupImage = function() {
  $("#popupEditImageUrl").value = "";
  const imageLinkInput = $("#popupEditImageLinkUrl");
  if (imageLinkInput) imageLinkInput.value = "";
  clearPreparedPopupPreview();
  updateImagePreview();
  debounceUpdatePreview();
};

// 리치 에디터 포맷팅 함수
window.formatPopupText = (command) => {
  const editor = $("#popupContent");
  if (!editor) return;
  
  editor.focus();
  document.execCommand(command, false, null);
};

// 텍스트 정렬 함수
window.alignPopupText = (align) => {
  const editor = $("#popupContent");
  if (!editor) return;
  
  editor.focus();
  
  if (align === 'left') {
    document.execCommand('justifyLeft', false, null);
  } else if (align === 'center') {
    document.execCommand('justifyCenter', false, null);
  } else if (align === 'right') {
    document.execCommand('justifyRight', false, null);
  } else if (align === 'justify') {
    document.execCommand('justifyFull', false, null);
  }
};

// 글꼴 변경
window.changePopupFontFamily = () => {
  const editor = $("#popupContent");
  const fontFamily = $("#popupFontFamily")?.value;
  if (!editor || !fontFamily) return;
  
  editor.focus();
  document.execCommand('fontName', false, fontFamily);
};

// 글자 크기 변경
window.changePopupFontSize = () => {
  const editor = $("#popupContent");
  const fontSize = $("#popupFontSize")?.value;
  if (!editor || !fontSize) return;
  
  editor.focus();
  
  const selection = window.getSelection();
  if (selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    if (!range.collapsed) {
      const span = document.createElement('span');
      span.style.fontSize = fontSize;
      try {
        range.surroundContents(span);
      } catch (e) {
        const contents = range.extractContents();
        span.appendChild(contents);
        range.insertNode(span);
      }
    }
  }
};

// 글자 색깔 변경
window.changePopupFontColor = () => {
  const editor = $("#popupContent");
  const fontColor = $("#popupFontColor")?.value;
  if (!editor || !fontColor) return;
  
  editor.focus();
  document.execCommand('foreColor', false, fontColor);
};

// 배경 색상 변경
window.changePopupBackgroundColor = () => {
  const editor = $("#popupContent");
  const bgColor = $("#popupBackgroundColor")?.value;
  
  if (!editor || !bgColor) return;
  
  editor.focus();
  document.execCommand('backColor', false, bgColor);
};

// 팝업 에디터 이미지 리사이즈 초기화 (간단 버전)
function initPopupImageResize(imgElement) {
  if (!imgElement || imgElement.getAttribute('data-resize-initialized') === 'true') return;
  
  imgElement.setAttribute('data-resize-initialized', 'true');
  imgElement.style.display = 'inline-block';
  imgElement.style.verticalAlign = 'middle';
  imgElement.style.cursor = 'pointer';
  imgElement.style.position = 'relative';
  
  // 이미지가 팝업창 크기에 맞게 자동 조절되도록 설정
  if (!imgElement.style.width || imgElement.style.width === 'auto') {
    imgElement.style.maxWidth = '100%';
    imgElement.style.width = 'auto';
    imgElement.style.height = 'auto';
  }
  imgElement.style.objectFit = 'contain';
  
  // 클릭으로 모달 폼 표시 (중복 방지)
  const existingClickHandler = imgElement.getAttribute('data-has-click-handler');
  if (!existingClickHandler) {
    imgElement.setAttribute('data-has-click-handler', 'true');
    imgElement.style.cursor = 'pointer';
    
    imgElement.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const savePath = imgElement.getAttribute('data-save-path') || imgElement.getAttribute('data-image-path') || '';
      const gridContainer = imgElement.closest('[data-image-grid]');
      const totalImages = gridContainer ? gridContainer.querySelectorAll('img').length : 1;
      const imageIndex = parseInt(imgElement.getAttribute('data-image-index') || '0');
      showPopupImageEditModal(imgElement, null, savePath, totalImages);
    });
  }
  
  // 더블클릭으로 크기/위치 편집 또는 모달 표시
  const existingDblClickHandler = imgElement.getAttribute('data-has-dblclick-handler');
  if (!existingDblClickHandler) {
    imgElement.setAttribute('data-has-dblclick-handler', 'true');
    
    imgElement.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      // 더블클릭 시 모달 폼 표시 (URL, 크기, 위치 모두 설정 가능)
      const savePath = imgElement.getAttribute('data-save-path') || imgElement.getAttribute('data-image-path') || '';
      const gridContainer = imgElement.closest('[data-image-grid]');
      const totalImages = gridContainer ? gridContainer.querySelectorAll('img').length : 1;
      showPopupImageEditModal(imgElement, null, savePath, totalImages);
    });
  }
}

// 팝업 이미지 편집 모달 (URL, 크기 등 설정)
window.showPopupImageEditModal = function(imgElement, webpFile, defaultPath, totalImages) {
  // 이미 모달이 열려있으면 중복 방지
  if (document.querySelector('.popup-image-edit-modal')) {
    return;
  }
  
  const currentUrl = imgElement.closest('a')?.href || '';
  const currentWidth = imgElement.style.width || 'auto';
  const imageIndex = parseInt(imgElement.getAttribute('data-image-index') || '0') + 1;
  
  // 모달 생성
  const modal = document.createElement('div');
  modal.className = 'modal-overlay popup-image-edit-modal';
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10001;';
  
  modal.innerHTML = `
    <div style="background:var(--card);padding:24px;border-radius:12px;max-width:500px;width:90%;border:1px solid var(--border);box-shadow:0 8px 32px rgba(0,0,0,0.3);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h3 style="margin:0;color:var(--text);">이미지 설정${totalImages > 1 ? ` (${imageIndex}/${totalImages})` : ''}</h3>
        <button class="modal-close-btn" style="background:none;border:none;font-size:28px;cursor:pointer;color:var(--muted);padding:0;width:32px;height:32px;line-height:32px;" onclick="this.closest('.modal-overlay').remove()">&times;</button>
      </div>
      
      <div style="margin-bottom:20px;text-align:center;">
        <img src="${imgElement.src}" alt="미리보기" style="max-width:100%;max-height:200px;border-radius:8px;border:1px solid var(--border);object-fit:contain;">
      </div>
      
      <div class="form-group" style="margin-bottom:16px;">
        <label style="display:block;margin-bottom:8px;color:var(--text);font-size:14px;font-weight:600;">이미지 링크 (선택)</label>
        <input type="text" id="popupImageUrlInput" value="${currentUrl}" placeholder="/courses.html 또는 https://example.com" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:14px;">
        <small style="display:block;margin-top:4px;color:var(--muted);font-size:12px;">비우면 링크를 제거합니다.</small>
      </div>
      
      <div class="form-group" style="margin-bottom:20px;">
        <label style="display:block;margin-bottom:8px;color:var(--text);font-size:14px;font-weight:600;">이미지 너비 (선택)</label>
        <input type="text" id="popupImageSizeInput" value="${currentWidth}" placeholder="auto, 200px, 50% 등" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:14px;">
        <small style="display:block;margin-top:4px;color:var(--muted);font-size:12px;">auto는 자동 조절</small>
      </div>
      
      <div style="display:flex;gap:8px;">
        <button class="btn primary" id="popupImageSaveBtn" style="flex:1;">저장</button>
        <button class="btn" id="popupImageCancelBtn" style="flex:1;background:var(--muted);">취소</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  const urlInput = modal.querySelector('#popupImageUrlInput');
  const sizeInput = modal.querySelector('#popupImageSizeInput');
  const saveBtn = modal.querySelector('#popupImageSaveBtn');
  const cancelBtn = modal.querySelector('#popupImageCancelBtn');
  
  const closeModal = () => {
    if (modal.parentNode) {
      document.body.removeChild(modal);
    }
    // 모달 클래스 제거
    const existingModal = document.querySelector('.popup-image-edit-modal');
    if (existingModal) {
      existingModal.classList.remove('popup-image-edit-modal');
    }
  };
  
  saveBtn.addEventListener('click', () => {
    const newUrl = urlInput.value.trim();
    const newSize = sizeInput.value.trim();
    
    // URL 설정
    const existingLink = imgElement.closest('a');
    if (newUrl) {
      if (existingLink) {
        existingLink.href = newUrl;
        if (newUrl.startsWith('http')) {
          existingLink.target = '_blank';
        } else {
          existingLink.removeAttribute('target');
        }
      } else {
        const link = document.createElement('a');
        link.href = newUrl;
        if (newUrl.startsWith('http')) {
          link.target = '_blank';
        }
        link.style.cssText = 'display:block;text-decoration:none;';
        imgElement.parentNode.insertBefore(link, imgElement);
        link.appendChild(imgElement);
      }
    } else if (existingLink) {
      // 링크 제거
      const parent = existingLink.parentNode;
      parent.insertBefore(imgElement, existingLink);
      existingLink.remove();
    }
    
    // 크기 설정
    if (newSize) {
      if (newSize === 'auto') {
        imgElement.style.width = 'auto';
        imgElement.style.maxWidth = '100%';
      } else {
        imgElement.style.width = newSize;
        imgElement.style.maxWidth = 'none';
        imgElement.setAttribute('data-width', newSize);
      }
    }
    
    debounceUpdatePreview();
    toast('이미지 설정이 저장되었습니다.');
    closeModal();
  });
  
  cancelBtn.addEventListener('click', closeModal);
  modal.querySelector('.modal-close-btn').addEventListener('click', closeModal);
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });
};

// 팝업 에디터의 모든 이미지에 리사이즈 기능 추가
function initPopupEditorImages() {
  const editor = $("#popupContent");
  if (!editor) return;
  
  const images = editor.querySelectorAll('img:not([data-resize-initialized])');
  images.forEach(img => {
    img.setAttribute('data-editable', 'true');
    initPopupImageResize(img);
    
    // 이미지 클릭 시 모달 폼 표시
    const existingClickHandler = img.getAttribute('data-has-click-handler');
    if (!existingClickHandler) {
      img.setAttribute('data-has-click-handler', 'true');
      img.style.cursor = 'pointer';
      
      img.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const savePath = img.getAttribute('data-save-path') || img.getAttribute('data-image-path') || '';
        const gridContainer = img.closest('[data-image-grid]');
        const totalImages = gridContainer ? gridContainer.querySelectorAll('img').length : 1;
        // webpFile은 없을 수 있으므로 null로 전달
        showPopupImageEditModal(img, null, savePath, totalImages);
      });
    }
  });
}

// 폼 제출
$("#popupEditForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  
  const enabled = $("#popupEditEnabled")?.checked || false;
  const title = $("#popupEditTitle")?.value.trim() || "";
  const position = $("#popupEditPosition")?.value || "center";
  const width = "auto";
  const height = "auto";
  const positionX = $("#popupEditPositionX")?.value.trim() || "";
  const positionY = $("#popupEditPositionY")?.value.trim() || "";
  const imageUrl = normalizePopupImagePath($("#popupEditImageUrl")?.value || "");
  const imageLinkUrl = $("#popupEditImageLinkUrl")?.value.trim() || "";
  const contentLinkUrl = $("#popupEditContentLinkUrl")?.value.trim() || "";
  const textItems = readPopupTextItemsForSave();
  let content = getPopupContentHtml();
  const safeImageLinkUrl = normalizeSafeLink(imageLinkUrl);
  const safeContentLinkUrl = normalizeSafeLink(contentLinkUrl);

  for (const item of readPopupTextItemsFromForm()) {
    if (!String(item.text || "").trim()) continue;
    if (item.linkUrl && !normalizeSafeLink(item.linkUrl)) {
      reportPopupError("문구 URL은 /로 시작하는 내부 경로 또는 https:// 주소만 사용할 수 있습니다.");
      return;
    }
    if (item.align && !POPUP_ALIGN_VALUES.has(normalizePopupAlign(item.align))) {
      reportPopupError("문구 정렬 값이 올바르지 않습니다.");
      return;
    }
  }

  if (imageUrl && !isSafePopupImagePath(imageUrl)) {
    reportPopupError(getPopupImageValidationMessage());
    return;
  }
  const imageUrlInputForSave = $("#popupEditImageUrl");
  if (imageUrlInputForSave && imageUrlInputForSave.value.trim() !== imageUrl) {
    imageUrlInputForSave.value = imageUrl;
  }
  if (imageLinkUrl && !safeImageLinkUrl) {
    reportPopupError("이미지 클릭 URL은 /로 시작하는 내부 경로 또는 https:// 주소만 사용할 수 있습니다.");
    return;
  }
  if (contentLinkUrl && !safeContentLinkUrl) {
    reportPopupError("문구/버튼 URL은 /로 시작하는 내부 경로 또는 https:// 주소만 사용할 수 있습니다.");
    return;
  }
  
  // Base64 이미지와 blob URL을 경로로 변환 (문서 크기 제한 방지)
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = content;
  
  // 모든 이미지 처리 (Base64, blob URL, 그리드 포함)
  const allImages = tempDiv.querySelectorAll('img');
  allImages.forEach(img => {
    // data-image-path 또는 data-save-path가 있으면 우선 사용
    const imagePath = img.getAttribute('data-image-path') || img.getAttribute('data-save-path');
    if (imagePath) {
      img.src = imagePath;
      img.removeAttribute('data-base64');
      img.removeAttribute('data-blob-url');
      img.removeAttribute('data-save-path');
    } else if (img.src.startsWith('blob:') || img.src.startsWith('data:') || img.hasAttribute('data-base64')) {
      // blob URL이나 Base64인데 경로가 없으면 경로 속성 재확인
      const path = img.getAttribute('data-image-path') || img.getAttribute('data-save-path');
      if (path) {
        img.src = path;
      }
      // 불필요한 속성 제거
      img.removeAttribute('data-blob-url');
      img.removeAttribute('data-base64');
      img.removeAttribute('data-save-path');
    }
  });
  
  const contentImages = tempDiv.querySelectorAll('img');
  for (const img of contentImages) {
    const src = img.getAttribute('data-image-path') || img.getAttribute('data-save-path') || img.getAttribute('src') || '';
    if (src && !isAllowedPublicImageUrl(src, { field: PUBLIC_IMAGE_FIELD.popup, allowEmpty: false })) {
      reportPopupError(`${getPopupImageValidationMessage()} (본문 이미지)`);
      return;
    }
  }

  content = sanitizePopupContentHtml(tempDiv.innerHTML);
  
  // 내용에서 이미지가 있는지 확인 (그리드 포함)
  const hasTextItems = textItems.some((item) => item.enabled !== false && String(item.text || "").trim());
  const tempDivCheck = document.createElement("div");
  tempDivCheck.innerHTML = content;
  const hasImages = tempDivCheck.querySelectorAll("img").length > 0;
  const hasTextContent = hasTextItems || tempDivCheck.textContent.trim().length > 0;
  const isMainImageOnly = Boolean(imageUrl && !hasImages && !hasTextContent);
  const finalImageLinkUrl = isMainImageOnly ? (safeImageLinkUrl || safeContentLinkUrl) : safeImageLinkUrl;
  const finalContentLinkUrl = isMainImageOnly ? "" : safeContentLinkUrl;
  
  // 이미지나 내용 중 하나는 있어야 함
  if (!imageUrl && !hasImages && !hasTextContent) {
    reportPopupError("팝업 이미지 또는 문구 중 하나 이상을 입력해주세요.");
    return;
  }
  
  try {
    const popupData = {
      id: currentPopup?.id || createPopupId(),
      title,
      enabled,
      position,
      width,
      height,
      imageUrl,
      imageLinkUrl: finalImageLinkUrl,
      content,
      contentLinkUrl: finalContentLinkUrl,
      textItems: textItems.map((item, index) => ({
        id: item.id,
        text: item.text,
        linkUrl: item.linkUrl,
        align: normalizePopupAlign(item.align),
        sortOrder: index,
        enabled: item.enabled !== false,
      })),
    };

    if (position === "custom" && positionX && positionY) {
      popupData.positionX = positionX;
      popupData.positionY = positionY;
    }

    const now = new Date();
    
    if (currentPopup && currentPopup.index !== undefined) {
      // 수정 — 레거시 필드 보존
      allPopups[currentPopup.index] = { 
        ...allPopups[currentPopup.index], 
        ...popupData,
        updatedAt: now
      };
    } else {
      // 추가
      popupData.createdAt = now;
      popupData.updatedAt = now;
      allPopups.push(popupData);
    }
    
    // serverTimestamp()는 배열 밖에만 사용
    await setDoc(doc(db, "settings", "popups"), {
      popups: allPopups,
      updatedAt: serverTimestamp()
    }, { merge: true });
    invalidateSetting("popups");
    clearHomePopupCache();

    const imageAvailable = await checkPopupAssetPathAvailable(imageUrl);
    const isR2Image = isRemotePublicImageUrl(imageUrl);
    toast(
      imageUrl && !imageAvailable && !isR2Image
        ? "팝업 정보는 저장되었습니다. 이미지 파일은 assets/popup 폴더에 넣고 npm run deploy를 실행해야 표시됩니다."
        : isR2Image
          ? "팝업 설정이 저장되었습니다. R2 public URL은 배포 없이 공개 사이트에 반영됩니다."
          : "팝업 설정이 저장되었습니다."
    );
    closePopupModal(true);
    await loadPopups();
  } catch (error) {
    console.error("팝업 설정 저장 실패:", error);
    reportPopupError("팝업 설정 저장 실패: " + error.message);
  }
});

// 팝업 활성화/비활성화 토글
window.togglePopupEnabled = async function(index, currentEnabled) {
  try {
    allPopups[index].enabled = !currentEnabled;
    await setDoc(doc(db, "settings", "popups"), {
      popups: allPopups,
      updatedAt: serverTimestamp()
    }, { merge: true });
    invalidateSetting("popups");
    clearHomePopupCache();
    
    toast(!currentEnabled ? "팝업창이 활성화되었습니다." : "팝업창이 비활성화되었습니다.");
    await loadPopups();
  } catch (error) {
    console.error("팝업 상태 변경 실패:", error);
    toast("팝업 상태 변경 실패: " + error.message, true);
  }
};

// 팝업 삭제
window.deletePopup = async function(index) {
  if (!confirm("정말 이 팝업창을 삭제하시겠습니까?")) {
    return;
  }
  
  try {
    allPopups.splice(index, 1);
    await setDoc(doc(db, "settings", "popups"), {
      popups: allPopups,
      updatedAt: serverTimestamp()
    }, { merge: true });
    invalidateSetting("popups");
    clearHomePopupCache();

    toast("팝업창이 삭제되었습니다.");
    await loadPopups();
  } catch (error) {
    console.error("팝업 삭제 실패:", error);
    toast("팝업 삭제 실패: " + error.message, true);
  }
};

// 모달 외부 클릭 시 닫기 방지 (닫기 버튼이나 X만 닫기 가능)
$("#popupEditModal")?.addEventListener("click", (e) => {
  // 모달 외부 클릭 시 닫지 않음 (닫기 버튼이나 X만 닫기 가능)
  // if (e.target.id === "popupEditModal") {
  //   closePopupModal();
  // }
});

// ESC 키로 모달 닫기 (확인 후)
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && $("#popupEditModal")?.style.display === "flex") {
    closePopupModal();
  }
});

// 운영자용 단순 미리보기: 홈 팝업 렌더링과 같은 필드만 사용한다.
window.updatePopupPreview = function() {
  const previewContainer = $("#popupPreviewContainer");
  if (!previewContainer) return;

  const rawContent = getPopupContentHtml();
  const textItems = readPopupTextItemsFromForm().filter((item) => item.enabled !== false && String(item.text || "").trim());
  const imageUrl = normalizePopupImagePath($("#popupEditImageUrl")?.value || "");
  const rawImageLinkUrl = normalizeSafeLink($("#popupEditImageLinkUrl")?.value || "");
  const rawContentLinkUrl = normalizeSafeLink($("#popupEditContentLinkUrl")?.value || "");
  const position = $("#popupEditPosition")?.value || "center";

  const temp = document.createElement("div");
  temp.innerHTML = rawContent;
  const hasLegacyText = temp.textContent.trim().length > 0 || Boolean(temp.querySelector("img"));
  const hasTextItems = textItems.length > 0;
  const hasText = hasTextItems || hasLegacyText;
  const hasImage = Boolean(imageUrl);
  const imageLinkUrl = hasImage && !hasText ? (rawImageLinkUrl || rawContentLinkUrl) : rawImageLinkUrl;
  const contentLinkUrl = hasText && !hasTextItems ? rawContentLinkUrl : "";

  if (!hasImage && !hasText) {
    previewContainer.innerHTML = '<div class="muted" style="text-align:center;">내용을 입력하면 표시됩니다.</div>';
    return;
  }

  const previewImageSrc = hasImage ? getPreparedPreviewSrc(imageUrl) : "";
  const safeImageSrc = previewImageSrc ? escapeHtml(previewImageSrc) : "";
  const safeImageHref = imageLinkUrl ? escapeHtml(imageLinkUrl) : "";
  const safeContentHref = contentLinkUrl ? escapeHtml(contentLinkUrl) : "";
  const imageTargetAttrs = imageLinkUrl ? ' target="_blank" rel="noopener noreferrer"' : "";
  const contentTargetAttrs = contentLinkUrl.startsWith("https://") ? ' target="_blank" rel="noopener noreferrer"' : "";
  const textItemsHtml = hasTextItems
    ? buildPopupTextItemsHtml(textItems, { escapeHtml, normalizeSafeUrl: normalizeSafeLink })
    : "";

  const previewKey = JSON.stringify({
    imageUrl: safeImageSrc,
    textItems,
    rawContent,
    imageLinkUrl,
    contentLinkUrl,
    position,
    hasText,
    hasImage,
  });
  if (previewKey === lastPopupDetailPreviewKey && previewContainer.querySelector(".popup-preview-stage")) {
    return;
  }
  lastPopupDetailPreviewKey = previewKey;

  const imageHtml = safeImageSrc && !isImageLoadExhausted(previewImageSrc)
    ? (safeImageHref
      ? `<a href="${safeImageHref}"${imageTargetAttrs} class="popup-preview-image-link"><img data-guarded-src="${safeImageSrc}" alt="팝업 이미지" class="popup-preview-main-image"></a>`
      : `<img data-guarded-src="${safeImageSrc}" alt="팝업 이미지" class="popup-preview-main-image">`)
    : safeImageSrc
      ? `<div class="popup-preview-image-missing" style="padding:16px;color:var(--muted);font-size:13px;text-align:center;">이미지를 불러올 수 없음</div>`
      : "";

  const previewPositions = new Set(["center", "top-left", "top-right", "bottom-left", "bottom-right"]);
  const positionClass = previewPositions.has(position) ? position : "center";
  previewContainer.innerHTML = `
    <div class="popup-preview-stage popup-preview-stage--${escapeHtml(positionClass)}">
      <div class="popup-preview-content-simple${hasImage && !hasText ? " popup-preview-content-simple--image-only" : ""}${hasText && !hasImage ? " popup-preview-content-simple--text-only" : ""}">
        <button type="button" class="popup-preview-btn-x" aria-label="닫기">&times;</button>
        <div class="popup-preview-body-simple">
          ${imageHtml}
          ${hasTextItems ? `<div class="popup-preview-text-items">${textItemsHtml}</div>` : ""}
          ${!hasTextItems && hasLegacyText ? `<div class="popup-preview-text-simple">${rawContent}</div>` : ""}
          ${safeContentHref ? `<a href="${safeContentHref}"${contentTargetAttrs} class="popup-preview-cta">자세히 보기</a>` : ""}
        </div>
        <div class="popup-preview-footer-simple">
          <button type="button">오늘 하루 보지 않기</button>
          <button type="button" class="primary">닫기</button>
        </div>
      </div>
    </div>
  `;
  bindGuardedImages(previewContainer, { includeInlineSrc: true });
};

// 내용 변경 시 미리보기 자동 업데이트 (실시간)
let previewUpdateTimer = null;
function debounceUpdatePreview() {
  if (previewUpdateTimer) clearTimeout(previewUpdateTimer);
  previewUpdateTimer = setTimeout(() => {
    updatePopupPreview();
  }, 300);
}
window.debounceUpdatePreview = debounceUpdatePreview;

// 즉시 미리보기 업데이트
function immediateUpdatePreview() {
  if (previewUpdateTimer) clearTimeout(previewUpdateTimer);
  updatePopupPreview();
}

$("#popupContent")?.addEventListener("input", debounceUpdatePreview);
$("#popupEditWidth")?.addEventListener("input", debounceUpdatePreview);
$("#popupEditHeight")?.addEventListener("input", debounceUpdatePreview);
$("#popupEditPositionX")?.addEventListener("input", debounceUpdatePreview);
$("#popupEditPositionY")?.addEventListener("input", debounceUpdatePreview);
$("#popupEditPosition")?.addEventListener("change", immediateUpdatePreview);
$("#popupEditEnabled")?.addEventListener("change", immediateUpdatePreview);
$("#popupEditImageUrl")?.addEventListener("input", () => {
  const input = $("#popupEditImageUrl");
  if (input) {
    input.value = normalizePopupImagePath(input.value);
  }
  updateImagePreview();
  debounceUpdatePreview();
});
$("#popupEditImageLinkUrl")?.addEventListener("input", debounceUpdatePreview);

bindPopupTextItemActions();

// 초기화
(async () => {
  await loadPopups();
})();
