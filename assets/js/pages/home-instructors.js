import { app } from "/assets/js/firebase-init.js";
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { getPublicSettingDoc } from "/assets/js/utils/settings-cache.js";
import { escapeHtml } from "/assets/js/utils/html.js";
import {
  resolveInstructorProfileImageUrl,
  INSTRUCTOR_PROFILE_PLACEHOLDER,
} from "/assets/js/utils/public-image-url.js";
import { bindGuardedImages } from "/assets/js/utils/image-load-guard.js";
import { formatInstructorSubjectsLabel } from "/assets/js/utils/instructor-subjects.js";

const db = getFirestore(app);
const wrap = document.getElementById("homeInstructors");
const PLACEHOLDER = INSTRUCTOR_PROFILE_PLACEHOLDER;
const MARQUEE_PAUSE_MS = 8000;

let ALL = [];
let homeOrder = null;
let homeHidden = [];
let marqueePauseTimer = null;
let marqueeScrollFrame = 0;

function showSkeleton() {
  if (!wrap) return;
  wrap.setAttribute("aria-busy", "true");
  wrap.innerHTML = Array(4)
    .fill(0)
    .map(() => '<div class="skeleton-instructor"></div>')
    .join("");
}

function sortForHome(instructors, order) {
  const idMap = new Map(instructors.map((inst) => [inst.id, inst]));
  const docIdMap = new Map();
  
  instructors.forEach((inst) => {
    if (inst.docId && inst.docId !== inst.id) {
      docIdMap.set(inst.docId, inst);
    }
  });
  
  const sorted = [];
  const used = new Set();
  
  if (Array.isArray(order)) {
    order.forEach((id) => {
      if (idMap.has(id)) {
        const inst = idMap.get(id);
        sorted.push(inst);
        used.add(inst.id);
        idMap.delete(id);
      } else if (docIdMap.has(id)) {
        const inst = docIdMap.get(id);
        sorted.push(inst);
        used.add(inst.id);
        idMap.delete(inst.id);
      }
    });
  }
  
  const remaining = Array.from(idMap.values())
    .filter((inst) => !used.has(inst.id))
    .sort((a, b) => {
      const aOrder = typeof a.sortOrder === "number" ? a.sortOrder : 1e9;
      const bOrder = typeof b.sortOrder === "number" ? b.sortOrder : 1e9;
      
      if (aOrder !== bOrder) {
        return aOrder - bOrder;
      }
      
      const aTime = a.createdAt && a.createdAt.seconds ? a.createdAt.seconds : 0;
      const bTime = b.createdAt && b.createdAt.seconds ? b.createdAt.seconds : 0;
      return aTime - bTime;
    });
  
  sorted.push(...remaining);
  return sorted;
}

function renderHomeInstructors() {
  if (!wrap) return;

  const sorted = sortForHome(ALL, homeOrder).filter(
    (inst) => !homeHidden.includes(inst.id)
  );
  
  const cardsHTML = sorted.map((inst, index) => cardHTML(inst, index)).join("");
  wrap.innerHTML = cardsHTML
    ? `
      <div class="home-instructors-group home-instructors-group--clone" aria-hidden="true">${cardsHTML}</div>
      <div class="home-instructors-group home-instructors-group--original">${cardsHTML}</div>
      <div class="home-instructors-group home-instructors-group--clone" aria-hidden="true">${cardsHTML}</div>
    `
    : "";
  wrap.setAttribute("aria-busy", "false");
  wireCardEvents(wrap);
  bindGuardedImages(wrap, {
    fallbackSrc: PLACEHOLDER,
    allowFallbackOnce: true,
  });
  setupInstructorMarquee();
}

function toWebP(url) {
  if (url && url.includes("/instructors/profile/")) {
    return url;
  }
  return url ? url.replace(/\.(png|jpg|jpeg)$/i, ".webp") : url;
}

function cardHTML(inst, index = 0) {
  const rawPhoto = (inst.photo || inst.profilePhoto || inst.imageUrl || "").trim();
  const photo = resolveInstructorProfileImageUrl(rawPhoto);
  const name = (inst.name || "").trim();
  const subject = formatInstructorSubjectsLabel(inst);
  const altText = name ? `${name} 강사` : "강사 이미지";
  const photoUrl = photo;

  return `
    <article class="inst-card" data-id="${inst.id}" tabindex="0" role="button" aria-label="${name}" style="--card-delay:${index * 60}ms">
      <img
        data-guarded-src="${escapeHtml(photoUrl)}"
        alt="${escapeHtml(altText)}"
        loading="lazy"
        decoding="async"
        fetchpriority="low"
      >
      <div class="inst-overlay">
        <div class="inst-overlay__inner">
          <span class="inst-name">${name || "이름 미정"}</span>
          <span class="inst-subject">${subject || ""}</span>
        </div>
      </div>
    </article>
  `;
}

function wireCardEvents(container) {
  if (container.dataset.cardEventsWired === "true") return;
  container.dataset.cardEventsWired = "true";

  container.addEventListener("click", (e) => {
    const card = e.target.closest(".inst-card");
    if (!card) return;
    
    const id = card.getAttribute("data-id");
    if (id) {
      console.log("[home-instructors] 강사 상세 페이지로 이동, id:", id);
      location.href = `/instructor-details.html?doc=${encodeURIComponent(id)}`;
    } else {
      console.warn("[home-instructors] 카드에 id가 없음:", card);
    }
  });
  
  container.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const card = e.target.closest(".inst-card");
      if (card) {
        card.click();
      }
    }
  });
}

function getCarouselTrack() {
  return wrap ? wrap.closest(".home-instructors-track") : null;
}

function setCloneAccessibility() {
  wrap.querySelectorAll(".home-instructors-group--clone .inst-card").forEach((card) => {
    card.setAttribute("tabindex", "-1");
  });
}

function getOriginalGroupWidth() {
  const original = wrap.querySelector(".home-instructors-group--original");
  return original ? original.getBoundingClientRect().width : 0;
}

function resetMarqueeScrollPosition() {
  const track = getCarouselTrack();
  const groupWidth = getOriginalGroupWidth();
  if (!track || groupWidth <= 0) return;

  track.scrollLeft = groupWidth;
}

function normalizeMarqueeScrollPosition() {
  const track = getCarouselTrack();
  const groupWidth = getOriginalGroupWidth();
  if (!track || groupWidth <= 0) return;

  const lowerBound = groupWidth * 0.35;
  const upperBound = groupWidth * 1.65;

  if (track.scrollLeft < lowerBound) {
    track.scrollLeft += groupWidth;
  } else if (track.scrollLeft > upperBound) {
    track.scrollLeft -= groupWidth;
  }
}

function scheduleMarqueeStart(track) {
  track.classList.add("is-marquee");
  track.classList.remove("is-marquee-ready");

  requestAnimationFrame(() => {
    resetMarqueeScrollPosition();
    requestAnimationFrame(() => {
      track.classList.add("is-marquee-ready");
    });
  });
}

function pauseMarqueeTemporarily() {
  const track = getCarouselTrack();
  if (!track) return;

  track.classList.add("is-marquee-paused");
  if (marqueePauseTimer) {
    window.clearTimeout(marqueePauseTimer);
  }

  marqueePauseTimer = window.setTimeout(() => {
    track.classList.remove("is-marquee-paused");
  }, MARQUEE_PAUSE_MS);
}

function setupInstructorMarquee() {
  const track = getCarouselTrack();
  if (!track || !wrap) return;

  track.querySelectorAll(".home-instructors-nav").forEach((button) => button.remove());
  setCloneAccessibility();
  scheduleMarqueeStart(track);

  if (track.dataset.marqueeWired === "true") return;
  track.dataset.marqueeWired = "true";

  track.addEventListener("mouseenter", () => track.classList.add("is-marquee-paused"));
  track.addEventListener("mouseleave", () => track.classList.remove("is-marquee-paused"));
  track.addEventListener("focusin", () => track.classList.add("is-marquee-paused"));
  track.addEventListener("focusout", () => {
    window.setTimeout(() => {
      if (!track.contains(document.activeElement)) {
        track.classList.remove("is-marquee-paused");
      }
    }, 0);
  });

  ["touchstart", "wheel", "pointerdown", "dragstart"].forEach((eventName) => {
    track.addEventListener(eventName, pauseMarqueeTemporarily, { passive: true });
  });

  track.addEventListener("scroll", () => {
    if (marqueeScrollFrame) return;
    marqueeScrollFrame = window.requestAnimationFrame(() => {
      normalizeMarqueeScrollPosition();
      marqueeScrollFrame = 0;
    });
  });

  window.addEventListener("resize", () => {
    requestAnimationFrame(resetMarqueeScrollPosition);
  });
}

if (wrap) {
  showSkeleton();
}

async function loadHomeInstructors() {
  try {
    const [instructorsMenuResult, instructorsSnap] = await Promise.all([
      getPublicSettingDoc("instructorsMenu"),
      getDocs(collection(db, "instructors"))
    ]);

    if (instructorsMenuResult.exists) {
      const data = instructorsMenuResult.data;
      if (Array.isArray(data.homeOrder) && data.homeOrder.length > 0) {
        homeOrder = data.homeOrder;
      } else if (Array.isArray(data.order) && data.order.length > 0) {
        homeOrder = data.order;
      } else {
        homeOrder = null;
      }
      homeHidden = Array.isArray(data.homeHidden) ? data.homeHidden : (Array.isArray(data.hidden) ? data.hidden : []);
    } else {
      homeOrder = null;
      homeHidden = [];
    }

    ALL = [];
    const nameSet = new Set();
    instructorsSnap.forEach((docSnap) => {
      const data = docSnap.data();
      const name = (data.name || "").trim();
      if (name && nameSet.has(name)) return;
      const instructorId = data.instructorId || docSnap.id;
      ALL.push({ id: instructorId, docId: docSnap.id, ...data, instructorId });
      if (name) nameSet.add(name);
    });

    renderHomeInstructors();
  } catch (error) {
    if (error.code !== "permission-denied") {
      console.error("강사 목록 로드 실패:", error);
    }
    if (wrap) wrap.innerHTML = "";
    if (wrap) wrap.setAttribute("aria-busy", "false");
  }
}

loadHomeInstructors();
