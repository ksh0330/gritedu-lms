// /assets/js/pages/admin-site.js

// 사이트 관리 페이지

import { auth, db, requireRole } from "/assets/js/firebase-init.js";

import {

  doc, getDoc, setDoc, collection, query, where, getDocs, updateDoc, deleteDoc,

  orderBy, serverTimestamp

} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

import { getSettingDoc, invalidateSetting } from "/assets/js/utils/settings-cache.js";

import {
  DEFAULT_KAKAO_CHANNEL_SETTINGS,
  KAKAO_CHANNEL_PAGE_OPTIONS,
  isValidKakaoChannelUrl,
  normalizeKakaoChannelSettings,
} from "/assets/js/utils/kakao-channel.js";
import { calculateDday, DEFAULT_DDAY_SETTINGS, normalizeDdaySettings } from "/assets/js/utils/dday.js";
import { escapeHtml } from "/assets/js/utils/html.js";
import { handleError, createSimpleErrorUI } from "/assets/js/utils/error-handler.js";
import {
  containsBlockedImageSource,
  getBlockedImageSourceMessage,
  PUBLIC_IMAGE_FIELD,
  sanitizePublicImageSrc,
} from "/assets/js/utils/public-image-url.js";
import {
  assignImageSrc,
  bindGuardedImages,
  isImageLoadExhausted,
} from "/assets/js/utils/image-load-guard.js";

const FOOTER_DEFAULTS = {
  companyName: "주식회사 그릿에듀 · 그릿에듀학원",
  businessNumber: "722-86-01587",
  representative: "유홍석",
  phone: "02-809-0611",
  address: "(08635) 서울특별시 금천구 시흥대로47길 28-5, 5층(시흥동, 남서울교육문화센터)",
  instagramUrl: "https://www.instagram.com/grit_edu_seoul/",
  youtubeUrl: "https://www.youtube.com/@GRITEDU_official",
  blogUrl: "https://blog.naver.com/gritedu",
};

const TUITION_IMAGE_SECTIONS = [
  { id: "academy", label: "학원정보조회" },
  { id: "fee", label: "교습비" },
  { id: "refund", label: "환불규정" },
];
let tuitionImages = { academy: [], fee: [], refund: [] };
let tuitionImagesLoaded = false;

function normalizeTuitionImages(data = {}) {
  return Object.fromEntries(TUITION_IMAGE_SECTIONS.map(({ id }) => [
    id,
    Array.isArray(data[id]) ? data[id].map((url) => String(url || "").trim()).filter((url) => /^https:\/\/assets\.gritedu\.kr\/public\/footer\/[\w./-]+\.(?:jpe?g|png|webp)$/i.test(url)) : [],
  ]));
}

function renderTuitionImageAdmin() {
  const root = document.getElementById("tuitionImageSections");
  if (!root) return;
  root.innerHTML = TUITION_IMAGE_SECTIONS.map(({ id, label }) => `
    <section class="tuition-image-section" data-section="${id}">
      <div class="tuition-image-section__title">
        <h3>${label}</h3>
      </div>
      <div class="tuition-image-add-row">
        <input type="url" data-new-url="${id}" placeholder="https://assets.gritedu.kr/public/footer/..." autocomplete="off" aria-label="${label} 새 이미지 URL">
        <button class="btn sm" type="button" data-add-url="${id}">이미지 추가</button>
      </div>
      <div class="tuition-image-list">
        ${tuitionImages[id].length ? tuitionImages[id].map((url, index) => `
          <div class="tuition-image-row" data-index="${index}">
            <img src="${escapeHtml(url)}" alt="${label} ${index + 1} 미리보기">
            <input type="url" value="${escapeHtml(url)}" aria-label="${label} 이미지 URL ${index + 1}">
            <div class="tuition-image-row__actions">
              <button class="btn sm" type="button" data-move="up" ${index === 0 ? "disabled" : ""}>위</button>
              <button class="btn sm" type="button" data-move="down" ${index === tuitionImages[id].length - 1 ? "disabled" : ""}>아래</button>
              <button class="btn sm danger" type="button" data-remove>삭제</button>
            </div>
          </div>`).join("") : '<p class="muted tuition-image-empty">등록된 이미지가 없습니다.</p>'}
      </div>
    </section>`).join("");

  root.querySelectorAll("[data-add-url]").forEach((button) => button.addEventListener("click", () => {
    const section = button.dataset.addUrl;
    const input = root.querySelector(`[data-new-url="${section}"]`);
    const url = String(input?.value || "").trim();
    if (!/^https:\/\/assets\.gritedu\.kr\/public\/footer\/[\w./-]+\.(?:jpe?g|png|webp)$/i.test(url)) {
      toast("https://assets.gritedu.kr/public/footer/ 아래 JPG, PNG, WebP 이미지 URL을 입력하세요.", true);
      input?.focus();
      return;
    }
    if (tuitionImages[section].includes(url)) {
      toast("이미 등록된 이미지 URL입니다.", true);
      return;
    }
    tuitionImages[section].push(url);
    renderTuitionImageAdmin();
  }));
  root.querySelectorAll(".tuition-image-row input[type=url]").forEach((input) => input.addEventListener("change", () => {
    const section = input.closest("[data-section]").dataset.section;
    const index = Number(input.closest("[data-index]").dataset.index);
    tuitionImages[section][index] = input.value.trim();
    input.previousElementSibling.src = input.value.trim();
  }));
  root.querySelectorAll("[data-remove]").forEach((button) => button.addEventListener("click", () => {
    const row = button.closest("[data-index]");
    tuitionImages[row.closest("[data-section]").dataset.section].splice(Number(row.dataset.index), 1);
    renderTuitionImageAdmin();
  }));
  root.querySelectorAll("[data-move]").forEach((button) => button.addEventListener("click", () => {
    const row = button.closest("[data-index]");
    const section = row.closest("[data-section]").dataset.section;
    const from = Number(row.dataset.index);
    const to = button.dataset.move === "up" ? from - 1 : from + 1;
    [tuitionImages[section][from], tuitionImages[section][to]] = [tuitionImages[section][to], tuitionImages[section][from]];
    renderTuitionImageAdmin();
  }));
}

async function loadTuitionImagesForAdmin() {
  if (tuitionImagesLoaded) return renderTuitionImageAdmin();
  const snapshot = await getDoc(doc(db, "settings", "tuitionImages"));
  tuitionImages = normalizeTuitionImages(snapshot.exists() ? snapshot.data() : {});
  tuitionImagesLoaded = true;
  renderTuitionImageAdmin();
}

async function saveTuitionImages() {
  const normalized = normalizeTuitionImages(tuitionImages);
  const rawCount = Object.values(tuitionImages).reduce((sum, urls) => sum + urls.length, 0);
  const validCount = Object.values(normalized).reduce((sum, urls) => sum + urls.length, 0);
  if (rawCount !== validCount) return toast("URL은 https://assets.gritedu.kr/public/footer/ 아래 JPG, PNG, WebP 이미지만 사용할 수 있습니다.", true);
  await setDoc(doc(db, "settings", "tuitionImages"), {
    ...normalized,
    updatedAt: serverTimestamp(),
    updatedBy: auth.currentUser?.uid || "",
  });
  tuitionImages = normalized;
  toast("교습비 안내 이미지가 저장되었습니다.");
}

async function loadFooterSettingsForAdmin() {
  const snapshot = await getDoc(doc(db, "settings", "footer"));
  const data = { ...FOOTER_DEFAULTS, ...(snapshot.exists() ? snapshot.data() : {}) };
  const fields = {
    footerSettingCompanyName: "companyName", footerSettingBusinessNumber: "businessNumber",
    footerSettingRepresentative: "representative", footerSettingPhone: "phone",
    footerSettingAddress: "address", footerSettingInstagram: "instagramUrl",
    footerSettingYoutube: "youtubeUrl", footerSettingBlog: "blogUrl",
  };
  Object.entries(fields).forEach(([id, key]) => { const input = document.getElementById(id); if (input) input.value = data[key] || ""; });
}

async function saveFooterSettings(event) {
  event.preventDefault();
  const value = (id) => String(document.getElementById(id)?.value || "").trim();
  const payload = {
    companyName: value("footerSettingCompanyName"), businessNumber: value("footerSettingBusinessNumber"),
    representative: value("footerSettingRepresentative"), phone: value("footerSettingPhone"),
    address: value("footerSettingAddress"), instagramUrl: value("footerSettingInstagram"),
    youtubeUrl: value("footerSettingYoutube"), blogUrl: value("footerSettingBlog"),
  };
  const invalidUrl = [payload.instagramUrl, payload.youtubeUrl, payload.blogUrl].find((url) => url && !/^https:\/\//i.test(url));
  if (invalidUrl) return toast("SNS 주소는 https://로 시작해야 합니다.", true);
  await setDoc(doc(db, "settings", "footer"), { ...payload, updatedAt: serverTimestamp(), updatedBy: auth.currentUser?.uid || "" }, { merge: true });
  invalidateSetting("footer");
  toast("푸터 정보가 저장되었습니다.");
}
import { loadStoryContent } from "/assets/js/pages/admin-story-cms.js";
import {
  CONTACT_PUBLIC_PAGE_TITLE,
  TRANSPORT_TYPE_META,
  MAX_MESSAGE_LINES,
  buildContactLeftColumnHTML,
  buildContactLocationPanelHTML,
  buildContactSavePayload,
  createContactTransportItemId,
  migrateLegacyContactLocation,
  migrateLegacyContactStructure,
  normalizeCanonicalContactLocation,
} from "/assets/js/utils/contact-location.js";

// 이미지 관리: popup/instructor/story는 R2 public URL을 사용합니다.
// 역할 가드: 관리자만 접근 가능
(async () => {
  try {
    await requireRole("admin", "/members/login.html");
  } catch (err) {
    // requireRole에서 이미 리다이렉션 처리됨
  }
})();

const $ = (s, r = document) => r.querySelector(s);

const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const KAKAO_CHANNEL_DOC_ID = "kakaoChannel";
const ADMIN_DEFAULT_KAKAO_CHANNEL_SETTINGS = {
  ...DEFAULT_KAKAO_CHANNEL_SETTINGS,
  visiblePages: {
    ...DEFAULT_KAKAO_CHANNEL_SETTINGS.visiblePages,
    home: true,
    contact: true
  }
};

// 이미지 URL은 R2 key 또는 local 파일명 변경으로 갱신한다.
function addImageCacheBuster(url) {
  return url;
}


function toast(msg, err = false) {

  const statusMsg = $("#statusMsg");

  if (statusMsg) {

    statusMsg.textContent = msg;

    statusMsg.style.color = err ? "var(--error-color)" : "var(--success-color)";

    statusMsg.style.background = err ? "var(--error-bg)" : "var(--success-bg)";

    statusMsg.style.padding = "12px";

    statusMsg.style.borderRadius = "8px";

    statusMsg.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";

    statusMsg.style.opacity = "1";

    statusMsg.style.pointerEvents = "auto";

    setTimeout(() => {

      if (statusMsg.textContent === msg) {

        statusMsg.style.opacity = "0";

        statusMsg.style.pointerEvents = "none";

        setTimeout(() => {

          if (statusMsg.textContent === msg) {

            statusMsg.textContent = "";

            statusMsg.style.background = "";

            statusMsg.style.boxShadow = "";

          }

        }, 300);

      }

    }, 3000);

  }

}



// 메인 탭 전환 이벤트 리스너 등록
let tabListenersSetup = false;
function setupTabListeners() {
  if (tabListenersSetup) return;
  tabListenersSetup = true;
  
  $$('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;
      
      // 모든 탭 버튼 비활성화
      $$('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // 모든 탭 콘텐츠 숨기기
      $$('.tab-content').forEach(c => c.classList.remove('active'));
      $(`#tab-${tabId}`)?.classList.add('active');
      
      // 탭별 초기화
      if (tabId === 'instructors') {
        loadInstructorsForOrder();
      } else if (tabId === 'dday') {
        loadDdaySettingsForAdmin();
      } else if (tabId === 'footer') {
        loadFooterSettingsForAdmin();
        loadTuitionImagesForAdmin();
      }
    });
  });
}

// 하위 메뉴 탭 전환 이벤트 리스너 등록
let submenuListenersSetup = false;
function setupSubmenuListeners() {
  if (submenuListenersSetup) return;
  submenuListenersSetup = true;
  
  $$('.submenu-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const submenuId = btn.dataset.submenu;
      const parentTab = btn.closest('.tab-content');
      
      // 같은 부모 내의 모든 하위 메뉴 버튼 비활성화
      parentTab.querySelectorAll('.submenu-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // 같은 부모 내의 모든 하위 메뉴 콘텐츠 숨기기
      parentTab.querySelectorAll('.submenu-content').forEach(c => c.classList.remove('active'));
      $(`#submenu-${submenuId}`)?.classList.add('active');
      
      // 하위 메뉴별 초기화
      if (submenuId === 'story') {
        loadPageContent('story');
      } else if (submenuId === 'contact') {
        loadPageContent('contact');
      } else if (submenuId === 'kakao-channel') {
        loadKakaoChannelSettingsForAdmin();
      }
    });
  });
}



// 상담문의 기본값 (신규 문서 시드용, Firestore 저장 구조와 동일)

const CONTACT_SEED = {
  phone: "02-809-0611",
  messageLines: ["전화 또는 온라인 예약으로 상담 일정을 잡으신 뒤 방문해 주세요."],
  hours: "평일 15:00–22:00 / 주말 12:00–22:00",
  mapLinks: {
    naver: "https://map.naver.com/p/entry/place/1775828207?c=15.00,0,0,0,dh",
    kakao: "https://place.map.kakao.com/1537339636",
    google: "https://maps.app.goo.gl/s24PTXWa5A27BZ5L8",
  },
  transportItems: [
    { id: "seed-walking", type: "walking", label: "도보", text: "문일중,고등학교 도보 2분거리", sortOrder: 0 },
    {
      id: "seed-subway",
      type: "subway",
      label: "지하철",
      text: "1호선 금천구청역 하차\n(마을버스 금천 06, 금천 07 환승 - 문일중고입구 정류장 하차)\n2호선 구로디지털단지역 하차\n(2번 승강장에서 5617, 5618, 5623, 5624, 5625, 51 환승 - 시흥사거리 정류장 하차)",
      sortOrder: 1,
    },
    {
      id: "seed-bus",
      type: "bus",
      label: "버스",
      text: "5, 9, 388, 500, 5618, 5523, 5537, 5601, 5602, 5609, 5624, 5625, 5530, 5531, 5713",
      sortOrder: 2,
    },
    { id: "seed-car", type: "car", label: "차량", text: "주차장 이용가능", sortOrder: 3 },
  ],
};

const CONTACT_LOCATION_BLANK = {
  label: "",
  phone: "",
  messageLines: [],
  onlineBookingUrl: "",
  hours: "",
  address: "",
  mapIframeSrc: "",
  mapEmbedQuery: "",
  transportItems: [],
  mapLinks: { naver: "", kakao: "", google: "" },
};

function getMessageLineSlotsForEditor(loc = {}) {
  if (Array.isArray(loc.messageLines)) {
    const slots = loc.messageLines.slice(0, MAX_MESSAGE_LINES).map((line) => String(line ?? ""));
    return slots.length ? slots : [""];
  }
  const migrated = migrateLegacyContactLocation(loc);
  return migrated.messageLines.length ? migrated.messageLines.slice(0, MAX_MESSAGE_LINES) : [""];
}

function getTransportItemsForEditor(loc = {}, structureFallback = {}) {
  if (Array.isArray(loc.transportItems)) {
    return loc.transportItems.map((item, index) => ({
      id: item.id || createContactTransportItemId(),
      type: item.type || "walking",
      text: String(item.text ?? "").replace(/\r\n/g, "\n"),
      sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : index,
    }));
  }
  return migrateLegacyContactLocation(loc, structureFallback).transportItems.map((item, index) => ({
    id: item.id || createContactTransportItemId(),
    type: item.type || "walking",
    text: item.text || "",
    sortOrder: index,
  }));
}

function prepareContactLocationDraftForRender(loc = {}, structureFallback = {}) {
  const messageLines = getMessageLineSlotsForEditor(loc);
  const transportItems = getTransportItemsForEditor(loc, structureFallback);
  if (Array.isArray(loc.messageLines) || Array.isArray(loc.transportItems)) {
    return {
      ...cloneContactLocation(loc),
      messageLines,
      transportItems,
    };
  }
  return {
    ...migrateLegacyContactLocation(loc, structureFallback),
    messageLines,
    transportItems,
  };
}

function normalizeContactLocationForEditor(loc = {}, structureFallback = {}) {
  return prepareContactLocationDraftForRender(loc, structureFallback);
}

function messageLinesForSave(slots = []) {
  return slots.map((line) => String(line ?? "").trim()).filter(Boolean).slice(0, MAX_MESSAGE_LINES);
}

function bindContactEditorActions() {
  if (window.__contactEditorActionsBound) return;
  window.__contactEditorActionsBound = true;

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-contact-action]");
    if (!button || !button.closest("#submenu-contact")) return;
    event.preventDefault();

    const action = button.dataset.contactAction;
    const locIndex = parseInt(button.dataset.locIndex || "0", 10);
    const lineIndex = parseInt(button.dataset.lineIndex || "0", 10);
    const itemIndex = parseInt(button.dataset.itemIndex || "0", 10);
    const current = readContactLocationsDraftFromForm();
    const loc = current[locIndex] || prepareContactLocationDraftForRender({});

    if (action === "add-message-line") {
      if (loc.messageLines.length >= MAX_MESSAGE_LINES) return;
      loc.messageLines.push("");
    } else if (action === "remove-message-line") {
      loc.messageLines.splice(lineIndex, 1);
      if (!loc.messageLines.length) loc.messageLines.push("");
    } else if (action === "add-transport-item") {
      loc.transportItems.push({
        id: createContactTransportItemId(),
        type: "walking",
        text: "",
        sortOrder: loc.transportItems.length,
      });
    } else if (action === "remove-transport-item") {
      loc.transportItems.splice(itemIndex, 1);
    } else {
      return;
    }

    current[locIndex] = loc;
    window.__contactLocList = current;
    window.renderContactLocationEditors();
  });
}

bindContactEditorActions();

function cloneContactLocation(loc) {
  return {
    ...CONTACT_LOCATION_BLANK,
    ...loc,
    messageLines: Array.isArray(loc?.messageLines) ? [...loc.messageLines] : [],
    transportItems: Array.isArray(loc?.transportItems)
      ? loc.transportItems.map((item) => ({ ...item }))
      : [],
    mapLinks: { ...CONTACT_LOCATION_BLANK.mapLinks, ...(loc.mapLinks || {}) },
  };
}

const CONTACT_DEFAULT_LOCATIONS = [
  cloneContactLocation({
    label: "고등 1관",
    phone: CONTACT_SEED.phone,
    messageLines: [...CONTACT_SEED.messageLines],
    hours: CONTACT_SEED.hours,
    address: "서울 금천구 시흥대로47길 28-5 5층",
    mapIframeSrc:
      "https://www.google.com/maps?q=%EC%84%9C%EC%9A%B8%20%EA%B8%88%EC%B2%9C%EA%B5%AC%20%EC%8B%9C%ED%9D%A5%EB%8C%80%EB%A1%9C47%EA%B8%B8%2028-5%205%EC%B8%B5&output=embed",
    mapEmbedQuery: "",
    transportItems: CONTACT_SEED.transportItems.map((item) => ({ ...item })),
    mapLinks: { ...CONTACT_SEED.mapLinks },
  }),
  cloneContactLocation({
    label: "고등 2관",
    phone: CONTACT_SEED.phone,
    messageLines: [...CONTACT_SEED.messageLines],
    hours: CONTACT_SEED.hours,
    address: "서울 금천구 시흥대로51길 33 5층",
    mapIframeSrc:
      "https://www.google.com/maps?q=%EC%84%9C%EC%9A%B8%20%EA%B8%88%EC%B2%9C%EA%B5%AC%20%EC%8B%9C%ED%9D%A5%EB%8C%80%EB%A1%9C51%EA%B8%B8%2033%205%EC%B8%B5&output=embed",
    mapEmbedQuery: "",
    transportItems: [],
    mapLinks: {
      naver: "https://map.naver.com/p/search/%EC%84%9C%EC%9A%B8%20%EA%B8%88%EC%B2%9C%EA%B5%AC%20%EC%8B%9C%ED%9D%A5%EB%8C%80%EB%A1%9C51%EA%B8%B8%2033%205%EC%B8%B5",
      kakao: "https://map.kakao.com/link/search/%EC%84%9C%EC%9A%B8%20%EA%B8%88%EC%B2%9C%EA%B5%AC%20%EC%8B%9C%ED%9D%A5%EB%8C%80%EB%A1%9C51%EA%B8%B8%2033%205%EC%B8%B5",
      google:
        "https://www.google.com/maps/search/?api=1&query=%EC%84%9C%EC%9A%B8%20%EA%B8%88%EC%B2%9C%EA%B5%AC%20%EC%8B%9C%ED%9D%A5%EB%8C%80%EB%A1%9C51%EA%B8%B8%2033%205%EC%B8%B5",
    },
  }),
  cloneContactLocation({
    label: "대치관",
    phone: "0507-1328-9725",
    messageLines: [],
    hours: "매일 12:00 – 22:00",
    address: "서울 강남구 삼성로57길 35 2층",
    mapIframeSrc:
      "https://www.google.com/maps?q=%EC%84%9C%EC%9A%B8%20%EA%B0%95%EB%82%A8%EA%B5%AC%20%EC%82%BC%EC%84%B1%EB%A1%9C57%EA%B8%B8%2035%202%EC%B8%B5&output=embed",
    mapEmbedQuery: "",
    transportItems: [
      {
        id: "seed-daechi-subway",
        type: "subway",
        label: "지하철",
        text: "수인분당 한티역 3번 출구 도보 약 434m",
        sortOrder: 0,
      },
    ],
    mapLinks: {
      naver: "https://map.naver.com/p/entry/place/1656846198",
      kakao: "https://map.kakao.com/link/search/%EC%84%9C%EC%9A%B8%20%EA%B0%95%EB%82%A8%EA%B5%AC%20%EC%82%BC%EC%84%B1%EB%A1%9C57%EA%B8%B8%2035",
      google:
        "https://www.google.com/maps/search/?api=1&query=%EC%84%9C%EC%9A%B8%20%EA%B0%95%EB%82%A8%EA%B5%AC%20%EC%82%BC%EC%84%B1%EB%A1%9C57%EA%B8%B8%2035%202%EC%B8%B5",
    },
  }),
  cloneContactLocation({
    label: "중등영재관",
    phone: CONTACT_SEED.phone,
    messageLines: [...CONTACT_SEED.messageLines],
    hours: CONTACT_SEED.hours,
    address: "서울 금천구 시흥대로51길 33 6층",
    mapIframeSrc:
      "https://www.google.com/maps?q=%EC%84%9C%EC%9A%B8%20%EA%B8%88%EC%B2%9C%EA%B5%AC%20%EC%8B%9C%ED%9D%A5%EB%8C%80%EB%A1%9C51%EA%B8%B8%2033%206%EC%B8%B5&output=embed",
    mapEmbedQuery: "",
    transportItems: [],
    mapLinks: {
      naver: "https://map.naver.com/p/search/%EC%84%9C%EC%9A%B8%20%EA%B8%88%EC%B2%9C%EA%B5%AC%20%EC%8B%9C%ED%9D%A5%EB%8C%80%EB%A1%9C51%EA%B8%B8%2033%206%EC%B8%B5",
      kakao: "https://map.kakao.com/link/search/%EC%84%9C%EC%9A%B8%20%EA%B8%88%EC%B2%9C%EA%B5%AC%20%EC%8B%9C%ED%9D%A5%EB%8C%80%EB%A1%9C51%EA%B8%B8%2033%206%EC%B8%B5",
      google:
        "https://www.google.com/maps/search/?api=1&query=%EC%84%9C%EC%9A%B8%20%EA%B8%88%EC%B2%9C%EA%B5%AC%20%EC%8B%9C%ED%9D%A5%EB%8C%80%EB%A1%9C51%EA%B8%B8%2033%206%EC%B8%B5",
    },
  }),
];

function loadContactLocationsFromStructure(structure = {}) {
  const migrated = migrateLegacyContactStructure(structure);
  const source = migrated.length ? migrated : CONTACT_DEFAULT_LOCATIONS;
  return source.map((loc) => normalizeContactLocationForEditor(loc, structure));
}



// 페이지 콘텐츠 로드 (이야기, 상담문의) - 새로운 구조 기반
async function loadPageContent(slug) {

  if (slug === 'story') {

    await loadStoryContent();

  } else if (slug === 'contact') {

    await loadContactContent();

  }

}



// 실시간 미리보기 업데이트

function updatePreview(slug) {

  const editor = $(`#editor-${slug}`);

  const preview = $(`#preview-${slug}`);

  

  if (!editor || !preview) return;

  

  const content = editor.value;

  preview.innerHTML = content || '<p class="muted">미리보기가 여기에 표시됩니다.</p>';

}

let ddayLoaded = false;

function getDdayFormSettings() {
  return normalizeDdaySettings({
    enabled: $("#ddayEnabled")?.checked || false,
    title: $("#ddayTitle")?.value?.trim() || DEFAULT_DDAY_SETTINGS.title,
    targetDate: $("#ddayTargetDate")?.value || "",
    placements: {
      home: $("#ddayShowHome")?.checked !== false,
      dashboard: $("#ddayShowDashboard")?.checked !== false
    }
  });
}

function fillDdayForm(settings) {
  const normalized = normalizeDdaySettings(settings);

  if ($("#ddayEnabled")) $("#ddayEnabled").checked = normalized.enabled;
  if ($("#ddayTitle")) $("#ddayTitle").value = normalized.title;
  if ($("#ddayTargetDate")) $("#ddayTargetDate").value = normalized.targetDate;
  if ($("#ddayShowHome")) $("#ddayShowHome").checked = normalized.placements.home;
  if ($("#ddayShowDashboard")) $("#ddayShowDashboard").checked = normalized.placements.dashboard;

  updateDdayPreview();
}

async function loadDdaySettingsForAdmin() {
  if (ddayLoaded) {
    updateDdayPreview();
    return;
  }

  try {
    const snapshot = await getDoc(doc(db, "pages", "dday"));
    if (snapshot.exists()) {
      fillDdayForm(snapshot.data());
    } else {
      const legacySnapshot = await getDoc(doc(db, "settings", "dday"));
      fillDdayForm(legacySnapshot.exists() ? legacySnapshot.data() : DEFAULT_DDAY_SETTINGS);
    }
    ddayLoaded = true;
  } catch (error) {
    console.error("D-DAY 설정 로드 실패:", error);
    toast("D-DAY 설정 로드 실패: " + error.message, true);
  }
}

function updateDdayPreview() {
  const preview = $("#ddayPreview");
  if (!preview) return;

  const settings = getDdayFormSettings();
  const dday = calculateDday(settings.targetDate);

  if (!settings.enabled) {
    preview.innerHTML = '<p class="muted" style="margin:0;">표시가 꺼져 있습니다.</p>';
    return;
  }

  if (!dday) {
    preview.innerHTML = '<p class="muted" style="margin:0;">시험일을 선택하면 미리보기가 표시됩니다.</p>';
    return;
  }

  preview.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 18px;border:1px solid var(--border);border-radius:16px;background:var(--card);">
      <div>
        <div style="font-size:13px;font-weight:700;color:var(--muted);">${escapeHtml(settings.title)}</div>
      </div>
      <strong style="font-size:32px;line-height:1;color:var(--brand);letter-spacing:-0.04em;">${escapeHtml(dday.displayText)}</strong>
    </div>
  `;
}

window.updateDdayPreview = updateDdayPreview;

window.saveDdaySettings = async () => {
  const settings = getDdayFormSettings();

  if (settings.enabled && !calculateDday(settings.targetDate)) {
    toast("D-DAY를 표시하려면 시험일을 선택해주세요.", true);
    return;
  }

  try {
    await setDoc(doc(db, "pages", "dday"), {
      slug: "dday",
      ...settings,
      updatedAt: serverTimestamp()
    }, { merge: true });

    ddayLoaded = false;
    toast("D-DAY 설정이 저장되었습니다.");
  } catch (error) {
    console.error("D-DAY 설정 저장 실패:", error);
    toast("D-DAY 설정 저장 실패: " + error.message, true);
  }
};

let kakaoChannelLoaded = false;

function getKakaoChannelCheckboxId(pageKey) {
  return `kakaoPage-${pageKey}`;
}

function getKakaoChannelFormSettings() {
  return {
    enabled: $("#kakaoChannelEnabled")?.checked === true,
    url: ($("#kakaoChannelUrl")?.value || "").trim(),
    buttonLabel: ($("#kakaoChannelButtonLabel")?.value || "").trim(),
    visiblePages: KAKAO_CHANNEL_PAGE_OPTIONS.reduce((map, page) => {
      map[page.key] = $(`#${getKakaoChannelCheckboxId(page.key)}`)?.checked === true;
      return map;
    }, {})
  };
}

function fillKakaoChannelForm(settings) {
  const normalized = normalizeKakaoChannelSettings(settings);

  if ($("#kakaoChannelEnabled")) $("#kakaoChannelEnabled").checked = normalized.enabled;
  if ($("#kakaoChannelUrl")) $("#kakaoChannelUrl").value = normalized.url;
  if ($("#kakaoChannelButtonLabel")) $("#kakaoChannelButtonLabel").value = normalized.buttonLabel;

  KAKAO_CHANNEL_PAGE_OPTIONS.forEach((page) => {
    const checkbox = $(`#${getKakaoChannelCheckboxId(page.key)}`);
    if (checkbox) checkbox.checked = normalized.visiblePages[page.key] === true;
  });

  updateKakaoChannelPreview();
}

async function loadKakaoChannelSettingsForAdmin() {
  if (kakaoChannelLoaded) {
    updateKakaoChannelPreview();
    return;
  }

  try {
    const snapshot = await getDoc(doc(db, "settings", KAKAO_CHANNEL_DOC_ID));
    fillKakaoChannelForm(snapshot.exists() ? snapshot.data() : ADMIN_DEFAULT_KAKAO_CHANNEL_SETTINGS);
    kakaoChannelLoaded = true;
  } catch (error) {
    console.error("카카오톡 채널 설정 로드 실패:", error);
    toast("카카오톡 채널 설정 로드 실패: " + error.message, true);
  }
}

function getSelectedKakaoChannelPageLabels(settings) {
  return KAKAO_CHANNEL_PAGE_OPTIONS
    .filter((page) => settings.visiblePages?.[page.key] === true)
    .map((page) => page.label);
}

function updateKakaoChannelPreview() {
  const preview = $("#kakaoChannelPreview");
  if (!preview) return;

  const settings = getKakaoChannelFormSettings();
  const selectedPages = getSelectedKakaoChannelPageLabels(settings);
  const hasButtonLabel = settings.buttonLabel.length > 0;
  const safeLabel = escapeHtml(settings.buttonLabel);
  const safeUrl = escapeHtml(settings.url);

  if (!settings.enabled) {
    preview.innerHTML = `
      <p class="muted" style="margin:0;">사용 여부가 꺼져 있어 공개 페이지에 버튼이 표시되지 않습니다.</p>
    `;
    return;
  }

  if (!settings.url) {
    preview.innerHTML = `
      <p class="muted" style="margin:0;color:var(--error-color);">사용하려면 카카오톡 채널 URL을 입력해야 합니다.</p>
    `;
    return;
  }

  if (!isValidKakaoChannelUrl(settings.url)) {
    preview.innerHTML = `
      <p class="muted" style="margin:0;color:var(--error-color);">https://pf.kakao.com/... 형식의 URL만 저장할 수 있습니다.</p>
    `;
    return;
  }

  preview.innerHTML = `
    <div class="kakao-channel-admin-preview-card">
      <div>
        <strong>${hasButtonLabel ? safeLabel : "아이콘만 표시"}</strong>
        <p class="muted">${safeUrl}</p>
      </div>
      <div class="kakao-channel-admin-preview-pages">
        ${selectedPages.length ? selectedPages.map((label) => `<span>${escapeHtml(label)}</span>`).join("") : '<span>선택된 페이지 없음</span>'}
      </div>
    </div>
  `;
}

window.updateKakaoChannelPreview = updateKakaoChannelPreview;

window.saveKakaoChannelSettings = async () => {
  const settings = getKakaoChannelFormSettings();

  if (settings.enabled && !settings.url) {
    toast("카카오톡 채널을 사용하려면 URL을 입력하세요.", true);
    updateKakaoChannelPreview();
    return;
  }

  if (settings.url && !isValidKakaoChannelUrl(settings.url)) {
    toast("https://pf.kakao.com/... 형식의 카카오톡 채널 URL만 저장할 수 있습니다.", true);
    updateKakaoChannelPreview();
    return;
  }

  try {
    await setDoc(doc(db, "settings", KAKAO_CHANNEL_DOC_ID), {
      ...settings,
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser?.uid || null
    }, { merge: true });

    kakaoChannelLoaded = false;
    toast("카카오톡 채널 설정이 저장되었습니다.");
    await loadKakaoChannelSettingsForAdmin();
  } catch (error) {
    console.error("카카오톡 채널 설정 저장 실패:", error);
    toast("카카오톡 채널 설정 저장 실패: " + error.message, true);
  }
};



// 페이지 콘텐츠 저장

window.saveContent = async (slug) => {

  const editor = $(`#editor-${slug}`);

  if (!editor) return;

  

  const content = editor.value.trim();

  

  try {

    await setDoc(doc(db, "pages", slug), {

      slug: slug,

      content: content,

      updatedAt: serverTimestamp()

    }, { merge: true });

    

    toast("저장되었습니다.");

  } catch (error) {

    console.error(`페이지 콘텐츠 저장 실패 (${slug}):`, error);

    toast(`저장 실패: ${error.message}`, true);

  }

};



// HTML 태그 삽입

window.insertHTMLTag = (slug, tag, label) => {

  const editor = $(`#editor-${slug}`);

  if (!editor) return;

  

  const cursorPos = editor.selectionStart;

  const textBefore = editor.value.substring(0, cursorPos);

  const textAfter = editor.value.substring(cursorPos);

  

  let html = '';

  if (tag === 'h2') {

    html = `<h2>제목</h2>\n`;

  } else if (tag === 'p') {

    html = `<p>문단 내용을 입력하세요.</p>\n`;

  } else if (tag === 'strong') {

    html = `<strong>굵은 텍스트</strong>`;

  }

  

  editor.value = textBefore + html + textAfter;

  editor.focus();

  const newPos = cursorPos + html.length;

  editor.setSelectionRange(newPos, newPos);

  updatePreview(slug);

};



function validateStoryContactContentBlocked(content, label = "본문") {
  if (!containsBlockedImageSource(content)) return true;
  toast(`${label}에 허용되지 않는 이미지 소스가 포함되어 있습니다. ${getBlockedImageSourceMessage()}`, true);
  return false;
}

// 이미지 삽입
window.insertImage = async (slug) => {
  if (slug === 'story' || slug === 'contact') {
    toast(getBlockedImageSourceMessage(), true);
    return;
  }

  const url = prompt("이미지 URL 또는 /assets/... 경로를 입력하세요:\n(로컬 파일 준비는 이미지 파일 준비 버튼을 사용하세요)", "");

  if (!url) return;

  

  const editor = $(`#editor-${slug}`);

  if (editor) {

    const cursorPos = editor.selectionStart;

    const textBefore = editor.value.substring(0, cursorPos);

    const textAfter = editor.value.substring(cursorPos);

    const alt = prompt("이미지 설명(alt 텍스트)을 입력하세요:", "이미지");

    editor.value = textBefore + `\n<img src="${url}" alt="${alt || '이미지'}" style="max-width:100%;height:auto;border-radius:8px;">\n` + textAfter;

    editor.focus();

    editor.setSelectionRange(cursorPos + url.length + 50, cursorPos + url.length + 50);

    updatePreview(slug);

  }

};



// 이미지 파일 준비

window.uploadImage = async () => {
  toast(getBlockedImageSourceMessage(), true);
};



// 링크 삽입

window.insertLink = (slug) => {

  const url = prompt("링크 URL을 입력하세요:", "https://");

  if (!url) return;

  

  const text = prompt("링크 텍스트를 입력하세요:", "링크");

  if (!text) return;

  

  const editor = $(`#editor-${slug}`);

  if (editor) {

    const cursorPos = editor.selectionStart;

    const textBefore = editor.value.substring(0, cursorPos);

    const textAfter = editor.value.substring(cursorPos);

    editor.value = textBefore + `<a href="${url}" target="_blank">${text}</a>` + textAfter;

    editor.focus();

    editor.setSelectionRange(cursorPos + url.length + text.length + 30, cursorPos + url.length + text.length + 30);

    updatePreview(slug);

  }

};



// 파일 삽입

window.insertFile = async () => {
  toast(getBlockedImageSourceMessage(), true);
};


// 강사진 순서 관리

let currentInstructorPageType = 'home'; // 'home' 또는 'instructors'

let homeOrder = [];
let instructorsOrder = [];
let homeHidden = [];
let instructorsHidden = [];

let allInstructorsList = [];
let lastInstructorPreviewKey = '';

// 현재 페이지 타입에 따른 순서와 숨김 설정 가져오기
function getCurrentInstructorOrder() {
  return currentInstructorPageType === 'home' ? homeOrder : instructorsOrder;
}

function setCurrentInstructorOrder(order) {
  if (currentInstructorPageType === 'home') {
    homeOrder = order;
  } else {
    instructorsOrder = order;
  }
}

function getCurrentInstructorHidden() {
  return currentInstructorPageType === 'home' ? homeHidden : instructorsHidden;
}

function setCurrentInstructorHidden(hidden) {
  if (currentInstructorPageType === 'home') {
    homeHidden = hidden;
  } else {
    instructorsHidden = hidden;
  }
}

// 페이지 타입 전환
window.switchInstructorPageType = (type) => {
  if (type !== 'home' && type !== 'instructors') return;
  
  currentInstructorPageType = type;
  
  // 버튼 스타일 업데이트
  const homeBtn = $("#instructorPageFilterHome");
  const instructorsBtn = $("#instructorPageFilterInstructors");
  
  if (homeBtn && instructorsBtn) {
    if (type === 'home') {
      homeBtn.classList.add('primary');
      homeBtn.classList.remove('sm');
      instructorsBtn.classList.remove('primary');
      instructorsBtn.classList.add('sm');
    } else {
      instructorsBtn.classList.add('primary');
      instructorsBtn.classList.remove('sm');
      homeBtn.classList.remove('primary');
      homeBtn.classList.add('sm');
    }
  }
  
  // 목록 새로고침
  renderInstructorList();
  updateInstructorPreview();
};

async function loadInstructorsForOrder() {
  try {

    // 모든 강사 로드

    const instructorsSnap = await getDocs(collection(db, "instructors"));

    allInstructorsList = [];
    const usedNames = new Set(); // 이름 기반 중복 체크

    instructorsSnap.forEach((doc) => {
      const data = doc.data();
      const name = (data.name || '').trim();
      
      // 같은 이름의 강사가 이미 있으면 중복으로 간주하고 건너뛰기
      if (name && usedNames.has(name)) {
        // 중복 강사 발견 (이름 기반)
        return; // 중복이면 건너뛰기
      }
      
      // instructorId를 우선 사용, 없으면 문서 ID 사용
      const instructorId = data.instructorId || doc.id;
      
      allInstructorsList.push({ 
        id: instructorId, // 강사 상세 페이지 링크용 ID (instructorId 우선 사용)
        docId: doc.id, // 문서 ID (순서 매칭용)
        instructorId: instructorId,
        ...data 
      });
      if (name) usedNames.add(name);
    });

    

    // 저장된 순서 및 숨김 설정 로드

    const settingsResult = await getSettingDoc("instructorsMenu");

    if (settingsResult.exists) {
      const data = settingsResult.data;
      
      // 기존 order 필드가 있으면 homeOrder로 마이그레이션 (하위 호환성)
      if (Array.isArray(data.order) && !data.homeOrder && !data.instructorsOrder) {
        homeOrder = data.order;
        instructorsOrder = [...data.order]; // 초기값은 동일하게
      } else {
        homeOrder = Array.isArray(data.homeOrder) ? data.homeOrder : [];
        instructorsOrder = Array.isArray(data.instructorsOrder) ? data.instructorsOrder : [];
      }
      
      // 기존 hidden 필드가 있으면 homeHidden으로 마이그레이션 (하위 호환성)
      if (Array.isArray(data.hidden) && !data.homeHidden && !data.instructorsHidden) {
        homeHidden = data.hidden;
        instructorsHidden = [...data.hidden]; // 초기값은 동일하게
      } else {
        homeHidden = Array.isArray(data.homeHidden) ? data.homeHidden : [];
        instructorsHidden = Array.isArray(data.instructorsHidden) ? data.instructorsHidden : [];
      }
    } else {
      homeOrder = [];
      instructorsOrder = [];
      homeHidden = [];
      instructorsHidden = [];
    }

    // 초기 페이지 타입 버튼 상태 설정
    switchInstructorPageType(currentInstructorPageType);
    
    renderInstructorList();

    updateInstructorPreview();

  } catch (error) {

    console.error("강사진 로드 실패:", error);

    toast("강사진 로드 실패: " + error.message, true);

  }

}



function renderInstructorList() {

  const list = $("#instructorOrderList");

  if (!list) return;

  const instructorOrder = getCurrentInstructorOrder();
  const instructorHidden = getCurrentInstructorHidden();
  
  const byId = new Map(allInstructorsList.map(x => [x.id, x]));

  const ordered = [];

  

  // 저장된 순서 우선

  instructorOrder.forEach(id => {

    if (byId.has(id)) {

      ordered.push(byId.get(id));

      byId.delete(id);

    }

  });

  

  // 남은 항목은 이름순으로 추가

  const remain = Array.from(byId.values())

    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko-KR'));

  ordered.push(...remain);

  

  const isHidden = (id) => instructorHidden.includes(id);
  
  list.innerHTML = ordered.map((inst, idx) => {
    const hidden = isHidden(inst.id);
    return `
    <li draggable="true" data-id="${inst.id}" ${hidden ? 'style="opacity:0.5;"' : ''}>
      <span class="item-number">${idx + 1}</span>
      <span class="drag-handle">☰</span>
      <div class="item-info">
        <div class="item-name">${inst.name || '이름 없음'} ${hidden ? '<span style="color:var(--muted);font-size:12px;">(숨김)</span>' : ''}</div>
        <div class="item-meta">${inst.subject || ''}</div>
      </div>
      <button class="btn sm" onclick="toggleInstructorVisibility('${inst.id}')" style="margin-left:auto;min-width:60px;">
        ${hidden 
          ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:4px;"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>표시'
          : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:4px;"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>숨김'
        }
      </button>
    </li>
    `;
  }).join('');

  

  enableDragAndDrop(list, 'instructor');

}



function updateInstructorPreview() {
  const preview = $("#instructorPreview");
  if (!preview) return;

  const list = $("#instructorOrderList");
  if (!list) return;

  const instructorHidden = getCurrentInstructorHidden();

  const ordered = Array.from(list.children)
    .map((li) => {
      const id = li.getAttribute('data-id');
      return allInstructorsList.find((inst) => inst.id === id);
    })
    .filter(Boolean)
    .filter((inst) => !instructorHidden.includes(inst.id));

  const previewKey = ordered.map((inst) => {
    const photo = sanitizePublicImageSrc(inst.photo || inst.profilePhoto || '', {
      field: PUBLIC_IMAGE_FIELD.instructorProfile,
    });
    return `${inst.id}:${photo}`;
  }).join('|');

  if (previewKey === lastInstructorPreviewKey && preview.querySelector('.preview-card')) {
    return;
  }
  lastInstructorPreviewKey = previewKey;

  preview.innerHTML = ordered.map((inst) => {
    const safeName = escapeHtml(inst.name || '이름 없음');
    const safeSubject = escapeHtml(inst.subject || '');
    const photo = sanitizePublicImageSrc(inst.photo || inst.profilePhoto || '', {
      field: PUBLIC_IMAGE_FIELD.instructorProfile,
    });
    const guardedSrc = photo ? addImageCacheBuster(photo) : '';

    let imageHtml = '<div style="width:100%;height:200px;background:var(--hover);border-radius:8px;display:flex;align-items:center;justify-content:center;color:var(--muted);">이미지 없음</div>';
    if (guardedSrc) {
      if (isImageLoadExhausted(guardedSrc)) {
        imageHtml = '<div style="width:100%;height:200px;background:var(--hover);border-radius:8px;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:13px;">이미지를 불러올 수 없음</div>';
      } else {
        imageHtml = `<img data-guarded-src="${escapeHtml(guardedSrc)}" alt="${safeName}">`;
      }
    }

    return `
    <div class="preview-card">
      ${imageHtml}
      <div class="card-title">${safeName}</div>
      <div class="card-meta">${safeSubject}</div>
    </div>
    `;
  }).join('');

  bindGuardedImages(preview);
}



// 강사진 순서 저장

window.saveInstructorOrder = async () => {

  const list = $("#instructorOrderList");

  if (!list) return;

  

  const newOrder = Array.from(list.children).map(li => li.getAttribute('data-id'));


  try {
    // 현재 페이지 타입에 맞는 순서와 숨김 설정 저장
    setCurrentInstructorOrder(newOrder);
    const currentHidden = getCurrentInstructorHidden();

    await setDoc(doc(db, "settings", "instructorsMenu"), {
      homeOrder: homeOrder,
      instructorsOrder: instructorsOrder,
      homeHidden: homeHidden,
      instructorsHidden: instructorsHidden,
      updatedAt: serverTimestamp()
    }, { merge: true });
    invalidateSetting("instructorsMenu");

    toast(`${currentInstructorPageType === 'home' ? '메인홈' : '강사진 페이지'} 강사진 순서가 저장되었습니다.`);

  } catch (error) {

    console.error("강사진 순서 저장 실패:", error);

    toast("저장 실패: " + error.message, true);

  }

};

// 강사진 숨김/표시 토글

window.toggleInstructorVisibility = (id) => {

  const instructorHidden = getCurrentInstructorHidden();
  const index = instructorHidden.indexOf(id);

  
  if (index > -1) {
    // 숨김 해제
    instructorHidden.splice(index, 1);
  } else {
    // 숨김 처리
    instructorHidden.push(id);
  }
  
  setCurrentInstructorHidden(instructorHidden);
  
  // UI 업데이트
  renderInstructorList();
  updateInstructorPreview();
  
  // 자동 저장
  saveInstructorOrder();
};

// 강사진 순서 자동 정리 (존재하지 않는 ID 제거)

window.cleanupInstructorOrder = async () => {

  try {

    // 현재 강사 목록의 ID 수집

    const validIds = new Set(allInstructorsList.map(inst => inst.id));
    const instructorOrder = getCurrentInstructorOrder();
    const instructorHidden = getCurrentInstructorHidden();

    // 저장된 순서에서 유효한 ID만 필터링

    const cleanedOrder = instructorOrder.filter(id => validIds.has(id));
    const cleanedHidden = instructorHidden.filter(id => validIds.has(id));
    
    const removedCount = instructorOrder.length - cleanedOrder.length;

    

    if (removedCount === 0) {

      toast("정리할 항목이 없습니다. 모든 ID가 유효합니다.");

      return;

    }

    

    if (!confirm(`존재하지 않는 ID ${removedCount}개를 순서에서 제거하시겠습니까?\n\n제거될 ID: ${instructorOrder.filter(id => !validIds.has(id)).join(', ')}`)) {

      return;

    }

    // 현재 페이지 타입에 맞게 정리된 순서 저장
    setCurrentInstructorOrder(cleanedOrder);
    setCurrentInstructorHidden(cleanedHidden);
    
    await setDoc(doc(db, "settings", "instructorsMenu"), {
      homeOrder: homeOrder,
      instructorsOrder: instructorsOrder,
      homeHidden: homeHidden,
      instructorsHidden: instructorsHidden,
      updatedAt: serverTimestamp()
    }, { merge: true });
    invalidateSetting("instructorsMenu");

    toast(`✅ 순서 정리 완료!\n제거된 ID: ${removedCount}개`);

    

    // 목록 새로고침

    renderInstructorList();

    updateInstructorPreview();

    

  } catch (error) {

    console.error("순서 정리 실패:", error);

    toast("정리 실패: " + error.message, true);

  }

};



// 강사진 정렬

window.sortInstructors = (type) => {

  const list = $("#instructorOrderList");

  if (!list) return;

  

  let ordered = [];

  

  if (type === 'alpha') {

    ordered = allInstructorsList.slice()

      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko-KR'))

      .map(x => x.id);

  } else if (type === 'subject') {

    const priority = { "수학": 0, "영어": 1, "국어": 2, "과학": 3 };

    ordered = allInstructorsList.slice()

      .sort((a, b) => {

        const ap = priority[a.subject] ?? 9;

        const bp = priority[b.subject] ?? 9;

        if (ap !== bp) return ap - bp;

        return (a.name || '').localeCompare(b.name || '', 'ko-KR');

      })

      .map(x => x.id);

  } else if (type === 'newest') {

    ordered = allInstructorsList.slice()

      .sort((a, b) => {

        const ac = a.createdAt?.toMillis?.() || 0;

        const bc = b.createdAt?.toMillis?.() || 0;

        return bc - ac;

      })

      .map(x => x.id);

  }

  setCurrentInstructorOrder(ordered);
  renderInstructorList();

  updateInstructorPreview();

};



// 드래그 앤 드롭 활성화

function enableDragAndDrop(listEl, type) {

  let dragEl = null;

  

  listEl.addEventListener("dragstart", (e) => {

    const li = e.target.closest("li[draggable]");

    if (!li) return;

    dragEl = li;

    li.classList.add("dragging");

    e.dataTransfer.effectAllowed = "move";

  });

  

  listEl.addEventListener("dragend", (e) => {

    const li = e.target.closest("li[draggable]");

    if (li) li.classList.remove("dragging");

    dragEl = null;

    Array.from(listEl.children).forEach(ch => ch.classList.remove("drag-over"));

    

    // 미리보기 업데이트

    if (type === 'instructor') {
      updateInstructorPreview();
    }

  });

  

  listEl.addEventListener("dragover", (e) => {

    e.preventDefault();

    const li = e.target.closest("li[draggable]");

    if (!li || li === dragEl) return;

    li.classList.add("drag-over");

  });

  

  listEl.addEventListener("dragleave", (e) => {

    const li = e.target.closest("li[draggable]");

    if (li) li.classList.remove("drag-over");

  });

  

  listEl.addEventListener("drop", (e) => {

    e.preventDefault();

    const li = e.target.closest("li[draggable]");

    if (!li || li === dragEl) return;

    li.classList.remove("drag-over");

    

    const rect = li.getBoundingClientRect();

    const before = (e.clientY - rect.top) < rect.height / 2;

    listEl.insertBefore(dragEl, before ? li : li.nextSibling);

    

    // 번호 업데이트

    Array.from(listEl.children).forEach((child, idx) => {

      const num = child.querySelector('.item-number');

      if (num) num.textContent = idx + 1;

    });

    

    // 미리보기 업데이트

    if (type === 'instructor') {
      updateInstructorPreview();
    } else if (type === 'faq') {

      updateFAQPreview();

    }

  });

}



function buildContactMessageLinesEditorHTML(lines, index) {
  const slots = lines.length ? lines : [""];
  const rows = slots
    .map((line, lineIndex) => {
      const label = `${lineIndex + 1}번째 줄`;
      const canRemove = slots.length > 1;
      return `
        <div class="contact-message-line-row" style="display:flex;gap:8px;align-items:flex-start;margin-bottom:8px;">
          <div style="flex:1;min-width:0;">
            <label style="display:block;font-weight:600;margin-bottom:6px;font-size:13px;color:var(--text);">${label}</label>
            <input type="text" id="contact-loc-${index}-message-${lineIndex}" value="${escapeHtml(line || "")}" placeholder="전화 또는 온라인 예약 안내 문구" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:6px;font-size:14px;background:var(--bg);color:var(--text);">
          </div>
          ${
            canRemove
              ? `<button type="button" class="btn sm" style="margin-top:26px;" data-contact-action="remove-message-line" data-loc-index="${index}" data-line-index="${lineIndex}" aria-label="${label} 삭제">삭제</button>`
              : ""
          }
        </div>`;
    })
    .join("");
  const canAdd = slots.length < MAX_MESSAGE_LINES;
  return `
    <div class="field-group" style="margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">
        <label style="display:block;font-weight:600;font-size:14px;color:var(--text);margin:0;">문구 (최대 3줄)</label>
        ${canAdd ? `<button type="button" class="btn sm" data-contact-action="add-message-line" data-loc-index="${index}">줄 추가</button>` : ""}
      </div>
      <input type="hidden" id="contact-loc-${index}-message-count" value="${slots.length}">
      <div id="contact-loc-${index}-message-lines">${rows}</div>
    </div>`;
}

function buildContactTransportItemsEditorHTML(items, index) {
  const rows = items
    .map((item, itemIndex) => {
      const typeOptions = Object.entries(TRANSPORT_TYPE_META)
        .map(([type, meta]) => {
          const selected = item.type === type ? "selected" : "";
          return `<option value="${type}" ${selected}>${meta.label}</option>`;
        })
        .join("");
      return `
        <div class="contact-transport-row" style="border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:10px;background:var(--bg);">
          <input type="hidden" id="contact-loc-${index}-transport-${itemIndex}-id" value="${escapeHtml(item.id || "")}">
          <div style="display:grid;grid-template-columns:140px 1fr auto;gap:8px;align-items:start;">
            <div>
              <label style="display:block;font-weight:600;margin-bottom:6px;font-size:12px;">유형</label>
              <select id="contact-loc-${index}-transport-${itemIndex}-type" data-transport-type-select style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--card);color:var(--text);">
                ${typeOptions}
              </select>
            </div>
            <div>
              <label style="display:block;font-weight:600;margin-bottom:6px;font-size:12px;">안내 문구</label>
              <textarea id="contact-loc-${index}-transport-${itemIndex}-text" rows="3" placeholder="교통 안내 문구 (줄바꿈 가능)" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--card);color:var(--text);font-family:inherit;resize:vertical;">${escapeHtml(item.text || "")}</textarea>
            </div>
            <button type="button" class="btn sm" data-contact-action="remove-transport-item" data-loc-index="${index}" data-item-index="${itemIndex}" aria-label="교통수단 삭제">삭제</button>
          </div>
        </div>`;
    })
    .join("");
  return `
    <div class="field-group" style="margin-bottom:12px;padding:16px;background:var(--bg-secondary);border-radius:12px;border-left:4px solid var(--brand);">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:12px;">
        <label style="display:block;font-weight:700;font-size:15px;color:var(--text);margin:0;">교통수단</label>
        <button type="button" class="btn sm" data-contact-action="add-transport-item" data-loc-index="${index}">교통수단 추가</button>
      </div>
      <input type="hidden" id="contact-loc-${index}-transport-count" value="${items.length}">
      <div id="contact-loc-${index}-transport-items">${rows || '<p class="muted" style="margin:0;font-size:13px;">등록된 교통수단이 없습니다.</p>'}</div>
    </div>`;
}

function buildSingleLocationEditorHTML(loc, index, totalCount) {
  const normalized = prepareContactLocationDraftForRender(loc);
  const ml = normalized.mapLinks || {};
  const delDisabled = totalCount <= 1;
  const mapSource = (normalized.mapIframeSrc || normalized.mapEmbedQuery || normalized.address || "").trim();
  return `
      <div class="contact-loc-block" style="border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:16px;background:var(--card);">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
          <strong style="font-size:16px;">위치 ${index + 1}</strong>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <button type="button" class="btn sm" onclick="removeContactLocation(${index})" ${delDisabled ? "disabled style=\"opacity:0.5;cursor:not-allowed\"" : ""}>이 위치 삭제</button>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:12px;">
          <div class="field-group">
            <label style="display:block;font-weight:600;margin-bottom:8px;font-size:14px;color:var(--text);">위치 이름</label>
            <input type="text" id="contact-loc-${index}-label" value="${escapeHtml(normalized.label || "")}" placeholder="예: 고등 1관" style="width:100%;padding:12px 16px;border:2px solid var(--border);border-radius:8px;font-size:15px;background:var(--bg);color:var(--text);">
          </div>
          <div class="field-group">
            <label style="display:block;font-weight:600;margin-bottom:8px;font-size:14px;color:var(--text);">전화번호</label>
            <input type="text" id="contact-loc-${index}-phone" value="${escapeHtml(normalized.phone || "")}" placeholder="02-809-0611" style="width:100%;padding:12px 16px;border:2px solid var(--border);border-radius:8px;font-size:15px;background:var(--bg);color:var(--text);">
          </div>
        </div>
        ${buildContactMessageLinesEditorHTML(normalized.messageLines, index)}
        <div class="field-group" style="margin-bottom:12px;">
          <label style="display:block;font-weight:600;margin-bottom:8px;font-size:14px;color:var(--text);">온라인 상담 예약 URL</label>
          <input type="url" id="contact-loc-${index}-onlineBookingUrl" value="${escapeHtml(normalized.onlineBookingUrl || "")}" placeholder="https://…" style="width:100%;padding:12px 16px;border:2px solid var(--border);border-radius:8px;font-size:15px;background:var(--bg);color:var(--text);">
        </div>
        <div class="field-group" style="margin-bottom:12px;">
          <label style="display:block;font-weight:600;margin-bottom:8px;font-size:14px;color:var(--text);">운영 시간</label>
          <input type="text" id="contact-loc-${index}-hours" value="${escapeHtml(normalized.hours || "")}" placeholder="평일 15:00–22:00 / 주말 12:00–22:00" style="width:100%;padding:12px 16px;border:2px solid var(--border);border-radius:8px;font-size:15px;background:var(--bg);color:var(--text);">
        </div>
        <div class="field-group" style="margin-bottom:12px;">
          <label style="display:block;font-weight:600;margin-bottom:8px;font-size:14px;color:var(--text);">주소</label>
          <input type="text" id="contact-loc-${index}-address" value="${escapeHtml(normalized.address || "")}" placeholder="서울 …" style="width:100%;padding:12px 16px;border:2px solid var(--border);border-radius:8px;font-size:15px;background:var(--bg);color:var(--text);">
        </div>
        <div class="field-group" style="margin-bottom:12px;">
          <label style="display:block;font-weight:600;margin-bottom:8px;font-size:14px;color:var(--text);">지도 입력값</label>
          <p class="muted" style="margin:0 0 8px 0;font-size:13px;line-height:1.55;">지도 URL, 주소 또는 좌표</p>
          <input type="text" id="contact-loc-${index}-mapSource" value="${escapeHtml(mapSource)}" placeholder="https://www.google.com/maps/... 또는 주소/좌표" style="width:100%;padding:12px 16px;border:2px solid var(--border);border-radius:8px;font-size:15px;background:var(--bg);color:var(--text);">
        </div>
        ${buildContactTransportItemsEditorHTML(normalized.transportItems, index)}
        <div class="field-group" style="padding:16px;background:var(--bg-secondary);border-radius:12px;border-left:4px solid var(--brand);">
          <label style="display:block;font-weight:700;margin-bottom:12px;font-size:15px;color:var(--text);">지도 앱 링크</label>
          <div style="display:flex;flex-direction:column;gap:10px;">
            <div>
              <label style="display:block;font-weight:600;margin-bottom:6px;font-size:13px;">네이버</label>
              <input type="url" id="contact-loc-${index}-mn" value="${escapeHtml(ml.naver || "")}" placeholder="https://map.naver.com/..." style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:6px;font-size:14px;background:var(--bg);color:var(--text);">
            </div>
            <div>
              <label style="display:block;font-weight:600;margin-bottom:6px;font-size:13px;">카카오</label>
              <input type="url" id="contact-loc-${index}-mk" value="${escapeHtml(ml.kakao || "")}" placeholder="https://map.kakao.com/..." style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:6px;font-size:14px;background:var(--bg);color:var(--text);">
            </div>
            <div>
              <label style="display:block;font-weight:600;margin-bottom:6px;font-size:13px;">구글</label>
              <input type="url" id="contact-loc-${index}-mg" value="${escapeHtml(ml.google || "")}" placeholder="https://maps.google.com/..." style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:6px;font-size:14px;background:var(--bg);color:var(--text);">
            </div>
          </div>
        </div>
      </div>`;
}

function readContactMessageLinesDraftFromForm(index) {
  const count = parseInt($(`#contact-loc-${index}-message-count`)?.value || "0", 10) || 0;
  const slots = [];
  for (let i = 0; i < count; i++) {
    slots.push($(`#contact-loc-${index}-message-${i}`)?.value ?? "");
  }
  return slots.slice(0, MAX_MESSAGE_LINES);
}

function readContactLocationDraftFromForm(index) {
  const label = $(`#contact-loc-${index}-label`)?.value?.trim();
  const mapSource = ($(`#contact-loc-${index}-mapSource`)?.value || "").trim();
  const isMapUrl = /^https?:\/\/(www\.)?(google\.com|maps\.google\.com)\//i.test(mapSource);
  const preserved = window.__contactLocList?.[index] || {};
  return cloneContactLocation({
    ...preserved,
    label: label || preserved.label || `위치 ${index + 1}`,
    phone: $(`#contact-loc-${index}-phone`)?.value || "",
    messageLines: readContactMessageLinesDraftFromForm(index),
    onlineBookingUrl: $(`#contact-loc-${index}-onlineBookingUrl`)?.value || "",
    hours: $(`#contact-loc-${index}-hours`)?.value || "",
    address: $(`#contact-loc-${index}-address`)?.value || "",
    mapIframeSrc: isMapUrl ? mapSource : "",
    mapEmbedQuery: isMapUrl ? "" : mapSource,
    transportItems: readContactTransportItemsFromForm(index),
    mapLinks: {
      naver: $(`#contact-loc-${index}-mn`)?.value || "",
      kakao: $(`#contact-loc-${index}-mk`)?.value || "",
      google: $(`#contact-loc-${index}-mg`)?.value || "",
    },
  });
}
function readContactTransportItemsFromForm(index) {
  const count = parseInt($(`#contact-loc-${index}-transport-count`)?.value || "0", 10) || 0;
  const items = [];
  for (let i = 0; i < count; i++) {
    const type = $(`#contact-loc-${index}-transport-${i}-type`)?.value || "walking";
    items.push({
      id: $(`#contact-loc-${index}-transport-${i}-id`)?.value?.trim() || createContactTransportItemId(),
      type,
      text: $(`#contact-loc-${index}-transport-${i}-text`)?.value ?? "",
      sortOrder: i,
    });
  }
  return items;
}

window.readContactLocationsFromForm = function readContactLocationsFromForm() {
  return readContactLocationsDraftFromForm().map((loc) => {
    const messageLines = messageLinesForSave(loc.messageLines || []);
    return normalizeCanonicalContactLocation({
      ...loc,
      messageLines,
      transportItems: loc.transportItems || [],
    });
  });
};

function readContactLocationsDraftFromForm() {
  const n = parseInt($("#contact-loc-count")?.value || "0", 10) || window.__contactLocList?.length || 0;
  const list = [];
  for (let i = 0; i < n; i++) {
    list.push(readContactLocationDraftFromForm(i));
  }
  return list;
}

window.renderContactLocationEditors = function renderContactLocationEditors() {
  const fieldsContainer = $("#contact-editor-fields");
  if (!fieldsContainer) return;
  const list = (window.__contactLocList || []).map((loc) => prepareContactLocationDraftForRender(loc));
  let html = `
    <input type="hidden" id="contact-loc-count" value="${list.length}">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
      <p class="muted" style="margin:0;max-width:720px;line-height:1.55;font-size:14px;">위치별 연락처·주소·교통·지도를 설정합니다.</p>
      <button type="button" class="btn sm primary" onclick="addContactLocation()">위치 추가</button>
    </div>
    <div style="margin-bottom:16px;padding:12px;border:1px solid var(--border);border-radius:10px;background:var(--bg-secondary);">
      <div style="font-weight:600;font-size:14px;margin-bottom:8px;">표시 순서 (드래그로 변경)</div>
      <div id="contact-location-order-list" style="display:flex;flex-wrap:wrap;gap:8px;"></div>
    </div>`;
  list.forEach((loc, i) => {
    html += buildSingleLocationEditorHTML(loc, i, list.length);
  });
  fieldsContainer.innerHTML = html;
  fieldsContainer.oninput = () => {
    window.updateContactPreview();
  };
  fieldsContainer.onchange = () => {
    window.updateContactPreview();
  };
  window.renderContactLocationOrderList();
  window.updateContactPreview();
};

window.addContactLocation = function addContactLocation() {
  window.__contactLocList = readContactLocationsDraftFromForm();
  window.__contactLocList.push(cloneContactLocation(CONTACT_LOCATION_BLANK));
  window.renderContactLocationEditors();
};

window.removeContactLocation = function removeContactLocation(index) {
  if (window.__contactLocList.length <= 1) {
    toast("최소 1개의 위치가 필요합니다.", true);
    return;
  }
  window.__contactLocList = readContactLocationsDraftFromForm();
  window.__contactLocList.splice(index, 1);
  window.renderContactLocationEditors();
};

window.renderContactLocationOrderList = function renderContactLocationOrderList() {
  const container = $("#contact-location-order-list");
  if (!container) return;
  const list = readContactLocationsDraftFromForm();
  container.innerHTML = list
    .map((loc, i) => {
      const label = escapeHtml((loc.label || `위치 ${i + 1}`).trim());
      return `<button type="button" class="btn sm" draggable="true" data-loc-idx="${i}" style="cursor:grab;">☰ ${label}</button>`;
    })
    .join("");

  let draggedIndex = -1;
  container.querySelectorAll("[data-loc-idx]").forEach((el) => {
    el.addEventListener("dragstart", (e) => {
      draggedIndex = parseInt(el.getAttribute("data-loc-idx") || "-1", 10);
      e.dataTransfer.effectAllowed = "move";
      el.style.opacity = "0.5";
    });
    el.addEventListener("dragend", () => {
      el.style.opacity = "1";
    });
    el.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    });
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      const targetIndex = parseInt(el.getAttribute("data-loc-idx") || "-1", 10);
      if (draggedIndex < 0 || targetIndex < 0 || draggedIndex === targetIndex) return;
      const current = readContactLocationsDraftFromForm();
      const [picked] = current.splice(draggedIndex, 1);
      current.splice(targetIndex, 0, picked);
      window.__contactLocList = current;
      window.renderContactLocationEditors();
    });
  });
};

// 상담문의 콘텐츠 로드 및 편집 필드 생성

async function loadContactContent() {

  const fieldsContainer = $("#contact-editor-fields");

  if (!fieldsContainer) return;

  

  try {

    const pageDoc = await getDoc(doc(db, "pages", "contact"));

    let structure = {};

    if (pageDoc.exists()) {
      const data = pageDoc.data();
      structure = data.structure || {};
    }

    window.__contactLocList = loadContactLocationsFromStructure(structure);

    window.renderContactLocationEditors();

  } catch (error) {

    console.error("상담문의 콘텐츠 로드 실패:", error);

    if (fieldsContainer) {
      fieldsContainer.innerHTML = `<div class="muted" style="text-align:center;padding:40px;color:var(--error-color);">
        콘텐츠 로드 실패: ${error.message}<br>
        <button class="btn sm" onclick="loadPageContent('contact')" style="margin-top:16px;">다시 시도</button>
      </div>`;
    }

    toast("콘텐츠 로드 실패: " + error.message, true);

  }

}



// 상담문의 텍스트 포맷팅
window.formatContactText = (command) => {
  const editor = $("#contact-content");
  if (!editor) return;
  
  editor.focus();
  document.execCommand(command, false, null);
  updateContactPreview();
};

// 상담문의 글자 크기 변경
window.changeContactFontSize = () => {
  const editor = $("#contact-content");
  const fontSize = $("#contact-fontSize")?.value;
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
    } else {
      document.execCommand('insertHTML', false, `<span style="font-size: ${fontSize}"></span>`);
    }
  }
  updateContactPreview();
};

// 상담문의 글자 색깔 변경
window.changeContactFontColor = () => {
  const editor = $("#contact-content");
  const fontColor = $("#contact-fontColor")?.value;
  if (!editor || !fontColor) return;
  
  editor.focus();
  document.execCommand('foreColor', false, fontColor);
  updateContactPreview();
};

// 상담문의 오시는길 텍스트 포맷팅
window.formatContactDirectionsText = (command) => {
  const editor = $("#contact-directions");
  if (!editor) return;
  
  editor.focus();
  document.execCommand(command, false, null);
  updateContactPreview();
};

// 상담문의 오시는길 글자 크기 변경
window.changeContactDirectionsFontSize = () => {
  const editor = $("#contact-directions");
  const fontSize = $("#contact-directions-fontSize")?.value;
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
    } else {
      document.execCommand('insertHTML', false, `<span style="font-size: ${fontSize}"></span>`);
    }
  }
  updateContactPreview();
};

// 상담문의 오시는길 글자 색깔 변경
window.changeContactDirectionsFontColor = () => {
  const editor = $("#contact-directions");
  const fontColor = $("#contact-directions-fontColor")?.value;
  if (!editor || !fontColor) return;
  
  editor.focus();
  document.execCommand('foreColor', false, fontColor);
  updateContactPreview();
};

// 상담문의 오시는길 이미지 파일 준비 (비활성화)
window.uploadContactDirectionsImage = () => {
  toast(getBlockedImageSourceMessage(), true);
};

// 상담문의 이미지 파일 준비 (비활성화)
window.uploadContactImage = () => {
  toast(getBlockedImageSourceMessage(), true);
};

// 상담문의 미리보기 업데이트 (실시간, debounce 적용)
let contactPreviewTimeout = null;
let contactPreviewActiveIndex = 0;

window.updateContactPreview = () => {
  clearTimeout(contactPreviewTimeout);
  contactPreviewTimeout = setTimeout(() => {
    const preview = $("#contactPreview");
    if (!preview) return;

    const locations = window.readContactLocationsFromForm();

    if (!locations.length) {
      preview.innerHTML = '<p class="muted" style="margin:0;">미리보기가 여기에 표시됩니다.</p>';
      return;
    }

    if (contactPreviewActiveIndex >= locations.length) {
      contactPreviewActiveIndex = 0;
    }

    const showTabs = locations.length > 1;
    const tabsHtml = showTabs
      ? `<section class="grit-filter contact-location-filter" aria-label="관 선택">
          <div class="filter-group contact-preview-tabs" style="display:flex;flex-wrap:wrap;gap:8px;">
            ${locations
              .map((loc, i) => {
                const label = escapeHtml(loc.label || `위치 ${i + 1}`);
                const active = i === contactPreviewActiveIndex;
                return `<button type="button" class="${active ? "on" : ""}" data-preview-index="${i}" style="padding:8px 14px;border-radius:999px;border:1px solid ${active ? "var(--brand)" : "var(--border)"};background:${active ? "var(--brand)" : "var(--card)"};color:${active ? "#fff" : "var(--text)"};font-size:13px;cursor:pointer;">${label}</button>`;
              })
              .join("")}
          </div>
        </section>`
      : "";

    const activeLoc = locations[contactPreviewActiveIndex] || locations[0];
    preview.innerHTML = `
      <div class="contact-preview-root contact-wrap" style="padding:0;max-width:none;">
        <h1 class="page-title" style="font-size:1.5rem;margin:0 0 12px;">${escapeHtml(CONTACT_PUBLIC_PAGE_TITLE)}</h1>
        ${tabsHtml}
        <section class="contact-grid contact-preview-grid" style="margin-top:20px;grid-template-columns:1fr;">
          <div class="contact-card contact-preview-card" style="padding:24px;">${buildContactLeftColumnHTML(activeLoc)}</div>
          ${buildContactLocationPanelHTML(activeLoc)}
        </section>
      </div>
    `;

    preview.querySelector(".contact-preview-tabs")?.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-preview-index]");
      if (!btn) return;
      contactPreviewActiveIndex = parseInt(btn.getAttribute("data-preview-index") || "0", 10);
      window.updateContactPreview();
    });
  }, 120);
};



// 상담문의 콘텐츠 저장

window.saveContactContent = async () => {

  try {

    const locations = window.readContactLocationsFromForm();

    if (!locations.length) {
      toast("저장할 위치 정보가 없습니다.", true);
      return;
    }

    window.__contactLocList = locations.map((loc) => normalizeContactLocationForEditor(loc));

    const payload = buildContactSavePayload(locations);

    await setDoc(doc(db, "pages", "contact"), {
      ...payload,
      updatedAt: serverTimestamp(),
    });

    toast("저장되었습니다.");

  } catch (error) {

    console.error("상담문의 콘텐츠 저장 실패:", error);

    toast("저장 실패: " + error.message, true);

  }

};




// 초기 로드 - 활성화된 탭/서브메뉴에 따라 로드
// DOM이 준비될 때까지 기다림
function initPageLoad() {
  bindContactEditorActions();
  const activeTab = $('.tab-btn.active')?.dataset.tab;
  const activeSubmenu = $('.submenu-btn.active')?.dataset.submenu;

  if (activeTab === 'academy') {
    // 학원안내 탭이 활성화된 경우
    if (activeSubmenu === 'story') {
      loadPageContent('story');
    } else if (activeSubmenu === 'contact') {
      loadPageContent('contact');
    } else if (activeSubmenu === 'kakao-channel') {
      loadKakaoChannelSettingsForAdmin();
    } else {
      // 기본적으로 이야기 로드
      loadPageContent('story');
    }
  }
  if (activeTab === 'instructors') {
    loadInstructorsForOrder();
  }
  if (activeTab === 'dday') {
    loadDdaySettingsForAdmin();
  }
  if (activeTab === 'footer') {
    loadFooterSettingsForAdmin();
    loadTuitionImagesForAdmin();
  }
  const footerForm = document.getElementById("footerSettingsForm");
  if (footerForm) footerForm.onsubmit = saveFooterSettings;
  const saveTuitionButton = document.getElementById("saveTuitionImages");
  if (saveTuitionButton) saveTuitionButton.onclick = saveTuitionImages;
}


// DOM이 준비되면 초기 로드 실행
// 요소가 준비될 때까지 기다림
function waitForElements() {
  const tabBtn = $('.tab-btn');
  const submenuBtn = $('.submenu-btn');
  
  
  if (tabBtn && submenuBtn) {
    // 이벤트 리스너 등록
    setupTabListeners();
    setupSubmenuListeners();
    // 초기 로드 실행
    initPageLoad();
  } else {
    // 요소가 아직 준비되지 않았으면 재시도 (최대 50회, 약 2.5초)
    const retryCount = waitForElements.retryCount || 0;
    if (retryCount < 50) {
      waitForElements.retryCount = retryCount + 1;
      if (retryCount % 10 === 0) {
      }
      setTimeout(waitForElements, 50);
    } else {
      console.error('[admin-site] 탭 버튼을 찾을 수 없습니다.');
      console.error('[admin-site] 현재 DOM 상태:', {
        tabBtn: $('.tab-btn'),
        submenuBtn: $('.submenu-btn'),
        allTabBtns: document.querySelectorAll('.tab-btn').length,
        allSubmenuBtns: document.querySelectorAll('.submenu-btn').length
      });
    }
  }
}


// 헤더가 로드될 때까지 기다린 후 초기화
function initAdminSite() {
  // 헤더가 로드되었는지 확인 (data-include="header"가 로드되었는지)
  const headerLoaded = document.querySelector('header') || document.querySelector('[data-include="header"]');
  
  
  if (headerLoaded || document.readyState === 'complete') {
    // 헤더가 로드되었거나 페이지가 완전히 로드된 경우
    setTimeout(waitForElements, 200);
  } else {
    // 헤더가 아직 로드되지 않은 경우, 조금 더 기다림
    const retryCount = initAdminSite.retryCount || 0;
    if (retryCount < 30) {
      initAdminSite.retryCount = retryCount + 1;
      setTimeout(initAdminSite, 100);
    } else {
      setTimeout(waitForElements, 200);
    }
  }
}


if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    // 헤더가 로드될 때까지 기다림
    setTimeout(initAdminSite, 300);
  });
} else {
  // 이미 DOM이 준비된 경우
  setTimeout(initAdminSite, 300);
}
