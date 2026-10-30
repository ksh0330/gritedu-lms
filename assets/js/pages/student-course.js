// /assets/js/pages/student-course.js
// 학생 강의 학습 페이지
import { auth, db, requireRole } from "/assets/js/firebase-init.js";
import {
  doc, getDoc, runTransaction, serverTimestamp, collection, query, where, getDocs
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { escapeHtml } from "/assets/js/utils/html.js";
import "/assets/js/utils/toast.js";
import { handleError } from "/assets/js/utils/error-handler.js";
import {
  createCourseLabelMaps,
  normalizeCourseForReadOnly,
  normalizeAccessType
} from "/assets/js/utils/course-readonly.js";
import { getSettingDoc } from "/assets/js/utils/settings-cache.js";
import { bindUnenrollModal } from "/assets/js/pages/student-dashboard/courses.js";
import { bindCommittedSearch } from "/assets/js/utils/list-controls.js";
import { normalizeVideoUrl } from "/assets/js/utils/video-url.js";
import { collectCourseVideoIds, completeVideoInTransaction, resolveCourseVideoId, summarizeCourseCompletion } from "/assets/js/utils/course-completion.js";
import {
  getSubjectColorStyle,
  loadSharedSubjectColorMap,
} from "/assets/js/utils/subject-colors.js";

// URL에서 강의 ID 가져오기
const urlParams = new URLSearchParams(window.location.search);
const courseId = urlParams.get("courseId") || urlParams.get("id");

const LEARNING_ROUTE = window.location.pathname.includes("/members/member/")
  ? {
      role: "member",
      dashboardUrl: "/members/member/dashboard.html",
      ownerLabel: "회원"
    }
  : {
      role: "student",
      dashboardUrl: "/members/students/dashboard.html",
      ownerLabel: "학생"
    };

// 역할 가드: 학생/일반 회원 학습 라우트별 접근 제어
let user, role;
const roleCheckPromise = (async () => {
  const result = await requireRole(LEARNING_ROUTE.role, "/members/login.html");
  user = result.user;
  role = result.role;
  return { user, role };
})();

let courseData = null;
let enrollmentData = null;
let courseUnenrollControls = null;
let watchedVideos = new Set(); // 시청한 영상 ID 목록
let activeVideoId = null;
let modalReturnFocus = null;
let completionInProgress = false;

function isActiveEnrollment(row) {
  return String(row?.status || "active").trim() === "active";
}

function isStudentCourseAvailable(course) {
  if (!course || typeof course !== "object") return false;
  const status = String(course.status || "").trim().toLowerCase();
  if (status !== "published") return false;
  const visibility = String(course.visibility || "public").trim().toLowerCase();
  if (visibility === "private" || visibility === "hidden") return false;
  if (course.deleted === true || course.isDeleted === true) return false;
  if (course.blocked === true || course.isBlocked === true) return false;
  return true;
}

function setupCourseUnenrollAction() {
  const actions = document.getElementById("courseEnrollmentActions");
  const unenrollBtn = document.getElementById("unenrollCourseBtn");
  if (!actions || !unenrollBtn || !enrollmentData || !courseData) return;

  if (normalizeAccessType(courseData.accessType) !== "memberOnly") {
    actions.hidden = true;
    return;
  }

  actions.hidden = false;
  const normalizedCourseId = String(courseId || enrollmentData.courseId || "").trim();

  if (!courseUnenrollControls) {
    courseUnenrollControls = bindUnenrollModal(
      {
        modal: document.getElementById("unenrollModal"),
        closeBtn: document.getElementById("closeUnenrollModal"),
        cancelBtn: document.getElementById("cancelUnenrollBtn"),
        confirmBtn: document.getElementById("confirmUnenrollBtn"),
        phraseInput: document.getElementById("unenrollPhraseInput"),
        courseTitleEl: document.getElementById("unenrollCourseTitle"),
        status: document.getElementById("unenrollStatus")
      },
      {
        onSuccess: async ({ courseId: cancelledCourseId }) => {
          const redirectId = String(cancelledCourseId || normalizedCourseId).trim();
          if (window.toast?.success) {
            window.toast.success("수강이 취소되었습니다. 강좌 상세에서 다시 수강신청할 수 있습니다.");
          }
          window.location.replace(
            `/course-detail?courseId=${encodeURIComponent(redirectId)}`
          );
        }
      }
    );
  }

  unenrollBtn.onclick = () => {
    courseUnenrollControls?.openModal({
      enrollmentId: enrollmentData.id,
      courseId: normalizedCourseId,
      courseTitle: courseData.title || "제목 없는 강좌"
    });
  };
}

// HTML 페이지 구조

function getWeekVideoArray(week) {
  if (!week || typeof week !== "object") return [];

  // Canonical shape: week.videos[].url
  if (Array.isArray(week.videos) && week.videos.length > 0) {
    return week.videos.filter((video) => getVideoUrlFromItem(video));
  }

  // Compatibility shape: week.lessons[].url
  if (Array.isArray(week.lessons) && week.lessons.length > 0) {
    return week.lessons.filter((lesson) => getVideoUrlFromItem(lesson));
  }

  // Compatibility fallback for legacy week.video / week.videoUrl
  const videoData = week.video || week.videoUrl || "";
  return Array.isArray(videoData) ? videoData : (videoData ? [videoData] : []);
}

function getVideoUrlFromItem(videoItem) {
  if (!videoItem) return "";
  return typeof videoItem === "string"
    ? videoItem
    : (videoItem.url || videoItem.fullUrl || videoItem.videoUrl || "");
}

function buildVideoId(weekId, videoIndex, videoItem) {
  return resolveCourseVideoId(courseId, weekId, videoItem, videoIndex);
}

function countPlayableVideos(weeks) {
  let count = 0;
  (weeks || []).forEach((week) => {
    getWeekVideoArray(week).forEach((videoItem) => {
      if (getVideoUrlFromItem(videoItem)) count += 1;
    });
  });
  return count;
}

function getCourseVideoIds() {
  return collectCourseVideoIds(courseId, courseData?.weeks);
}

function getWeekWatchStats(week, weekIndex) {
  const weekId = week?.id || `week_${weekIndex}`;
  const videoArray = getWeekVideoArray(week);
  let total = 0;
  let watched = 0;

  videoArray.forEach((videoItem, videoIndex) => {
    const videoUrl = getVideoUrlFromItem(videoItem);
    if (!videoUrl) return;
    total += 1;
    if (watchedVideos.has(buildVideoId(weekId, videoIndex, videoItem))) watched += 1;
  });

  return { total, watched, allWatched: total > 0 && watched === total };
}

const LEARNING_STATE = {
  NO_ID: {
    type: "error",
    title: "강좌를 불러올 수 없습니다",
    message: "강좌 ID가 없습니다."
  },
  NOT_FOUND: {
    type: "error",
    title: "강좌를 찾을 수 없습니다",
    message: "요청하신 강좌 정보가 없습니다."
  },
  NO_ENROLLMENT: {
    type: "blocked",
    title: "수강 권한 없음",
    message: "수강신청한 강좌가 아닙니다."
  },
  NOT_AVAILABLE: {
    type: "blocked",
    title: "수강 불가",
    message: "현재 수강할 수 없는 강좌입니다."
  },
  NO_CONTENT: {
    type: "empty",
    title: "학습 내용 없음",
    message: "등록된 학습 내용이 없습니다."
  },
  SEARCH_EMPTY: {
    type: "empty",
    title: "검색 결과 없음",
    message: "검색 조건에 맞는 학습 내용이 없습니다."
  }
};

function initLearningPageShell() {
  document.body.classList.add("student-learning-page");
  if (LEARNING_ROUTE.role === "member") {
    document.body.classList.add("member-learning-page");
  }
  const page = document.getElementById("coursePage");
  if (!page) return;
  page.classList.add("student-learning-shell");
  const backWrap = page.querySelector(":scope > .student-learning-toolbar .dash-back, :scope > .dash-back");
  if (backWrap) backWrap.classList.add("student-learning-back");
}

function ensureLearningGateEl() {
  let gate = document.getElementById("studentLearningGate");
  if (gate) return gate;

  const page = document.getElementById("coursePage");
  if (!page) return null;

  gate = document.createElement("section");
  gate.id = "studentLearningGate";
  gate.className = "student-learning-gate";
  gate.hidden = true;
  page.appendChild(gate);
  return gate;
}

function showLearningGate(stateKey, extra = {}) {
  const preset = LEARNING_STATE[stateKey] || LEARNING_STATE.NOT_FOUND;
  const page = document.getElementById("coursePage");
  const header = document.getElementById("courseHeader");
  const content = document.getElementById("courseContent");
  const gate = ensureLearningGateEl();

  if (header) header.hidden = true;
  if (content) content.hidden = true;
  if (page) page.classList.add("student-learning-shell--gated");

  if (!gate) return;

  const title = extra.title || preset.title;
  const message = extra.message || preset.message;
  const actionHref = extra.actionHref || LEARNING_ROUTE.dashboardUrl;
  const actionLabel = extra.actionLabel || "내 강의실로 돌아가기";

  gate.hidden = false;
  gate.className = `student-learning-gate student-learning-gate--${preset.type}`;
  gate.setAttribute("role", "alert");
  gate.innerHTML = `
    <div class="student-learning-gate__card">
      <div class="student-learning-gate__icon" aria-hidden="true"></div>
      <h2 class="student-learning-gate__title">${escapeHtml(title)}</h2>
      <p class="student-learning-gate__message">${escapeHtml(message)}</p>
      <a href="${escapeHtml(actionHref)}" class="btn student-learning-gate__action">${escapeHtml(actionLabel)}</a>
    </div>
  `;

  const weeksList = document.getElementById("weeksList");
  if (weeksList) {
    weeksList.innerHTML = "";
    weeksList.removeAttribute("aria-busy");
  }
}

function hideLearningGate() {
  const page = document.getElementById("coursePage");
  const header = document.getElementById("courseHeader");
  const content = document.getElementById("courseContent");
  const gate = document.getElementById("studentLearningGate");

  if (header) header.hidden = false;
  if (content) content.hidden = false;
  if (gate) gate.hidden = true;
  if (page) page.classList.remove("student-learning-shell--gated");
}

function renderListEmpty(message, hint = "") {
  return `
    <div class="student-learning-empty" role="status">
      <div class="student-learning-empty__icon" aria-hidden="true">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
      </div>
      <p class="student-learning-empty__title">${escapeHtml(message)}</p>
      ${hint ? `<p class="student-learning-empty__hint">${escapeHtml(hint)}</p>` : ""}
    </div>
  `;
}

// 강좌 전체 완료율은 현재 영상 목록과 저장된 완료 ID로 계산한다.
function updateProgress() {
  if (!courseData || !enrollmentData) return;
  const { completed, total, progress } = summarizeCourseCompletion(
    getCourseVideoIds(), watchedVideos
  );
  const progressBar = document.getElementById("progressBar");
  const progressText = document.getElementById("progressText");
  const watchedCount = document.getElementById("watchedCount");
  const totalVideos = document.getElementById("totalVideos");
  if (progressBar) {
    progressBar.style.width = `${progress}%`;
    progressBar.setAttribute("aria-valuenow", String(progress));
  }
  if (progressText) progressText.textContent = String(progress);
  if (watchedCount) watchedCount.textContent = String(completed);
  if (totalVideos) totalVideos.textContent = String(total);
}

// 저장된 목록을 transaction 안에서 다시 읽어 다른 탭의 완료 ID도 보존한다.
async function markVideoAsWatched(videoId) {
  if (!enrollmentData?.id || !getCourseVideoIds().includes(videoId)) {
    throw new Error("완료할 영상을 확인할 수 없습니다.");
  }
  const enrollmentRef = doc(db, "enrollments", enrollmentData.id);
  const videoIds = getCourseVideoIds();
  const result = await completeVideoInTransaction(
    (operation) => runTransaction(db, operation),
    enrollmentRef,
    videoIds,
    videoId,
    serverTimestamp
  );
  watchedVideos = new Set(result.watchedVideos);
  enrollmentData.watchedVideos = result.watchedVideos;
  enrollmentData.progress = result.progress;
  renderWeeks();
  updateProgress();
  return result;
}

function setVideoModalStatus(message, state = "") {
  const status = document.getElementById("videoModalStatus");
  if (!status) return;
  status.textContent = message;
  status.dataset.state = state;
}

function syncVideoModalActions() {
  const completeButton = document.getElementById("markVideoComplete");
  if (!completeButton) return;
  const completed = Boolean(activeVideoId && watchedVideos.has(activeVideoId));
  completeButton.disabled = completionInProgress || completed || !activeVideoId;
  completeButton.textContent = completionInProgress ? "저장 중..." : completed ? "학습 완료됨" : "학습 완료";
}

window.completeCurrentVideo = async function() {
  const videoId = activeVideoId;
  if (!videoId || completionInProgress || watchedVideos.has(videoId)) return;
  completionInProgress = true;
  syncVideoModalActions();
  setVideoModalStatus("완료 기록을 저장하고 있습니다.", "saving");
  let saved = false;
  try {
    await markVideoAsWatched(videoId);
    saved = true;
  } catch (error) {
    console.error("[student-course] completion save failed:", error);
    if (activeVideoId === videoId) {
      setVideoModalStatus("저장하지 못했습니다. 다시 시도해 주세요.", "error");
    }
  } finally {
    completionInProgress = false;
    syncVideoModalActions();
  }
  if (saved) {
    if (activeVideoId === videoId) window.closeVideoModal();
    window.toast?.success?.("학습 완료로 기록했습니다.");
  }
};

// 영상 모달 열기
window.openVideoModal = function(videoUrl, videoTitle, videoId) {
  if (!isStudentCourseAvailable(courseData)) {
    showLearningGate("NOT_AVAILABLE");
    return;
  }

  const modal = document.getElementById("videoModal");
  const modalTitle = document.getElementById("videoModalTitle");
  const videoPlayer = document.getElementById("videoPlayer");
  const youtubeLink = document.getElementById("watchOnYouTube");
  if (!modal || !videoPlayer) return;

  const opener = Array.from(document.querySelectorAll(".video-item"))
    .find((item) => item.dataset.videoId === videoId);
  modalReturnFocus = opener || document.activeElement;
  activeVideoId = videoId;
  if (modalTitle) modalTitle.textContent = videoTitle || "영상 재생";
  setVideoModalStatus("");
  syncVideoModalActions();

  const videoInfo = normalizeVideoUrl(videoUrl);
  if (youtubeLink) {
    youtubeLink.hidden = videoInfo?.type !== "youtube" && videoInfo?.type !== "youtubePlaylist";
    if (videoInfo?.type === "youtube" || videoInfo?.type === "youtubePlaylist") {
      youtubeLink.href = videoInfo.watchUrl;
    } else {
      youtubeLink.removeAttribute("href");
    }
  }

  if (videoInfo?.type === "youtube" || videoInfo?.type === "youtubePlaylist") {
    videoPlayer.innerHTML = `
      <div class="video-player-wrapper">
        <iframe
          title="${escapeHtml(videoTitle || "강의 영상")}"
          src="${videoInfo.embedUrl}${videoInfo.type === "youtubePlaylist" ? "&" : "?"}autoplay=1"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen>
        </iframe>
      </div>
    `;
  } else if (videoInfo?.type === "mp4") {
    videoPlayer.innerHTML = `
      <div class="video-player-wrapper">
        <video controls autoplay>
          <source src="${escapeHtml(videoInfo.url)}" type="video/mp4">
          브라우저가 비디오 태그를 지원하지 않습니다.
        </video>
      </div>
    `;
  } else {
    videoPlayer.innerHTML = '<p class="muted">영상 URL이 올바르지 않습니다.</p>';
    activeVideoId = null;
    syncVideoModalActions();
  }

  document.getElementById("videoModalHint").textContent = videoInfo?.type === "youtube" || videoInfo?.type === "youtubePlaylist"
    ? "사이트 내 재생이 제한되면 YouTube에서 볼 수 있습니다. 재생목록은 한 항목으로 기록되며 학습 후 완료 버튼을 눌러야 합니다."
    : "학습 후 완료 버튼을 눌러 기록하세요. 재생이나 모달 닫기로 자동 완료되지 않습니다.";
  modal.style.display = "flex";
  const scrollY = window.scrollY || window.pageYOffset;
  document.body.style.position = "fixed";
  document.body.style.top = `-${scrollY}px`;
  document.body.style.width = "100%";
  document.body.classList.add("modal-open");
  document.body.style.overflow = "hidden";
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
    document.documentElement.style.overflow = "hidden";
  }
  modal.querySelector(".video-modal-close")?.focus();
};

// 영상 모달 닫기
window.closeVideoModal = function() {
  const modal = document.getElementById("videoModal");
  const videoPlayer = document.getElementById("videoPlayer");
  const closingVideoId = activeVideoId;
  if (modal) modal.style.display = "none";
  document.body.classList.remove("modal-open");
  const scrollY = document.body.style.top;
  document.body.style.position = "";
  document.body.style.top = "";
  document.body.style.width = "";
  document.body.style.overflow = "";
  document.documentElement.style.overflow = "";
  if (scrollY) window.scrollTo(0, parseInt(scrollY, 10) * -1);
  if (videoPlayer) videoPlayer.innerHTML = "";
  activeVideoId = null;
  const replacement = Array.from(document.querySelectorAll(".video-item"))
    .find((item) => item.dataset.videoId === closingVideoId);
  const focusTarget = replacement || (modalReturnFocus?.isConnected ? modalReturnFocus : null);
  focusTarget?.focus();
  modalReturnFocus = null;
};

// 영상 모달 외부 클릭 시 닫기
document.addEventListener('click', (e) => {
  const modal = document.getElementById('videoModal');
  if (e.target === modal) {
    window.closeVideoModal();
    return;
  }
  const item = e.target.closest?.('.video-item');
  if (item) window.openVideoModal(item.dataset.videoUrl, item.dataset.videoTitle, item.dataset.videoId);
});

// 주차 검색 쿼리 처리
let searchQuery = '';

// 입력값과 적용 검색어를 분리해 Enter/검색 버튼에서만 이미 로드된 배열을 필터링한다.
const searchInput = document.getElementById('searchInput');
const searchButton = document.getElementById('searchButton');
bindCommittedSearch(searchInput, searchButton, (keyword) => {
  searchQuery = keyword;
  renderWeeks();
});

function weekMatchesSearch(week, weekIndex, query) {
  if (!query) return true;

  const weekTitle = (week.title || `${weekIndex + 1}주차`).toLowerCase();
  const weekContent = (week.description || week.content || "").toLowerCase();
  if (weekTitle.includes(query) || weekContent.includes(query)) return true;

  const videoArray = getWeekVideoArray(week);
  return videoArray.some((videoItem, videoIndex) => {
    const videoUrl = getVideoUrlFromItem(videoItem);
    if (!videoUrl) return false;
    const label = (typeof videoItem === "object" && String(videoItem?.title || "").trim()) ||
      (videoArray.length > 1
        ? `${week.title || `${weekIndex + 1}주차`} ${videoIndex + 1}교시`
        : (week.title || `${weekIndex + 1}주차`));
    return label.toLowerCase().includes(query);
  });
}

function buildVideoItemHtml({
  videoUrl,
  videoId,
  videoTitle,
  weekIndex,
  isWatched,
  videoInfo,
  indexLabel
}) {
  const typeLabel = videoInfo?.type === "youtube"
    ? "유튜브 영상"
    : videoInfo?.type === "youtubePlaylist"
      ? "유튜브 재생목록"
    : videoInfo?.type === "mp4"
      ? "동영상 파일"
      : "영상";

  return `
    <div class="video-item ${isWatched ? "completed" : ""}"
         data-video-id="${escapeHtml(videoId)}"
         data-video-url="${escapeHtml(videoUrl)}"
         data-video-title="${escapeHtml(videoTitle)}"
         data-week-index="${weekIndex}"
         role="button"
         tabindex="0"
         aria-label="${escapeHtml(videoTitle)}${isWatched ? ", 학습 완료" : ", 학습 전"}">
      <span class="video-index" aria-hidden="true">${escapeHtml(indexLabel)}</span>
      <div class="video-icon" aria-hidden="true">▶</div>
      <div class="video-info">
        <div class="video-name">${escapeHtml(videoTitle)}</div>
        <div class="video-meta" aria-hidden="true">${typeLabel}</div>
      </div>
      <div class="video-check ${isWatched ? "checked" : ""}" aria-label="${isWatched ? "학습 완료" : "학습 전"}" role="status">${isWatched ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' : ""}</div>
    </div>
  `;
}

// 주차 목록 렌더링
function renderWeeks() {
  const weeksList = document.getElementById('weeksList');
  if (!weeksList) {
    console.warn('[renderWeeks] weeksList가 없습니다.');
    return;
  }
  
  if (!courseData) {
    weeksList.innerHTML = renderListEmpty("강좌 데이터를 불러오는 중입니다.");
    return;
  }
  
  if (!courseId) {
    weeksList.innerHTML = renderListEmpty("강좌 ID가 없습니다.");
    return;
  }

  const previousCards = Array.from(weeksList.querySelectorAll(".week-card"));
  const expandedWeekIndexes = new Set(previousCards
    .filter((card) => card.classList.contains("expanded"))
    .map((card) => card.dataset.weekIndex));

  const allWeeks = courseData.weeks || [];
  const totalPlayable = countPlayableVideos(allWeeks);

  if (!searchQuery && totalPlayable === 0) {
    weeksList.innerHTML = renderListEmpty(
      LEARNING_STATE.NO_CONTENT.message,
      "관리자에게 문의하거나 잠시 후 다시 확인해 주세요."
    );
    return;
  }

  let weeks = [...allWeeks];
  
  if (searchQuery) {
    weeks = weeks.filter((week, index) => weekMatchesSearch(week, index, searchQuery));
  }

  weeks.sort((a, b) => {
    const indexA = allWeeks.findIndex((w) => w === a);
    const indexB = allWeeks.findIndex((w) => w === b);
    return indexA - indexB;
  });
  
  const html = weeks.map((week) => {
    // 주차 인덱스 추출
    const index = allWeeks.findIndex((w) => w === week);
    const weekId = week.id || `week_${index}`;
    const weekTitle = week.title || `${index + 1}주차`;
    const weekContent = week.description || week.content || '';
    
    // 주차 영상 배열 추출
    const videoArray = getWeekVideoArray(week);
    
    const { total, watched, allWatched } = getWeekWatchStats(week, index);
    
    let videosHTML = "";
    let visibleVideoCount = 0;

    videoArray.forEach((videoItem, videoIndex) => {
      const videoUrl = getVideoUrlFromItem(videoItem);
      if (!videoUrl) return;

      const videoTitle = (typeof videoItem === "object" && String(videoItem?.title || "").trim()) ||
        (videoArray.length > 1 ? `${weekTitle} ${videoIndex + 1}교시` : weekTitle);

      if (searchQuery && !videoTitle.toLowerCase().includes(searchQuery)) {
        const weekTitleMatch = weekTitle.toLowerCase().includes(searchQuery);
        const weekContentMatch = weekContent.toLowerCase().includes(searchQuery);
        if (!weekTitleMatch && !weekContentMatch) return;
      }

      visibleVideoCount += 1;
      const videoId = buildVideoId(weekId, videoIndex, videoItem);
      videosHTML += buildVideoItemHtml({
        videoUrl,
        videoId,
        videoTitle,
        weekIndex: index,
        isWatched: watchedVideos.has(videoId),
        videoInfo: normalizeVideoUrl(videoUrl),
        indexLabel: `${index + 1}-${videoIndex + 1}`
      });
    });

    if (searchQuery && visibleVideoCount === 0) return null;

    const progressPill = total > 0
      ? `<span class="week-progress-pill" aria-label="${total}강 중 ${watched}강 학습 완료">${watched}/${total}</span>`
      : "";

    const videosBlock = videosHTML || (
      searchQuery
        ? '<p class="week-videos-empty">검색 조건에 맞는 영상이 없습니다.</p>'
        : '<p class="week-videos-empty">이 주차에 등록된 영상이 없습니다.</p>'
    );

    return `
      <article class="week-card ${allWatched ? "watched" : ""}" data-week-index="${index}">
        <button type="button" class="week-header ${allWatched ? "watched" : ""}" onclick="toggleWeek(${index})" aria-expanded="false" aria-controls="weekContent_${index}">
          <div class="week-title-section">
            <span class="week-number ${allWatched ? "watched" : ""}">${index + 1}</span>
            <h3 class="week-title">${escapeHtml(weekTitle)}</h3>
            ${progressPill}
          </div>
          <span class="week-toggle-icon" aria-hidden="true">▾</span>
        </button>
        <div class="week-content" id="weekContent_${index}">
          ${weekContent ? `<div class="week-description">${escapeHtml(weekContent)}</div>` : ""}
          <div class="week-videos-list">${videosBlock}</div>
        </div>
      </article>
    `;
  }).filter(Boolean);

  if (!html.length) {
    weeksList.innerHTML = renderListEmpty(
      searchQuery ? LEARNING_STATE.SEARCH_EMPTY.message : LEARNING_STATE.NO_CONTENT.message
    );
    return;
  }

  weeksList.innerHTML = html.join("");

  const cards = Array.from(weeksList.querySelectorAll(".week-card"));
  cards.forEach((card, index) => {
    const expanded = previousCards.length
      ? expandedWeekIndexes.has(card.dataset.weekIndex)
      : index === 0;
    card.classList.toggle("expanded", expanded);
    card.querySelector(".week-header")?.setAttribute("aria-expanded", String(expanded));
  });
}

// 주차 토글 함수
window.toggleWeek = function(weekIndex) {
  const weekCard = document.querySelector(`.week-card[data-week-index="${weekIndex}"]`);
  if (!weekCard) return;
  weekCard.classList.toggle("expanded");
  const headerBtn = weekCard.querySelector(".week-header");
  if (headerBtn) {
    headerBtn.setAttribute("aria-expanded", weekCard.classList.contains("expanded") ? "true" : "false");
  }
};




// 강의 로드 함수
async function loadCourse() {
  // user 정보 초기화
  let currentUser = user;
  if (!currentUser || !currentUser.uid) {
    if (auth.currentUser) {
      currentUser = auth.currentUser;
      console.log('[loadCourse] user 정보 초기화:', currentUser.uid);
    } else {
      console.error('[loadCourse] user 정보 초기화 실패: auth.currentUser 없음');
      return;
    }
  }
  
  if (!courseId) {
    showLearningGate("NO_ID");
    return;
  }

  const weeksList = document.getElementById('weeksList');
  if (weeksList) {
    weeksList.setAttribute('aria-busy', 'true');
  }

  try {
    const courseDoc = await getDoc(doc(db, "courses", courseId));

    let catalogResult = { exists: false, data: {} };
    try {
      catalogResult = await getSettingDoc("courseCatalog");
    } catch (error) {
      console.warn("[student-course] courseCatalog settings unavailable, using defaults", error);
    }

    let coursesMenuResult = { exists: false, data: {} };
    try {
      coursesMenuResult = await getSettingDoc("coursesMenu");
    } catch (error) {
      console.warn("[student-course] coursesMenu settings unavailable, using defaults", error);
    }

    const subjectColorMap = await loadSharedSubjectColorMap(getSettingDoc);

    if (!courseDoc.exists()) {
      showLearningGate("NOT_FOUND");
      return;
    }

    const rawCourse = courseDoc.data() || {};
    const normalizedCourseId = String(courseId || "").trim();

    const labelMaps = createCourseLabelMaps(catalogResult?.exists ? catalogResult.data : {});
    const hiddenList = coursesMenuResult?.exists ? (coursesMenuResult.data?.hidden || []) : [];
    const hiddenCourseIds = new Set(Array.isArray(hiddenList) ? hiddenList : []);

    courseData = normalizeCourseForReadOnly(
      { id: courseDoc.id, ...rawCourse },
      { labelMaps, hiddenCourseIds }
    );

    if (!isStudentCourseAvailable(courseData)) {
      showLearningGate("NOT_AVAILABLE");
      return;
    }

    const accessType = normalizeAccessType(courseData.accessType);
    if (accessType === "public") {
      window.location.replace(`/course-detail?courseId=${encodeURIComponent(normalizedCourseId)}`);
      return;
    }

    const enrollmentsSnap = await getDocs(query(
      collection(db, "enrollments"),
      where("userId", "==", currentUser.uid),
      where("courseId", "==", normalizedCourseId)
    ));

    const enrollmentDoc = enrollmentsSnap.docs.find((docSnap) => isActiveEnrollment(docSnap.data() || {}));

    if (!enrollmentDoc) {
      console.warn("[student-course] enrollment not found for current user", {
        courseId: normalizedCourseId,
        userId: currentUser.uid
      });
      showLearningGate("NO_ENROLLMENT");
      return;
    }

    enrollmentData = { id: enrollmentDoc.id, ...enrollmentDoc.data() };
    if (accessType === "approvalRequired") {
      const protectedSnap = await getDoc(doc(db, "coursePrivateContent", normalizedCourseId));
      if (!protectedSnap.exists()) {
        showLearningGate("NOT_AVAILABLE");
        return;
      }
      const protectedData = protectedSnap.data() || {};
      courseData = {
        ...courseData,
        weeks: Array.isArray(protectedData.weeks) ? protectedData.weeks : [],
        curriculumWeeks: Array.isArray(protectedData.weeks) ? protectedData.weeks : []
      };
    }

    // 강의 ID 설정
    window.courseId = courseId;
    if (courseData.instructorId) {
      window.instructorId = courseData.instructorId;
    }
    
    // courseLoaded 이벤트 발생
    window.dispatchEvent(new CustomEvent('courseLoaded', {
      detail: { 
        courseId: courseId, 
        instructorId: courseData.instructorId || ""
      }
    }));

    // 수강신청 정보 초기화
    if (enrollmentData.watchedVideos && Array.isArray(enrollmentData.watchedVideos)) {
      watchedVideos = new Set(enrollmentData.watchedVideos);
    }

    // 강사 이름 조회
    let instructorName = courseData.instructorName || '';

    // 강의 제목 설정
    const courseSubject = document.getElementById('courseSubject');
    const courseTitle = document.getElementById('courseTitle');
    const courseInstructor = document.getElementById('courseInstructor');

    if (courseSubject) {
      const subjectLabel = courseData.subjectLabel || courseData.subject || '과목';
      courseSubject.textContent = subjectLabel;
      courseSubject.setAttribute('data-subject', subjectLabel);
      const subjectColorStyle = getSubjectColorStyle(subjectLabel, subjectColorMap);
      courseSubject.classList.toggle("has-subject-color", Boolean(subjectColorStyle));
      if (subjectColorStyle) courseSubject.style.cssText += subjectColorStyle;
    }
    
    if (courseTitle) {
      courseTitle.textContent = courseData.title || '제목 없음';
    }
    
    if (courseInstructor) {
      if (instructorName) {
        courseInstructor.textContent = instructorName;
        courseInstructor.style.display = 'inline-block';
      } else {
        courseInstructor.style.display = 'none';
      }
    }

    // 페이지 타이틀 설정
    document.title = `그릿에듀 | ${courseData.title || '강의 학습'}`;

    hideLearningGate();
    setupCourseUnenrollAction();

    // 주차 목록 렌더링
    renderWeeks();

    // 진도 업데이트
    await updateProgress();
    
    // 주차 목록 로딩 완료
    if (weeksList) {
      weeksList.setAttribute('aria-busy', 'false');
    }
  } catch (error) {
    const errorMessage = handleError(error, '강좌 로드', {
      showToast: true,
      logError: true
    });

    showLearningGate("NOT_FOUND", {
      title: "강좌를 불러올 수 없습니다",
      message: errorMessage
    });
  }
}

// 키보드 이벤트 설정
function setupKeyboardNavigation() {
  // Tab 키 이벤트 처리
  document.addEventListener('keydown', (e) => {
    // 영상 모달 처리
    const modal = document.getElementById('videoModal');
    if (modal && modal.style.display === 'flex') {
      if (e.key === 'Escape') {
        e.preventDefault();
        window.closeVideoModal();
      } else if (e.key === 'Tab') {
        const focusable = Array.from(modal.querySelectorAll('button:not([disabled]), a[href]:not([hidden])'));
        if (focusable.length) {
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
      return;
    }
    
    // Enter 키 또는 Space 키 이벤트 처리
    if (e.key === 'Enter' || e.key === ' ') {
      const focusedElement = document.activeElement;
      if (focusedElement.classList.contains('video-item')) {
        e.preventDefault();
        focusedElement.click();
      }
      // 주차 헤더 처리
      if (focusedElement.classList.contains('week-header')) {
        e.preventDefault();
        const weekCard = focusedElement.closest('.week-card');
        if (weekCard) {
          const weekIndex = parseInt(weekCard.getAttribute('data-week-index'));
          if (!isNaN(weekIndex)) {
            window.toggleWeek(weekIndex);
          }
        }
      }
    }
    
    // 주차 토글 처리
  });
  
  // DOMContentLoaded 이벤트 처리
  document.addEventListener('DOMContentLoaded', () => {
    // tabindex 초기화
    const observer = new MutationObserver(() => {
      document.querySelectorAll('.video-item').forEach(item => {
        if (!item.hasAttribute('tabindex')) {
          item.setAttribute('tabindex', '0');
          item.setAttribute('role', 'button');
          item.setAttribute('aria-label', item.querySelector('.video-name')?.textContent || '영상 재생');
        }
      });
      
      // 주차 헤더 초기화
      document.querySelectorAll('.week-header').forEach(header => {
        if (!header.hasAttribute('tabindex')) {
          header.setAttribute('tabindex', '0');
          header.setAttribute('role', 'button');
          const weekTitle = header.querySelector('.week-title')?.textContent || '';
          header.setAttribute('aria-label', `${weekTitle} 주차 열기/닫기`);
        }
      });
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

// 강의 로드 함수 실행
(async () => {
  // 역할 가드 처리
  try {
    await roleCheckPromise;
  } catch {
    return;
  }

  if (!user) {
    console.error('[student-course] user 정보 처리 실패');
    return;
  }
  
  initLearningPageShell();
  setupKeyboardNavigation();
  loadCourse();
})();
