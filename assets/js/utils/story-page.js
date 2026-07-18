import { escapeHtml } from "/assets/js/utils/html.js";
import { deleteField } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import {
  PUBLIC_IMAGE_FIELD,
  normalizeStoryImageUrl,
  isAllowedStoryImageUrl,
  getStoryImageValidationMessage,
} from "/assets/js/utils/public-image-url.js";

export const STORY_PAGE_VERSION = 2;

const DEFAULT_PAGE_TITLE = "그릿에듀 학원 안내";
const DEFAULT_HERO_IMAGE_ALT = "그릿에듀 강사진 단체 이미지";
const DEFAULT_CEO_IMAGE_ALT = "그릿에듀 대표이사 유홍석";
const DEFAULT_SIGNATURE_TITLE = "그릿에듀 대표이사";
const DEFAULT_SIGNATURE_NAME = "유홍석";

const DEFAULT_GRIT_VALUES = [
  { letter: "G", word: "Growth", title: "꾸준한 반복이 만드는 성장" },
  { letter: "R", word: "Resilience", title: "흔들려도 다시 회복하는 회복탄력성" },
  { letter: "I", word: "Integrity", title: "바르게 배우고 정직하게 쌓는 공부 태도" },
  { letter: "T", word: "Tenacity", title: "포기하지 않고 끝까지 해내는 힘" },
];

const DEFAULT_CLOSING_LINE1 = "꾸준히 하는 아이가 결국 끝까지 해냅니다.";
const DEFAULT_CLOSING_LINE2 = "그릿에듀는 그 힘을 길러냅니다.";

const DEFAULT_GREETING_BODY = `그릿에듀가 가장 강조하는 것은
꾸준함의 힘과 끝까지 하는 힘입니다.

성적은 우연히 오르지 않습니다.
좋은 수업을 한 번 듣는다고 완성되지도 않습니다.

진짜 실력은 매일의 반복 속에서 만들어집니다.
배운 것을 다시 복습하고,
틀린 문제를 다시 바라보고,
무너진 루틴을 다시 회복하며,
포기하고 싶은 순간에도 한 번 더 앉는 과정 속에서
학생은 조금씩 성장합니다.

그래서 그릿에듀는 학생에게 단순히 지식을 전달하지 않습니다.
공부를 계속할 수 있는 구조를 만들고,
흔들려도 다시 일어서는 회복탄력성을 기르며,
끝까지 완성해내는 경험을 쌓게 합니다.

그릿에듀가 말하는 GRIT은
무조건 버티라는 말이 아닙니다.

어제보다 오늘 조금 더 해내는 힘,
틀려도 다시 배우는 힘,
힘들어도 루틴을 회복하는 힘,
그리고 끝내 자신의 공부를 완성하는 힘입니다.

그릿에듀는 국어, 영어, 수학, 과학 정규 수업을 기반으로
수리논술과 약술형논술, 프리미엄 중등부까지 연결해
중등부터 고등, 내신부터 수능과 대학별고사까지
학생의 학습 여정을 체계적으로 설계합니다.

수업만 제공하지 않습니다.
학생의 현재를 진단하고,
학습 루틴을 만들고,
학교별 내신과 입시 전략에 맞춰
성장의 과정을 끝까지 관리합니다.

그릿에듀는 처음부터 잘하는 아이보다
꾸준히 다시 시작하는 아이,
흔들려도 회복하는 아이,
결국 끝까지 해내는 아이를 길러냅니다.`;

export const STORY_V2_DEFAULTS = {
  slug: "story",
  version: STORY_PAGE_VERSION,
  pageTitle: DEFAULT_PAGE_TITLE,
  heroImageUrl: "",
  heroImageAlt: DEFAULT_HERO_IMAGE_ALT,
  greeting: {
    title: "그릿에듀의 교육철학",
    subtitle: "꾸준함의 힘, 끝까지 하는 힘",
    body: DEFAULT_GREETING_BODY,
    ceoImageUrl: "",
    ceoImageAlt: DEFAULT_CEO_IMAGE_ALT,
    signatureTitle: DEFAULT_SIGNATURE_TITLE,
    signatureName: DEFAULT_SIGNATURE_NAME,
  },
  gritValues: DEFAULT_GRIT_VALUES.map((item) => ({ ...item })),
  closingLine1: DEFAULT_CLOSING_LINE1,
  closingLine2: DEFAULT_CLOSING_LINE2,
};

function trimText(value) {
  return String(value ?? "").trim();
}

function resolveHeroImageAlt(value) {
  return trimText(value) || DEFAULT_HERO_IMAGE_ALT;
}

function resolveCeoImageAlt(value) {
  return trimText(value) || DEFAULT_CEO_IMAGE_ALT;
}

function normalizeGritValues(source) {
  const list = Array.isArray(source) ? source : [];
  return DEFAULT_GRIT_VALUES.map((def) => {
    const item = list.find((entry) => trimText(entry?.letter)?.toUpperCase() === def.letter) || {};
    return {
      letter: def.letter,
      word: trimText(item.word) || def.word,
      title: trimText(item.title) || def.title,
    };
  });
}

function resolveClosingLines(data = {}) {
  const line1 = trimText(data.closingLine1);
  const line2 = trimText(data.closingLine2);
  if (line1 || line2) {
    return {
      closingLine1: line1 || DEFAULT_CLOSING_LINE1,
      closingLine2: line2 || DEFAULT_CLOSING_LINE2,
    };
  }

  const legacy = String(data.closingMessage ?? "").replace(/\r\n/g, "\n").trim();
  if (legacy) {
    const parts = legacy.split("\n");
    return {
      closingLine1: parts[0]?.trim() || DEFAULT_CLOSING_LINE1,
      closingLine2: parts.slice(1).join("\n").trim() || DEFAULT_CLOSING_LINE2,
    };
  }

  return {
    closingLine1: DEFAULT_CLOSING_LINE1,
    closingLine2: DEFAULT_CLOSING_LINE2,
  };
}

function splitLegacySignature(signature) {
  const text = trimText(signature).replace(/^\s*-\s*/, "").replace(/\s*-\s*$/, "").trim();
  if (!text) {
    return {
      signatureTitle: DEFAULT_SIGNATURE_TITLE,
      signatureName: DEFAULT_SIGNATURE_NAME,
    };
  }
  if (text.endsWith(DEFAULT_SIGNATURE_NAME)) {
    return {
      signatureTitle: text.slice(0, -DEFAULT_SIGNATURE_NAME.length).trim() || DEFAULT_SIGNATURE_TITLE,
      signatureName: DEFAULT_SIGNATURE_NAME,
    };
  }
  const parts = text.split(/\s+/);
  if (parts.length >= 2) {
    return {
      signatureTitle: parts.slice(0, -1).join(" "),
      signatureName: parts[parts.length - 1],
    };
  }
  return {
    signatureTitle: text,
    signatureName: DEFAULT_SIGNATURE_NAME,
  };
}

function resolveSignatureParts(greetingSource = {}) {
  const title = trimText(greetingSource.signatureTitle);
  const name = trimText(greetingSource.signatureName);
  if (title || name) {
    return {
      signatureTitle: title || DEFAULT_SIGNATURE_TITLE,
      signatureName: name || DEFAULT_SIGNATURE_NAME,
    };
  }

  if (trimText(greetingSource.signature)) {
    return splitLegacySignature(greetingSource.signature);
  }

  return {
    signatureTitle: DEFAULT_SIGNATURE_TITLE,
    signatureName: DEFAULT_SIGNATURE_NAME,
  };
}

export function isStoryV2Document(data) {
  if (!data || typeof data !== "object") return false;
  return Number(data.version) === STORY_PAGE_VERSION;
}

export function normalizeStoryV2(data = {}) {
  const greetingSource = data.greeting && typeof data.greeting === "object" ? data.greeting : {};
  const body = greetingSource.body != null && String(greetingSource.body).trim()
    ? String(greetingSource.body).replace(/\r\n/g, "\n")
    : DEFAULT_GREETING_BODY;
  const closing = resolveClosingLines(data);
  const signatureParts = resolveSignatureParts(greetingSource);

  return {
    slug: "story",
    version: STORY_PAGE_VERSION,
    pageTitle: trimText(data.pageTitle) || DEFAULT_PAGE_TITLE,
    heroImageUrl: normalizeStoryImageUrl(data.heroImageUrl),
    heroImageAlt: resolveHeroImageAlt(data.heroImageAlt),
    greeting: {
      title: trimText(greetingSource.title) || STORY_V2_DEFAULTS.greeting.title,
      subtitle: trimText(greetingSource.subtitle) || STORY_V2_DEFAULTS.greeting.subtitle,
      body,
      signatureTitle: signatureParts.signatureTitle,
      signatureName: signatureParts.signatureName,
      ceoImageUrl: normalizeStoryImageUrl(greetingSource.ceoImageUrl),
      ceoImageAlt: resolveCeoImageAlt(greetingSource.ceoImageAlt),
    },
    gritValues: normalizeGritValues(data.gritValues),
    closingLine1: closing.closingLine1,
    closingLine2: closing.closingLine2,
  };
}

function renderStoryImage(url, alt, className) {
  const safeUrl = normalizeStoryImageUrl(url);
  if (!safeUrl) return "";
  const safeAlt = escapeHtml(alt || "");
  return `<img class="${className}" src="${escapeHtml(safeUrl)}" alt="${safeAlt}" loading="lazy" decoding="async">`;
}

function renderSignatureHtml(signatureTitle, signatureName) {
  if (!signatureTitle && !signatureName) return "";
  return `
    <div class="story-signature">
      ${signatureTitle ? `<span class="story-signature-title">${escapeHtml(signatureTitle)}</span>` : ""}
      ${signatureName ? `<strong class="story-signature-name">${escapeHtml(signatureName)}</strong>` : ""}
    </div>
  `.trim();
}

function renderGritPlainHtml(gritValues) {
  const items = gritValues
    .map(
      (item) => `
    <div class="story-grit-plain-item">
      <dt><strong>${escapeHtml(item.letter)}</strong> <span>${escapeHtml(item.word)}</span></dt>
      <dd>${escapeHtml(item.title)}</dd>
    </div>`
    )
    .join("\n");

  return `<dl class="story-grit-plain">${items}</dl>`;
}

function renderFinalMessageHtml(closingLine1, closingLine2) {
  if (!closingLine1 && !closingLine2) return "";
  return `
    <div class="story-final-message">
      ${closingLine1 ? `<p class="story-final-message-line">${escapeHtml(closingLine1)}</p>` : ""}
      ${closingLine2 ? `<p class="story-final-message-line">${escapeHtml(closingLine2)}</p>` : ""}
    </div>
  `.trim();
}

export function renderStoryV2InnerHtml(data) {
  const story = normalizeStoryV2(data);
  const parts = [];

  const heroImage = renderStoryImage(story.heroImageUrl, story.heroImageAlt, "story-hero-image");
  if (heroImage) {
    parts.push(`<section class="story-hero" aria-label="학원 안내 배너">${heroImage}</section>`);
  }

  const ceoImage = renderStoryImage(
    story.greeting.ceoImageUrl,
    story.greeting.ceoImageAlt,
    "story-greeting-photo-image"
  );

  const photoPanel = ceoImage
    ? `<aside class="story-greeting-photo-panel" aria-label="대표 사진"><figure class="story-greeting-photo">${ceoImage}</figure></aside>`
    : "";

  parts.push(`
    <section class="story-greeting story-greeting-panel" aria-labelledby="story-greeting-title">
      <div class="story-greeting-inner">
        <div class="story-greeting-copy">
          <h2 id="story-greeting-title" class="story-greeting-title">${escapeHtml(story.greeting.title)}</h2>
          ${story.greeting.subtitle ? `<p class="story-greeting-subtitle">${escapeHtml(story.greeting.subtitle)}</p>` : ""}
          <div class="story-greeting-body">${escapeHtml(story.greeting.body)}</div>
          ${renderSignatureHtml(story.greeting.signatureTitle, story.greeting.signatureName)}
        </div>
        ${photoPanel}
        ${renderGritPlainHtml(story.gritValues)}
        ${renderFinalMessageHtml(story.closingLine1, story.closingLine2)}
      </div>
    </section>
  `);

  return parts.join("\n").trim();
}

function readGritFromForm(formRoot) {
  return DEFAULT_GRIT_VALUES.map((def, index) => {
    const title = trimText(formRoot.querySelector(`#story-grit-${index}-title`)?.value);
    return {
      letter: def.letter,
      word: def.word,
      title: title || def.title,
    };
  });
}

export function readStoryV2FromForm(formRoot = document) {
  const query = (selector) => formRoot.querySelector(selector);

  return {
    slug: "story",
    version: STORY_PAGE_VERSION,
    heroImageUrl: trimText(query("#story-heroImageUrl")?.value),
    greeting: {
      title: trimText(query("#story-greetingTitle")?.value),
      subtitle: trimText(query("#story-greetingSubtitle")?.value),
      body: String(query("#story-greetingBody")?.value ?? "").replace(/\r\n/g, "\n"),
      signatureTitle: trimText(query("#story-signatureTitle")?.value),
      signatureName: trimText(query("#story-signatureName")?.value),
      ceoImageUrl: trimText(query("#story-ceoImageUrl")?.value),
    },
    gritValues: readGritFromForm(formRoot),
    closingLine1: trimText(query("#story-closingLine1")?.value),
    closingLine2: trimText(query("#story-closingLine2")?.value),
  };
}

export function fillStoryV2Form(data, formRoot = document) {
  const story = normalizeStoryV2(data);
  const setValue = (selector, value) => {
    const el = formRoot.querySelector(selector);
    if (el) el.value = value ?? "";
  };

  setValue("#story-heroImageUrl", data.heroImageUrl || "");
  setValue("#story-greetingTitle", story.greeting.title);
  setValue("#story-greetingSubtitle", story.greeting.subtitle);
  setValue("#story-greetingBody", data.greeting?.body ?? story.greeting.body);
  setValue("#story-signatureTitle", story.greeting.signatureTitle);
  setValue("#story-signatureName", story.greeting.signatureName);
  setValue("#story-ceoImageUrl", data.greeting?.ceoImageUrl || "");

  story.gritValues.forEach((item, index) => {
    setValue(`#story-grit-${index}-title`, item.title);
  });

  setValue("#story-closingLine1", story.closingLine1);
  setValue("#story-closingLine2", story.closingLine2);
}

function validateOptionalImageUrl(rawValue, label) {
  const raw = trimText(rawValue);
  if (!raw) return null;
  if (!isAllowedStoryImageUrl(raw, { allowEmpty: false })) {
    return `${label}: ${getStoryImageValidationMessage()}`;
  }
  return null;
}

export function validateStoryV2ForSave(data) {
  const errors = [];
  const story = normalizeStoryV2(data);

  if (!story.greeting.title) errors.push("대표 인사말 제목을 입력해 주세요.");
  if (!story.greeting.body) errors.push("대표 인사말 본문을 입력해 주세요.");

  const heroError = validateOptionalImageUrl(data.heroImageUrl, "상단 배너 이미지 URL");
  if (heroError) errors.push(heroError);

  const ceoError = validateOptionalImageUrl(data.greeting?.ceoImageUrl, "대표 사진 URL");
  if (ceoError) errors.push(ceoError);

  return {
    ok: errors.length === 0,
    errors,
    data: story,
  };
}

export function buildStoryV2FirestorePayload(data) {
  const story = normalizeStoryV2(data);
  return {
    slug: "story",
    version: STORY_PAGE_VERSION,
    pageTitle: DEFAULT_PAGE_TITLE,
    heroImageUrl: normalizeStoryImageUrl(data.heroImageUrl),
    heroImageAlt: DEFAULT_HERO_IMAGE_ALT,
    greeting: {
      title: story.greeting.title,
      subtitle: story.greeting.subtitle,
      body: story.greeting.body,
      signatureTitle: story.greeting.signatureTitle,
      signatureName: story.greeting.signatureName,
      ceoImageUrl: normalizeStoryImageUrl(data.greeting?.ceoImageUrl),
      ceoImageAlt: DEFAULT_CEO_IMAGE_ALT,
      signature: deleteField(),
      ceoTitle: deleteField(),
      ceoName: deleteField(),
    },
    gritValues: story.gritValues.map((item) => ({
      letter: item.letter,
      word: item.word,
      title: item.title,
    })),
    closingLine1: story.closingLine1,
    closingLine2: story.closingLine2,
    closingMessage: deleteField(),
    content: deleteField(),
    structure: deleteField(),
    lead: deleteField(),
  };
}

export { getStoryImageValidationMessage, PUBLIC_IMAGE_FIELD };
