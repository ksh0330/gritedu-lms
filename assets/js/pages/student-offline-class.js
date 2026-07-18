// /assets/js/pages/student-offline-class.js
import { auth, db, requireRole } from "/assets/js/firebase-init.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { escapeHtml } from "/assets/js/utils/html.js";

const $ = (sel, root = document) => root.querySelector(sel);

const SCHEDULE_DAYS = [
  { id: "mon", label: "월" },
  { id: "tue", label: "화" },
  { id: "wed", label: "수" },
  { id: "thu", label: "목" },
  { id: "fri", label: "금" },
  { id: "sat", label: "토" },
  { id: "sun", label: "일" }
];
const DAY_ORDER = SCHEDULE_DAYS.map((d) => d.id);

function getClassIdFromUrl() {
  try {
    return new URLSearchParams(window.location.search).get("classId")?.trim() || "";
  } catch {
    return "";
  }
}

function formatTimeDisplay(value) {
  const t = String(value || "").trim();
  if (!t) return "";
  return t.length >= 5 ? t.slice(0, 5) : t;
}

function normalizeScheduleItems(classRow) {
  if (Array.isArray(classRow?.scheduleItems) && classRow.scheduleItems.length) {
    return classRow.scheduleItems
      .map((item) => ({
        day: String(item?.day || "").trim(),
        startTime: formatTimeDisplay(item?.startTime),
        endTime: formatTimeDisplay(item?.endTime),
        room: String(item?.room || "").trim()
      }))
      .filter((item) => item.day);
  }
  const days = Array.isArray(classRow?.scheduleDays) ? classRow.scheduleDays : [];
  if (!days.length) return [];
  const start = formatTimeDisplay(classRow?.startTime);
  const end = formatTimeDisplay(classRow?.endTime);
  const room = String(classRow?.room || "").trim();
  return days.map((day) => ({ day, startTime: start, endTime: end, room }));
}

function formatScheduleLine(item) {
  const dayLabel = SCHEDULE_DAYS.find((d) => d.id === item.day)?.label || item.day;
  const timePart =
    item.startTime && item.endTime
      ? `${item.startTime}–${item.endTime}`
      : item.startTime || item.endTime || "";
  const parts = [dayLabel, timePart, item.room].filter(Boolean);
  return parts.join(" ");
}

function formatSchedule(classRow) {
  const items = normalizeScheduleItems(classRow)
    .slice()
    .sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day));
  if (!items.length) return "-";
  return items.map((item) => formatScheduleLine(item)).join(" / ");
}

function formatScheduleHtml(classRow) {
  const items = normalizeScheduleItems(classRow)
    .slice()
    .sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day));
  if (!items.length) return "-";
  return items.map((item) => escapeHtml(formatScheduleLine(item))).join("<br>");
}

function formatSchoolGrade(classRow) {
  const school = String(classRow?.school || "").trim();
  const grade = String(classRow?.grade || "").trim();
  if (school && grade) return `${school} / ${grade}`;
  return school || grade || "-";
}

function isScheduleVisible(classRow) {
  return classRow?.scheduleVisible !== false;
}

function formatSessionDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "-";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-");
    return `${y}. ${Number(m)}. ${Number(d)}.`;
  }
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return raw;
  return new Date(t).toLocaleDateString("ko-KR");
}

function toDateOnlyMs(value) {
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    const raw = value.trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    }
    const parsed = Date.parse(raw);
    if (Number.isNaN(parsed)) return null;
    const d = new Date(parsed);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  }
  if (typeof value?.toDate === "function") {
    const d = value.toDate();
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  }
  if (typeof value?.seconds === "number") {
    const d = new Date(value.seconds * 1000);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  }
  return null;
}

function isSessionOnOrAfterJoinDate(sessionDate, joinedAt) {
  const sessionMs = toDateOnlyMs(sessionDate);
  const joinedMs = toDateOnlyMs(joinedAt);
  if (sessionMs == null || joinedMs == null) return false;
  return sessionMs >= joinedMs;
}

function parseSessionDateValue(value) {
  const ms = toDateOnlyMs(value);
  return ms == null ? 0 : ms;
}

function normalizeVideoEntry(entry) {
  if (entry == null) return null;
  if (typeof entry === "string") {
    const url = entry.trim();
    return url ? { title: "", url } : null;
  }
  if (typeof entry === "object") {
    const url = String(
      entry.url || entry.videoUrl || entry.href || entry.link || ""
    ).trim();
    const title = String(entry.title || entry.name || "").trim();
    return url ? { title, url } : null;
  }
  return null;
}

function isValidVideoUrl(url) {
  const s = String(url || "").trim();
  if (!s) return false;
  try {
    const parsed = new URL(s);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function getSessionVideos(session) {
  const out = [];
  if (Array.isArray(session?.videos)) {
    session.videos.forEach((entry) => {
      const normalized = normalizeVideoEntry(entry);
      if (normalized) out.push(normalized);
    });
  } else if (session?.videos && typeof session.videos === "object") {
    Object.values(session.videos).forEach((entry) => {
      const normalized = normalizeVideoEntry(entry);
      if (normalized) out.push(normalized);
    });
  }
  if (!out.length) {
    const legacyUrl = String(session?.videoUrl || "").trim();
    if (legacyUrl) out.push({ title: "", url: legacyUrl });
  }
  return out;
}

function getSessionPlayableVideos(session) {
  if (session?.hasVideo !== true) return [];
  return getSessionVideos(session).filter((video) => isValidVideoUrl(video.url));
}

function getSessionSkipReason(session, classId) {
  if (!session) return "session-missing";
  if (String(session.classId || "").trim() !== classId) return "session-class-mismatch";
  if (session.status !== "published") return "session-not-published";
  return null;
}

function isSessionVisibleForStudent(session, membership, accessBySessionId) {
  if (membership?.status === "removed") return false;
  const sessionId = String(session?.id || "").trim();
  const access = sessionId ? accessBySessionId.get(sessionId) : null;
  if (access?.status === "revoked") return false;
  if (access?.status === "active") return true;
  return isSessionOnOrAfterJoinDate(session?.sessionDate, membership?.joinedAt);
}

const SESSIONS_PAGE_SIZE = 5;
/** @type {Array<Record<string, unknown>>} */
let allAccessibleSessions = [];
let sessionCurrentPage = 1;
let expandedSessionId = null;
let sessionsUiBound = false;
let expandFirstOnNextRender = true;

function logFirebaseLoadError(label, err, context = {}) {
  console.warn(`[offline-class] ${label}`, {
    code: typeof err?.code === "string" ? err.code : "",
    message: typeof err?.message === "string" ? err.message : "",
    operation: context.operation || "",
    classId: context.classId || "",
    uid: context.uid || ""
  });
}

function tagLoadError(err, operation) {
  if (err && typeof err === "object") {
    err.offlineClassOperation = operation;
  }
  return err;
}

function sortSessions(sessions) {
  return sessions.slice().sort((a, b) => {
    const dateDiff =
      parseSessionDateValue(b.sessionDate) - parseSessionDateValue(a.sessionDate);
    if (dateDiff !== 0) return dateDiff;
    return (Number(b.sessionNo) || 0) - (Number(a.sessionNo) || 0);
  });
}

function renderBlockedMessage(title, message, extraHtml = "") {
  const head = $("#offlineClassHead");
  const sessionsSection = $("#offlineSessionsSection");
  if (sessionsSection) sessionsSection.hidden = true;
  if (!head) return;
  head.innerHTML = `
    <div class="student-offline-blocked">
      <h1 class="page-title">${escapeHtml(title)}</h1>
      <p class="home-subdesc">${escapeHtml(message)}</p>
      ${extraHtml}
      <a class="btn sm" href="/members/students/dashboard.html">내 강의실로 돌아가기</a>
    </div>`;
}

function renderClassHeader(classRow) {
  const head = $("#offlineClassHead");
  if (!head) return;
  const isArchived = classRow.status === "archived";
  const archivedNotice = isArchived
    ? '<p class="student-offline-archived-notice" role="status">이 반은 보관 상태입니다. 기존에 허용된 수업별 영상만 조회할 수 있습니다.</p>'
    : "";
  const scheduleHtml = isScheduleVisible(classRow)
    ? `
      <p class="student-offline-class-meta student-offline-class-meta--schedule"><span class="student-offline-class-meta__label">시간표</span></p>
      <p class="student-offline-class-meta student-offline-class-meta--schedule-lines">${formatScheduleHtml(classRow)}</p>`
    : "";
  head.innerHTML = `
    <div class="student-offline-class-info">
      <p class="student-offline-class-label course-label" data-subject="${escapeHtml(String(classRow.subject || "과목").trim())}">${escapeHtml(classRow.subject || "과목")}</p>
      <h1 class="page-title">${escapeHtml(classRow.className || "오프라인 반")}</h1>
      <p class="home-subdesc">${escapeHtml(formatSchoolGrade(classRow))}</p>
      <p class="student-offline-class-meta">담당: ${escapeHtml(classRow.instructorName || "미배정")}</p>
      ${scheduleHtml}
      ${archivedNotice}
    </div>`;
}

function ensureExpandedSession(pageSessions) {
  const ids = pageSessions.map((s) => s.id);
  if (expandFirstOnNextRender && pageSessions.length) {
    expandedSessionId = pageSessions[0].id;
    expandFirstOnNextRender = false;
    return;
  }
  if (expandedSessionId && !ids.includes(expandedSessionId)) {
    expandedSessionId = pageSessions[0]?.id || null;
  }
}

function renderSessionPagination(totalItems, totalPages) {
  const nav = $("#offlineSessionsPagination");
  if (!nav) return;
  if (totalPages <= 1) {
    nav.hidden = true;
    nav.innerHTML = "";
    return;
  }
  nav.hidden = false;
  const prevDisabled = sessionCurrentPage <= 1 ? " disabled" : "";
  const nextDisabled = sessionCurrentPage >= totalPages ? " disabled" : "";
  nav.innerHTML = `
    <button type="button" class="btn sm" data-session-page="prev"${prevDisabled} aria-label="이전 페이지">이전</button>
    <span class="student-offline-sessions-pagination__info">${sessionCurrentPage} / ${totalPages} 페이지</span>
    <button type="button" class="btn sm" data-session-page="next"${nextDisabled} aria-label="다음 페이지">다음</button>`;
}

function renderSessionsView() {
  const list = $("#offlineSessionsList");
  const section = $("#offlineSessionsSection");
  const meta = $("#offlineSessionsMeta");
  if (!list || !section) return;

  section.hidden = false;

  if (!allAccessibleSessions.length) {
    if (meta) meta.textContent = "";
    renderSessionPagination(0, 0);
    list.innerHTML =
      '<p class="student-offline-sessions-empty">현재 표시할 수업이 없습니다.</p>';
    return;
  }

  const total = allAccessibleSessions.length;
  const totalPages = Math.max(1, Math.ceil(total / SESSIONS_PAGE_SIZE));
  if (sessionCurrentPage > totalPages) sessionCurrentPage = totalPages;
  if (sessionCurrentPage < 1) sessionCurrentPage = 1;

  const start = (sessionCurrentPage - 1) * SESSIONS_PAGE_SIZE;
  const pageSessions = allAccessibleSessions.slice(start, start + SESSIONS_PAGE_SIZE);
  ensureExpandedSession(pageSessions);

  if (meta) meta.textContent = `총 ${total}개 수업`;
  renderSessionPagination(total, totalPages);

  list.innerHTML = pageSessions
    .map((session) => {
      const videos = getSessionPlayableVideos(session);
      const isOpen = session.id === expandedSessionId;
      const hasPlayableVideo = videos.length > 0;
      const videoCountLabel = hasPlayableVideo
        ? videos.length === 1 ? "영상 1개" : `영상 ${videos.length}개`
        : "영상 없음";
      const videoItems = videos
        .map((v) => {
          const label = escapeHtml(v.title || "영상");
          const url = escapeHtml(v.url);
          return `<li><a href="${url}" target="_blank" rel="noopener noreferrer" class="student-offline-video-link"><span class="student-offline-video-link__title">${label}</span><span class="student-offline-video-link__go" aria-hidden="true">↗</span></a></li>`;
        })
        .join("");
      const desc = String(session.description || "").trim();
      const descHtml = desc
        ? `<p class="student-offline-session-desc">${escapeHtml(desc)}</p>`
        : "";
      const videoContentHtml = hasPlayableVideo
        ? `<ul class="student-offline-video-list">${videoItems}</ul>`
        : '<p class="student-offline-session-desc">이 수업은 등록된 영상이 없습니다.</p>';
      const panelId = `session-panel-${escapeHtml(session.id)}`;
      return `
      <article class="student-offline-session-card${isOpen ? " is-open" : ""}">
        <button type="button" class="student-offline-session-toggle" data-session-toggle="${escapeHtml(session.id)}" aria-expanded="${isOpen ? "true" : "false"}" aria-controls="${panelId}">
          <span class="student-offline-session-toggle__row">
            <span class="student-offline-session-no">${escapeHtml(String(session.sessionNo ?? "-"))}수업</span>
            <span class="student-offline-session-date">${escapeHtml(formatSessionDate(session.sessionDate))}</span>
            <span class="student-offline-session-title">${escapeHtml(session.title || "제목 없음")}</span>
          </span>
          <span class="student-offline-session-toggle__end">
            <span class="student-offline-session-video-count">${escapeHtml(videoCountLabel)}</span>
            <span class="student-offline-session-toggle__icon" aria-hidden="true"></span>
          </span>
        </button>
        <div id="${panelId}" class="student-offline-session-panel"${isOpen ? "" : " hidden"}>
          ${descHtml}
          ${videoContentHtml}
        </div>
      </article>`;
    })
    .join("");
}

function setAccessibleSessions(sessions) {
  allAccessibleSessions = sortSessions(sessions);
  sessionCurrentPage = 1;
  expandedSessionId = null;
  expandFirstOnNextRender = true;
  renderSessionsView();
  bindSessionsUi();
}

function bindSessionsUi() {
  if (sessionsUiBound) return;
  sessionsUiBound = true;

  $("#offlineSessionsList")?.addEventListener("click", (e) => {
    const toggle = e.target.closest("[data-session-toggle]");
    if (!toggle) return;
    const sessionId = toggle.dataset.sessionToggle || "";
    if (!sessionId) return;
    expandedSessionId = expandedSessionId === sessionId ? null : sessionId;
    expandFirstOnNextRender = false;
    renderSessionsView();
  });

  $("#offlineSessionsPagination")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-session-page]");
    if (!btn || btn.disabled) return;
    const action = btn.dataset.sessionPage;
    const totalPages = Math.max(1, Math.ceil(allAccessibleSessions.length / SESSIONS_PAGE_SIZE));
    if (action === "prev" && sessionCurrentPage > 1) sessionCurrentPage -= 1;
    if (action === "next" && sessionCurrentPage < totalPages) sessionCurrentPage += 1;
    expandFirstOnNextRender = true;
    renderSessionsView();
  });
}

function renderSessions(sessions) {
  setAccessibleSessions(sessions);
}

async function loadMembership(classId, studentUid) {
  try {
    const snap = await getDocs(
      query(collection(db, "offlineClassMembers"), where("studentUid", "==", studentUid))
    );
    const row = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .find((member) => String(member.classId || "").trim() === classId);
    return row || null;
  } catch (err) {
    logFirebaseLoadError("membership query failed", err, {
      operation: "membership query",
      classId,
      uid: studentUid
    });
    throw tagLoadError(err, "membership query");
  }
}

async function loadAccessibleSessions(classId, studentUid, membership) {
  let accessSnap;
  try {
    accessSnap = await getDocs(
      query(collection(db, "offlineSessionAccess"), where("studentUid", "==", studentUid))
    );
  } catch (err) {
    logFirebaseLoadError("session access query failed", err, {
      operation: "manual access query",
      classId,
      uid: studentUid
    });
    throw tagLoadError(err, "manual access query");
  }

  let sessionsSnap;
  try {
    sessionsSnap = await getDocs(
      query(
        collection(db, "offlineClassSessions"),
        where("classId", "==", classId),
        where("status", "==", "published")
      )
    );
  } catch (err) {
    logFirebaseLoadError("sessions query failed", err, {
      operation: "sessions query",
      classId,
      uid: studentUid
    });
    throw tagLoadError(err, "sessions query");
  }

  const accessBySessionId = new Map();
  accessSnap.docs.forEach((d) => {
    const data = d.data() || {};
    if (String(data.classId || "").trim() !== classId) return;
    const sessionId = String(data.sessionId || "").trim();
    if (sessionId) accessBySessionId.set(sessionId, { id: d.id, ...data });
  });
  const sessions = sessionsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const visible = [];
  for (const session of sessions) {
    const skipReason = getSessionSkipReason(session, classId);
    const visibleByPolicy = isSessionVisibleForStudent(session, membership, accessBySessionId);

    if (skipReason || !visibleByPolicy) continue;
    visible.push(session);
  }

  return sortSessions(visible);
}

async function init() {
  let user;
  try {
    const result = await requireRole("student", "/members/login.html");
    user = result.user;
  } catch (err) {
    console.warn("[student-offline-class] auth failed", err);
    return;
  }

  const urlClassId = getClassIdFromUrl();
  const studentUid = user?.uid || auth.currentUser?.uid || "";

  if (!urlClassId) {
    renderBlockedMessage("오프라인 반", "배정된 반이 아닙니다.");
    return;
  }
  if (!studentUid) {
    renderBlockedMessage("오프라인 반", "로그인이 필요합니다.");
    return;
  }

  try {
    const membership = await loadMembership(urlClassId, studentUid);
    if (!membership) {
      renderBlockedMessage("오프라인 반", "이 반에 배정된 학생만 볼 수 있습니다.");
      return;
    }

    const membershipClassId = String(membership.classId || "").trim();

    if (membership.status !== "active") {
      renderBlockedMessage("이용할 수 없는 반", "현재 이용할 수 없는 반입니다.");
      return;
    }

    if (membershipClassId !== urlClassId) {
      const fixHref = `/members/students/offline-class.html?classId=${encodeURIComponent(membershipClassId)}`;
      renderBlockedMessage(
        "오프라인 반",
        "반 정보가 일치하지 않습니다.",
        `<p class="home-subdesc">URL classId: <code>${escapeHtml(urlClassId)}</code><br>등록 classId: <code>${escapeHtml(membershipClassId)}</code></p>
         <p><a class="btn sm primary" href="${fixHref}">올바른 반 페이지로 이동</a></p>`
      );
      return;
    }

    const classId = membershipClassId;
    let classSnap;
    try {
      classSnap = await getDoc(doc(db, "offlineClasses", classId));
    } catch (err) {
      logFirebaseLoadError("class read failed", err, {
        operation: "class read",
        classId,
        uid: studentUid
      });
      throw tagLoadError(err, "class read");
    }
    if (!classSnap.exists()) {
      renderBlockedMessage("이용할 수 없는 반", "현재 이용할 수 없는 반입니다.");
      return;
    }

    const classRow = { id: classSnap.id, ...classSnap.data() };
    if (classRow.status === "archived") {
      renderBlockedMessage("이용할 수 없는 반", "현재 이용할 수 없는 반입니다.");
      return;
    }
    renderClassHeader(classRow);

    const sessions = await loadAccessibleSessions(classId, studentUid, membership);
    renderSessions(sessions);
  } catch (err) {
    logFirebaseLoadError("load failed", err, {
      operation: err?.offlineClassOperation || "load",
      classId: urlClassId,
      uid: studentUid
    });
    renderBlockedMessage(
      "오프라인 반",
      "정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."
    );
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => init(), { once: true });
} else {
  init();
}
