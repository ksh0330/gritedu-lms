import { app } from "/assets/js/firebase-init.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { sanitizeHtml } from "/assets/js/utils/html.js";
import {
  isStoryV2Document,
  normalizeStoryV2,
  renderStoryV2InnerHtml,
} from "/assets/js/utils/story-page.js";
import { assignImageSrc } from "/assets/js/utils/image-load-guard.js";

const db = getFirestore(app);
const main = document.querySelector("main.story");
const storyPage = document.getElementById("story-page");

function markStoryReady() {
  storyPage?.classList.remove("story-page--loading");
  storyPage?.classList.add("story-page--ready");
}

function setFallbackVisibility(show) {
  main?.querySelectorAll("[data-story-fallback]").forEach((section) => {
    section.hidden = !show;
  });
}

function hideDynamicLayers() {
  const dynamic = document.getElementById("story-dynamic");
  const legacy = document.getElementById("story-legacy-content");
  if (dynamic) {
    dynamic.hidden = true;
    dynamic.innerHTML = "";
  }
  if (legacy) {
    legacy.hidden = true;
    legacy.innerHTML = "";
  }
}

function bindStoryImages(root) {
  if (!root) return;
  root.querySelectorAll("img.story-hero-image, img.story-greeting-photo-image").forEach((img) => {
    const src = img.getAttribute("src");
    if (!src) {
      img.remove();
      return;
    }
    assignImageSrc(img, src, {
      onGiveUp: () => {
        const wrapper = img.closest(".story-hero, .story-greeting-photo-panel");
        if (wrapper) wrapper.remove();
      },
    });
  });
}

function applyV2Header(story) {
  main?.classList.add("story-page--v2");
  const pageTitleEl = main?.querySelector(".page-title");
  if (pageTitleEl) pageTitleEl.textContent = story.pageTitle;
}

function applyLegacyHeader(data) {
  main?.classList.remove("story-page--v2");
  const pageTitleEl = main?.querySelector(".page-title");
  if (pageTitleEl) {
    pageTitleEl.classList.remove("visually-hidden");
    if (data.structure?.pageTitle) pageTitleEl.textContent = data.structure.pageTitle;
  }
}

function renderStoryV2(data) {
  const story = normalizeStoryV2(data);
  applyV2Header(story);

  const dynamic = document.getElementById("story-dynamic");
  if (!dynamic) return;

  dynamic.innerHTML = sanitizeHtml(renderStoryV2InnerHtml(story));
  dynamic.hidden = false;
  bindStoryImages(dynamic);
  setFallbackVisibility(false);
  markStoryReady();
}

function renderLegacyContent(data, legacyHtml) {
  applyLegacyHeader(data);

  const legacy = document.getElementById("story-legacy-content");
  if (!legacy) return;

  legacy.innerHTML = sanitizeHtml(legacyHtml);
  legacy.hidden = false;
  setFallbackVisibility(false);
  markStoryReady();
}

function showHtmlFallback() {
  main?.classList.remove("story-page--v2");
  hideDynamicLayers();
  setFallbackVisibility(true);

  const pageTitleEl = main?.querySelector(".page-title");
  if (pageTitleEl) pageTitleEl.classList.remove("visually-hidden");

  markStoryReady();
}

if (main) {
  (async () => {
    try {
      const snap = await getDoc(doc(db, "pages", "story"));
      if (!snap.exists()) {
        showHtmlFallback();
        return;
      }

      const data = snap.data();

      if (isStoryV2Document(data)) {
        renderStoryV2(data);
        return;
      }

      const legacyHtml = String(data.content || "").trim();
      if (legacyHtml) {
        renderLegacyContent(data, legacyHtml);
        return;
      }

      showHtmlFallback();
    } catch (error) {
      if (error.code !== "permission-denied") {
        console.error("학원 안내 콘텐츠 로드 실패:", error);
      }
      showHtmlFallback();
    }
  })();
}
