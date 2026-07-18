// /assets/js/pages/home-popup.js
// 메인 홈페이지 팝업창 표시 (여러 팝업 지원)
import { db } from "/assets/js/firebase-init.js";
import { doc, getDocFromServer } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { escapeHtml } from "/assets/js/utils/html.js";
import {
  PUBLIC_IMAGE_FIELD,
  sanitizePublicImageSrc,
} from "/assets/js/utils/public-image-url.js";
import { bindGuardedImages } from "/assets/js/utils/image-load-guard.js";
import {
  getEnabledPopupTextItems,
  buildPopupTextItemsHtml,
} from "/assets/js/utils/popup-text-items.js";

const POPUP_STORAGE_KEY = "grit-popup-dismissed";
const POPUP_CACHE_KEY = "grit-popup-cache";
const POPUP_UPDATE_SIGNAL_KEY = "grit-popup-updated-at";
const POPUP_CACHE_TTL_MS = 5 * 60 * 1000; // launch restore: keep popup setting changes reasonably fresh
const ALLOWED_POSITIONS = new Set(["center", "top-left", "top-right", "bottom-left", "bottom-right", "custom"]);
const STACK_POSITIONS = ["center", "top-left", "top-right", "bottom-left", "bottom-right"];
let lastPopupUpdateSignal = localStorage.getItem(POPUP_UPDATE_SIGNAL_KEY) || "";

function todayKey() {
  return new Date().toISOString().split("T")[0];
}

function normalizeSafeUrl(value, { allowRelative = true, allowHttps = true } = {}) {
  const url = String(value || "").trim();
  if (!url) return "";
  if (allowRelative && /^\/(?!\/)/.test(url)) return url;
  if (allowHttps && /^https:\/\//i.test(url)) return url;
  return "";
}

function normalizePopupSize(value) {
  const size = String(value || "").trim();
  if (!size || size === "auto") return "auto";
  if (/^\d{1,4}(\.\d{1,2})?(px|%|vw|vh|rem|em)$/.test(size)) return size;
  return "auto";
}

function normalizePositionOffset(value) {
  const offset = String(value || "").trim();
  if (/^-?\d{1,4}(\.\d{1,2})?(px|%)$/.test(offset)) return offset;
  return "";
}

function normalizePopupId(value, index) {
  const directId = String(value?.id || "").trim();
  if (directId) return directId.replace(/[^A-Za-z0-9._:-]/g, "_");

  const createdAt = value?.createdAt;
  if (createdAt) {
    const createdValue =
      typeof createdAt.toMillis === "function"
        ? createdAt.toMillis()
        : (typeof createdAt.toDate === "function" ? createdAt.toDate().getTime() : new Date(createdAt).getTime());
    if (Number.isFinite(createdValue)) return `created-${createdValue}`;
  }

  return `index-${index}`;
}

function normalizePopupVersion(value) {
  const updatedAt = value?.updatedAt || value?.createdAt;
  if (!updatedAt) return "unversioned";
  if (typeof updatedAt.seconds === "number") {
    return String((updatedAt.seconds * 1000) + Math.floor((updatedAt.nanoseconds || 0) / 1000000));
  }
  const updatedValue =
    typeof updatedAt.toMillis === "function"
      ? updatedAt.toMillis()
      : (typeof updatedAt.toDate === "function" ? updatedAt.toDate().getTime() : new Date(updatedAt).getTime());
  return Number.isFinite(updatedValue) ? String(updatedValue) : "unversioned";
}

function popupDismissKey(popupId, popupVersion = "unversioned") {
  return `${POPUP_STORAGE_KEY}:${popupId}:${popupVersion}`;
}

function isDismissedToday(popup) {
  return localStorage.getItem(popupDismissKey(popup.id, popup.version)) === todayKey();
}

function sanitizePopupContent(html) {
  const raw = String(html || "").trim();
  if (!raw) return "";

  const template = document.createElement("template");
  template.innerHTML = raw;
  template.content.querySelectorAll("script, style, iframe, object, embed, link, meta").forEach((node) => node.remove());

  template.content.querySelectorAll("*").forEach((node) => {
    Array.from(node.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on") || name === "srcset") {
        node.removeAttribute(attr.name);
      }
    });

    if (node.tagName === "A") {
      const safeHref = normalizeSafeUrl(node.getAttribute("href"));
      if (safeHref) {
        node.setAttribute("href", safeHref);
        if (safeHref.startsWith("https://")) {
          node.setAttribute("target", "_blank");
          node.setAttribute("rel", "noopener noreferrer");
        } else {
          node.removeAttribute("target");
          node.removeAttribute("rel");
        }
      } else {
        node.removeAttribute("href");
        node.removeAttribute("target");
        node.removeAttribute("rel");
      }
    }

    if (node.tagName === "IMG") {
      const safeSrc = sanitizePublicImageSrc(node.getAttribute("src"), { field: PUBLIC_IMAGE_FIELD.popup });
      if (safeSrc) {
        node.setAttribute("src", safeSrc);
      } else {
        node.remove();
      }
    }
  });

  return template.innerHTML.trim();
}

function contentHasUsableDisplay(html) {
  if (!html) return false;
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content.textContent.trim().length > 0 || !!template.content.querySelector("img");
}

function normalizePopup(popup, index) {
  if (!popup || typeof popup !== "object" || popup.enabled !== true) return null;

  const imageUrl = sanitizePublicImageSrc(popup.imageUrl, { field: PUBLIC_IMAGE_FIELD.popup });
  const rawImageLinkUrl = normalizeSafeUrl(popup.imageLinkUrl);
  const rawContentLinkUrl = normalizeSafeUrl(popup.contentLinkUrl);
  const content = sanitizePopupContent(popup.content);
  const textItems = getEnabledPopupTextItems(popup);
  const hasImage = !!imageUrl;
  const hasTextItems = textItems.length > 0;
  const hasContent = !hasTextItems && contentHasUsableDisplay(content);

  if (!hasImage && !hasTextItems && !hasContent) return null;

  const position = ALLOWED_POSITIONS.has(popup.position) ? popup.position : "center";
  const normalized = {
    id: normalizePopupId(popup, index),
    version: normalizePopupVersion(popup),
    imageUrl,
    imageLinkUrl: hasImage && !hasTextItems && !hasContent ? (rawImageLinkUrl || rawContentLinkUrl) : rawImageLinkUrl,
    contentLinkUrl: hasContent ? rawContentLinkUrl : "",
    content,
    textItems,
    width: normalizePopupSize(popup.width),
    height: normalizePopupSize(popup.height),
    position
  };

  if (position === "custom") {
    normalized.positionX = normalizePositionOffset(popup.positionX) || "50%";
    normalized.positionY = normalizePositionOffset(popup.positionY) || "50%";
  }

  if (hasImage && !hasTextItems && !hasContent) {
    normalized.width = "auto";
    normalized.height = "auto";
  }

  return normalized;
}

// 팝업 설정 로드 (공개 페이지 — 서버 최신값)
async function loadPopupSettings() {
  const popupDoc = await getDocFromServer(doc(db, "settings", "popups"));
  if (!popupDoc.exists()) {
    localStorage.removeItem(POPUP_CACHE_KEY);
    return null;
  }
  return popupDoc.data();
}

// 팝업창 표시
async function showPopups() {
  try {
    const popupData = await loadPopupSettings();
    const rawPopups = Array.isArray(popupData?.popups) ? popupData.popups : [];
    const enabledPopups = rawPopups
      .map((popup, index) => normalizePopup(popup, index))
      .filter(Boolean)
      .filter((popup) => !isDismissedToday(popup));
    if (enabledPopups.length === 0) return;

    renderPopupStack(enabledPopups);
  } catch (error) {
    console.error("[home-popup] 팝업창 로드 실패:", error);
  }
}

function renderPopupStack(popups) {
  if (!document.body) return;

  document.getElementById("grit-popup-root")?.remove();

  const root = document.createElement("div");
  root.id = "grit-popup-root";
  root.className = "grit-popup-root";
  root.innerHTML = '<div class="popup-backdrop" aria-hidden="true"></div>';

  const groups = new Map();
  STACK_POSITIONS.forEach((position) => {
    const group = document.createElement("div");
    group.className = `popup-stack popup-stack--${position}`;
    group.dataset.position = position;
    groups.set(position, group);
    root.appendChild(group);
  });

  const stackAllOnMobile = window.innerWidth < 768;
  popups.forEach((popup, index) => {
    const stackPosition = stackAllOnMobile
      ? "center"
      : (STACK_POSITIONS.includes(popup.position) ? popup.position : "center");
    const popupElement = createPopupElement(popup, index);
    if (popupElement) groups.get(stackPosition)?.appendChild(popupElement);
  });

  groups.forEach((group) => {
    if (group.children.length === 0) group.remove();
  });

  if (root.querySelector(".popup-content")) {
    document.body.appendChild(root);
    root.querySelectorAll(".popup-content").forEach((content) => adjustPopupImageSize(content));
    setupPopupEvents(root);
  }
}

// 팝업창 HTML 생성
function createPopupElement(popupData, index) {
  const safeImageUrl = popupData.imageUrl ? escapeHtml(popupData.imageUrl) : "";
  const safeImageLinkUrl = popupData.imageLinkUrl ? escapeHtml(popupData.imageLinkUrl) : "";
  const safeContentLinkUrl = popupData.contentLinkUrl ? escapeHtml(popupData.contentLinkUrl) : "";
  const linkAttrs = safeImageLinkUrl
    ? ' target="_blank" rel="noopener noreferrer"'
    : "";
  const contentLinkAttrs = safeContentLinkUrl.startsWith("https://")
    ? ' target="_blank" rel="noopener noreferrer"'
    : "";
  const hasTextItems = Array.isArray(popupData.textItems) && popupData.textItems.length > 0;
  const hasContent = !hasTextItems && contentHasUsableDisplay(popupData.content);
  const isImageOnly = Boolean(safeImageUrl && !hasTextItems && !hasContent);
  const isTextOnly = Boolean(!safeImageUrl && (hasTextItems || hasContent));
  const textItemsHtml = hasTextItems
    ? buildPopupTextItemsHtml(popupData.textItems, { escapeHtml, normalizeSafeUrl })
    : "";
  const imageHtml = safeImageUrl
    ? (safeImageLinkUrl
      ? `<a href="${safeImageLinkUrl}"${linkAttrs} class="popup-image-link"><img data-guarded-src="${safeImageUrl}" alt="팝업 이미지" class="popup-main-image"></a>`
      : `<img data-guarded-src="${safeImageUrl}" alt="팝업 이미지" class="popup-main-image">`)
    : "";

  if (!imageHtml && !hasContent && !hasTextItems) return null;

  const sizeStyle = [
    popupData.width !== "auto" ? `width:${popupData.width};` : "",
    popupData.height !== "auto" ? `height:${popupData.height};` : ""
  ].join("");

  const item = document.createElement("section");
  item.className = `popup-stack-item${isImageOnly ? " popup-stack-item--image-only" : ""}${isTextOnly ? " popup-stack-item--text-only" : ""}`;
  item.dataset.popupId = popupData.id;
  item.dataset.popupVersion = popupData.version;
  item.dataset.popupIndex = String(index);
  item.innerHTML = `
      <div class="popup-content${isImageOnly ? " popup-content--image-only" : ""}${isTextOnly ? " popup-content--text-only" : ""}" style="${sizeStyle}">
        <button class="popup-btn-x" type="button" data-popup-action="close" aria-label="닫기">&times;</button>
        <div class="popup-body">
          ${imageHtml}
          ${hasTextItems ? textItemsHtml : ""}
          ${hasContent ? `<div class="popup-text">${popupData.content}</div>` : ""}
          ${hasContent && safeContentLinkUrl ? `<a href="${safeContentLinkUrl}"${contentLinkAttrs} class="popup-text-cta">자세히 보기</a>` : ""}
        </div>
        <div class="popup-footer">
          <button class="popup-btn-dismiss" type="button" data-popup-action="dismiss-today">오늘 하루 보지 않기</button>
          <button class="popup-btn-close" type="button" data-popup-action="close">닫기</button>
        </div>
      </div>
  `;
  return item;
}

function adjustPopupImageSize(content) {
  if (!content) return;

  setTimeout(() => {
    const mainImage = content.querySelector(".popup-main-image");
    if (!mainImage) return;

    const adjustImagePopupSize = () => {
      if (!mainImage.naturalWidth || !mainImage.naturalHeight) return;
      const isMobile = window.innerWidth < 768;
      const isImageOnly = content.classList.contains("popup-content--image-only");
      const footerHeight = content.querySelector(".popup-footer")?.offsetHeight || 0;
      const bodyPadding = isImageOnly ? (isMobile ? 20 : 24) : (isMobile ? 32 : 40);
      const viewportPadding = isMobile ? 32 : 48;
      const maxPopupWidth = Math.max(240, Math.min(isImageOnly ? 720 : 640, window.innerWidth - viewportPadding));
      const maxPopupHeight = Math.max(220, window.innerHeight - viewportPadding);
      const imageMaxWidth = Math.max(120, maxPopupWidth - bodyPadding);
      const imageMaxHeight = Math.max(120, maxPopupHeight - footerHeight - bodyPadding);
      const aspect = mainImage.naturalWidth / mainImage.naturalHeight;
      let imageWidth = Math.min(mainImage.naturalWidth, imageMaxWidth);
      let imageHeight = imageWidth / aspect;

      if (imageHeight > imageMaxHeight) {
        imageHeight = imageMaxHeight;
        imageWidth = imageHeight * aspect;
      }

      const roundedImageWidth = Math.max(1, Math.floor(imageWidth));
      const roundedImageHeight = Math.max(1, Math.floor(imageHeight));
      mainImage.style.width = `${roundedImageWidth}px`;
      mainImage.style.height = `${roundedImageHeight}px`;
      mainImage.style.maxWidth = "100%";
      mainImage.style.objectFit = "contain";
      const imageLink = mainImage.closest(".popup-image-link");
      if (imageLink) {
        imageLink.style.width = `${roundedImageWidth}px`;
        imageLink.style.maxWidth = "100%";
      }

      content.style.width = `${Math.round(roundedImageWidth + bodyPadding)}px`;
      if (!isImageOnly && !content.style.height) {
        content.style.height = `${Math.round(roundedImageHeight + footerHeight + bodyPadding)}px`;
      }
    };

    if (mainImage.complete) {
      adjustImagePopupSize();
    } else {
      mainImage.addEventListener("load", adjustImagePopupSize, { once: true });
    }
  }, 50);
}

// 이벤트 리스너 설정
function setupPopupEvents(root) {
  const closePopup = (item) => {
    if (!item) return;
    item.style.opacity = "0";
    item.style.transition = "opacity 0.25s ease";
    setTimeout(() => {
      item.remove();
      if (!root.querySelector(".popup-stack-item")) root.remove();
    }, 250);
  };

  root.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-popup-action]");
    if (!actionButton) return;
    const item = actionButton.closest(".popup-stack-item");
    if (!item) return;
    if (actionButton.dataset.popupAction === "dismiss-today") {
      localStorage.setItem(popupDismissKey(item.dataset.popupId || "", item.dataset.popupVersion || "unversioned"), todayKey());
    }
    closePopup(item);
  });

  root.querySelectorAll(".popup-content").forEach((content) => {
    bindGuardedImages(content, {
      includeInlineSrc: true,
      onGiveUp: (img) => {
        if (img.classList.contains("popup-main-image")) {
          if (content.querySelector(".popup-text")) {
            img.style.display = "none";
          } else {
            closePopup(img.closest(".popup-stack-item"));
          }
          return;
        }
        img.style.display = "none";
      },
    });
  });

  root.querySelectorAll(".popup-image-link").forEach((imageLink) => {
    imageLink.addEventListener("click", (event) => {
      const href = imageLink.getAttribute("href") || "";
      if (!href) return;
      event.preventDefault();
      if (href.startsWith("https://") || href.startsWith("/")) {
        window.open(href, "_blank", "noopener,noreferrer");
      }
    });
  });
}

async function refreshPopups() {
  localStorage.removeItem(POPUP_CACHE_KEY);
  document.getElementById("grit-popup-root")?.remove();
  await showPopups();
}

// CSS 추가
function addPopupStyles() {
  if (document.getElementById("grit-popup-styles")) return;

  const style = document.createElement("style");
  style.id = "grit-popup-styles";
  style.textContent = `
    .grit-popup-root {
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      z-index: 9999;
      animation: fadeIn 0.3s ease;
      pointer-events: none;
    }

    .popup-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.35);
      pointer-events: none;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .popup-stack {
      position: fixed;
      display: flex;
      flex-direction: column;
      gap: 14px;
      max-height: calc(100dvh - 40px);
      overflow: auto;
      padding: 4px;
      pointer-events: none;
      scrollbar-width: thin;
    }

    .popup-stack--center {
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      align-items: center;
    }

    .popup-stack--top-left {
      top: 20px;
      left: 20px;
      align-items: flex-start;
    }

    .popup-stack--top-right {
      top: 20px;
      right: 20px;
      align-items: flex-end;
    }

    .popup-stack--bottom-left {
      bottom: 20px;
      left: 20px;
      align-items: flex-start;
    }

    .popup-stack--bottom-right {
      right: 20px;
      bottom: 20px;
      align-items: flex-end;
    }

    .popup-stack-item {
      pointer-events: auto;
      width: max-content;
      max-width: min(90vw, 640px);
    }

    .popup-stack-item--image-only {
      max-width: min(94vw, 720px);
    }

    .popup-stack-item--text-only {
      min-width: min(280px, 88vw);
    }

    .popup-content {
      position: relative;
      background: var(--card);
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      width: auto;
      max-width: min(90vw, 640px);
      max-height: min(680px, calc(100dvh - 40px));
      animation: slideUp 0.3s ease;
      box-sizing: border-box;
    }

    .popup-content--image-only {
      max-width: min(94vw, 720px);
    }

    .popup-content--text-only {
      min-width: min(280px, 88vw);
    }

    @keyframes slideUp {
      from {
        transform: translateY(20px);
        opacity: 0;
      }
      to {
        transform: translateY(0);
        opacity: 1;
      }
    }

    .popup-body {
      flex: 1;
      padding: 20px;
      overflow: auto;
      position: relative;
      display: flex;
      flex-direction: column;
      min-height: 0;
      max-width: 100%;
    }

    .popup-content--image-only .popup-body {
      padding: 12px;
      overflow: visible;
    }

    .popup-text {
      color: var(--text);
      line-height: 1.6;
      min-height: 0;
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    .popup-text-items {
      width: 100%;
      max-width: 100%;
      min-width: 0;
    }

    .popup-text-items .popup-text-item {
      display: block;
      width: 100%;
      max-width: 100%;
      margin: 0;
      padding: 0;
      color: var(--text);
      font-size: 15px;
      line-height: 1.55;
      overflow-wrap: anywhere;
      word-break: break-word;
      text-decoration: none;
    }

    .popup-text-items .popup-text-item + .popup-text-item {
      margin-top: 10px;
    }

    .popup-text-items .popup-text-item--left { text-align: left; }
    .popup-text-items .popup-text-item--center { text-align: center; }
    .popup-text-items .popup-text-item--right { text-align: right; }

    .popup-text-items .popup-text-item:hover,
    .popup-text-items .popup-text-item:focus {
      color: var(--brand);
    }

    .popup-main-image {
      max-width: 100%;
      max-height: min(62vh, 520px);
      width: auto;
      height: auto;
      object-fit: contain;
      display: block;
      margin: 0 auto;
      flex: 0 0 auto;
    }

    .popup-content--image-only .popup-main-image {
      max-height: min(70vh, 620px);
      border-radius: 8px;
      margin: 0 auto;
    }

    .popup-image-link {
      display: block;
      max-width: 100%;
      max-height: 100%;
      cursor: pointer;
      text-decoration: none;
    }

    .popup-content--image-only .popup-image-link {
      line-height: 0;
    }

    .popup-image-link:hover {
      opacity: 0.95;
    }

    .popup-text-cta {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin: 12px 0 0 auto;
      padding: 7px 12px;
      border-radius: 999px;
      background: var(--brand);
      color: #fff !important;
      text-decoration: none;
      font-weight: 700;
      font-size: 12px;
      line-height: 1.2;
      align-self: flex-end;
      box-shadow: 0 4px 10px rgba(255, 111, 0, 0.22);
    }

    .popup-text-cta:hover,
    .popup-text-cta:focus {
      background: var(--brand);
      color: #fff !important;
      text-decoration: none;
    }

    .popup-text img,
    .popup-body img {
      max-width: 100% !important;
      height: auto !important;
      object-fit: contain !important;
      border-radius: 8px;
      margin: 8px 0;
    }

    .popup-footer {
      padding: 12px 16px;
      border-top: 1px solid var(--border);
      display: flex;
      gap: 6px;
      justify-content: flex-end;
      flex-shrink: 0;
      background: var(--card);
    }

    .popup-content--image-only .popup-footer {
      padding: 8px 10px 10px;
    }

    .popup-btn-dismiss,
    .popup-btn-close {
      padding: 6px 12px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      transition: all 0.2s ease;
    }

    .popup-btn-dismiss {
      background: var(--hover);
      color: var(--text);
    }

    .popup-btn-dismiss:hover {
      background: var(--border);
    }

    .popup-btn-close {
      background: var(--brand);
      color: #fff;
    }

    .popup-btn-close:hover {
      background: #ff8c42;
    }

    .popup-btn-x {
      position: absolute;
      top: 12px;
      right: 12px;
      width: 32px;
      height: 32px;
      border: none;
      background: rgba(0, 0, 0, 0.5);
      color: #fff;
      border-radius: 50%;
      cursor: pointer;
      font-size: 20px;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100;
      transition: all 0.2s ease;
      font-weight: bold;
    }

    .popup-btn-x:hover {
      background: rgba(0, 0, 0, 0.7);
      transform: scale(1.1);
    }

    @media (max-width: 768px) {
      .popup-backdrop {
        background: rgba(0, 0, 0, 0.25);
      }

      .popup-stack {
        top: 12px !important;
        right: 12px !important;
        bottom: auto !important;
        left: 12px !important;
        transform: none !important;
        align-items: center;
        gap: 12px;
        max-height: calc(100dvh - 24px);
        overflow: auto;
      }

      .popup-stack-item,
      .popup-content {
        width: min(calc(100vw - 32px), 420px) !important;
        max-width: calc(100vw - 32px);
      }

      .popup-stack-item--image-only {
        width: auto !important;
        max-width: calc(100vw - 32px);
      }

      .popup-content--image-only {
        width: auto !important;
        max-width: calc(100vw - 32px);
      }

      .popup-content {
        height: auto !important;
        max-height: calc(100dvh - 24px);
      }

      .popup-footer {
        flex-direction: column;
      }

      .popup-btn-dismiss,
      .popup-btn-close {
        width: 100%;
        font-size: 12px;
        padding: 8px 10px;
      }

      .popup-body {
        padding: 16px;
      }

      .popup-content--image-only .popup-body {
        padding: 10px;
      }

      .popup-main-image {
        max-height: 56dvh;
      }

      .popup-text-cta {
        width: auto;
        align-self: flex-end;
      }
    }
  `;

  document.head.appendChild(style);
}

// 초기화
(async () => {
  addPopupStyles();
  await showPopups();
})();

window.addEventListener("storage", (event) => {
  if (event.key !== POPUP_UPDATE_SIGNAL_KEY || event.newValue === lastPopupUpdateSignal) return;
  lastPopupUpdateSignal = event.newValue || "";
  refreshPopups();
});

window.addEventListener("focus", () => {
  const currentSignal = localStorage.getItem(POPUP_UPDATE_SIGNAL_KEY) || "";
  if (currentSignal && currentSignal !== lastPopupUpdateSignal) {
    lastPopupUpdateSignal = currentSignal;
    refreshPopups();
  }
});
