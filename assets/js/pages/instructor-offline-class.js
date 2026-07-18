// /assets/js/pages/instructor-offline-class.js
import { db, requireRole } from "/assets/js/firebase-init.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { escapeHtml } from "/assets/js/utils/html.js";
import { handleError } from "/assets/js/utils/error-handler.js";
import { formatGrade } from "/assets/js/utils/grade.js";
import {
  formatScheduleHtml,
  isScheduleVisible,
  isAssignedToCurrentInstructor
} from "/assets/js/pages/instructor-dashboard/offline-classes.js";
import {
  state,
  PAGE_SIZE,
  renderListPagination
} from "/assets/js/pages/instructor-dashboard/context.js";

const $ = (sel, root = document) => root.querySelector(sel);

const SESSIONS_PAGE_SIZE = 5;

let instructorProfileId = "";
let allMembers = [];
let membersPage = 1;
/** @type {Array<Record<string, unknown>>} */
let allSessions = [];
let sessionCurrentPage = 1;
let expandedSessionId = null;
let sessionsUiBound = false;
let expandFirstOnNextRender = true;

function getClassIdFromUrl() {
  try {
    return new URLSearchParams(window.location.search).get("classId")?.trim() || "";
  } catch {
    return "";
  }
}

function formatSchoolGrade(classRow) {
  const school = String(classRow?.school || "").trim();
  const grade = formatDisplayGrade(classRow?.grade);
  const hasGrade = grade && grade !== "-";
  if (school && hasGrade) return `${school} / ${grade}`;
  return school || (hasGrade ? grade : "-");
}

function formatDisplayGrade(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "-";
  const label = formatGrade(raw);
  return label === "-" ? raw : label;
}

function classStatusLabel(status) {
  if (status === "archived") return "보관";
  return "운영중";
}

function sessionStatusLabel(status) {
  if (status === "published") return "게시";
  if (status === "archived") return "보관";
  return "레거시";
}

function sessionStatusClass(status) {
  if (status === "published") return "instructor-offline-session-status--published";
  if (status === "archived") return "instructor-offline-session-status--archived";
  return "instructor-offline-session-status--legacy";
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

function formatJoinedAtDisplay(joinedAt) {
  const ms = toDateOnlyMs(joinedAt);
  if (ms == null) return "-";
  return new Date(ms).toLocaleDateString("ko-KR");
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

function getPlayableVideos(session) {
  return getSessionVideos(session).filter((v) => v.url);
}

function sortSessions(sessions) {
  return sessions.slice().sort((a, b) => {
    const dateDiff =
      parseSessionDateValue(b.sessionDate) - parseSessionDateValue(a.sessionDate);
    if (dateDiff !== 0) return dateDiff;
    return (Number(b.sessionNo) || 0) - (Number(a.sessionNo) || 0);
  });
}

function isVisibleMember(member) {
  const status = String(member?.status || "active").trim();
  return status !== "removed";
}

function memberDisplayFields(member) {
  return {
    name:
      String(member.studentNameSnapshot || member.name || member.studentName || "").trim() ||
      "이름 미등록",
    school: String(member.schoolSnapshot || member.school || "").trim() || "-",
    grade: formatDisplayGrade(member.gradeSnapshot || member.grade),
    phone: String(member.phoneSnapshot || member.phone || "").trim() || "-"
  };
}

function renderBlockedMessage(title, message) {
  const head = $("#offlineClassHead");
  const membersSection = $("#offlineMembersSection");
  const sessionsSection = $("#offlineSessionsSection");
  const accessNote = $("#offlineAccessNote");
  if (membersSection) membersSection.hidden = true;
  if (sessionsSection) sessionsSection.hidden = true;
  if (accessNote) accessNote.hidden = true;
  if (!head) return;
  head.innerHTML = `
    <div class="instructor-offline-blocked">
      <h1 class="page-title">${escapeHtml(title)}</h1>
      <p class="home-subdesc">${escapeHtml(message)}</p>
      <a class="btn sm" href="/members/instructors/dashboard.html">강사 LMS로 돌아가기</a>
    </div>`;
}

function renderClassHeader(classRow) {
  const head = $("#offlineClassHead");
  if (!head) return;
  const description = String(classRow.description || "").trim();
  const descHtml = description
    ? `<p class="instructor-offline-class-desc">${escapeHtml(description)}</p>`
    : "";
  const scheduleRow = isScheduleVisible(classRow)
    ? `<div><dt>시간표</dt><dd>${formatScheduleHtml(classRow)}</dd></div>`
    : "";
  head.innerHTML = `
    <div class="instructor-offline-class-summary">
      <p class="course-label instructor-offline-class-label" data-subject="${escapeHtml(String(classRow.subject || "과목").trim())}">${escapeHtml(classRow.subject || "과목")}</p>
      <h1 class="page-title">${escapeHtml(classRow.className || "오프라인 반")}</h1>
      <dl class="instructor-offline-class-dl">
        <div><dt>학교/학년</dt><dd>${escapeHtml(formatSchoolGrade(classRow))}</dd></div>
        <div><dt>담당 강사</dt><dd>${escapeHtml(classRow.instructorName || "미배정")}</dd></div>
        ${scheduleRow}
        <div><dt>상태</dt><dd>${escapeHtml(classStatusLabel(classRow.status))}</dd></div>
      </dl>
      ${descHtml}
    </div>`;
}

function setMembersData(members) {
  allMembers = members
    .filter(isVisibleMember)
    .sort((a, b) =>
      memberDisplayFields(a).name.localeCompare(memberDisplayFields(b).name, "ko")
    );
  membersPage = 1;
  renderMembersView();
}

function renderMembersView() {
  const section = $("#offlineMembersSection");
  const tbody = $("#offlineMembersTable tbody");
  const meta = $("#offlineMembersMeta");
  const pagination = $("#offlineMembersPagination");
  if (!section || !tbody) return;

  section.hidden = false;
  const total = allMembers.length;

  if (meta) meta.textContent = `배정 학생 ${total}명`;

  if (!total) {
    tbody.innerHTML =
      '<tr><td colspan="5" class="muted instructor-table-empty">배정된 학생이 없습니다.</td></tr>';
    if (pagination) {
      pagination.innerHTML = "";
      pagination.onclick = null;
    }
    return;
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (membersPage > totalPages) membersPage = totalPages;

  const start = (membersPage - 1) * PAGE_SIZE;
  const pageRows = allMembers.slice(start, start + PAGE_SIZE);

  tbody.innerHTML = pageRows
    .map((member) => {
      const fields = memberDisplayFields(member);
      return `
      <tr>
        <td>${escapeHtml(fields.name)}</td>
        <td>${escapeHtml(fields.school)}</td>
        <td>${escapeHtml(fields.grade)}</td>
        <td>${escapeHtml(fields.phone)}</td>
        <td>${escapeHtml(formatJoinedAtDisplay(member.joinedAt))}</td>
      </tr>`;
    })
    .join("");

  membersPage = renderListPagination(pagination, {
    page: membersPage,
    totalItems: total,
    dataAttr: "offline-member-p",
    onPageChange: (nextPage) => {
      membersPage = nextPage;
      renderMembersView();
      pagination?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }) || membersPage;
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
    <span class="instructor-offline-sessions-pagination__info">${sessionCurrentPage} / ${totalPages} 페이지</span>
    <button type="button" class="btn sm" data-session-page="next"${nextDisabled} aria-label="다음 페이지">다음</button>`;
}

function setSessionsData(sessions) {
  allSessions = sortSessions(sessions);
  sessionCurrentPage = 1;
  expandedSessionId = null;
  expandFirstOnNextRender = true;
  renderSessionsView();
}

function renderSessionsView() {
  const section = $("#offlineSessionsSection");
  const list = $("#offlineSessionsList");
  const meta = $("#offlineSessionsMeta");
  const accessNote = $("#offlineAccessNote");
  if (!section || !list) return;

  section.hidden = false;
  if (accessNote) accessNote.hidden = false;

  const total = allSessions.length;
  if (meta) meta.textContent = `총 ${total}개 수업`;

  if (!total) {
    renderSessionPagination(0, 0);
    list.innerHTML =
      '<p class="instructor-offline-sessions-empty muted">등록된 수업이 없습니다.</p>';
    return;
  }

  const totalPages = Math.max(1, Math.ceil(total / SESSIONS_PAGE_SIZE));
  if (sessionCurrentPage > totalPages) sessionCurrentPage = totalPages;
  if (sessionCurrentPage < 1) sessionCurrentPage = 1;

  const start = (sessionCurrentPage - 1) * SESSIONS_PAGE_SIZE;
  const pageSessions = allSessions.slice(start, start + SESSIONS_PAGE_SIZE);
  ensureExpandedSession(pageSessions);
  renderSessionPagination(total, totalPages);

  list.innerHTML = pageSessions
    .map((session) => {
      const videos = getPlayableVideos(session);
      const noVideo = session?.hasVideo === false || videos.length === 0;
      const isOpen = session.id === expandedSessionId;
      const status = sessionStatusLabel(session.status);
      const statusClass = sessionStatusClass(session.status);
      const videoCountLabel = noVideo
        ? "영상 없음"
        : videos.length === 1
          ? "영상 1개"
          : `영상 ${videos.length}개`;
      const videoItems = noVideo
        ? '<p class="muted instructor-offline-no-videos">영상 없음</p>'
        : `<ul class="instructor-offline-video-list">${videos
            .map((v) => {
              const label = escapeHtml(v.title || "영상");
              const url = escapeHtml(v.url);
              return `<li><a href="${url}" target="_blank" rel="noopener noreferrer" class="instructor-offline-video-link"><span class="instructor-offline-video-link__title">${label}</span><span class="instructor-offline-video-link__go" aria-hidden="true">↗</span></a></li>`;
            })
            .join("")}</ul>`;
      const desc = String(session.description || "").trim();
      const descHtml = desc
        ? `<p class="instructor-offline-session-desc">${escapeHtml(desc)}</p>`
        : "";
      const panelId = `instructor-session-panel-${escapeHtml(session.id)}`;
      return `
      <article class="instructor-offline-session-card${isOpen ? " is-open" : ""}">
        <button type="button" class="instructor-offline-session-toggle" data-session-toggle="${escapeHtml(session.id)}" aria-expanded="${isOpen ? "true" : "false"}" aria-controls="${panelId}">
          <span class="instructor-offline-session-toggle__row">
            <span class="instructor-offline-session-no">${escapeHtml(String(session.sessionNo ?? "-"))}수업</span>
            <span class="instructor-offline-session-date">${escapeHtml(formatSessionDate(session.sessionDate))}</span>
            <span class="instructor-offline-session-title">${escapeHtml(session.title || "제목 없음")}</span>
          </span>
          <span class="instructor-offline-session-toggle__end">
            <span class="instructor-offline-session-status ${statusClass}">${escapeHtml(status)}</span>
            <span class="instructor-offline-session-video-count">${escapeHtml(videoCountLabel)}</span>
            <span class="instructor-offline-session-toggle__icon" aria-hidden="true"></span>
          </span>
        </button>
        <div id="${panelId}" class="instructor-offline-session-panel"${isOpen ? "" : " hidden"}>
          ${descHtml}
          ${videoItems}
        </div>
      </article>`;
    })
    .join("");
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
    const totalPages = Math.max(1, Math.ceil(allSessions.length / SESSIONS_PAGE_SIZE));
    if (action === "prev" && sessionCurrentPage > 1) sessionCurrentPage -= 1;
    if (action === "next" && sessionCurrentPage < totalPages) sessionCurrentPage += 1;
    expandFirstOnNextRender = true;
    renderSessionsView();
  });
}

async function loadInstructorProfileId(uid) {
  try {
    const accountDoc = await getDoc(doc(db, "instructorAccounts", uid));
    if (accountDoc.exists()) {
      instructorProfileId = String(accountDoc.data()?.instructorId || "").trim();
    }
    if (!instructorProfileId) {
      const profilesByUid = await getDocs(query(collection(db, "instructors"), where("uid", "==", uid)));
      if (!profilesByUid.empty) {
        const profileDoc = profilesByUid.docs[0];
        instructorProfileId = String(profileDoc.data()?.instructorId || profileDoc.id || "").trim();
      }
    }
  } catch {
    instructorProfileId = "";
  }
}

async function init() {
  const classId = getClassIdFromUrl();
  if (!classId) {
    renderBlockedMessage("오프라인 반", "반 정보를 찾을 수 없습니다.");
    return;
  }

  const { user } = await requireRole("instructor", "/members/login.html");
  if (!user?.uid) return;

  await loadInstructorProfileId(user.uid);
  state.instructorProfileId = instructorProfileId;

  try {
    const classSnap = await getDoc(doc(db, "offlineClasses", classId));
    if (!classSnap.exists()) {
      renderBlockedMessage("오프라인 반", "반 정보를 찾을 수 없습니다.");
      return;
    }

    const classRow = { id: classSnap.id, ...classSnap.data() };
    const assigned = isAssignedToCurrentInstructor(classRow, user.uid);

    if (!assigned) {
      renderBlockedMessage("오프라인 반", "접근 권한이 없습니다.");
      return;
    }

    renderClassHeader(classRow);

    const [membersSnap, sessionsSnap] = await Promise.all([
      getDocs(query(collection(db, "offlineClassMembers"), where("classId", "==", classId))),
      getDocs(query(collection(db, "offlineClassSessions"), where("classId", "==", classId)))
    ]);

    const members = membersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const sessions = sessionsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    setMembersData(members);
    setSessionsData(sessions);
    bindSessionsUi();
  } catch (error) {
    handleError(error, "Load instructor offline class", { showToast: true, logError: true });
    renderBlockedMessage("오프라인 반", "반 정보를 불러오지 못했습니다.");
  }
}

init();
