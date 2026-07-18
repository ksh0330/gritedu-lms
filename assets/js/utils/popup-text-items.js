const POPUP_ALIGN_VALUES = new Set(["left", "center", "right"]);

function trimText(value) {
  return String(value ?? "").trim();
}

export function createPopupTextItemId() {
  return `text_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizePopupAlign(value) {
  const align = trimText(value).toLowerCase();
  return POPUP_ALIGN_VALUES.has(align) ? align : "center";
}

export function normalizePopupTextItems(popup = {}) {
  const raw = Array.isArray(popup.textItems) ? popup.textItems : [];
  return raw
    .map((item, index) => {
      const text = trimText(item?.text);
      if (!text) return null;
      return {
        id: trimText(item?.id) || createPopupTextItemId(),
        text,
        linkUrl: trimText(item?.linkUrl),
        align: normalizePopupAlign(item?.align),
        sortOrder: Number.isFinite(Number(item?.sortOrder)) ? Number(item.sortOrder) : index,
        enabled: item?.enabled !== false,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function getEnabledPopupTextItems(popup = {}) {
  return normalizePopupTextItems(popup).filter((item) => item.enabled !== false);
}

export function popupHasTextItems(popup = {}) {
  return getEnabledPopupTextItems(popup).length > 0;
}

export function buildPopupTextItemsHtml(items, { escapeHtml, normalizeSafeUrl }) {
  const list = Array.isArray(items) ? items.filter((item) => item.enabled !== false && trimText(item.text)) : [];
  if (!list.length) return "";

  const rows = list
    .map((item) => {
      const safeText = escapeHtml(item.text);
      const safeUrl = normalizeSafeUrl(item.linkUrl);
      const alignClass = `popup-text-item--${normalizePopupAlign(item.align)}`;
      if (safeUrl) {
        const targetAttrs = safeUrl.startsWith("https://") ? ' target="_blank" rel="noopener noreferrer"' : "";
        return `<a href="${escapeHtml(safeUrl)}" class="popup-text-item ${alignClass}"${targetAttrs}>${safeText}</a>`;
      }
      return `<p class="popup-text-item ${alignClass}">${safeText}</p>`;
    })
    .join("");

  return `<div class="popup-text-items">${rows}</div>`;
}

export { POPUP_ALIGN_VALUES };
