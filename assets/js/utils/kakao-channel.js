import { db } from "/assets/js/firebase-init.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

const KAKAO_CHANNEL_SETTING_ID = "kakaoChannel";
const KAKAO_CHANNEL_HOST = "pf.kakao.com";
const KAKAO_CHANNEL_BUTTON_ID = "grit-kakao-channel-floating";

export const KAKAO_CHANNEL_PAGE_OPTIONS = [
  { key: "home", label: "메인 홈", file: "index.html" },
  { key: "story", label: "학원 안내", file: "story.html" },
  { key: "schedule", label: "시간표", file: "schedule.html" },
  { key: "contact", label: "상담 문의", file: "contact.html" },
  { key: "instructors", label: "강사진", file: "instructors.html" },
  { key: "courses", label: "모든 강좌", file: "courses.html" }
];

const PAGE_KEY_BY_FILE = KAKAO_CHANNEL_PAGE_OPTIONS.reduce((map, page) => {
  map[page.file] = page.key;
  return map;
}, {});

const EMPTY_VISIBLE_PAGES = KAKAO_CHANNEL_PAGE_OPTIONS.reduce((map, page) => {
  map[page.key] = false;
  return map;
}, {});

export const DEFAULT_KAKAO_CHANNEL_SETTINGS = {
  enabled: false,
  url: "",
  buttonLabel: "카톡 상담",
  visiblePages: { ...EMPTY_VISIBLE_PAGES }
};

export function isValidKakaoChannelUrl(value) {
  const raw = String(value || "").trim();
  if (!raw || !raw.toLowerCase().startsWith(`https://${KAKAO_CHANNEL_HOST}/`)) {
    return false;
  }

  try {
    const url = new URL(raw);
    return (
      url.protocol === "https:" &&
      url.hostname === KAKAO_CHANNEL_HOST &&
      url.pathname.length > 1
    );
  } catch (_error) {
    return false;
  }
}

function normalizeVisiblePages(value) {
  const source = value && typeof value === "object" ? value : {};
  return KAKAO_CHANNEL_PAGE_OPTIONS.reduce((map, page) => {
    map[page.key] = source[page.key] === true;
    return map;
  }, {});
}

export function normalizeKakaoChannelSettings(value) {
  const source =
    value?.kakaoChannel && typeof value.kakaoChannel === "object"
      ? value.kakaoChannel
      : value;
  const data = source && typeof source === "object" ? source : {};
  const hasButtonLabel = Object.prototype.hasOwnProperty.call(data, "buttonLabel");

  return {
    enabled: data.enabled === true,
    url: String(data.url || "").trim(),
    buttonLabel: hasButtonLabel ? String(data.buttonLabel || "").trim() : "",
    visiblePages: normalizeVisiblePages(data.visiblePages)
  };
}

export function getKakaoChannelPageKey(pathname = window.location.pathname) {
  const normalizedPath = String(pathname || "/");
  if (normalizedPath.startsWith("/members/")) return "";

  const cleanPath = normalizedPath.split(/[?#]/)[0] || "/";
  const fileName = cleanPath.endsWith("/")
    ? "index.html"
    : cleanPath.slice(cleanPath.lastIndexOf("/") + 1);

  return PAGE_KEY_BY_FILE[fileName || "index.html"] || "";
}

function shouldRenderKakaoChannel(settings, pageKey) {
  return (
    settings.enabled === true &&
    isValidKakaoChannelUrl(settings.url) &&
    settings.visiblePages?.[pageKey] === true
  );
}

function createKakaoIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "22");
  svg.setAttribute("height", "22");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("grit-kakao-channel__icon");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute(
    "d",
    "M12 3C6.477 3 2 6.477 2 10.8c0 2.74 1.79 5.14 4.5 6.55-.18.66-.66 2.4-.76 2.78-.12.47.17.46.36.34.15-.1 2.36-1.6 3.32-2.25.85.12 1.73.18 2.58.18 5.523 0 10-3.477 10-7.6S17.523 3 12 3z"
  );
  svg.appendChild(path);
  return svg;
}

function renderKakaoChannelButton(settings) {
  document.getElementById(KAKAO_CHANNEL_BUTTON_ID)?.remove();

  const link = document.createElement("a");
  const labelText = String(settings.buttonLabel || "").trim();
  link.id = KAKAO_CHANNEL_BUTTON_ID;
  link.className = labelText
    ? "grit-kakao-channel"
    : "grit-kakao-channel grit-kakao-channel--icon-only";
  link.href = settings.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute("aria-label", "카카오톡 상담하기");
  link.title = labelText || "카카오톡 상담하기";

  link.appendChild(createKakaoIcon());
  if (labelText) {
    const label = document.createElement("span");
    label.className = "grit-kakao-channel__label";
    label.textContent = labelText;
    link.appendChild(label);
  }
  document.body.appendChild(link);
}

let kakaoChannelBootstrapped = false;

export async function initKakaoChannelFloatingButton() {
  if (kakaoChannelBootstrapped) return;
  kakaoChannelBootstrapped = true;

  const pageKey = getKakaoChannelPageKey();
  if (!pageKey) return;

  try {
    const snapshot = await getDoc(doc(db, "settings", KAKAO_CHANNEL_SETTING_ID));
    if (!snapshot.exists()) return;

    const settings = normalizeKakaoChannelSettings(snapshot.data());
    if (!shouldRenderKakaoChannel(settings, pageKey)) return;

    renderKakaoChannelButton(settings);
  } catch (error) {
    console.warn("[kakao-channel] failed to load settings:", error);
  }
}
