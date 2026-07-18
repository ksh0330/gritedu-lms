// /assets/js/pages/course-detail.js
import { app, auth } from "/assets/js/firebase-init.js";
import {
  getFirestore,
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";
import { getPublicSettingDoc } from "/assets/js/utils/settings-cache.js";
import { getUserRole } from "/assets/js/utils/auth.js";
import {
  createCourseLabelMaps,
  getSubjectLabel,
  normalizeCourseForReadOnly,
  normalizeAccessType,
  normalizeCourseFormat
} from "/assets/js/utils/course-readonly.js";
import { normalizeGrade } from "/assets/js/utils/grade.js";
import {
  PUBLIC_IMAGE_FIELD,
  sanitizePublicImageSrc,
} from "/assets/js/utils/public-image-url.js";
import { getInstructorSubjects } from "/assets/js/utils/instructor-subjects.js";

const db = getFirestore(app);
const params = new URLSearchParams(window.location.search);
const courseId = params.get("courseId") || params.get("id");

let currentUser = null;
let currentUserRole = null;
let currentMemberPurpose = null;
let currentCourse = null;
let enrollmentsLoaded = false;
let enrollRequestInFlight = false;
let enrolledCourseIds = new Set();
let labelMaps = createCourseLabelMaps({});
let activeTabKey = "introduction";

const TAB_KEYS = ["introduction", "instructor", "lecture"];

function escapeHtml(value) {
  if (value == null) return "";
  const div = document.createElement("div");
  div.textContent = String(value);
  return div.innerHTML;
}

function showMessage(msg) {
  const root = document.getElementById("coursePage");
  if (!root) return;
  root.innerHTML = `<div class="muted" style="text-align:center;padding:40px;">${escapeHtml(msg)}</div>`;
}

function toDisplayText(value, fallback = "-") {
  const text = String(value || "").trim();
  return text || fallback;
}

function formatInstructorDisplayName(name) {
  const text = String(name || "").trim();
  if (!text || text === "강사 미정") return "";
  return text;
}

function formatSubjectsLabel(values, maps = labelMaps, fallback = "") {
  const list = (Array.isArray(values) ? values : [values])
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (!list.length) return fallback;
  return list.map((value) => getSubjectLabel(value, maps) || value).join(" | ");
}

function getSubjectAccentClass(subjectCode, subjectLabel = "") {
  const code = String(subjectCode || "").trim().toUpperCase();
  const label = String(subjectLabel || "").trim();
  if (code === "KOR" || label === "국어") return "subject-ko";
  if (code === "ENG" || label === "영어") return "subject-en";
  if (code === "MATH" || label === "수학") return "subject-ma";
  if (code === "SCI" || label === "과학") return "subject-sc";
  if (code === "ESSAY" || label === "수리논술") return "subject-etc";
  return "subject-etc";
}

function isPublicCourse(course) {
  return normalizeAccessType(course?.accessType) === "public";
}

function isMemberOnlyCourse(course) {
  return normalizeAccessType(course?.accessType) === "memberOnly";
}

function isSeriesCourse(course, weekCount = 0) {
  return normalizeCourseFormat(course?.courseFormat, weekCount) === "series";
}

function resolveWeekTitle(week, weekIndex) {
  const title = String(week?.title || "").trim();
  return title || `${weekIndex + 1}주차`;
}

function getWeekVideos(week) {
  return Array.isArray(week?.videos) ? week.videos : (Array.isArray(week?.lessons) ? week.lessons : []);
}

function buildLectureRows(videos, isPublic) {
  return videos.map((video, videoIndex) => {
    const videoTitle = getWeekVideoTitle(video, videoIndex);
    const videoUrl = getWeekVideoUrl(video);
    const inner = `<span class="lecture-text">${escapeHtml(videoTitle)}</span>`;

    if (isPublic && videoUrl) {
      return `<div class="lecture-row lecture-row--readonly">${inner}<button type="button" class="btn sm" data-public-learn="1" data-video-url="${escapeHtml(videoUrl)}">학습하기</button></div>`;
    }
    return `<div class="lecture-row lecture-row--readonly">${inner}</div>`;
  }).join("");
}

function setupCourseWeekToggles(root) {
  const list = root?.querySelector(".week-list--collapsible");
  if (!list) return;

  if (list.dataset.weekToggleBound !== "1") {
    list.dataset.weekToggleBound = "1";
    list.addEventListener("click", (event) => {
      const toggle = event.target.closest(".week-card__toggle");
      if (!toggle || !list.contains(toggle)) return;

      const card = toggle.closest(".week-card--collapsible");
      if (!card) return;

      const expanded = card.classList.toggle("is-expanded");
      toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    });
  }

  const firstCard = list.querySelector(".week-card--collapsible");
  if (firstCard && !firstCard.classList.contains("is-expanded")) {
    firstCard.classList.add("is-expanded");
    const firstToggle = firstCard.querySelector(".week-card__toggle");
    if (firstToggle) firstToggle.setAttribute("aria-expanded", "true");
  }
}

function getSectionMap(course, hasExplicitDetailSections) {
  const map = new Map();
  if (!hasExplicitDetailSections) return map;
  if (!Array.isArray(course?.detailSections)) return map;

  course.detailSections.forEach((section) => {
    const type = String(section?.type || "").trim();
    if (!type || map.has(type)) return;
    map.set(type, section);
  });
  return map;
}

function getSectionByTypes(sectionMap, types) {
  for (const type of types) {
    if (sectionMap.has(type)) return sectionMap.get(type);
  }
  return null;
}

async function loadContext() {
  try {
    const catalogResult = await getPublicSettingDoc("courseCatalog");
    labelMaps = createCourseLabelMaps(catalogResult.exists ? catalogResult.data : {});
  } catch (_) {
    labelMaps = createCourseLabelMaps({});
  }
}

function getInstructorDetailUrl(course) {
  const docId = String(course?.instructorId || course?.instructorDocId || "").trim();
  return docId ? `/instructor-details.html?doc=${encodeURIComponent(docId)}` : "";
}

const INSTRUCTOR_IMAGE_FIELDS = [
  "profileImage",
  "profileImageUrl",
  "avatar",
  "photo",
  "photoURL",
  "imageUrl",
  "profilePhoto",
  "instructorImage",
  "instructorImageUrl",
  "instructorPhoto",
  "instructorProfilePhoto"
];

function pickInstructorImageUrl(source) {
  if (!source || typeof source !== "object") return "";
  for (const key of INSTRUCTOR_IMAGE_FIELDS) {
    const url = String(source[key] || "").trim();
    if (!url) continue;
    const safeUrl = sanitizePublicImageSrc(url, { field: PUBLIC_IMAGE_FIELD.instructorProfile });
    if (safeUrl) return safeUrl;
  }
  return "";
}

function getInstructorProfileImage(course) {
  return String(course?._instructorImageUrl || "").trim() || pickInstructorImageUrl(course);
}

function getInstructorInitial(name) {
  const text = String(name || "").trim();
  if (!text) return "강";
  return text.charAt(0);
}

async function fetchInstructorRecord(course) {
  const docId = String(course?.instructorId || course?.instructorDocId || "").trim();
  if (docId) {
    try {
      const snap = await getDoc(doc(db, "instructors", docId));
      if (snap.exists()) return { id: snap.id, ...snap.data() };
    } catch (_) {
    }
  }

  const instructorUid = String(course?.instructorUid || "").trim();
  if (!instructorUid) return null;

  try {
    const byLinkedUid = await getDocs(query(collection(db, "instructors"), where("uid", "==", instructorUid)));
    if (!byLinkedUid.empty) {
      const match = byLinkedUid.docs[0];
      return { id: match.id, ...match.data() };
    }
  } catch (_) {
  }

  try {
    const byUid = await getDocs(query(collection(db, "instructors"), where("instructorId", "==", instructorUid)));
    if (!byUid.empty) {
      const match = byUid.docs[0];
      return { id: match.id, ...match.data() };
    }
  } catch (_) {
  }

  return null;
}

async function enrichCourseWithInstructorProfile(course) {
  const next = { ...course };
  const fromCourse = pickInstructorImageUrl(course);
  if (fromCourse) next._instructorImageUrl = fromCourse;

  const instructor = await fetchInstructorRecord(course);
  if (!instructor) return next;

  const imageUrl = pickInstructorImageUrl(instructor);
  if (imageUrl) next._instructorImageUrl = imageUrl;

  if (!String(next.instructorName || "").trim() && instructor.name) {
    next.instructorName = String(instructor.name).trim();
  }
  if (!String(next.instructorId || "").trim() && instructor.instructorId) {
    next.instructorId = String(instructor.instructorId).trim();
  }
  if (!String(next.instructorId || "").trim() && instructor.id) {
    next.instructorId = String(instructor.id).trim();
  }

  const instructorSubjects = getInstructorSubjects(instructor);
  next._instructorSubjectsLabel = formatSubjectsLabel(instructorSubjects);
  const primarySubject = instructorSubjects[0] || "";
  next._instructorPrimarySubject = primarySubject
    ? (getSubjectLabel(primarySubject, labelMaps) || primarySubject)
    : "";

  return next;
}

function renderInstructorAvatar(avatarEl, name, imageUrl) {
  if (!avatarEl) return;
  const initial = getInstructorInitial(name);
  avatarEl.classList.remove("has-image", "has-initial");
  avatarEl.removeAttribute("data-initial");

  if (!imageUrl) {
    avatarEl.classList.add("has-initial");
    avatarEl.dataset.initial = initial;
    avatarEl.textContent = initial;
    return;
  }

  avatarEl.classList.add("has-image");
  avatarEl.innerHTML = `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(name)} 프로필" loading="lazy" decoding="async">`;
  const img = avatarEl.querySelector("img");
  if (!img) return;

  img.addEventListener("error", () => {
    avatarEl.classList.remove("has-image");
    avatarEl.classList.add("has-initial");
    avatarEl.dataset.initial = initial;
    avatarEl.textContent = initial;
  }, { once: true });
}

function toYouTubeEmbed(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  const idMatch = raw.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/);
  if (idMatch?.[1]) return `https://www.youtube.com/embed/${idMatch[1]}`;
  if (/^[\w-]{11}$/.test(raw)) return `https://www.youtube.com/embed/${raw}`;
  return "";
}

function getWeekVideoUrl(video) {
  if (typeof video === "string") return String(video || "").trim();
  return String(video?.url || video?.fullUrl || video?.videoUrl || "").trim();
}

function getWeekVideoTitle(video, index) {
  if (typeof video === "string") return `${index + 1}차시`;
  const text = String(video?.title || "").trim();
  return text || `${index + 1}차시`;
}

function resolvePublicLearningUrl(course) {
  const weeks = Array.isArray(course?.weeks) ? course.weeks : [];
  for (const week of weeks) {
    const videos = Array.isArray(week?.videos) ? week.videos : (Array.isArray(week?.lessons) ? week.lessons : []);
    for (const video of videos) {
      const url = getWeekVideoUrl(video);
      if (url) return url;
    }
  }

  return "";
}

function scrollToLectureList() {
  const lecturePanel = document.querySelector('.course-tab-panel[data-panel="lecture"]');
  const lectureTab = document.querySelector('.course-tab-btn[data-tab="lecture"]');
  if (lectureTab && lectureTab.hidden !== true) {
    lectureTab.click();
  } else if (lecturePanel) {
    activateTab("lecture");
  }
  const weeksRoot = document.getElementById("weeksContent");
  weeksRoot?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderHeroMedia(course) {
  const root = document.getElementById("heroMedia");
  if (!root) return;
  const previewUrl = String(course.previewVideoUrl || "").trim();
  if (!previewUrl) {
    root.innerHTML = "";
    root.style.display = "none";
    return;
  }
  const yt = toYouTubeEmbed(previewUrl);
  if (yt) {
    root.innerHTML = `<div class="media-ratio"><iframe src="${escapeHtml(yt)}" title="미리보기 영상" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
  } else {
    root.innerHTML = `<div class="media-ratio"><video controls preload="metadata" src="${escapeHtml(previewUrl)}"></video></div>`;
  }
  root.style.display = "";
}

function applyTabTitles(sectionMap) {
  const tabTitleMap = {
    introduction: "강좌 소개",
    instructor: "강사 정보",
    lecture: "강의 목록"
  };

  const explicitIntroTitle = String(getSectionByTypes(sectionMap, ["introduction"])?.title || "").trim();
  const explicitInstructorTitle = String(getSectionByTypes(sectionMap, ["instructor"])?.title || "").trim();
  const explicitLectureTitle = String(getSectionByTypes(sectionMap, ["curriculum", "learningContent"])?.title || "").trim();

  const finalTitleMap = {
    introduction: explicitIntroTitle || tabTitleMap.introduction,
    instructor: explicitInstructorTitle || tabTitleMap.instructor,
    lecture: explicitLectureTitle || tabTitleMap.lecture
  };

  TAB_KEYS.forEach((key) => {
    const btn = document.querySelector(`.course-tab-btn[data-tab="${key}"]`);
    const panel = document.querySelector(`.course-tab-panel[data-panel="${key}"]`);
    const heading = panel?.querySelector(".section-title");
    if (btn) btn.textContent = finalTitleMap[key];
    if (heading) heading.textContent = finalTitleMap[key];
  });
}

function renderCourseOverview(course, sectionMap) {
  const metaRowEl = document.getElementById("courseMetaRow");
  const subjectEl = document.getElementById("courseSubject");
  const titleEl = document.getElementById("courseTitle");
  const instructorEl = document.getElementById("courseInstructor");
  const summaryEl = document.getElementById("courseSummary");
  const gradeEl = document.getElementById("courseGrade");
  const yearEl = document.getElementById("courseYear");
  const descriptionEl = document.getElementById("courseDescription");
  const instructorInfoEl = document.getElementById("courseInstructorInfo");
  const profileLinkEl = document.getElementById("courseInstructorProfileLink");
  const avatarEl = document.getElementById("courseInstructorAvatar");
  const instructorNameTextEl = document.getElementById("courseInstructorNameText");
  const instructorSubjectTextEl = document.getElementById("courseInstructorSubjectText");
  const instructorContentTextEl = document.getElementById("courseInstructorContentText");

  const subjectText = toDisplayText(
    course.subjectLabel || getSubjectLabel(course.subjectCode || course.subject, labelMaps)
  );
  const gradeText = toDisplayText(course.gradeLabel || course.grade);
  const yearText = toDisplayText(course.year);
  const instructorNameText = formatInstructorDisplayName(course.instructorName);
  const subjectAccentClass = getSubjectAccentClass(course.subjectCode || course.subject, course.subjectLabel);

  if (metaRowEl) {
    metaRowEl.classList.remove("subject-ko", "subject-en", "subject-ma", "subject-sc", "subject-etc");
    metaRowEl.classList.add(subjectAccentClass);
  }

  if (subjectEl) subjectEl.textContent = subjectText;
  if (titleEl) titleEl.textContent = toDisplayText(course.title, "제목 없는 강좌");
  if (gradeEl) gradeEl.textContent = gradeText;
  if (yearEl) yearEl.textContent = yearText;

  const detailUrl = getInstructorDetailUrl(course);
  const instructorNameHtml = escapeHtml(instructorNameText);
  const instructorLinkHtml = detailUrl
    ? `<a href="${detailUrl}" class="course-instructor-link">${instructorNameHtml}</a>`
    : instructorNameHtml;
  if (instructorEl) {
    instructorEl.innerHTML = instructorLinkHtml;
  }

  const topDescription = String(course.shortDescription || course.fullDescription || "").trim();
  if (summaryEl) {
    summaryEl.textContent = topDescription || "강좌 소개가 준비 중입니다. 자세한 수업 안내는 상담을 통해 확인해 주세요.";
  }

  const introContent = String(
    getSectionByTypes(sectionMap, ["introduction"])?.content ||
    course.fullDescription ||
    ""
  ).trim();
  if (descriptionEl) {
    descriptionEl.innerHTML = introContent
      ? `<p style="white-space:pre-wrap;line-height:1.75;">${escapeHtml(introContent)}</p>`
      : '<p class="muted">강좌 소개가 준비 중입니다. 자세한 수업 안내는 상담을 통해 확인해 주세요.</p>';
  }

  const instructorSectionContent = String(getSectionByTypes(sectionMap, ["instructor"])?.content || "").trim();
  const profileImage = getInstructorProfileImage(course);

  if (profileLinkEl) {
    if (detailUrl) {
      profileLinkEl.href = detailUrl;
      profileLinkEl.classList.remove("is-disabled");
      profileLinkEl.setAttribute("aria-disabled", "false");
    } else {
      profileLinkEl.href = "#";
      profileLinkEl.classList.add("is-disabled");
      profileLinkEl.setAttribute("aria-disabled", "true");
    }
  }

  renderInstructorAvatar(avatarEl, instructorNameText, profileImage);
  if (instructorNameTextEl) instructorNameTextEl.textContent = instructorNameText;

  const instructorSubjectsLabel = instructorNameText
    ? toDisplayText(
      course._instructorSubjectsLabel
        || formatSubjectsLabel(course.instructorSubject, labelMaps, "")
        || subjectText,
      subjectText
    )
    : "";
  if (instructorSubjectTextEl) {
    instructorSubjectTextEl.textContent = instructorSubjectsLabel;
    const badgeSubject = course._instructorPrimarySubject || subjectText;
    if (badgeSubject && badgeSubject !== "-") {
      instructorSubjectTextEl.dataset.subject = badgeSubject;
    } else {
      instructorSubjectTextEl.removeAttribute("data-subject");
    }
  }

  if (instructorContentTextEl) {
    if (instructorSectionContent) {
      instructorContentTextEl.textContent = instructorSectionContent;
      instructorContentTextEl.style.display = "";
    } else {
      instructorContentTextEl.style.display = "none";
      instructorContentTextEl.textContent = "";
    }
  }

  if (instructorInfoEl) {
    instructorInfoEl.classList.add("instructor-info-card");
  }

  applyTabTitles(sectionMap);
  document.title = `그릿에듀 | ${course.title || "강좌 상세"}`;
}

function renderWeeks(course, sectionMap) {
  const root = document.getElementById("weeksContent");
  if (!root) return;

  const weeks = Array.isArray(course.weeks) ? course.weeks : [];
  const isPublic = isPublicCourse(course);
  const isSeries = isSeriesCourse(course, weeks.length);
  const lectureIntro = String(getSectionByTypes(sectionMap, ["curriculum", "learningContent"])?.content || "").trim();

  if (!weeks.length) {
    root.innerHTML = `${lectureIntro ? `<p style="margin:0 0 10px;white-space:pre-wrap;line-height:1.7;">${escapeHtml(lectureIntro)}</p>` : ""}<p class="muted">강의 목록이 준비 중입니다. 자세한 수업 안내는 상담을 통해 확인해 주세요.</p>`;
    return;
  }

  let weekHtml = "";

  if (isSeries) {
    weekHtml = weeks.map((week, weekIndex) => {
      const weekTitle = resolveWeekTitle(week, weekIndex);
      const weekDescription = String(week?.description || week?.content || "").trim();
      const videos = getWeekVideos(week);
      const rows = buildLectureRows(videos, isPublic);
      const lectureCount = videos.length;
      const metaLabel = lectureCount > 0 ? `${lectureCount}개 강의` : "강의 없음";

      return `
        <article class="week-card week-card--collapsible" data-week-index="${weekIndex}">
          <button
            type="button"
            class="week-card__toggle"
            aria-expanded="false"
            aria-controls="courseWeekBody_${weekIndex}"
          >
            <span class="week-card__title">${escapeHtml(weekTitle)}</span>
            <span class="week-card__meta">${escapeHtml(metaLabel)}</span>
            <span class="week-card__icon" aria-hidden="true">▾</span>
          </button>
          <div id="courseWeekBody_${weekIndex}" class="week-card__body">
            ${weekDescription ? `<p class="week-description">${escapeHtml(weekDescription)}</p>` : ""}
            <div class="lecture-row-list">
              ${rows || '<p class="muted">강의 영상이 준비 중입니다.</p>'}
            </div>
          </div>
        </article>
      `;
    }).join("");
  } else if (weeks.length === 1) {
    const week = weeks[0];
    const weekDescription = String(week?.description || week?.content || "").trim();
    const videos = getWeekVideos(week);
    const rows = buildLectureRows(videos, isPublic);

    weekHtml = `
      ${weekDescription ? `<p class="week-description week-description--single">${escapeHtml(weekDescription)}</p>` : ""}
      <div class="lecture-row-list lecture-row-list--single">
        ${rows || '<p class="muted">강의 영상이 준비 중입니다.</p>'}
      </div>
    `;
  } else {
    weekHtml = weeks.map((week, weekIndex) => {
      const weekTitle = resolveWeekTitle(week, weekIndex);
      const weekDescription = String(week?.description || week?.content || "").trim();
      const videos = getWeekVideos(week);
      const rows = buildLectureRows(videos, isPublic);

      return `
        <article class="week-card">
          <h3 class="week-title">${escapeHtml(weekTitle)}</h3>
          ${weekDescription ? `<p class="week-description">${escapeHtml(weekDescription)}</p>` : ""}
          <div class="lecture-row-list">
            ${rows || '<p class="muted">강의 영상이 준비 중입니다.</p>'}
          </div>
        </article>
      `;
    }).join("");
  }

  const listClass = isSeries ? "week-list week-list--collapsible" : "week-list";

  root.innerHTML = `
    ${lectureIntro ? `<p style="margin:0 0 12px;white-space:pre-wrap;line-height:1.75;">${escapeHtml(lectureIntro)}</p>` : ""}
    <div class="${listClass}">${weekHtml}</div>
  `;

  if (isSeries) {
    setupCourseWeekToggles(root);
  }

  bindPublicLearnButtons(root);
}

function openPublicVideo(url) {
  const target = String(url || "").trim();
  if (!target) return;
  window.open(target, "_blank", "noopener");
}

function bindPublicLearnButtons(root) {
  if (!root || root.dataset.publicLearnBound === "1") return;
  root.dataset.publicLearnBound = "1";
  root.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-public-learn]");
    if (!button) return;
    event.preventDefault();
    openPublicVideo(button.getAttribute("data-video-url"));
  });
}

function activateTab(tabKey) {
  activeTabKey = tabKey;
  TAB_KEYS.forEach((key) => {
    const button = document.querySelector(`.course-tab-btn[data-tab="${key}"]`);
    const panel = document.querySelector(`.course-tab-panel[data-panel="${key}"]`);
    const isActive = key === tabKey;

    if (button) {
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
    }
    if (panel) {
      panel.classList.toggle("active", isActive);
      panel.hidden = !isActive;
    }
  });
}

function applyTabVisibility(sectionMap, hasExplicitDetailSections) {
  const tabsContainer = document.getElementById("courseTabs");
  if (!tabsContainer) return;

  const visibility = {
    introduction: true,
    instructor: true,
    lecture: true
  };

  if (hasExplicitDetailSections) {
    const introSection = getSectionByTypes(sectionMap, ["introduction"]);
    const instructorSection = getSectionByTypes(sectionMap, ["instructor"]);
    const lectureSection = getSectionByTypes(sectionMap, ["curriculum", "learningContent"]);

    if (introSection) visibility.introduction = introSection.visible !== false;
    if (instructorSection) visibility.instructor = instructorSection.visible !== false;
    if (lectureSection) visibility.lecture = lectureSection.visible !== false;
  }

  const visibleTabKeys = TAB_KEYS.filter((key) => visibility[key]);
  const tabCount = Math.max(visibleTabKeys.length, 1);
  tabsContainer.style.setProperty("--tab-count", String(tabCount));

  TAB_KEYS.forEach((key) => {
    const button = document.querySelector(`.course-tab-btn[data-tab="${key}"]`);
    const panel = document.querySelector(`.course-tab-panel[data-panel="${key}"]`);
    const isVisible = visibility[key];
    if (button) button.hidden = !isVisible;
    if (panel && !isVisible) {
      panel.hidden = true;
      panel.classList.remove("active");
    }
  });

  const nextActive = visibleTabKeys.includes(activeTabKey)
    ? activeTabKey
    : (visibleTabKeys[0] || "introduction");
  activateTab(nextActive);
}

function setupTabInteraction() {
  const tabsContainer = document.getElementById("courseTabs");
  if (!tabsContainer || tabsContainer.dataset.bound === "1") return;
  tabsContainer.dataset.bound = "1";

  tabsContainer.addEventListener("click", (event) => {
    const button = event.target.closest(".course-tab-btn[data-tab]");
    if (!button || button.hidden) return;
    const tabKey = button.getAttribute("data-tab");
    if (!tabKey) return;
    activateTab(tabKey);
  });
}

function ensureEnrollNodes() {
  const root = document.getElementById("enrollSection");
  if (!root) return null;
  let button = root.querySelector("button[data-enroll-cta='1']");
  let hint = root.querySelector("p[data-enroll-hint='1']");
  if (!button || !hint) {
    root.innerHTML = `<button type="button" class="btn primary" data-enroll-cta="1">수강신청</button><p class="muted" data-enroll-hint="1"></p>`;
    button = root.querySelector("button[data-enroll-cta='1']");
    hint = root.querySelector("p[data-enroll-hint='1']");
  }
  return { button, hint };
}

function renderEnrollCta({ label, disabled = false, hint = "", onClick = null }) {
  const nodes = ensureEnrollNodes();
  if (!nodes) return;
  nodes.button.textContent = label || "수강신청";
  nodes.button.disabled = Boolean(disabled);
  nodes.button.onclick = typeof onClick === "function" ? onClick : null;
  nodes.hint.textContent = hint || "";
  nodes.hint.style.display = hint ? "block" : "none";
}

function loginUrl() {
  return `/members/login.html?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
}

function promptLoginRequired() {
  if (window.toast?.warning) {
    window.toast.warning("로그인이 필요합니다.", 2000);
  } else {
    alert("로그인이 필요합니다.");
  }
  setTimeout(() => {
    window.location.href = loginUrl();
  }, 1000);
}

const LEARNER_ONLY_ENROLL_MESSAGE = "학생 또는 일반 회원 계정에서만 수강신청이 가능합니다.";
const PARENT_MEMBER_ENROLL_MESSAGE = "학부모 회원은 자녀 학습 현황 확인용 계정입니다. 직접 수강은 일반 회원으로 가입해야 합니다.";

let enrollRoleNoticeModalBound = false;

function closeEnrollRoleNoticeModal() {
  const modal = document.getElementById("enrollRoleNoticeModal");
  if (!modal) return;
  modal.style.display = "none";
  document.body.style.overflow = "";
}

function openEnrollRoleNoticeModal(message = LEARNER_ONLY_ENROLL_MESSAGE) {
  const modal = document.getElementById("enrollRoleNoticeModal");
  if (!modal) {
    if (window.toast?.warning) {
      window.toast.warning(message, 3000);
    } else {
      alert(message);
    }
    return;
  }

  const messageEl = document.getElementById("enrollRoleNoticeMessage");
  if (messageEl) messageEl.textContent = message;

  if (!enrollRoleNoticeModalBound) {
    enrollRoleNoticeModalBound = true;
    document.getElementById("closeEnrollRoleNoticeModal")?.addEventListener("click", closeEnrollRoleNoticeModal);
    document.getElementById("confirmEnrollRoleNoticeModal")?.addEventListener("click", closeEnrollRoleNoticeModal);
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeEnrollRoleNoticeModal();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && modal.style.display === "flex") {
        closeEnrollRoleNoticeModal();
      }
    });
  }

  modal.style.display = "flex";
  document.body.style.overflow = "hidden";
  document.getElementById("confirmEnrollRoleNoticeModal")?.focus();
}

function promptLearnerOnlyEnrollment() {
  openEnrollRoleNoticeModal(LEARNER_ONLY_ENROLL_MESSAGE);
}

function promptParentMemberEnrollmentBlocked() {
  openEnrollRoleNoticeModal(PARENT_MEMBER_ENROLL_MESSAGE);
}

function studentCourseUrl(id) {
  return `/members/students/course.html?courseId=${encodeURIComponent(id)}`;
}

function memberCourseUrl(id) {
  return `/members/member/course.html?courseId=${encodeURIComponent(id)}`;
}

function learnerCourseUrl(id) {
  return currentUserRole === "member" ? memberCourseUrl(id) : studentCourseUrl(id);
}

async function getCurrentMemberPurpose() {
  if (!currentUser || currentUserRole !== "member") return "";
  if (currentMemberPurpose != null) return currentMemberPurpose;
  try {
    const snap = await getDoc(doc(db, "members", currentUser.uid));
    currentMemberPurpose = snap.exists() ? String(snap.data()?.memberPurpose || "").trim() : "";
  } catch (_) {
    currentMemberPurpose = "";
  }
  return currentMemberPurpose;
}

function buildEnrollmentId(userId, targetCourseId) {
  return `${String(userId || "").trim()}_${String(targetCourseId || "").trim()}`;
}

function isActiveEnrollment(row) {
  return String(row?.status || "active").trim() === "active";
}

async function updateEnrollButton() {
  if (!currentCourse || !courseId) return;
  const course = currentCourse;
  const enrolled = currentUser ? enrolledCourseIds.has(courseId) : false;
  const accessType = normalizeAccessType(course.accessType);

  if (course.status !== "published" || course.isDetailBlocked) {
    return renderEnrollCta({ label: "수강신청", disabled: true, hint: "현재 온라인 수강 신청 준비 중인 강좌입니다. 상담을 통해 안내받아 주세요." });
  }

  if (isPublicCourse(course)) {
    const publicUrl = resolvePublicLearningUrl(course);
    if (isSeriesCourse(course)) {
      if (!publicUrl && !(Array.isArray(course.weeks) && course.weeks.length)) {
        return renderEnrollCta({ label: "강의 목록 보기", disabled: true, hint: "강의 영상이 준비 중입니다." });
      }
      return renderEnrollCta({
        label: "강의 목록 보기",
        onClick: () => { scrollToLectureList(); }
      });
    }
    if (!publicUrl) {
      return renderEnrollCta({ label: "학습하기", disabled: true, hint: "강의 영상이 준비 중입니다." });
    }
    return renderEnrollCta({
      label: "학습하기",
      onClick: () => { openPublicVideo(publicUrl); }
    });
  }

  if (accessType === "paid") {
    return renderEnrollCta({ label: "수강신청", disabled: true, hint: "결제 기능 준비중입니다." });
  }

  if (!isMemberOnlyCourse(course)) {
    return renderEnrollCta({ label: "수강신청", disabled: true, hint: "현재 온라인 수강 신청 준비 중인 강좌입니다. 상담을 통해 안내받아 주세요." });
  }

  if (!currentUser) {
    return renderEnrollCta({
      label: "수강신청",
      onClick: () => { promptLoginRequired(); }
    });
  }

  if (!currentUserRole) {
    try {
      currentUserRole = await getUserRole(currentUser);
    } catch (_) {
      currentUserRole = null;
    }
  }

  if (currentUserRole !== "student" && currentUserRole !== "member") {
    return renderEnrollCta({
      label: "수강신청",
      onClick: () => { promptLearnerOnlyEnrollment(); }
    });
  }

  if (currentUserRole === "member" && await getCurrentMemberPurpose() === "parent") {
    return renderEnrollCta({
      label: "수강신청 불가",
      disabled: true,
      hint: PARENT_MEMBER_ENROLL_MESSAGE
    });
  }

  if (!enrollmentsLoaded) {
    return renderEnrollCta({ label: "수강신청", disabled: true, hint: "수강 상태를 확인하는 중입니다." });
  }

  if (enrolled) {
    return renderEnrollCta({
      label: "학습하기",
      onClick: () => { window.location.href = learnerCourseUrl(courseId); }
    });
  }

  return renderEnrollCta({
    label: "수강신청",
    disabled: enrollRequestInFlight,
    onClick: () => { window.enrollCourse(courseId); }
  });
}

async function buildStudentSnapshot(uid) {
  const empty = { name: "", email: String(currentUser?.email || "").trim(), phone: "", school: "", grade: "" };
  if (!uid) return empty;
  const toSnapshot = (profile = {}) => ({
    name: String(profile.name || "").trim(),
    email: String(profile.email || currentUser?.email || "").trim(),
    phone: String(profile.phone || "").trim(),
    school: String(profile.school || "").trim(),
    grade: normalizeGrade(profile.grade)
  });

  try {
    const snap = await getDoc(doc(db, "students", uid));
    if (snap.exists()) return toSnapshot(snap.data() || {});
  } catch (_) {
  }

  return empty;
}

async function buildMemberSnapshot(uid) {
  const empty = {
    name: "",
    email: String(currentUser?.email || "").trim(),
    phone: "",
    school: null,
    grade: null
  };
  if (!uid) return empty;
  const toSnapshot = (profile = {}) => ({
    name: String(profile.name || "").trim(),
    email: String(profile.email || currentUser?.email || "").trim(),
    phone: String(profile.phone || "").trim(),
    school: null,
    grade: null
  });

  try {
    const snap = await getDoc(doc(db, "members", uid));
    if (snap.exists()) return toSnapshot(snap.data() || {});
  } catch (_) {
  }

  return empty;
}

async function buildLearnerEnrollmentData(uid, targetCourseId) {
  if (currentUserRole === "member") {
    const memberSnapshot = await buildMemberSnapshot(uid);
    return {
      userId: uid,
      courseId: targetCourseId,
      status: "active",
      progress: 0,
      learnerType: "member",
      learnerSnapshot: {
        ...memberSnapshot,
        type: "member"
      },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
  }

  const studentSnapshot = await buildStudentSnapshot(uid);
  return {
    userId: uid,
    courseId: targetCourseId,
    status: "active",
    studentSnapshot,
    progress: 0,
    learnerType: "student",
    learnerSnapshot: {
      ...studentSnapshot,
      type: "student"
    },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
}

async function loadEnrolledCourses() {
  if (!currentUser) {
    enrolledCourseIds.clear();
    enrollmentsLoaded = false;
    return;
  }
  const snap = await getDocs(query(collection(db, "enrollments"), where("userId", "==", currentUser.uid)));
  enrolledCourseIds = new Set();
  snap.forEach((d) => {
    const row = d.data() || {};
    if (row.courseId && isActiveEnrollment(row)) enrolledCourseIds.add(String(row.courseId));
  });
  enrollmentsLoaded = true;
}

window.enrollCourse = async function enrollCourse(targetCourseId) {
  const enrollmentCourseId = String(targetCourseId || courseId || "").trim();
  if (!currentUser) {
    promptLoginRequired();
    return;
  }
  if (enrollRequestInFlight) return;
  if (!currentCourse) return;
  if (isPublicCourse(currentCourse)) return;
  if (!isMemberOnlyCourse(currentCourse)) return;
  if (!currentUserRole) {
    try {
      currentUserRole = await getUserRole(currentUser);
    } catch (_) {
      currentUserRole = null;
    }
  }
  if (currentUserRole !== "student" && currentUserRole !== "member") {
    promptLearnerOnlyEnrollment();
    return;
  }
  if (currentUserRole === "member" && await getCurrentMemberPurpose() === "parent") {
    promptParentMemberEnrollmentBlocked();
    return;
  }
  if (!enrollmentCourseId) {
    if (window.toast?.error) window.toast.error("강좌 ID를 확인할 수 없습니다.");
    return;
  }
  if (enrolledCourseIds.has(enrollmentCourseId)) {
    window.location.href = learnerCourseUrl(enrollmentCourseId);
    return;
  }

  enrollRequestInFlight = true;
  await updateEnrollButton();
  try {
    const dup = await getDocs(query(
      collection(db, "enrollments"),
      where("userId", "==", currentUser.uid),
      where("courseId", "==", enrollmentCourseId)
    ));
    const existingActiveEnrollment = dup.docs.find((docSnap) => isActiveEnrollment(docSnap.data() || {}));
    if (existingActiveEnrollment) {
      enrolledCourseIds.add(enrollmentCourseId);
      window.location.href = learnerCourseUrl(enrollmentCourseId);
      return;
    }
    const enrollmentId = buildEnrollmentId(currentUser.uid, enrollmentCourseId);
    const enrollmentData = await buildLearnerEnrollmentData(currentUser.uid, enrollmentCourseId);
    await setDoc(doc(db, "enrollments", enrollmentId), enrollmentData, { merge: true });
    enrolledCourseIds.add(enrollmentCourseId);
    if (window.toast?.success) {
      window.toast.success("수강신청이 완료되었습니다.");
    }
    setTimeout(() => {
      window.location.href = learnerCourseUrl(enrollmentCourseId);
    }, 800);
  } catch (error) {
    if (window.toast?.error) {
      window.toast.error(`수강신청 중 오류가 발생했습니다: ${error.message || error}`);
    }
  } finally {
    enrollRequestInFlight = false;
    await updateEnrollButton();
  }
};

async function loadCourse() {
  if (!courseId) return showMessage("요청하신 강좌 정보를 확인할 수 없습니다.");
  await loadContext();
  const snap = await getDoc(doc(db, "courses", courseId));
  if (!snap.exists()) return showMessage("요청하신 강좌 정보를 확인할 수 없습니다.");

  const rawCourse = snap.data() || {};
  const hasExplicitDetailSections = Object.prototype.hasOwnProperty.call(rawCourse, "detailSections");
  let course = normalizeCourseForReadOnly(
    { id: snap.id, ...rawCourse },
    { labelMaps }
  );
  if (course.status !== "published") return showMessage("현재 공개 준비 중인 강좌입니다.");
  if (course.isDetailBlocked) return (window.location.href = "/404.html");

  course = await enrichCourseWithInstructorProfile(course);

  const sectionMap = getSectionMap(course, hasExplicitDetailSections);
  currentCourse = course;
  renderHeroMedia(course);
  renderCourseOverview(course, sectionMap);
  renderWeeks(course, sectionMap);
  applyTabVisibility(sectionMap, hasExplicitDetailSections);
  await updateEnrollButton();
}

setupTabInteraction();

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  currentUserRole = null;
  currentMemberPurpose = null;
  try {
    await loadEnrolledCourses();
  } catch (_) {
    enrollmentsLoaded = false;
  }
  await updateEnrollButton();
});

loadCourse().catch((error) => {
  showMessage(`강좌 정보를 불러오지 못했습니다. 잠시 후 다시 확인해 주세요. ${error.message || error}`);
});
