import { app } from "/assets/js/firebase-init.js";
import {
  getFirestore,
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { getPublicSettingDoc } from "/assets/js/utils/settings-cache.js";
import {
  PUBLIC_IMAGE_FIELD,
  sanitizePublicImageSrc,
  INSTRUCTOR_PROFILE_PLACEHOLDER,
} from "/assets/js/utils/public-image-url.js";
import { assignImageSrc } from "/assets/js/utils/image-load-guard.js";
import { formatInstructorSubjectsLabel } from "/assets/js/utils/instructor-subjects.js";

const db = getFirestore(app);
const params = new URLSearchParams(location.search);
const docId = params.get("doc");
const MAX_ASSIGNED_COURSES = 8;
const MAX_CURRICULUM_IMAGES = 4;

let instructorHidden = [];
let loadedInstructor = null; // 로드된 강사 정보 저장
let curriculumLightboxKeydownHandler = null;
let curriculumLightboxTrigger = null;
let curriculumLightboxItems = [];
let curriculumLightboxIndex = 0;

function renderFormattedBio(container, text) {
  if (!container) return;
  container.replaceChildren();

  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return;

  const wrapper = document.createElement("div");
  wrapper.className = "instructor-bio-formatted";

  lines.forEach((line) => {
    const row = document.createElement("div");
    row.className = "instructor-bio-row";

    const match = line.match(/^(現|현|前|전)\s*\)\s*(.*)$/);
    if (!match) {
      row.textContent = line;
      wrapper.appendChild(row);
      return;
    }

    const prefix = document.createElement("span");
    prefix.className = `instructor-bio-prefix ${match[1] === "現" || match[1] === "현" ? "is-current" : "is-previous"}`;
    prefix.textContent = `${match[1]})`;

    const content = document.createElement("span");
    content.className = "instructor-bio-text";
    content.textContent = match[2].trim();

    row.append(prefix, content);
    wrapper.appendChild(row);
  });

  container.appendChild(wrapper);
}

function getActiveDetailSections(globalDetailSections = {}) {
  const detailSections = globalDetailSections && typeof globalDetailSections === "object"
    ? globalDetailSections
    : {};

  return {
    video: detailSections.video !== false,
    curriculum: detailSections.curriculum !== false,
    courses: detailSections.courses !== false
  };
}

function getString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getSafeUrl(value) {
  const raw = getString(value);
  if (!raw || /^(javascript|data):/i.test(raw)) return "";

  try {
    const resolved = new URL(raw, window.location.origin);
    return resolved.protocol === "http:" || resolved.protocol === "https:"
      ? resolved.href
      : "";
  } catch {
    return "";
  }
}

function withCacheBuster(url) {
  return url;
}

function normalizeExternalUrl(value) {
  const raw = getString(value);
  if (!raw) return "";
  if (/^(https?:)?\/\//i.test(raw)) {
    return raw.startsWith("//") ? `https:${raw}` : raw;
  }
  if (/^(www\.)?(youtube\.com|youtu\.be)\//i.test(raw)) {
    return `https://${raw.replace(/^www\./i, "www.")}`;
  }
  return raw;
}

function getTimestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function getCourseRecency(course) {
  return getTimestampMillis(course?.createdAt) || getTimestampMillis(course?.updatedAt);
}

function extractYouTubeVideoId(value) {
  const raw = normalizeExternalUrl(value);
  if (!raw) return "";

  const directId = raw.trim();
  if (/^[\w-]{11}$/.test(directId)) return directId;

  try {
    const parsed = new URL(raw);
    const hostname = parsed.hostname.replace(/^www\./, "");
    let id = "";

    if (hostname === "youtu.be") {
      id = parsed.pathname.split("/").filter(Boolean)[0] || "";
    } else if (hostname === "youtube.com" || hostname === "m.youtube.com") {
      const parts = parsed.pathname.split("/").filter(Boolean);
      id = parsed.searchParams.get("v") || "";
      if (!id && ["embed", "shorts", "live"].includes(parts[0])) {
        id = parts[1] || "";
      }
    }

    return /^[\w-]{11}$/.test(id) ? id : "";
  } catch {
    return "";
  }
}

function getInstructorIdentifierSet(instructor, profileDocId) {
  return new Set(
    [
      profileDocId,
      instructor?.docId,
      instructor?.id,
      instructor?.instructorId,
      instructor?.uid
    ]
      .map((value) => getString(value))
      .filter(Boolean)
  );
}

function isHiddenInstructor(instructor, profileDocId) {
  const hiddenIds = new Set(instructorHidden.map((value) => getString(value)).filter(Boolean));
  return [...getInstructorIdentifierSet(instructor, profileDocId)].some((id) => hiddenIds.has(id));
}

function collectInstructorVideos(instructor) {
  const videos = [];
  const youtubeIds = new Set();
  const mediaUrls = new Set();

  const addVideo = (value) => {
    if (Array.isArray(value)) {
      value.forEach(addVideo);
      return;
    }

    let url = "";
    if (typeof value === "string") {
      url = value.trim();
    } else if (value?.url) {
      url = getString(value.url);
    } else if (value?.fullUrl) {
      const id = extractYouTubeVideoId(value.fullUrl);
      url = id ? `https://www.youtube.com/watch?v=${id}` : getString(value.fullUrl);
    } else if (value?.embedUrl) {
      url = getString(value.embedUrl);
    } else if (value?.youtubeId || value?.videoId || value?.id) {
      url = getString(value.youtubeId || value.videoId || value.id);
    }

    if (!url) return;

    const id = extractYouTubeVideoId(url);
    if (id) {
      if (!youtubeIds.has(id)) {
        videos.push({ type: "youtube", id });
        youtubeIds.add(id);
      }
      return;
    }

    const safeUrl = getSafeUrl(url);
    if (safeUrl && !mediaUrls.has(safeUrl)) {
      videos.push({ type: "media", url: safeUrl });
      mediaUrls.add(safeUrl);
    }
  };

  if (Array.isArray(instructor?.videos)) {
    instructor.videos.forEach(addVideo);
  }
  addVideo(instructor?.youtube_url);
  addVideo(instructor?.video);

  return videos;
}

function renderVideoSection(instructor, detailSections) {
  const videoGrid = document.getElementById("videoGrid");
  const sectionVideo = document.getElementById("sectionVideo");
  if (!videoGrid || !sectionVideo) return;

  videoGrid.replaceChildren();
  const videos = detailSections.video ? collectInstructorVideos(instructor) : [];
  if (videos.length === 0) {
    sectionVideo.hidden = true;
    return;
  }

  videos.forEach((video, index) => {
    const item = document.createElement("div");
    item.className = "video-item";

    if (video.type === "youtube") {
      const embedUrl = `https://www.youtube.com/embed/${video.id}`;

      const wrapper = document.createElement("div");
      wrapper.className = "video-wrapper";
      const iframe = document.createElement("iframe");
      iframe.src = embedUrl;
      iframe.title = `소개 영상 ${index + 1}`;
      iframe.loading = "lazy";
      iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
      iframe.allowFullscreen = true;
      wrapper.appendChild(iframe);
      item.appendChild(wrapper);
    } else {
      const media = document.createElement("video");
      media.controls = true;
      media.src = video.url;
      media.className = "video-media";
      media.textContent = "브라우저가 비디오 태그를 지원하지 않습니다.";
      item.appendChild(media);
    }

    if (item.childElementCount > 0) {
      videoGrid.appendChild(item);
    }
  });

  sectionVideo.hidden = videoGrid.childElementCount === 0;
}

function getCurriculumImageUrls(instructor) {
  const arrayValues = Array.isArray(instructor?.curriculumImageUrls)
    ? instructor.curriculumImageUrls
    : [];
  const fallback = getString(instructor?.curriculumImageUrl);
  const values = arrayValues.length > 0 ? arrayValues : [fallback];
  const seen = new Set();

  return values
    .map((value) => sanitizePublicImageSrc(value, { field: PUBLIC_IMAGE_FIELD.instructorCurriculum }))
    .filter((url) => {
      if (!url || seen.has(url)) return false;
      seen.add(url);
      return true;
    })
    .slice(0, MAX_CURRICULUM_IMAGES);
}

function renderCurriculumSection(instructor, detailSections) {
  const sectionCurriculum = document.getElementById("sectionCurriculum");
  const curriculumImageWrap = document.getElementById("curriculumImageWrap");
  if (!sectionCurriculum || !curriculumImageWrap) return;

  curriculumImageWrap.replaceChildren();
  const imageUrls = detailSections.curriculum ? getCurriculumImageUrls(instructor) : [];
  if (imageUrls.length === 0) {
    curriculumLightboxItems = [];
    sectionCurriculum.hidden = true;
    return;
  }

  curriculumImageWrap.classList.remove("is-count-1", "is-count-2", "is-count-3", "is-count-4");
  curriculumImageWrap.classList.add(`is-count-${imageUrls.length}`);
  curriculumLightboxItems = imageUrls.map((url, index) => ({
    src: withCacheBuster(url),
    alt: `${instructor?.name || "강사"} 참고 자료 ${index + 1}`
  }));

  curriculumLightboxItems.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "curriculum-image-card";
    button.setAttribute("aria-label", `참고 자료 이미지 ${index + 1} 확대`);

    const image = document.createElement("img");
    image.alt = item.alt;
    image.loading = "lazy";
    image.decoding = "async";
    assignImageSrc(image, item.src, {
      onGiveUp: (img) => {
        img.style.display = "none";
        button.disabled = true;
      },
    });

    button.appendChild(image);
    button.addEventListener("click", () => openCurriculumLightbox(index));
    curriculumImageWrap.appendChild(button);
  });
  sectionCurriculum.hidden = false;
}

function updateCurriculumLightboxImage() {
  const lightbox = document.getElementById("curriculumLightbox");
  const image = document.getElementById("curriculumLightboxImage");
  const prevButton = document.getElementById("curriculumLightboxPrev");
  const nextButton = document.getElementById("curriculumLightboxNext");
  const item = curriculumLightboxItems[curriculumLightboxIndex];
  if (!lightbox || !image || !item) return;

  image.removeAttribute("data-load-key");
  image.removeAttribute("data-load-state");
  image.alt = item.alt || "참고 자료 이미지";
  assignImageSrc(image, item.src, {
    onGiveUp: (img) => {
      img.removeAttribute("src");
      img.alt = "이미지를 불러올 수 없습니다";
    },
  });
  const hasMultiple = curriculumLightboxItems.length > 1;
  if (prevButton) {
    prevButton.hidden = !hasMultiple;
    prevButton.disabled = !hasMultiple;
  }
  if (nextButton) {
    nextButton.hidden = !hasMultiple;
    nextButton.disabled = !hasMultiple;
  }
}

function showCurriculumLightboxImage(direction) {
  if (curriculumLightboxItems.length <= 1) return;
  const count = curriculumLightboxItems.length;
  curriculumLightboxIndex = (curriculumLightboxIndex + direction + count) % count;
  updateCurriculumLightboxImage();
}

function openCurriculumLightbox(index = 0) {
  const lightbox = document.getElementById("curriculumLightbox");
  if (!lightbox || curriculumLightboxItems.length === 0) return;

  if (curriculumLightboxKeydownHandler) {
    document.removeEventListener("keydown", curriculumLightboxKeydownHandler);
  }
  curriculumLightboxTrigger = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  curriculumLightboxIndex = Math.min(Math.max(index, 0), curriculumLightboxItems.length - 1);
  updateCurriculumLightboxImage();
  lightbox.hidden = false;
  lightbox.setAttribute("aria-hidden", "false");
  document.body.classList.add("curriculum-lightbox-open");
  document.getElementById("curriculumLightboxClose")?.focus({ preventScroll: true });

  curriculumLightboxKeydownHandler = (event) => {
    if (event.key === "Escape") {
      closeCurriculumLightbox();
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      showCurriculumLightboxImage(-1);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      showCurriculumLightboxImage(1);
    }
  };
  document.addEventListener("keydown", curriculumLightboxKeydownHandler);
}

function closeCurriculumLightbox() {
  const lightbox = document.getElementById("curriculumLightbox");
  const image = document.getElementById("curriculumLightboxImage");
  if (!lightbox) return;

  if (document.activeElement && lightbox.contains(document.activeElement)) {
    if (curriculumLightboxTrigger?.isConnected) {
      curriculumLightboxTrigger.focus({ preventScroll: true });
    } else {
      document.activeElement.blur();
    }
  }
  lightbox.hidden = true;
  lightbox.setAttribute("aria-hidden", "true");
  document.body.classList.remove("curriculum-lightbox-open");
  curriculumLightboxTrigger = null;
  if (image) {
    image.removeAttribute("src");
    image.alt = "";
  }
  if (curriculumLightboxKeydownHandler) {
    document.removeEventListener("keydown", curriculumLightboxKeydownHandler);
    curriculumLightboxKeydownHandler = null;
  }
}

function setupCurriculumLightbox() {
  const lightbox = document.getElementById("curriculumLightbox");
  const closeButton = document.getElementById("curriculumLightboxClose");
  const prevButton = document.getElementById("curriculumLightboxPrev");
  const nextButton = document.getElementById("curriculumLightboxNext");
  if (!lightbox) return;

  lightbox.addEventListener("click", (event) => {
    if (event.target === lightbox) {
      closeCurriculumLightbox();
    }
  });

  if (closeButton) {
    closeButton.addEventListener("click", closeCurriculumLightbox);
  }
  if (prevButton) {
    prevButton.addEventListener("click", () => showCurriculumLightboxImage(-1));
  }
  if (nextButton) {
    nextButton.addEventListener("click", () => showCurriculumLightboxImage(1));
  }
}

function normalizeCourseStatus(value) {
  return getString(value).toLowerCase();
}

function isAvailableCourse(course) {
  const status = normalizeCourseStatus(course?.status);
  const visibility = normalizeCourseStatus(course?.visibility);

  if (status === "archived" || status === "blocked" || status === "draft") return false;
  if (visibility === "hidden" || visibility === "private") return false;

  return true;
}

function courseMatchesInstructor(course, instructor, profileDocId) {
  const identifiers = getInstructorIdentifierSet(instructor, profileDocId);
  const instructorUid = getString(course?.instructorUid);
  const instructorId = getString(course?.instructorId);
  const instructorUids = Array.isArray(course?.instructorUids)
    ? course.instructorUids.map((value) => getString(value)).filter(Boolean)
    : [];

  return (
    (instructorUid && identifiers.has(instructorUid)) ||
    (instructorId && identifiers.has(instructorId)) ||
    instructorUids.some((id) => identifiers.has(id))
  );
}

async function queryCoursesByField(field, operator, value) {
  if (!value) return [];
  try {
    const snap = await getDocs(query(collection(db, "courses"), where(field, operator, value)));
    return snap.docs;
  } catch (error) {
    console.warn(`[instructor-details] 담당 강의 조회 실패: ${field}`, error);
    return [];
  }
}

async function loadAssignedCourses(instructor, profileDocId) {
  const identifiers = [...getInstructorIdentifierSet(instructor, profileDocId)];
  const uid = getString(instructor?.uid);
  const instructorId = getString(instructor?.instructorId);
  const idQueries = [
    ...new Set([instructorId, profileDocId].map((value) => getString(value)).filter(Boolean))
  ];
  const arrayQueries = [...new Set([uid, instructorId, profileDocId].map((value) => getString(value)).filter(Boolean))];

  if (identifiers.length === 0) return [];

  const queryPromises = [
    uid ? queryCoursesByField("instructorUid", "==", uid) : Promise.resolve([]),
    ...idQueries.map((id) => queryCoursesByField("instructorId", "==", id)),
    ...arrayQueries.map((id) => queryCoursesByField("instructorUids", "array-contains", id))
  ];

  const results = await Promise.all(queryPromises);
  const byId = new Map();

  results.flat().forEach((courseDoc) => {
    if (byId.has(courseDoc.id)) return;
    const data = courseDoc.data();
    if (!courseMatchesInstructor(data, instructor, profileDocId)) return;
    if (!isAvailableCourse(data)) return;
    byId.set(courseDoc.id, { id: courseDoc.id, ...data });
  });

  return [...byId.values()].sort((a, b) => {
    const recencyA = getCourseRecency(a);
    const recencyB = getCourseRecency(b);
    if (recencyA !== recencyB) return recencyB - recencyA;
    return String(b.id || "").localeCompare(String(a.id || ""), "ko-KR");
  });
}

function formatGrade(course) {
  const gradeMap = {
    "1": "중1",
    "2": "중2",
    "3": "중3",
    "4": "고1",
    "5": "고2",
    "6": "고3",
    G1: "중1",
    G2: "중2",
    G3: "중3"
  };
  const grade = getString(course?.grade);
  return gradeMap[grade] || grade;
}

function formatAccessType(accessType) {
  const normalized = getString(accessType).toLowerCase();
  if (normalized === "public") return "공개";
  if (normalized === "memberonly" || normalized === "member_only" || normalized === "member" || normalized === "paid") return "회원전용";
  return "";
}

function getAssignedCourseMetaItems(course) {
  const accessLabel = formatAccessType(course?.accessType);
  return [
    { type: "year", value: getString(course?.year || course?.schoolYear) },
    { type: "grade", value: formatGrade(course) },
    {
      type: accessLabel === "공개" ? "access-public" : "access-member",
      value: accessLabel
    }
  ].filter((item) => item.value);
}

function renderAssignedCoursesSection(courses, detailSections) {
  const sectionCourses = document.getElementById("sectionCourses");
  const assignedCoursesGrid = document.getElementById("assignedCoursesGrid");
  if (!sectionCourses || !assignedCoursesGrid) return;

  assignedCoursesGrid.replaceChildren();
  if (!detailSections.courses || courses.length === 0) {
    sectionCourses.hidden = true;
    return;
  }

  const visibleCourses = courses.slice(0, MAX_ASSIGNED_COURSES);

  visibleCourses.forEach((course) => {
    const card = document.createElement("a");
    card.className = "assigned-course-card";
    card.href = `/course-detail.html?courseId=${encodeURIComponent(course.id)}`;

    const metaItems = getAssignedCourseMetaItems(course);
    const meta = document.createElement("div");
    meta.className = "assigned-course-meta";
    meta.setAttribute("aria-label", "강좌 메타 정보");
    metaItems.forEach((metaItem) => {
      const item = document.createElement("span");
      item.className = `assigned-course-meta-item is-${metaItem.type}`;
      item.textContent = metaItem.value;
      meta.appendChild(item);
    });

    const title = document.createElement("h3");
    title.className = "assigned-course-title";
    title.textContent = course.title || "강좌명 미정";

    if (metaItems.length > 0) {
      card.appendChild(meta);
    }
    card.appendChild(title);

    const description = getString(course.shortDescription);
    if (description) {
      const desc = document.createElement("p");
      desc.className = "assigned-course-description";
      desc.textContent = description;
      card.appendChild(desc);
    }

    assignedCoursesGrid.appendChild(card);
  });

  sectionCourses.hidden = assignedCoursesGrid.childElementCount === 0;
}

function showSkeleton() {
  const page = document.getElementById("instructorPage");
  if (!page) return;

  const photo = document.getElementById("heroPhoto");
  if (photo) {
    photo.style.opacity = "0.3";
  }

  page.querySelectorAll(".section-card").forEach((card) => {
    if (!card.querySelector(".skeleton")) {
      const content = card.querySelector(".section-content, .video-grid");
      if (content) {
        content.innerHTML =
          '<div class="skeleton" style="height:200px;border-radius:8px;"></div>';
      }
    }
  });
}

function removeSkeleton() {
  const page = document.getElementById("instructorPage");
  if (!page) return;

  const photo = document.getElementById("heroPhoto");
  if (photo) {
    photo.style.opacity = "1";
  }

  page.querySelectorAll(".skeleton").forEach((skeleton) => {
    skeleton.remove();
  });
}

async function load() {
  if (!docId) {
    console.warn("[instructor-details] doc 파라미터 없음");
    removeSkeleton();
    return;
  }

  console.log("[instructor-details] 로드 시작, docId:", docId);
  showSkeleton();

  let instructor = null;
  let profileDocId = docId;

  const [docSnap, instructorsMenuResult] = await Promise.all([
    getDoc(doc(db, "instructors", docId)),
    getPublicSettingDoc("instructorsMenu")
  ]);

  let globalDetailSections = {};
  if (instructorsMenuResult.exists) {
    const data = instructorsMenuResult.data;
    const homeHidden = Array.isArray(data.homeHidden) ? data.homeHidden : [];
    const instructorsHidden = Array.isArray(data.instructorsHidden) ? data.instructorsHidden : [];
    instructorHidden = [...new Set([...homeHidden, ...instructorsHidden])];
    globalDetailSections = data.detailSections && typeof data.detailSections === "object"
      ? data.detailSections
      : {};
  } else {
    instructorHidden = [];
  }
  if (docSnap.exists()) {
    console.log("[instructor-details] instructors 컬렉션에서 문서 ID로 찾음:", docId);
    instructor = docSnap.data();
    profileDocId = docSnap.id;
  } else {
    console.log(
      "[instructor-details] instructors 컬렉션 문서 ID로 찾지 못함, instructorId 필드로 검색 시도"
    );

    try {
      const q = query(
        collection(db, "instructors"),
        where("instructorId", "==", docId)
      );
      const snap = await getDocs(q);

      if (snap.empty) {
        console.log(
          "[instructor-details] instructors 컬렉션에서 instructorId 필드로도 찾지 못함"
        );
      } else {
        console.log(
          "[instructor-details] instructors 컬렉션에서 instructorId 필드로 찾음:",
          docId
        );
        instructor = snap.docs[0].data();
        profileDocId = snap.docs[0].id;
      }
    } catch (error) {
      console.warn("[instructor-details] instructorId로 검색 실패:", error);
    }
  }

  if (!instructor) {
    console.error("[instructor-details] 강사 정보를 찾을 수 없음, docId:", docId);
    removeSkeleton();
    // 404 페이지로 리다이렉트
    window.location.href = "/404.html";
    return;
  }

  // 강사 정보 저장
  loadedInstructor = { ...instructor, docId: profileDocId };
  instructor = loadedInstructor;
  
  if (isHiddenInstructor(instructor, profileDocId)) {
    console.warn("[instructor-details] 숨김 처리된 강사 접근 시도, 리다이렉트");
    removeSkeleton();
    window.location.href = "/404.html";
    return;
  }

  console.log(
    "[instructor-details] 강사 정보 로드 완료:",
    instructor.name || "이름 없음"
  );
  removeSkeleton();

  const heroPhoto = document.getElementById("heroPhoto");
  const heroHeadline = document.getElementById("heroHeadline");
  const heroName = document.getElementById("heroName");
  const heroSubtitle = document.getElementById("heroSubtitle");
  const heroLead = document.getElementById("heroLead");

  if (heroPhoto) {
    const rawPhoto = instructor.photo || instructor.profilePhoto || "";
    const safePhoto = sanitizePublicImageSrc(rawPhoto, { field: PUBLIC_IMAGE_FIELD.instructorProfile });
    const displayPhoto = safePhoto || INSTRUCTOR_PROFILE_PLACEHOLDER;
    assignImageSrc(heroPhoto, displayPhoto, {
      allowFallbackOnce: Boolean(safePhoto),
      fallbackSrc: INSTRUCTOR_PROFILE_PLACEHOLDER,
    });
    heroPhoto.loading = "lazy";
  }

  if (heroHeadline) {
    heroHeadline.textContent = instructor.brief || "끝까지 해내는 힘";
  }

  if (heroName) {
    heroName.textContent = instructor.name || "";
  }

  if (heroSubtitle) {
    heroSubtitle.textContent = formatInstructorSubjectsLabel(instructor);
    heroSubtitle.removeAttribute("data-subject");
  }

  if (heroLead) {
    const bio = instructor.bio || "";
    if (bio) {
      renderFormattedBio(heroLead, bio);
      heroLead.style.whiteSpace = "";
      heroLead.style.lineHeight = "";
      heroLead.style.display = "block";
    } else {
      heroLead.replaceChildren();
      heroLead.style.display = "none";
    }
  }

  const detailSections = getActiveDetailSections(globalDetailSections);
  renderVideoSection(instructor, detailSections);
  renderCurriculumSection(instructor, detailSections);
  const assignedCourses = detailSections.courses
    ? await loadAssignedCourses(instructor, profileDocId)
    : [];
  renderAssignedCoursesSection(assignedCourses, detailSections);
}

if (!docId) {
  console.warn("doc 파라미터 없음");
}

setupCurriculumLightbox();
load();
