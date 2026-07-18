// /assets/js/pages/student-course.js
// 학생 강의 학습 페이지
import { auth, db, requireRole } from "/assets/js/firebase-init.js";
import {
  doc, getDoc, updateDoc, serverTimestamp, collection, query, where, getDocs
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
let currentVideoId = null; // 현재 재생 중인 영상 ID

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
            `/course-detail.html?courseId=${encodeURIComponent(redirectId)}`
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

// YouTube URL에서 ID 추출
function extractYouTubeId(url) {
  if (!url) return null;
  
  // YouTube ID 패턴 (11자리)
  const youtubeIdPattern = /^[\w-]{11}$/;
  if (youtubeIdPattern.test(url.trim())) {
    return url.trim();
  }
  
  // URL 패턴 확인
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /youtube\.com\/watch\?.*v=([^&\n?#]+)/
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// 영상 URL 정규화
function normalizeVideoUrl(url) {
  if (!url) return null;
  
  const youtubeId = extractYouTubeId(url);
  if (youtubeId) {
    return {
      type: 'youtube',
      id: youtubeId,
      embedUrl: `https://www.youtube.com/embed/${youtubeId}`,
      watchUrl: `https://www.youtube.com/watch?v=${youtubeId}`
    };
  }
  
  // MP4 URL
  if (url.endsWith('.mp4') || url.includes('.mp4')) {
    return {
      type: 'mp4',
      url: url
    };
  }
  
  return null;
}

function getWeekVideoArray(week) {
  if (!week || typeof week !== "object") return [];

  // Canonical shape: week.videos[].url
  if (Array.isArray(week.videos) && week.videos.length > 0) {
    return week.videos
      .map((video) => (typeof video === "string" ? video : (video?.url || video?.fullUrl || video?.videoUrl || "")))
      .filter(Boolean);
  }

  // Compatibility shape: week.lessons[].url
  if (Array.isArray(week.lessons) && week.lessons.length > 0) {
    return week.lessons
      .map((lesson) => (typeof lesson === "string" ? lesson : (lesson?.url || lesson?.fullUrl || lesson?.videoUrl || "")))
      .filter(Boolean);
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

function buildVideoId(weekId, videoIndex) {
  return `${courseId}_week_${weekId}_video_${videoIndex}`;
}

function countPlayableVideos(weeks) {
  let count = 0;
  (weeks || []).forEach((week, index) => {
    const weekId = week?.id || `week_${index}`;
    getWeekVideoArray(week).forEach((videoItem, videoIndex) => {
      if (getVideoUrlFromItem(videoItem)) count += 1;
    });
  });
  return count;
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
    if (watchedVideos.has(buildVideoId(weekId, videoIndex))) watched += 1;
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
  const backWrap = page.querySelector(":scope > div");
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

// 진도 업데이트
async function updateProgress() {
  if (!courseData || !enrollmentData) return;

  const weeks = courseData.weeks || [];
  let totalVideos = 0;
  let watchedCount = 0;

  weeks.forEach((week, weekIndex) => {
    const videoArray = getWeekVideoArray(week);
    const weekId = week.id || `week_${weekIndex}`;
    
    videoArray.forEach((videoItem, videoIndex) => {
      const videoUrl = typeof videoItem === 'string' ? videoItem : (videoItem.url || videoItem.fullUrl || '');
      if (videoUrl) {
        totalVideos++;
        const videoId = `${courseId}_week_${weekId}_video_${videoIndex}`;
        if (watchedVideos.has(videoId)) {
          watchedCount++;
        }
      }
    });
  });

  const progress = totalVideos > 0 ? Math.round((watchedCount / totalVideos) * 100) : 0;

  // UI 업데이트
  const progressBar = document.getElementById('progressBar');
  const progressBarGlow = document.getElementById('progressBarGlow');
  const progressText = document.getElementById('progressText');
  
  if (progressBar) {
    // 애니메이션 지연 처리
    requestAnimationFrame(() => {
      progressBar.style.width = `${progress}%`;
      if (progressBarGlow) {
        progressBarGlow.style.width = `${progress}%`;
      }
    });
  }
  if (progressText) {
    // 현재 진도 애니메이션
    const currentProgress = parseInt(progressText.textContent) || 0;
    animateNumber(currentProgress, progress, progressText);
  }
  
  // 시청 횟수 업데이트
  const watchedCountEl = document.getElementById('watchedCount');
  const totalVideosEl = document.getElementById('totalVideos');
  const progressMessageEl = document.getElementById('progressMessage');
  
  if (watchedCountEl) {
    watchedCountEl.textContent = watchedCount;
  }
  if (totalVideosEl) {
    totalVideosEl.textContent = totalVideos;
  }
  
  // 진도 메시지 업데이트
  if (progressMessageEl) {
    if (progress >= 100) {
      progressMessageEl.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:4px;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>완료!';
      progressMessageEl.style.color = '#4caf50';
    } else if (progress >= 75) {
      progressMessageEl.textContent = '거의 다 왔어요!';
      progressMessageEl.style.color = 'var(--brand)';
    } else if (progress >= 50) {
      progressMessageEl.textContent = '절반 이상 완료!';
      progressMessageEl.style.color = 'var(--brand)';
    } else if (progress > 0) {
      progressMessageEl.textContent = '화이팅!';
      progressMessageEl.style.color = 'var(--muted)';
    } else {
      progressMessageEl.textContent = '';
    }
  }

  // Firestore 업데이트: 진도 저장 (updateProgress UI 업데이트)
}

// 클릭 시 영상 시청 완료 처리
async function markVideoAsWatchedOnClick(videoId, weekId) {
  if (!enrollmentData) {
    return false;
  }

  // 이미 시청한 영상인지 확인
  if (watchedVideos.has(videoId)) {
    return true;
  }

  // 영상 시청 완료 처리
  return await markVideoAsWatched(videoId, weekId);
}

// 영상 시청 완료 처리
async function markVideoAsWatched(videoId, weekId) {
  console.log("[markVideoAsWatched] 영상 시청 완료 - videoId:", videoId);
  
  if (!enrollmentData) {
    console.warn("[markVideoAsWatched] enrollmentData가 없습니다.");
    return false;
  }

  // 이미 시청한 영상인지 확인
  if (watchedVideos.has(videoId)) {
    console.log("[markVideoAsWatched] 이미 시청한 영상입니다:", videoId);
    return true;
  }

  watchedVideos.add(videoId);
  const watchedVideosArray = Array.from(watchedVideos);
  let totalVideos = 0;
  let watchedCount = 0;
  (courseData?.weeks || []).forEach((week, weekIndex) => {
    const videoArray = getWeekVideoArray(week);
    const weekId = week.id || `week_${weekIndex}`;
    videoArray.forEach((videoItem, videoIndex) => {
      const videoUrl = typeof videoItem === 'string' ? videoItem : (videoItem?.url || videoItem?.fullUrl || '');
      if (videoUrl) {
        totalVideos++;
        const vid = `${courseId}_week_${weekId}_video_${videoIndex}`;
        if (watchedVideos.has(vid)) watchedCount++;
      }
    });
  });
  const progress = totalVideos > 0 ? Math.round((watchedCount / totalVideos) * 100) : 0;

  try {
    await updateDoc(doc(db, "enrollments", enrollmentData.id), {
      watchedVideos: watchedVideosArray,
      progress: progress,
      updatedAt: serverTimestamp()
    });
    enrollmentData.watchedVideos = watchedVideosArray;
    enrollmentData.progress = progress;

    updateVideoItemUI(videoId);
    updateProgress();
    
    // 영상 시청 완료 알림
    if (window.toast && window.toast.success) {
      window.toast.success('영상 시청 완료되었습니다!', 2000);
    }
    
    console.log("[markVideoAsWatched] 완료!");
    return true;
  } catch (error) {
    console.error("[markVideoAsWatched] 영상 시청 완료 처리 중 오류:", error);
    console.error("[markVideoAsWatched] 오류 코드:", error.code);
    console.error("[markVideoAsWatched] 오류 메시지:", error.message);
    // 영상 시청 취소 처리
    watchedVideos.delete(videoId);
    return false;
  }
}

// 영상 아이템 UI 업데이트
function updateVideoItemUI(videoId) {
  const videoItem = document.querySelector(`[data-video-id="${videoId}"]`);
  if (videoItem) {
    const checkBox = videoItem.querySelector('.video-check');
    if (checkBox) {
      checkBox.classList.add('checked');
      checkBox.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    }
    videoItem.classList.add('completed');
  }
  
  // 주차 카드 상태 업데이트
  updateWeekCardStatus(videoId);
}

function updateWeekCardStatus(videoId) {
  if (!courseData) return;

  const videoItem = document.querySelector(`[data-video-id="${videoId}"]`);
  if (!videoItem) return;

  const weekIndex = Number.parseInt(videoItem.getAttribute("data-week-index"), 10);
  if (Number.isNaN(weekIndex)) return;

  const weeks = courseData.weeks || [];
  if (weekIndex >= weeks.length) return;

  const week = weeks[weekIndex];
  const { total, watched, allWatched } = getWeekWatchStats(week, weekIndex);

  const weekCard = document.querySelector(`.week-card[data-week-index="${weekIndex}"]`);
  if (!weekCard) return;

  const weekHeader = weekCard.querySelector(".week-header");
  const weekNumber = weekCard.querySelector(".week-number");
  const progressPill = weekCard.querySelector(".week-progress-pill");

  if (progressPill && total > 0) {
    progressPill.textContent = `${watched}/${total}`;
    progressPill.setAttribute("aria-label", `${watched}개 중 ${total}개 시청 완료`);
  }

  if (allWatched) {
    weekCard.classList.add("watched");
    weekHeader?.classList.add("watched");
    weekNumber?.classList.add("watched");
  } else {
    weekCard.classList.remove("watched");
    weekHeader?.classList.remove("watched");
    weekNumber?.classList.remove("watched");
  }
}

// 영상 모달 열기
window.openVideoModal = function(videoUrl, videoTitle, videoId, weekId) {
  if (!isStudentCourseAvailable(courseData)) {
    showLearningGate("NOT_AVAILABLE");
    return;
  }

  const modal = document.getElementById('videoModal');
  const modalTitle = document.getElementById('videoModalTitle');
  const videoPlayer = document.getElementById('videoPlayer');
  
  if (!modal || !videoPlayer) return;

  if (modalTitle) {
    modalTitle.textContent = videoTitle || '영상 재생';
  }

  const videoInfo = normalizeVideoUrl(videoUrl);
  
  if (!videoInfo) {
    videoPlayer.innerHTML = '<p class="muted">영상 URL이 올바르지 않습니다.</p>';
    modal.style.display = 'flex';
    return;
  }

  currentVideoId = videoId;
  let playerHTML = '';
  
  if (videoInfo.type === 'youtube') {
    // YouTube iframe (재생 시작 허용 및 API 활성화)
    playerHTML = `
      <div class="video-player-wrapper">
        <iframe 
          id="youtube-iframe-${videoId}"
          src="${videoInfo.embedUrl}?autoplay=1&enablejsapi=1" 
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
          allowfullscreen
          style="width:100%;height:100%;">
        </iframe>
      </div>
    `;
  } else if (videoInfo.type === 'mp4') {
    playerHTML = `
      <div class="video-player-wrapper">
        <video id="mp4-player-${videoId}" controls autoplay style="width:100%;height:100%;">
          <source src="${videoInfo.url}" type="video/mp4">
          브라우저가 비디오 태그를 지원하지 않습니다.
        </video>
      </div>
    `;
  }

  videoPlayer.innerHTML = playerHTML;
  modal.style.display = 'flex';
  
  // 스크롤 위치 저장 및 바디 고정
  const scrollY = window.scrollY || window.pageYOffset;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${scrollY}px`;
  document.body.style.width = '100%';
  document.body.classList.add('modal-open');
  
  // iOS Safari 모바일 호환성 처리
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
  } else {
    document.body.style.overflow = 'hidden';
  }

  // 영상 시청 완료 처리
  if (videoId && !watchedVideos.has(videoId)) {
    // 영상 시청 완료 처리
    setTimeout(async () => {
      await markVideoAsWatchedOnClick(videoId, weekId);
    }, 1000); // 1초 지연 후 처리
  }
};



// 영상 모달 닫기
window.closeVideoModal = function() {
  const modal = document.getElementById('videoModal');
  const videoPlayer = document.getElementById('videoPlayer');
  
  if (modal) {
    modal.style.display = 'none';
  }
  
  // 스크롤 위치 복원 및 바디 고정 해제
  document.body.classList.remove('modal-open');
  const scrollY = document.body.style.top;
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.width = '';
  document.body.style.overflow = '';
  document.documentElement.style.overflow = '';
  
  // 스크롤 위치 복원
  if (scrollY) {
    window.scrollTo(0, parseInt(scrollY || '0') * -1);
  }
  
  if (videoPlayer) {
    videoPlayer.innerHTML = '';
  }
  
  currentVideoId = null;
};

// 영상 모달 외부 클릭 시 닫기
document.addEventListener('click', (e) => {
  const modal = document.getElementById('videoModal');
  if (e.target === modal) {
    closeVideoModal();
  }
});

// 영상 아이템 키보드 이벤트 처리
window.handleVideoItemKeydown = function(e, videoUrl, videoTitle, videoId, weekId) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    openVideoModal(videoUrl, videoTitle, videoId, weekId);
  }
};

// 영상 모달 키보드 이벤트 처리
document.addEventListener('keydown', (e) => {
  // Esc: 영상 모달 닫기
  if (e.key === 'Escape') {
    const modal = document.getElementById('videoModal');
    if (modal && modal.style.display === 'flex') {
      closeVideoModal();
    }
  }
  
});

// 주차 검색 쿼리 처리
let searchQuery = '';

// 주차 검색 입력 이벤트 처리
const searchInput = document.getElementById('searchInput');
if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase().trim();
    renderWeeks();
  });
}

function weekMatchesSearch(week, weekIndex, query) {
  if (!query) return true;

  const weekTitle = (week.title || `${weekIndex + 1}주차`).toLowerCase();
  const weekContent = (week.description || week.content || "").toLowerCase();
  if (weekTitle.includes(query) || weekContent.includes(query)) return true;

  const videoArray = getWeekVideoArray(week);
  return videoArray.some((videoItem, videoIndex) => {
    const videoUrl = getVideoUrlFromItem(videoItem);
    if (!videoUrl) return false;
    const label = videoArray.length > 1
      ? `${week.title || `${weekIndex + 1}주차`} ${videoIndex + 1}교시`
      : (week.title || `${weekIndex + 1}주차`);
    return label.toLowerCase().includes(query);
  });
}

function buildVideoItemHtml({
  videoUrl,
  videoId,
  videoTitle,
  weekIndex,
  weekId,
  isWatched,
  videoInfo,
  indexLabel
}) {
  const typeLabel = videoInfo?.type === "youtube"
    ? "유튜브 영상"
    : videoInfo?.type === "mp4"
      ? "동영상 파일"
      : "영상";

  return `
    <div class="video-item ${isWatched ? "completed" : ""}"
         data-video-id="${videoId}"
         data-video-url="${escapeHtml(videoUrl)}"
         data-video-title="${escapeHtml(videoTitle)}"
         data-week-index="${weekIndex}"
         role="button"
         tabindex="0"
         aria-label="${escapeHtml(videoTitle)}${isWatched ? ", 시청 완료" : ", 미시청"}"
         onclick="openVideoModal('${escapeHtml(videoUrl)}', '${escapeHtml(videoTitle)}', '${videoId}', '${weekId}')"
         onkeydown="handleVideoItemKeydown(event, '${escapeHtml(videoUrl)}', '${escapeHtml(videoTitle)}', '${videoId}', '${weekId}')">
      <span class="video-index" aria-hidden="true">${escapeHtml(indexLabel)}</span>
      <div class="video-icon" aria-hidden="true">▶</div>
      <div class="video-info">
        <div class="video-name">${escapeHtml(videoTitle)}</div>
        <div class="video-meta" aria-hidden="true">${typeLabel}</div>
      </div>
      <div class="video-check ${isWatched ? "checked" : ""}" aria-label="${isWatched ? "시청 완료" : "미시청"}" role="status">${isWatched ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' : ""}</div>
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
  
  const html = weeks.map((week, originalIndex) => {
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

      const videoTitle = videoArray.length > 1
        ? `${weekTitle} ${videoIndex + 1}교시`
        : weekTitle;

      if (searchQuery && !videoTitle.toLowerCase().includes(searchQuery)) {
        const weekTitleMatch = weekTitle.toLowerCase().includes(searchQuery);
        const weekContentMatch = weekContent.toLowerCase().includes(searchQuery);
        if (!weekTitleMatch && !weekContentMatch) return;
      }

      visibleVideoCount += 1;
      const videoId = buildVideoId(weekId, videoIndex);
      videosHTML += buildVideoItemHtml({
        videoUrl,
        videoId,
        videoTitle,
        weekIndex: index,
        weekId,
        isWatched: watchedVideos.has(videoId),
        videoInfo: normalizeVideoUrl(videoUrl),
        indexLabel: `${index + 1}-${videoIndex + 1}`
      });
    });

    if (searchQuery && visibleVideoCount === 0) return null;

    const progressPill = total > 0
      ? `<span class="week-progress-pill" aria-label="${watched}개 중 ${total}개 시청 완료">${watched}/${total}</span>`
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

  const firstCard = weeksList.querySelector(".week-card");
  if (firstCard) {
    firstCard.classList.add("expanded");
    const headerBtn = firstCard.querySelector(".week-header");
    if (headerBtn) headerBtn.setAttribute("aria-expanded", "true");
  }
}

// 숫자 애니메이션 함수
function animateNumber(from, to, element, duration = 600) {
  // requestAnimationFrame fallback
  const raf = window.requestAnimationFrame || 
               window.webkitRequestAnimationFrame || 
               window.mozRequestAnimationFrame || 
               window.msRequestAnimationFrame ||
               function(callback) { return setTimeout(callback, 16); };
  
  const startTime = (window.performance && window.performance.now) ? 
                    window.performance.now() : Date.now();
  const difference = to - from;
  
  function update(currentTime) {
    const now = (window.performance && window.performance.now) ? 
                window.performance.now() : Date.now();
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    
    // easing 함수 (ease-out)
    const easeOut = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(from + difference * easeOut);
    
    if (element && element.textContent !== undefined) {
      element.textContent = `${current}%`;
    }
    
    if (progress < 1) {
      raf(update);
    } else {
      if (element && element.textContent !== undefined) {
        element.textContent = `${to}%`;
      }
    }
  }
  
  raf(update);
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
      window.location.replace(`/course-detail.html?courseId=${encodeURIComponent(normalizedCourseId)}`);
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
    if (modal && modal.style.display !== 'none') {
      // ESC 키 이벤트 처리
      if (e.key === 'Escape') {
        closeVideoModal();
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
            toggleWeek(weekIndex);
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
