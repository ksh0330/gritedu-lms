import { escapeHtml, sanitizeUrl } from "/assets/js/utils/html.js";

export const CONTACT_PUBLIC_PAGE_TITLE = "상담 문의";

const TRANSPORT_TYPE_META = {
  walking: { icon: "🚶", label: "도보" },
  subway: { icon: "🚇", label: "지하철" },
  bus: { icon: "🚌", label: "버스" },
  car: { icon: "🚗", label: "차량" },
  custom: { icon: "📍", label: "기타" },
};

const MAX_MESSAGE_LINES = 3;

function trimText(value) {
  return String(value ?? "").trim();
}

export function createContactTransportItemId() {
  return `transport_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function getTransportTypeLabel(type) {
  const key = trimText(type) || "custom";
  return TRANSPORT_TYPE_META[key]?.label || "기타";
}

function normalizeMapLinks(mapLinks = {}) {
  return {
    naver: trimText(mapLinks.naver),
    kakao: trimText(mapLinks.kakao),
    google: trimText(mapLinks.google),
  };
}

function resolveTransportItemText(item = {}) {
  const direct = String(item.text ?? "").replace(/\r\n/g, "\n").trim();
  if (direct) return direct;
  if (Array.isArray(item.lines) && item.lines.length) {
    return item.lines.map((line) => trimText(line)).filter(Boolean).join("\n");
  }
  return "";
}

function migrateTransportItemsFromTransportation(transportation = {}) {
  const items = [];
  ["walking", "subway", "bus", "car"].forEach((type, index) => {
    const text = trimText(transportation[type]);
    if (!text) return;
    items.push({
      id: `legacy-${type}`,
      type,
      label: getTransportTypeLabel(type),
      text,
      sortOrder: index,
    });
  });
  return items;
}

function migrateMessageLines(loc = {}) {
  if (Array.isArray(loc.messageLines) && loc.messageLines.length) {
    return loc.messageLines.map((line) => trimText(line)).filter(Boolean).slice(0, MAX_MESSAGE_LINES);
  }
  const legacy = trimText(loc.phoneNote);
  return legacy ? [legacy] : [];
}

function migrateHours(loc = {}, structureFallback = {}) {
  const hours = trimText(loc.hours);
  if (hours) return hours;
  const callable = trimText(loc.callableHours);
  if (callable) return callable;
  return trimText(structureFallback.hours) || "";
}

/** Admin load only: legacy Firestore location → canonical editor draft */
export function migrateLegacyContactLocation(raw = {}, structureFallback = {}) {
  const loc = raw || {};
  let transportItems = [];

  if (Array.isArray(loc.transportItems)) {
    transportItems = loc.transportItems
      .map((item, index) => {
        const type = trimText(item?.type) || "custom";
        const text = resolveTransportItemText(item);
        if (!text) return null;
        return {
          id: trimText(item?.id) || createContactTransportItemId(),
          type,
          label: getTransportTypeLabel(type),
          text,
          sortOrder: Number.isFinite(Number(item?.sortOrder)) ? Number(item.sortOrder) : index,
        };
      })
      .filter(Boolean);
  } else if (loc.transportation && typeof loc.transportation === "object") {
    transportItems = migrateTransportItemsFromTransportation(loc.transportation);
  }

  return {
    label: trimText(loc.label) || "위치 1",
    phone: trimText(loc.phone) || trimText(structureFallback.phone) || "",
    messageLines: migrateMessageLines(loc),
    onlineBookingUrl: trimText(loc.onlineBookingUrl) || "",
    hours: migrateHours(loc, structureFallback),
    address: trimText(loc.address) || trimText(structureFallback.address) || "",
    mapIframeSrc: trimText(loc.mapIframeSrc) || trimText(structureFallback.mapIframeSrc) || "",
    mapEmbedQuery: trimText(loc.mapEmbedQuery) || trimText(structureFallback.mapEmbedQuery) || "",
    mapLinks: normalizeMapLinks(loc.mapLinks || structureFallback.mapLinks),
    transportItems,
  };
}

/** Admin load only: legacy structure → locations[] */
export function migrateLegacyContactStructure(structure = {}) {
  if (Array.isArray(structure.locations) && structure.locations.length) {
    return structure.locations.map((loc) => migrateLegacyContactLocation(loc, structure));
  }
  if (structure.phone || structure.address) {
    return [
      migrateLegacyContactLocation(
        {
          label: "위치 1",
          phone: structure.phone,
          phoneNote: structure.phoneNote,
          callableHours: structure.callableHours,
          hours: structure.hours,
          address: structure.address,
          mapIframeSrc: structure.mapIframeSrc,
          mapEmbedQuery: structure.mapEmbedQuery,
          transportation: structure.transportation,
          mapLinks: structure.mapLinks,
        },
        structure
      ),
    ];
  }
  return [];
}

export function normalizeCanonicalTransportItem(item = {}, index = 0) {
  const type = trimText(item?.type) || "custom";
  const text = resolveTransportItemText(item);
  if (!text) return null;
  return {
    id: trimText(item?.id) || createContactTransportItemId(),
    type,
    label: getTransportTypeLabel(type),
    text,
    sortOrder: Number.isFinite(Number(item?.sortOrder)) ? Number(item.sortOrder) : index,
  };
}

export function normalizeCanonicalContactLocation(loc = {}) {
  const messageLines = (Array.isArray(loc.messageLines) ? loc.messageLines : [])
    .map((line) => trimText(line))
    .filter(Boolean)
    .slice(0, MAX_MESSAGE_LINES);

  const transportItems = (Array.isArray(loc.transportItems) ? loc.transportItems : [])
    .map((item, index) => normalizeCanonicalTransportItem(item, index))
    .filter(Boolean)
    .map((item, index) => ({ ...item, sortOrder: index }));

  return {
    label: trimText(loc.label) || "위치 1",
    phone: trimText(loc.phone),
    messageLines,
    onlineBookingUrl: trimText(loc.onlineBookingUrl),
    hours: trimText(loc.hours),
    address: trimText(loc.address),
    mapIframeSrc: trimText(loc.mapIframeSrc),
    mapEmbedQuery: trimText(loc.mapEmbedQuery),
    mapLinks: normalizeMapLinks(loc.mapLinks),
    transportItems,
  };
}

export function buildContactSavePayload(locations = []) {
  return {
    slug: "contact",
    structure: {
      locations: locations.map(normalizeCanonicalContactLocation),
    },
  };
}

export function getCanonicalMessageLines(loc = {}) {
  const lines = (Array.isArray(loc.messageLines) ? loc.messageLines : [])
    .map((line) => trimText(line))
    .filter(Boolean);
  if (lines.length) return lines;
  // migration compatibility only — pre-canonical Firestore
  const legacy = trimText(loc.phoneNote);
  return legacy ? [legacy] : [];
}

export function getCanonicalHours(loc = {}) {
  const hours = trimText(loc.hours);
  if (hours) return hours;
  // migration compatibility only — pre-canonical Firestore
  return trimText(loc.callableHours) || "";
}

export function getCanonicalTransportItems(loc = {}) {
  const raw = Array.isArray(loc.transportItems) ? loc.transportItems : [];
  const items = raw
    .map((item, index) => normalizeCanonicalTransportItem(item, index))
    .filter(Boolean);
  if (items.length) return items;
  // migration compatibility only — pre-canonical Firestore
  if (loc.transportation && typeof loc.transportation === "object") {
    return migrateTransportItemsFromTransportation(loc.transportation);
  }
  return [];
}

function formatMultiline(text) {
  if (!text) return "";
  return text
    .split("\n")
    .map((line) => {
      const escaped = escapeHtml(line);
      return escaped.trim() ? `${escaped}<br>` : "<br>";
    })
    .join("");
}

export function buildDirectionsHTMLFromTransportItems(items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return "";

  const rows = list
    .map((item, index) => {
      const meta = TRANSPORT_TYPE_META[item.type];
      const icon = meta?.icon || "📍";
      const label = escapeHtml(item.label || getTransportTypeLabel(item.type));
      const body = item.text.includes("\n") ? formatMultiline(item.text) : escapeHtml(item.text);
      const border = index < list.length - 1 ? "border-bottom:1px solid var(--border);" : "";
      return `
        <div style="display:flex;align-items:flex-start;gap:12px;padding:12px 0;${border}">
          <div style="flex-shrink:0;width:24px;height:24px;display:flex;align-items:center;justify-content:center;background:var(--bg-secondary);border-radius:6px;">
            <span style="font-size:16px;">${icon}</span>
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:14px;color:var(--text);margin-bottom:4px;">${label}</div>
            <div style="white-space:pre-wrap;line-height:1.6;color:var(--text);font-size:14px;overflow-wrap:anywhere;">${body}</div>
          </div>
        </div>`;
    })
    .join("");

  return `
    <div class="contact-directions" style="padding:20px;background:var(--bg-secondary);border-radius:12px;">
      <h4 class="directions-title" style="margin:0 0 16px 0;font-size:16px;font-weight:700;color:var(--text);">교통수단</h4>
      <div style="display:flex;flex-direction:column;">${rows}</div>
    </div>`;
}

function isGoogleMapsIframeUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host !== "google.com" && host !== "maps.google.com") return false;
    return u.pathname.includes("maps") || u.pathname.startsWith("/maps");
  } catch {
    return false;
  }
}

export function resolveMapIframeSrc(loc = {}) {
  const custom = trimText(loc.mapIframeSrc);
  if (custom) {
    const u = sanitizeUrl(custom);
    if (u && isGoogleMapsIframeUrl(u)) return u;
  }
  const qRaw = trimText(loc.mapEmbedQuery || loc.address);
  if (!qRaw) return "";
  const compact = qRaw.replace(/\s/g, "");
  if (/^-?\d+\.?\d*,-?\d+\.?\d*$/.test(compact)) {
    const parts = compact.split(",");
    const lat = parts[0];
    const lng = parts[1];
    return `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}&output=embed&z=17&hl=ko`;
  }
  return `https://www.google.com/maps?q=${encodeURIComponent(qRaw)}&output=embed&z=17&hl=ko`;
}

export function buildMapLinksHTML(mapLinks = {}) {
  const ml = mapLinks || {};
  let html = "";
  const naver = sanitizeUrl(ml.naver);
  const kakao = sanitizeUrl(ml.kakao);
  const google = sanitizeUrl(ml.google);
  if (naver) {
    html += `<a href="${escapeHtml(naver)}" target="_blank" rel="noopener noreferrer" class="map-link-btn">네이버 지도</a>`;
  }
  if (kakao) {
    html += `<a href="${escapeHtml(kakao)}" target="_blank" rel="noopener noreferrer" class="map-link-btn">카카오 지도</a>`;
  }
  if (google) {
    html += `<a href="${escapeHtml(google)}" target="_blank" rel="noopener noreferrer" class="map-link-btn">구글 지도</a>`;
  }
  return html;
}

export function buildContactLeftColumnHTML(loc = {}) {
  const phone = trimText(loc.phone);
  const telDigits = phone.replace(/[^0-9]/g, "");
  const messageLines = getCanonicalMessageLines(loc);
  const onlineBookingUrl = sanitizeUrl(trimText(loc.onlineBookingUrl));
  const hours = getCanonicalHours(loc);
  const address = trimText(loc.address);
  const transportItems = getCanonicalTransportItems(loc);
  const directionsHTML = buildDirectionsHTMLFromTransportItems(transportItems);

  let html = `
    <div class="contact-meta" aria-label="상담 예약 기본 정보">
      <div class="contact-phone-section">
        ${
          phone
            ? `<a class="grit-contact-phone" href="tel:${telDigits}" aria-label="그릿에듀 상담전화">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
          </svg>
          ${escapeHtml(phone)}
        </a>`
            : ""
        }
        ${
          messageLines.length
            ? messageLines
                .map(
                  (line) =>
                    `<div style="margin-top:8px;font-size:14px;color:var(--text-secondary);line-height:1.5;">${escapeHtml(line)}</div>`
                )
                .join("")
            : ""
        }
        ${
          onlineBookingUrl
            ? `<a class="grit-contact-booking-btn" href="${escapeHtml(onlineBookingUrl)}" target="_blank" rel="noopener noreferrer" aria-label="온라인 상담 예약 페이지로 이동">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
          </svg>
          온라인 상담 예약
        </a>`
            : ""
        }
      </div>`;

  if (hours) {
    html += `
      <div class="contact-info-item">
        <span class="contact-label">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:6px;">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
          운영 시간
        </span>
        <span class="contact-value">${escapeHtml(hours)}</span>
      </div>`;
  }

  if (address) {
    html += `
      <div class="contact-info-item">
        <span class="contact-label">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:6px;">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
            <circle cx="12" cy="10" r="3"></circle>
          </svg>
          주소
        </span>
        <address class="contact-value" style="font-style:normal;margin:0;">${escapeHtml(address)}</address>
      </div>`;
  }

  html += "</div>";

  if (directionsHTML) {
    html += `<div style="margin-top:16px;">${directionsHTML}</div>`;
  }

  return html;
}

export function buildContactLocationPanelHTML(loc = {}) {
  const mapSrc = resolveMapIframeSrc(loc);
  const mapLinksInner = buildMapLinksHTML(loc.mapLinks);
  const iframeTitle = "구글 지도";
  return `
    <div class="contact-map-area">
      <div class="grit-map">
        <div class="embed-map" role="img" aria-label="위치 지도">
          ${
            mapSrc
              ? `<iframe title="${escapeHtml(iframeTitle)}" src="${escapeHtml(mapSrc)}" allowfullscreen referrerpolicy="no-referrer-when-downgrade"></iframe>`
              : `<div class="contact-map-placeholder">지도를 표시하려면 주소, 좌표 또는 지도 URL을 입력해 주세요.</div>`
          }
        </div>
      </div>
      <div class="map-links" aria-label="지도 앱으로 열기">${mapLinksInner}</div>
    </div>`;
}

export { TRANSPORT_TYPE_META, MAX_MESSAGE_LINES };
