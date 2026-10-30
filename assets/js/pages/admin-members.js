import { db, requireRole } from "/assets/js/firebase-init.js";
import * as XLSX from "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";
import { adminXlsxFilename, writeAdminXlsx } from "/assets/js/utils/admin-xlsx.js";
import { fetchExportDocuments, fetchScopedExportRows } from "/assets/js/utils/admin-export-scope.js";
import { showAdminToast } from "/assets/js/utils/admin-toast.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  where
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { normalizeAccessType, normalizeCourseForReadOnly } from "/assets/js/utils/course-readonly.js";
import { getCurrentCourseCompletion } from "/assets/js/utils/course-completion.js";
import { openAdminConfirm } from "/assets/js/utils/admin-dialog.js";
import "/assets/js/utils/toast.js";
import {
  bindCommittedSearch,
  normalizeListPageSize,
  renderListPagination,
} from "/assets/js/utils/list-controls.js";

const MEMBER_PURPOSE_LABELS = {
  parent: "학부모 회원",
  general: "일반 회원"
};

const SIGNUP_SOURCE_LABELS = {
  search: "인터넷 검색",
  friend: "지인 소개",
  sns: "SNS",
  ad: "광고, 홍보",
  other: "기타"
};

const GRADE_LABELS = {
  1: "중1",
  2: "중2",
  3: "중3",
  4: "고1",
  5: "고2",
  6: "고3",
  7: "졸업"
};

const ATTEMPT_RESULT_LABELS = {
  linked: "연동 완료",
  alreadyLinked: "이미 연동됨",
  notFound: "학생 정보 불일치",
  ambiguous: "동일 정보 학생 여러 명",
  invalidInput: "입력 정보 오류",
  notMember: "회원 정보 없음",
  inactiveMember: "비활성 회원",
  notParent: "학부모 회원 아님",
  rateLimited: "너무 많은 시도",
  serverError: "서버 처리 오류"
};

const ATTEMPT_RESULT_MESSAGES = {
  linked: "자녀 연동이 완료되었습니다.",
  alreadyLinked: "이미 연결된 자녀입니다.",
  notFound: "등록된 학생 정보를 찾지 못했습니다.",
  ambiguous: "동일한 정보의 학생이 여러 명 확인되었습니다.",
  invalidInput: "입력 정보를 확인할 수 없습니다.",
  notMember: "회원 정보를 확인할 수 없습니다.",
  inactiveMember: "비활성 회원이라 연동할 수 없습니다.",
  notParent: "학부모 회원으로 설정되지 않았습니다.",
  rateLimited: "짧은 시간에 너무 많은 연동을 시도했습니다.",
  serverError: "처리 중 오류가 발생했습니다."
};

const ATTEMPT_FIELD_LABELS = {
  studentName: "학생 이름",
  school: "학교",
  grade: "학년",
  studentPhone: "전화번호",
  relationLabel: "관계"
};

const ATTEMPT_RELATION_LABELS = {
  father: "부",
  mother: "모",
  guardian: "보호자"
};

const DETAIL_SAMPLE_LIMIT = 3;
const MEMBER_ATTEMPT_QUERY_LIMIT = 30;
const MEMBER_ATTEMPT_ISSUE_DISPLAY_LIMIT = 3;
const MEMBER_ATTEMPT_ALL_DISPLAY_LIMIT = 5;
const SIGNUP_ATTEMPT_QUERY_LIMIT = 20;
const SIGNUP_ATTEMPT_DISPLAY_LIMIT = 10;
const CHILD_SUMMARY_CHUNK_SIZE = 10;
const MANUAL_STUDENT_SEARCH_LIMIT = 20;
const TABLE_COLSPAN = 8;

const $ = (selector, root = document) => root.querySelector(selector);

let allMembers = [];
let filteredMembers = [];
let hasLoadedMembers = false;
let currentPage = 1;
let pageSize = 10;
let appliedMemberKeyword = "";
const courseCache = new Map();
const privateCourseWeeksCache = new Map();
const offlineClassCache = new Map();
const memberChildSummaryCache = new Map();
const manualStudentSearchResults = new Map();
let currentMemberDetailUid = "";
let currentMemberActiveLinkCount = 0;
let memberLinkMutationPending = false;
let memberAttemptCache = {uid: "", rows: []};
let signupAttemptCache = {email: "", rows: []};

(async () => {
  try {
    await requireRole("admin", "/members/login.html");
    setReadyState();
  } catch (error) {
    console.error("[admin-members] initialization failed", error);
  }
})();

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function formatDate(value) {
  const millis = toMillis(value);
  if (!millis) return "-";
  return new Date(millis).toLocaleDateString("ko-KR");
}

function formatDateTime(value) {
  const millis = toMillis(value);
  if (!millis) return "-";
  return new Date(millis).toLocaleString("ko-KR");
}

function getConsentStatusLabel(value) {
  return value === true ? "동의" : "미동의";
}

function getMarketingConsent(member = {}) {
  return member.marketingConsent && typeof member.marketingConsent === "object"
    ? member.marketingConsent
    : {};
}

function getMarketingConsentStatusLabel(consent = {}) {
  const sms = consent.sms === true;
  const email = consent.email === true;
  if (sms && email) return "동의";
  if (!sms && !email) return "미동의";
  return "일부 동의";
}

function formatDateOrFallback(value, fallback) {
  const formatted = formatDate(value);
  return formatted === "-" ? fallback : formatted;
}

function getMarketingConsentDateRows(consent = {}) {
  const sms = consent.sms === true;
  const email = consent.email === true;

  if (sms && email) {
    return [["수신 동의일", formatDate(consent.agreedAt || consent.updatedAt)]];
  }

  if (!sms && !email && consent.withdrawnAt) {
    return [["철회일", formatDate(consent.withdrawnAt)]];
  }

  if (!sms && !email) {
    return [["수신 동의일", "-"]];
  }

  return [["수신 동의일", formatDate(consent.updatedAt)]];
}

function getMemberPurposeLabel(value) {
  return MEMBER_PURPOSE_LABELS[value] || value || "-";
}

function getSignupSourceLabel(member = {}) {
  const source = String(member.signupSource || "").trim();
  if (!source) return "-";
  const label = SIGNUP_SOURCE_LABELS[source] || source;
  const other = String(member.signupSourceOther || "").trim();
  return source === "other" && other ? `${label} (${other})` : label;
}

function getGradeLabel(value) {
  const key = String(value || "").trim();
  return GRADE_LABELS[key] || key || "-";
}

function getAttemptResultLabel(value) {
  return ATTEMPT_RESULT_LABELS[value] || "확인 필요";
}

function isActiveRow(row = {}) {
  return String(row.status || "active").trim() === "active";
}

function setMeta(text) {
  const meta = $("#membersMeta");
  if (!meta) return;
  meta.textContent = text;
  meta.hidden = !text;
}

function setTableMessage(message) {
  const tbody = $("#membersTableBody");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="${TABLE_COLSPAN}" class="muted">${escapeHtml(message)}</td></tr>`;
}

function setReadyState() {
  hasLoadedMembers = false;
  allMembers = [];
  filteredMembers = [];
  currentPage = 1;
  setMeta("");
  setTableMessage("현황 불러오기를 눌러 회원 목록을 확인하세요.");
  renderPagination();
  setMemberExportReady();
}

function setMemberExportReady() {
  const button = $("#dlMembers");
  if (!button) return;
  button.disabled = !hasLoadedMembers || !filteredMembers.length;
  button.title = !hasLoadedMembers
    ? "회원 현황을 불러온 뒤 다운로드할 수 있습니다"
    : (filteredMembers.length ? "현재 필터 결과 전체를 엑셀로 다운로드" : "다운로드할 회원이 없습니다");
}

async function loadMembers() {
  const snap = await getDocs(collection(db, "members"));
  allMembers = snap.docs.map((docSnap) => {
    const data = docSnap.data() || {};
    return {
      uid: data.uid || docSnap.id,
      ...data,
      memberPurpose: String(data.memberPurpose || "").trim()
    };
  });

  allMembers.sort((a, b) => {
    const dateCmp = toMillis(b.createdAt) - toMillis(a.createdAt);
    if (dateCmp !== 0) return dateCmp;
    return String(a.name || "").localeCompare(String(b.name || ""), "ko");
  });
}

function getFilterValues() {
  return {
    keyword: appliedMemberKeyword,
    purpose: $("#memberPurposeFilter")?.value || "",
    signupSource: $("#memberSignupSourceFilter")?.value || ""
  };
}

function applyFilters() {
  const filters = getFilterValues();
  filteredMembers = allMembers.filter((member) => {
    if (filters.keyword) {
      const haystack = [member.name, member.email, member.phone]
        .map((value) => String(value || "").toLowerCase())
        .join(" ");
      if (!haystack.includes(filters.keyword)) return false;
    }

    if (filters.purpose && member.memberPurpose !== filters.purpose) return false;
    if (filters.signupSource && String(member.signupSource || "") !== filters.signupSource) return false;

    return true;
  });
}

function getMemberChildSummaryText(uid) {
  const cached = memberChildSummaryCache.get(uid);
  if (!cached || cached.state === "loading") return "조회 중";
  if (cached.state === "error") return "조회 실패";
  const names = cached.names || [];
  if (!names.length) return "미연결";
  return names.length === 1 ? names[0] : `${names[0]} 외 ${names.length - 1}명`;
}

function refreshVisibleMemberChildCells() {
  document.querySelectorAll("[data-member-child-summary]").forEach((cell) => {
    const uid = cell.getAttribute("data-member-child-summary") || "";
    cell.textContent = getMemberChildSummaryText(uid);
  });
}

async function loadVisibleMemberChildSummaries(memberUids = []) {
  const pendingUids = [...new Set(memberUids.filter(Boolean))]
    .filter((uid) => !memberChildSummaryCache.has(uid));
  if (!pendingUids.length) return;
  pendingUids.forEach((uid) => {
    memberChildSummaryCache.set(uid, {state: "loading", names: []});
  });
  refreshVisibleMemberChildCells();

  for (let index = 0; index < pendingUids.length; index += CHILD_SUMMARY_CHUNK_SIZE) {
    const chunk = pendingUids.slice(index, index + CHILD_SUMMARY_CHUNK_SIZE);
    try {
      const linksSnap = await getDocs(query(
        collection(db, "studentParentLinks"),
        where("memberUid", "in", chunk)
      ));
      const namesByUid = new Map(chunk.map((uid) => [uid, []]));
      linksSnap.forEach((linkDoc) => {
        const row = linkDoc.data() || {};
        if (String(row.status || "active") !== "active") return;
        const uid = String(row.memberUid || "").trim();
        if (!namesByUid.has(uid)) return;
        const name = String(row.studentSnapshot?.name || "이름 없음").trim() || "이름 없음";
        namesByUid.get(uid).push(name);
      });
      namesByUid.forEach((names, uid) => {
        memberChildSummaryCache.set(uid, {
          state: "loaded",
          names: [...new Set(names)].sort((a, b) => a.localeCompare(b, "ko")),
        });
      });
    } catch (error) {
      console.warn("[admin-members] visible child summaries load failed", error);
      chunk.forEach((uid) => {
        memberChildSummaryCache.set(uid, {state: "error", names: []});
      });
    }
  }
  refreshVisibleMemberChildCells();
}

function renderMembersTable() {
  const tbody = $("#membersTableBody");
  if (!tbody || !hasLoadedMembers) return;

  applyFilters();
  setMemberExportReady();
  const totalPages = Math.max(1, Math.ceil(filteredMembers.length / pageSize));
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  if (!filteredMembers.length) {
    setTableMessage(allMembers.length ? "조건에 맞는 회원이 없습니다." : "등록된 회원이 없습니다.");
    setMeta("");
    renderPagination();
    return;
  }

  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, filteredMembers.length);
  const pageMembers = filteredMembers.slice(startIndex, endIndex);

  tbody.innerHTML = pageMembers.map((member) => {
    const uid = String(member.uid || "").trim();
    return `
      <tr>
        <td><span class="member-purpose-pill">${escapeHtml(getMemberPurposeLabel(member.memberPurpose))}</span></td>
        <td>${escapeHtml(member.name || "-")}</td>
        <td>${escapeHtml(member.email || "-")}</td>
        <td>${escapeHtml(member.phone || "-")}</td>
        <td data-member-child-summary="${escapeHtml(uid)}">${escapeHtml(getMemberChildSummaryText(uid))}</td>
        <td>${escapeHtml(getSignupSourceLabel(member))}</td>
        <td>${escapeHtml(formatDate(member.createdAt))}</td>
        <td><button type="button" class="btn sm" data-member-detail="${escapeHtml(uid)}">상세</button></td>
      </tr>
    `;
  }).join("");

  setMeta("");
  renderPagination();
  void loadVisibleMemberChildSummaries(pageMembers.map((member) => member.uid));
}

function renderPagination() {
  const state = renderListPagination($("#memberPagination"), {
    currentPage,
    itemLabel: "명",
    onPageChange: (page) => {
      currentPage = page;
      renderMembersTable();
    },
    pageSize,
    totalItems: hasLoadedMembers ? filteredMembers.length : 0,
  });
  currentPage = state.currentPage;
}

async function loadMembersPage() {
  const loadButton = $("#refreshBtn");
  if (loadButton?.disabled) return;
  hasLoadedMembers = false;
  setMemberExportReady();
  loadButton.disabled = true;
  loadButton.textContent = "불러오는 중...";
  loadButton.setAttribute("aria-busy", "true");
  setTableMessage("회원 목록을 불러오는 중입니다.");
  setMeta("");

  try {
    memberChildSummaryCache.clear();
    await loadMembers();
    hasLoadedMembers = true;
    currentPage = 1;
    renderMembersTable();
    showAdminToast(`회원 ${allMembers.length}명의 현황을 불러왔습니다.`);
  } catch (error) {
    console.error("[admin-members] member list load failed", error);
    hasLoadedMembers = false;
    setMemberExportReady();
    setTableMessage("회원 목록을 불러오지 못했습니다. 상단 버튼으로 다시 시도해 주세요.");
    setMeta("");
    showAdminToast("회원 목록을 불러오지 못했습니다. 다시 시도해 주세요.", true);
  } finally {
    loadButton?.removeAttribute("aria-busy");
    if (loadButton) {
      loadButton.classList.toggle("primary", !hasLoadedMembers);
      loadButton.classList.toggle("secondary", hasLoadedMembers);
      loadButton.classList.toggle("admin-refresh-btn", hasLoadedMembers);
      loadButton.textContent = hasLoadedMembers ? "새로고침" : "현황 불러오기";
      loadButton.disabled = false;
    }
  }
}

async function loadCourse(courseId) {
  const id = String(courseId || "").trim();
  if (!id) return null;
  if (courseCache.has(id)) return courseCache.get(id);

  try {
    const snap = await getDoc(doc(db, "courses", id));
    const course = snap.exists() ? normalizeCourseForReadOnly({ id: snap.id, ...snap.data() }) : null;
    courseCache.set(id, course);
    return course;
  } catch (error) {
    console.warn("[admin-members] course load failed", error);
    courseCache.set(id, null);
    return null;
  }
}

async function loadOfflineClass(classId) {
  const id = String(classId || "").trim();
  if (!id) return null;
  if (offlineClassCache.has(id)) return offlineClassCache.get(id);

  try {
    const snap = await getDoc(doc(db, "offlineClasses", id));
    const row = snap.exists() ? (snap.data() || {}) : null;
    offlineClassCache.set(id, row);
    return row;
  } catch (error) {
    console.warn("[admin-members] offline class load failed", error);
    offlineClassCache.set(id, null);
    return null;
  }
}

async function hydrateEnrollments(enrollments = []) {
  return Promise.all(enrollments.map(async (enrollment) => {
    const courseId = String(enrollment.courseId || "").trim();
    const course = await loadCourse(courseId);
    let weeks = course?.weeks;
    if (course && normalizeAccessType(course.accessType) === "approvalRequired") {
      if (!privateCourseWeeksCache.has(courseId)) {
        privateCourseWeeksCache.set(courseId, getDoc(doc(db, "coursePrivateContent", courseId))
          .then((snap) => snap.exists() ? snap.data()?.weeks : null)
          .catch((error) => {
            console.warn("[admin-members] protected course progress unavailable", courseId, error);
            return null;
          }));
      }
      weeks = await privateCourseWeeksCache.get(courseId);
    }
    return {
      ...enrollment,
      courseTitle: course?.title || "제목 없는 강좌",
      currentProgress: Array.isArray(weeks)
        ? getCurrentCourseCompletion(courseId, weeks, enrollment.watchedVideos).progress
        : null
    };
  }));
}

async function resolveOfflineClassSummary(membership = {}) {
  let className = membership.classNameSnapshot || membership.className || "";
  if (!className && membership.classId) {
    const classRow = await loadOfflineClass(membership.classId);
    className = classRow?.className || classRow?.name || "";
  }

  return {
    className: className || "반명 미정",
    joinedAt: membership.joinedAt || membership.createdAt || null
  };
}

async function loadLinkedChildDetail(link = {}) {
  const studentUid = String(link.studentUid || "").trim();
  const snapshot = link.studentSnapshot || {};
  const studentPromise = studentUid ? getDoc(doc(db, "students", studentUid)) : Promise.resolve(null);
  const enrollmentsPromise = studentUid
    ? getDocs(query(collection(db, "enrollments"), where("userId", "==", studentUid)))
    : Promise.resolve({ docs: [] });
  const offlinePromise = studentUid
    ? getDocs(query(collection(db, "offlineClassMembers"), where("studentUid", "==", studentUid)))
    : Promise.resolve({ docs: [] });

  const [studentSnap, enrollmentsSnap, offlineSnap] = await Promise.all([
    studentPromise,
    enrollmentsPromise,
    offlinePromise
  ]);
  const student = studentSnap?.exists?.() ? (studentSnap.data() || {}) : {};
  const childEnrollments = enrollmentsSnap.docs
    .map((docSnap) => docSnap.data() || {})
    .filter(isActiveRow);
  const offlineMemberships = offlineSnap.docs
    .map((docSnap) => docSnap.data() || {})
    .filter(isActiveRow);
  const onlineRows = await hydrateEnrollments(childEnrollments);
  const offlineRows = await Promise.all(offlineMemberships.map(resolveOfflineClassSummary));

  return {
    linkId: String(link.id || "").trim(),
    studentUid,
    name: student.name || snapshot.name || "이름 없음",
    school: student.school || snapshot.school || "-",
    grade: student.grade || snapshot.grade || "",
    relationLabel: link.relationLabel || "guardian",
    relationDisplay: link.relationDisplay || "",
    linkedAt: link.createdAt || link.updatedAt || null,
    onlineRows,
    offlineRows
  };
}

async function loadMemberDetailData(uid) {
  // Detail reads are intentionally scoped to the selected member and linked children only.
  const [enrollmentsSnap, linksSnap] = await Promise.all([
    getDocs(query(collection(db, "enrollments"), where("userId", "==", uid))),
    getDocs(query(collection(db, "studentParentLinks"), where("memberUid", "==", uid)))
  ]);
  const listMember = allMembers.find((item) => item.uid === uid) || {};
  const member = { uid, ...listMember };
  const memberEnrollments = enrollmentsSnap.docs
    .map((docSnap) => docSnap.data() || {})
    .filter(isActiveRow);
  const linkedChildren = linksSnap.docs
    .map((docSnap) => ({id: docSnap.id, ...(docSnap.data() || {})}))
    .filter(isActiveRow)
    .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));

  return {
    member,
    enrollments: await hydrateEnrollments(memberEnrollments),
    children: await Promise.all(linkedChildren.map(loadLinkedChildDetail))
  };
}

function buildEnrollmentListHtml(enrollments = []) {
  if (!enrollments.length) return '<div class="muted detail-empty">온라인 수강 기록이 없습니다.</div>';

  const items = enrollments.map((enrollment) => {
    const progress = enrollment.currentProgress;
    return `<li><strong>${escapeHtml(enrollment.courseTitle)}</strong> / 진도 ${progress == null ? "확인 불가" : `${progress}%`} / ${escapeHtml(formatDate(enrollment.updatedAt || enrollment.createdAt))}</li>`;
  });

  return `<ul class="member-detail-list">${items.join("")}</ul>`;
}

function buildLinkedChildrenHtml(children = [], memberUid = "") {
  if (!children.length) return '<div class="muted detail-empty">연결된 자녀가 없습니다.</div>';

  const items = children.map((child) => {
    const onlineItems = child.onlineRows.slice(0, DETAIL_SAMPLE_LIMIT).map((row) => row.courseTitle);
    const offlineItems = child.offlineRows.slice(0, DETAIL_SAMPLE_LIMIT);
    return `
      <li>
        <div class="member-detail-child-head">
          <strong>${escapeHtml(child.name)}</strong>
          <span>${escapeHtml(child.school || "-")} / ${escapeHtml(getGradeLabel(child.grade))} / ${escapeHtml(child.relationDisplay || ATTEMPT_RELATION_LABELS[child.relationLabel] || "-")} / 연동일 ${escapeHtml(formatDate(child.linkedAt))}</span>
        </div>
        <div class="member-detail-child-counts">
          <span class="count-chip">온라인 수강 ${child.onlineRows.length.toLocaleString("ko-KR")}개</span>
          <span class="count-chip count-chip--offline">오프라인 반 ${child.offlineRows.length.toLocaleString("ko-KR")}개</span>
        </div>
        ${onlineItems.length ? `<p class="member-detail-child-note">온라인 수강: ${escapeHtml(onlineItems.join(", "))}</p>` : ""}
        ${offlineItems.length ? `
          <ul class="member-detail-sublist">
            ${offlineItems.map((item) => `
              <li>
                <strong>${escapeHtml(item.className)}</strong>
                <span>입반일: ${escapeHtml(formatDateOrFallback(item.joinedAt, "입반일 미정"))}</span>
              </li>
            `).join("")}
          </ul>
        ` : ""}
        <div class="member-detail-child-actions">
          <button type="button" class="btn sm" data-unlink-child="${escapeHtml(child.linkId)}" data-member-uid="${escapeHtml(memberUid)}">연결 해제</button>
        </div>
      </li>
    `;
  });

  return `<ul class="member-detail-list">${items.join("")}</ul>`;
}

function buildManualLinkSection(member = {}, activeCount = 0) {
  if (member.memberPurpose !== "parent") {
    return "";
  }

  return `
    <section class="member-detail-section" data-manual-link-member="${escapeHtml(member.uid)}" data-active-link-count="${activeCount}">
      <h3>관리자 자녀 연결</h3>
      <p class="muted member-detail-child-note">학생 이름(2자 이상) 또는 정확한 UID로 검색한 뒤 대상과 관계를 확인하세요.</p>
      <div class="member-manual-link-controls">
        <div class="admin-toolbar__search-wrap">
          <input type="search" id="manualChildSearchInput" class="admin-toolbar__search-input" placeholder="학생 이름 또는 UID" autocomplete="off">
          <button type="button" id="manualChildSearchButton" class="admin-toolbar__search-button" aria-label="학생 검색 실행" title="검색">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7.25"/><path d="M20 20l-3.5-3.5"/></svg>
          </button>
        </div>
        <select id="manualChildRelation" class="admin-toolbar__select" aria-label="학생과의 관계">
          <option value="mother">모</option>
          <option value="father">부</option>
          <option value="guardian">보호자</option>
        </select>
      </div>
      <div id="manualChildSearchResults" class="member-manual-link-results muted">검색 버튼을 눌러 학생을 찾으세요.</div>
    </section>
  `;
}

function getPhoneLast4(value) {
  return String(value || "").replace(/\D/g, "").slice(-4);
}

function renderManualStudentSearchResults(rows = []) {
  const container = $("#manualChildSearchResults");
  if (!container) return;
  manualStudentSearchResults.clear();
  if (!rows.length) {
    container.classList.add("muted");
    container.textContent = "일치하는 학생이 없습니다.";
    return;
  }

  rows.forEach((row) => manualStudentSearchResults.set(row.uid, row));
  container.classList.remove("muted");
  container.innerHTML = `
    <ul class="member-detail-list">
      ${rows.map((student) => `
        <li class="member-manual-link-result">
          <div>
            <strong>${escapeHtml(student.name || "이름 없음")}</strong>
            <span>${escapeHtml(student.school || "-")} / ${escapeHtml(getGradeLabel(student.grade))} / 전화번호 끝 4자리 ${escapeHtml(getPhoneLast4(student.phone) || "-")}</span>
            <details class="member-technical-details"><summary>상세 정보</summary><span>학생 식별값: ${escapeHtml(student.uid)}</span></details>
          </div>
          <button type="button" class="btn primary sm" data-manual-link-student="${escapeHtml(student.uid)}">이 학생 연결</button>
        </li>
      `).join("")}
    </ul>
  `;
}

async function searchManualLinkStudents() {
  const input = $("#manualChildSearchInput");
  const button = $("#manualChildSearchButton");
  const container = $("#manualChildSearchResults");
  const keyword = String(input?.value || "").trim();
  if (!container) return;
  if (keyword.length < 2) {
    container.classList.add("muted");
    container.textContent = "학생 이름은 2자 이상 입력하세요.";
    return;
  }

  const detailUid = currentMemberDetailUid;
  container.classList.add("muted");
  container.textContent = "학생을 검색하는 중입니다.";
  if (button) button.disabled = true;
  try {
    const reads = [getDocs(query(
      collection(db, "students"),
      where("name", ">=", keyword),
      where("name", "<=", `${keyword}\uf8ff`),
      limit(MANUAL_STUDENT_SEARCH_LIMIT)
    ))];
    if (!keyword.includes("/")) reads.push(getDoc(doc(db, "students", keyword)));
    const results = await Promise.allSettled(reads);
    if (detailUid !== currentMemberDetailUid) return;

    const studentsByUid = new Map();
    const nameResult = results[0];
    if (nameResult.status === "fulfilled") {
      nameResult.value.forEach((studentDoc) => {
        studentsByUid.set(studentDoc.id, {uid: studentDoc.id, ...(studentDoc.data() || {})});
      });
    }
    const uidResult = results[1];
    if (uidResult?.status === "fulfilled" && uidResult.value.exists()) {
      studentsByUid.set(uidResult.value.id, {
        uid: uidResult.value.id,
        ...(uidResult.value.data() || {}),
      });
    }
    if (results.every((result) => result.status === "rejected")) {
      throw results[0].reason;
    }
    renderManualStudentSearchResults(
      [...studentsByUid.values()].sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || ""), "ko")
      )
    );
  } catch (error) {
    console.warn("[admin-members] manual student search failed", error);
    container.classList.add("muted");
    container.textContent = "학생 검색에 실패했습니다.";
  } finally {
    if (button && detailUid === currentMemberDetailUid) button.disabled = false;
  }
}

function updateLocalMemberLinkCount(memberUid, linkedChildrenCount) {
  const member = allMembers.find((row) => row.uid === memberUid);
  if (member) {
    member.linkedChildrenCount = linkedChildrenCount;
    member.hasLinkedChildren = linkedChildrenCount > 0;
  }
  currentMemberActiveLinkCount = linkedChildrenCount;
  memberChildSummaryCache.delete(memberUid);
  const visibleUids = [...document.querySelectorAll("[data-member-child-summary]")]
    .map((cell) => cell.getAttribute("data-member-child-summary") || "")
    .filter(Boolean);
  void loadVisibleMemberChildSummaries(visibleUids);
}

function createOperatorError(message) {
  const error = new Error(message);
  error.operatorMessage = message;
  return error;
}

function getMemberLinkErrorMessage(error, fallback) {
  const code = String(error?.code || "").toLowerCase();
  if (code.includes("permission-denied")) {
    return "현재 권한 설정으로 처리할 수 없습니다. 관리자에게 문의해 주세요.";
  }
  if (code.includes("unavailable") || code.includes("deadline-exceeded")) {
    return "네트워크가 불안정해 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  }
  if (code.includes("aborted")) {
    return "처리 중 정보가 변경되었습니다. 회원 상세를 다시 확인한 뒤 시도해 주세요.";
  }
  return String(error?.operatorMessage || fallback);
}

function showMemberActionMessage(type, message) {
  showAdminToast(message, type === "error");
}

function setMemberLinkMutationPending(pending) {
  memberLinkMutationPending = pending;
  document.querySelectorAll("[data-manual-link-student], [data-unlink-child]").forEach((button) => {
    button.disabled = pending;
  });
}

async function refreshMemberDetailAfterCommit(memberUid, successMessage) {
  if (currentMemberDetailUid !== memberUid) {
    showMemberActionMessage("success", successMessage);
    return;
  }
  try {
    await openMemberDetail(memberUid, {showLoading: false, throwOnError: true});
    showMemberActionMessage("success", successMessage);
  } catch (error) {
    console.warn("[admin-members] committed child-link detail refresh failed", error);
    showMemberActionMessage(
      "warning",
      `${successMessage} 화면을 새로 불러오지 못했으니 새로고침해 주세요.`
    );
  }
}

async function createManualChildLink(studentUid) {
  const memberUid = currentMemberDetailUid;
  const student = manualStudentSearchResults.get(studentUid);
  const relationLabel = $("#manualChildRelation")?.value || "guardian";
  const relationDisplay = ATTEMPT_RELATION_LABELS[relationLabel] || "보호자";
  if (!memberUid || !student || memberLinkMutationPending) return;
  const confirmed = await openAdminConfirm({
    title: "자녀 연결 확인",
    message: `${student.name || "선택한 학생"} 학생을 ${relationDisplay} 관계로 연결할까요?`,
    cancelLabel: "취소",
    confirmLabel: "연결",
  });
  if (!confirmed || memberUid !== currentMemberDetailUid) return;

  const expectedActiveCount = currentMemberActiveLinkCount;
  const memberRef = doc(db, "members", memberUid);
  const studentRef = doc(db, "students", studentUid);
  const linkRef = doc(db, "studentParentLinks", `${studentUid}_${memberUid}`);
  setMemberLinkMutationPending(true);
  let nextCount;
  try {
    nextCount = await runTransaction(db, async (transaction) => {
      const [memberSnap, studentSnap, linkSnap] = await Promise.all([
        transaction.get(memberRef),
        transaction.get(studentRef),
        transaction.get(linkRef),
      ]);
      if (!memberSnap.exists() || !studentSnap.exists()) {
        throw createOperatorError("회원 또는 학생 정보를 확인할 수 없습니다.");
      }
      const currentMember = memberSnap.data() || {};
      const currentStudent = studentSnap.data() || {};
      if (currentMember.memberPurpose !== "parent" || currentMember.status !== "active") {
        throw createOperatorError("활성 학부모 회원만 자녀를 연결할 수 있습니다.");
      }
      const currentCount = Number(currentMember.linkedChildrenCount);
      if (!Number.isInteger(currentCount) || currentCount !== expectedActiveCount) {
        throw createOperatorError("현재 자녀 연결 정보와 회원 수가 일치하지 않습니다. 관리자 점검이 필요합니다.");
      }
      const currentLink = linkSnap.exists() ? (linkSnap.data() || {}) : null;
      if (currentLink?.status === "active") {
        throw createOperatorError("이미 연결된 학생입니다.");
      }

      const updatedCount = currentCount + 1;
      transaction.set(linkRef, {
        studentUid,
        memberUid,
        status: "active",
        relationLabel,
        relationDisplay,
        linkedBy: "admin",
        matchMethod: "admin_manual",
        studentSnapshot: {
          name: String(currentStudent.name || "").trim(),
          school: String(currentStudent.school || "").trim(),
          grade: String(currentStudent.grade || "").trim(),
          phoneLast4: getPhoneLast4(currentStudent.phone),
        },
        memberSnapshot: {
          name: String(currentMember.name || "").trim(),
          email: String(currentMember.email || "").trim(),
          phone: String(currentMember.phone || "").trim(),
        },
        createdAt: currentLink?.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
        revokedAt: null,
      }, {merge: true});
      transaction.update(memberRef, {
        hasLinkedChildren: true,
        linkedChildrenCount: updatedCount,
        updatedAt: serverTimestamp(),
      });
      return updatedCount;
    });
  } catch (error) {
    console.warn("[admin-members] manual child link failed", error);
    showMemberActionMessage("error", getMemberLinkErrorMessage(error, "자녀 연결에 실패했습니다."));
    setMemberLinkMutationPending(false);
    return;
  }
  updateLocalMemberLinkCount(memberUid, nextCount);
  try {
    await refreshMemberDetailAfterCommit(memberUid, "자녀 연결을 완료했습니다.");
  } finally {
    setMemberLinkMutationPending(false);
  }
}

async function revokeManualChildLink(linkId, memberUid) {
  if (!linkId || !memberUid || memberUid !== currentMemberDetailUid || memberLinkMutationPending) return;
  const confirmed = await openAdminConfirm({
    title: "자녀 연결 해제",
    message: "이 자녀 연결을 해제할까요? 연동 이력은 보존됩니다.",
    cancelLabel: "취소",
    confirmLabel: "연결 해제",
    danger: true,
  });
  if (!confirmed || memberUid !== currentMemberDetailUid) return;
  const expectedActiveCount = currentMemberActiveLinkCount;
  const memberRef = doc(db, "members", memberUid);
  const linkRef = doc(db, "studentParentLinks", linkId);
  setMemberLinkMutationPending(true);
  let nextCount;
  try {
    nextCount = await runTransaction(db, async (transaction) => {
      const [memberSnap, linkSnap] = await Promise.all([
        transaction.get(memberRef),
        transaction.get(linkRef),
      ]);
      if (!memberSnap.exists() || !linkSnap.exists()) {
        throw createOperatorError("회원 또는 자녀 연결 정보를 확인할 수 없습니다.");
      }
      const currentMember = memberSnap.data() || {};
      const currentLink = linkSnap.data() || {};
      const currentCount = Number(currentMember.linkedChildrenCount);
      if (!Number.isInteger(currentCount) || currentCount !== expectedActiveCount) {
        throw createOperatorError("현재 자녀 연결 정보와 회원 수가 일치하지 않습니다. 관리자 점검이 필요합니다.");
      }
      if (currentLink.memberUid !== memberUid || currentLink.status !== "active") {
        throw createOperatorError("이미 해제되었거나 다른 회원의 연결입니다.");
      }
      const updatedCount = Math.max(0, currentCount - 1);
      transaction.update(linkRef, {
        status: "revoked",
        revokedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      transaction.update(memberRef, {
        hasLinkedChildren: updatedCount > 0,
        linkedChildrenCount: updatedCount,
        updatedAt: serverTimestamp(),
      });
      return updatedCount;
    });
  } catch (error) {
    console.warn("[admin-members] manual child unlink failed", error);
    showMemberActionMessage("error", getMemberLinkErrorMessage(error, "자녀 연결 해제에 실패했습니다."));
    setMemberLinkMutationPending(false);
    return;
  }
  updateLocalMemberLinkCount(memberUid, nextCount);
  try {
    await refreshMemberDetailAfterCommit(memberUid, "자녀 연결을 해제했습니다.");
  } finally {
    setMemberLinkMutationPending(false);
  }
}

function buildAttemptsSection(uid) {
  return `
    <section class="member-detail-section member-records-section">
      <details class="member-records-panel">
        <summary>자녀 연동 기록</summary>
        <div class="member-records-panel__content">
          <p class="muted">필요할 때만 이 회원의 최근 기록을 제한해서 불러옵니다.</p>
          <button type="button" class="btn sm" data-load-member-attempts="${escapeHtml(uid)}">연동 기록 보기</button>
          <div class="member-record-view-controls" data-member-attempt-controls hidden>
            <button type="button" class="btn sm primary" data-member-attempt-view="issues">최근 실패 기록</button>
            <button type="button" class="btn sm" data-member-attempt-view="all">최근 전체 기록</button>
          </div>
          <p id="memberAttemptsMeta" class="muted member-records-meta" aria-live="polite" hidden></p>
          <div id="memberAttemptsBody" class="member-attempts-body" hidden></div>
        </div>
      </details>
    </section>
  `;
}

function buildSignupAttemptsSection(member = {}) {
  const email = String(member.email || "").trim().toLowerCase();
  if (!email) return "";
  return `
    <section class="member-detail-section member-records-section">
      <details class="member-records-panel">
        <summary>회원가입 인증 요청 기록</summary>
        <div class="member-records-panel__content">
          <p class="muted">회원가입 인증번호 발송 요청이 접수된 기록입니다. 로그인 실패 기록이 아닙니다.</p>
          <button type="button" class="btn sm" data-load-signup-attempts="${escapeHtml(email)}">인증 요청 기록 보기</button>
          <p id="signupAttemptsMeta" class="muted member-records-meta" aria-live="polite"></p>
          <div id="signupAttemptsBody" class="member-attempts-body"></div>
        </div>
      </details>
    </section>
  `;
}

function formatPhoneNumber(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 11) return digits.replace(/^(\d{3})(\d{4})(\d{4})$/, "$1-$2-$3");
  if (digits.length === 10) return digits.replace(/^(\d{3})(\d{3})(\d{4})$/, "$1-$2-$3");
  return value || "-";
}

function buildRecordGrid(rows = []) {
  return `
    <dl class="member-detail-grid member-record-grid">
      ${rows.map(([label, value]) => `
        <div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value == null || value === "" ? "-" : value)}</dd></div>
      `).join("")}
    </dl>
  `;
}

function buildChildAttemptCard(row = {}) {
  const submittedInput = row.submittedInput && typeof row.submittedInput === "object"
    ? row.submittedInput
    : {};
  const mismatchFields = Array.isArray(row.diagnostics?.mismatchFields)
    ? row.diagnostics.mismatchFields
    : [];
  const providedFields = Array.isArray(row.diagnostics?.providedFields)
    ? row.diagnostics.providedFields
    : [];
  const result = String(row.result || "serverError");
  const phone = submittedInput.studentPhone || submittedInput.phoneLast4 || "";
  return `
    <article class="member-record-card">
      <header class="member-record-card__header">
        <time>${escapeHtml(formatDateTime(row.createdAt))}</time>
        <span class="member-record-status member-record-status--${escapeHtml(result)}">${escapeHtml(getAttemptResultLabel(result))}</span>
      </header>
      <p class="member-record-summary">${escapeHtml(ATTEMPT_RESULT_MESSAGES[result] || "처리 결과를 확인해 주세요.")}</p>
      <h4>입력한 학생 정보</h4>
      ${buildRecordGrid([
        ["학생 이름", submittedInput.studentName],
        ["학교", submittedInput.school],
        ["학년", getGradeLabel(submittedInput.grade)],
        ["전화번호", formatPhoneNumber(phone)],
        ["관계", ATTEMPT_RELATION_LABELS[submittedInput.relationLabel] || submittedInput.relationLabel],
      ])}
      ${mismatchFields.length ? `<p class="member-record-mismatch"><strong>확인이 필요한 정보:</strong> ${escapeHtml(mismatchFields.map((field) => ATTEMPT_FIELD_LABELS[field] || field).join(", "))}</p>` : ""}
      <details class="member-technical-details">
        <summary>상세 정보</summary>
        ${buildRecordGrid([
          ["기록 ID", row.id],
          ["회원 식별값", row.memberUid],
          ["일치 학생 식별값", row.matchedStudentUid],
          ["연결 식별값", row.linkId],
          ["후보 수", Number.isFinite(Number(row.matchCount)) ? String(Number(row.matchCount)) : "-"],
          ["입력 확인 항목", providedFields.map((field) => ATTEMPT_FIELD_LABELS[field] || field).join(", ")],
          ["정리 예정", formatDateTime(row.cleanupAt)],
        ])}
      </details>
    </article>
  `;
}

function buildSignupAttemptCard(row = {}) {
  return `
    <article class="member-record-card">
      <header class="member-record-card__header">
        <time>${escapeHtml(formatDateTime(row.timestamp || row.createdAt))}</time>
        <span class="member-record-status member-record-status--accepted">인증번호 요청 접수</span>
      </header>
      <p class="member-record-summary">회원가입 인증번호 발송 요청이 접수된 기록입니다.</p>
      ${buildRecordGrid([["이메일", row.email]])}
      <details class="member-technical-details">
        <summary>상세 정보</summary>
        ${buildRecordGrid([
          ["서버 확인 IP", row.ip],
          ["정리 예정", formatDateTime(row.cleanupAt)],
          ["기록 ID", row.id],
        ])}
      </details>
    </article>
  `;
}

function renderMemberAttemptRows(uid, view = "issues") {
  if (uid !== currentMemberDetailUid) return;
  if (memberAttemptCache.uid !== uid) return;
  const body = $("#memberAttemptsBody");
  const meta = $("#memberAttemptsMeta");
  const controls = $("[data-member-attempt-controls]");
  if (!body || !meta) return;
  const sourceRows = view === "issues"
    ? memberAttemptCache.rows.filter((row) => !["linked", "alreadyLinked"].includes(String(row.result || "")))
    : memberAttemptCache.rows;
  const displayLimit = view === "issues"
    ? MEMBER_ATTEMPT_ISSUE_DISPLAY_LIMIT
    : MEMBER_ATTEMPT_ALL_DISPLAY_LIMIT;
  const rows = sourceRows.slice(0, displayLimit);
  meta.textContent = view === "issues"
    ? `최근 조회 범위의 실패 기록 ${sourceRows.length.toLocaleString("ko-KR")}건 중 최대 ${MEMBER_ATTEMPT_ISSUE_DISPLAY_LIMIT}건을 표시합니다.`
    : `최근 조회 ${memberAttemptCache.rows.length.toLocaleString("ko-KR")}건 중 최대 ${MEMBER_ATTEMPT_ALL_DISPLAY_LIMIT}건을 표시합니다.`;
  meta.hidden = false;
  body.hidden = false;
  body.innerHTML = rows.length
    ? rows.map(buildChildAttemptCard).join("")
    : `<div class="muted detail-empty">${view === "issues" ? "최근 실패 기록이 없습니다." : "자녀 연동 기록이 없습니다."}</div>`;
  if (controls) {
    controls.hidden = false;
    controls.querySelectorAll("[data-member-attempt-view]").forEach((button) => {
      button.classList.toggle("primary", button.dataset.memberAttemptView === view);
    });
  }
}

async function loadMemberAttemptRows(uid) {
  if (!uid || uid !== currentMemberDetailUid) return;
  const detailUid = currentMemberDetailUid;
  const button = $("[data-load-member-attempts]");
  const body = $("#memberAttemptsBody");
  const meta = $("#memberAttemptsMeta");
  if (!body || !meta) return;
  if (button) button.disabled = true;
  meta.hidden = false;
  body.hidden = true;
  meta.textContent = "자녀 연동 기록을 불러오는 중입니다.";
  try {
    if (memberAttemptCache.uid !== uid) {
      const snap = await getDocs(query(
        collection(db, "memberChildLinkAttempts"),
        where("memberUid", "==", uid),
        limit(MEMBER_ATTEMPT_QUERY_LIMIT)
      ));
      if (detailUid !== currentMemberDetailUid) return;
      memberAttemptCache = {
        uid,
        rows: snap.docs
          .map((docSnap) => ({id: docSnap.id, ...(docSnap.data() || {})}))
          .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt)),
      };
    }
    if (button) button.hidden = true;
    renderMemberAttemptRows(uid, "issues");
  } catch (error) {
    console.warn("[admin-members] child-link records load failed", error);
    meta.textContent = "자녀 연동 기록을 불러오지 못했습니다.";
    body.hidden = false;
    body.innerHTML = '<div class="muted detail-empty">잠시 후 다시 시도해 주세요.</div>';
  } finally {
    if (button) button.disabled = false;
  }
}

async function loadSignupAttemptRows(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail || !currentMemberDetailUid) return;
  const detailUid = currentMemberDetailUid;
  const button = $("[data-load-signup-attempts]");
  const body = $("#signupAttemptsBody");
  const meta = $("#signupAttemptsMeta");
  if (!body || !meta) return;
  if (button) button.disabled = true;
  meta.textContent = "회원가입 인증 요청 기록을 불러오는 중입니다.";
  try {
    if (signupAttemptCache.email !== normalizedEmail) {
      const snap = await getDocs(query(
        collection(db, "signupAttempts"),
        where("email", "==", normalizedEmail),
        limit(SIGNUP_ATTEMPT_QUERY_LIMIT)
      ));
      if (detailUid !== currentMemberDetailUid) return;
      signupAttemptCache = {
        email: normalizedEmail,
        rows: snap.docs
          .map((docSnap) => ({id: docSnap.id, ...(docSnap.data() || {})}))
          .sort((a, b) => toMillis(b.timestamp || b.createdAt) - toMillis(a.timestamp || a.createdAt)),
      };
    }
    const rows = signupAttemptCache.rows.slice(0, SIGNUP_ATTEMPT_DISPLAY_LIMIT);
    meta.textContent = `최근 조회 ${signupAttemptCache.rows.length.toLocaleString("ko-KR")}건 중 최대 ${SIGNUP_ATTEMPT_DISPLAY_LIMIT}건을 표시합니다.`;
    body.innerHTML = rows.length
      ? rows.map(buildSignupAttemptCard).join("")
      : '<div class="muted detail-empty">회원가입 인증 요청 기록이 없습니다.</div>';
    if (button) button.hidden = true;
  } catch (error) {
    console.warn("[admin-members] signup request records load failed", error);
    meta.textContent = "회원가입 인증 요청 기록을 불러오지 못했습니다.";
    body.innerHTML = '<div class="muted detail-empty">잠시 후 다시 시도해 주세요.</div>';
  } finally {
    if (button) button.disabled = false;
  }
}

function buildParentChildSections(member = {}, children = []) {
  if (member.memberPurpose !== "parent") return "";
  const childOnlineTotal = children.reduce((sum, child) => sum + child.onlineRows.length, 0);
  const childOfflineTotal = children.reduce((sum, child) => sum + child.offlineRows.length, 0);
  return `
    <section class="member-detail-section">
      <h3>연결된 자녀 <span>${children.length.toLocaleString("ko-KR")}명</span></h3>
      <p class="muted">
        자녀 온라인 수강: <strong>${childOnlineTotal.toLocaleString("ko-KR")}개</strong>
        / 오프라인 반: <strong>${childOfflineTotal.toLocaleString("ko-KR")}개</strong>
      </p>
      ${buildLinkedChildrenHtml(children, member.uid)}
    </section>
    ${buildManualLinkSection(member, children.length)}
    ${buildAttemptsSection(member.uid)}
  `;
}

async function openMemberDetail(uid, {showLoading = true, throwOnError = false} = {}) {
  const modal = $("#memberDetailModal");
  const body = $("#memberDetailBody");
  if (!modal || !body) return;

  if (showLoading) {
    body.innerHTML = '<p class="muted">회원 상세 정보를 불러오는 중입니다.</p>';
  }
  body.setAttribute("aria-busy", "true");
  currentMemberDetailUid = uid;
  manualStudentSearchResults.clear();
  memberAttemptCache = {uid: "", rows: []};
  signupAttemptCache = {email: "", rows: []};
  modal.hidden = false;
  document.body.classList.add("modal-open");

  try {
    const detail = await loadMemberDetailData(uid);
    if (uid !== currentMemberDetailUid) return;
    const { member, enrollments, children } = detail;
    currentMemberActiveLinkCount = children.length;
    const marketingConsent = getMarketingConsent(member);
    const consentRows = [
      ["이용약관 동의", getConsentStatusLabel(member.termsAgreed)],
      ["개인정보 동의", getConsentStatusLabel(member.privacyAgreed)],
      ["광고성 정보 수신", getMarketingConsentStatusLabel(marketingConsent)],
      ...getMarketingConsentDateRows(marketingConsent)
    ];
    body.innerHTML = `
      <div class="member-detail">
        <section class="member-detail-section">
          <h3>기본 정보</h3>
          <dl class="member-detail-grid">
            <div><dt>이름</dt><dd>${escapeHtml(member.name || "-")}</dd></div>
            <div><dt>회원 유형</dt><dd>${escapeHtml(getMemberPurposeLabel(member.memberPurpose))}</dd></div>
            <div><dt>연락처</dt><dd>${escapeHtml(member.phone || "-")}</dd></div>
            <div><dt>이메일</dt><dd>${escapeHtml(member.email || "-")}</dd></div>
            <div><dt>가입 경로</dt><dd>${escapeHtml(getSignupSourceLabel(member))}</dd></div>
          </dl>
        </section>
        <section class="member-detail-section">
          <h3>동의 정보</h3>
          <dl class="member-detail-grid">
            ${consentRows.map(([label, value]) => `
              <div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>
            `).join("")}
          </dl>
        </section>
        <section class="member-detail-section">
          <h3>온라인 수강 <span>${enrollments.length.toLocaleString("ko-KR")}개</span></h3>
          ${buildEnrollmentListHtml(enrollments)}
        </section>
        ${buildParentChildSections(member, children)}
        ${buildSignupAttemptsSection(member)}
        <section class="member-detail-section">
          <h3>가입/수정일</h3>
          <dl class="member-detail-grid">
            <div><dt>가입일</dt><dd>${escapeHtml(formatDate(member.createdAt))}</dd></div>
            <div><dt>수정일</dt><dd>${escapeHtml(formatDate(member.updatedAt))}</dd></div>
          </dl>
        </section>
      </div>
    `;
    if (memberLinkMutationPending) setMemberLinkMutationPending(true);
  } catch (error) {
    console.error("[admin-members] detail load failed", error);
    if (uid === currentMemberDetailUid && showLoading) {
      body.innerHTML = '<p class="muted">회원 상세 정보를 불러오지 못했습니다.</p>';
    }
    if (throwOnError) throw error;
  } finally {
    if (uid === currentMemberDetailUid) body.setAttribute("aria-busy", "false");
  }
}

function closeMemberDetail() {
  const modal = $("#memberDetailModal");
  if (!modal) return;
  modal.hidden = true;
  currentMemberDetailUid = "";
  currentMemberActiveLinkCount = 0;
  manualStudentSearchResults.clear();
  memberAttemptCache = {uid: "", rows: []};
  signupAttemptCache = {email: "", rows: []};
  document.body.classList.remove("modal-open");
}

["#memberPurposeFilter", "#memberSignupSourceFilter"].forEach((selector) => {
  $(selector)?.addEventListener("change", () => {
    currentPage = 1;
    renderMembersTable();
  });
});

bindCommittedSearch($("#memberKeywordFilter"), $("#memberKeywordSearchButton"), (keyword) => {
  appliedMemberKeyword = keyword;
  currentPage = 1;
  renderMembersTable();
});

$("#membersPageSize")?.addEventListener("change", (event) => {
  pageSize = normalizeListPageSize(event.target.value);
  currentPage = 1;
  renderMembersTable();
});

$("#refreshBtn")?.addEventListener("click", loadMembersPage);

let memberExportPending = false;
$("#dlMembers")?.addEventListener("click", async () => {
  if (memberExportPending) return;
  if (!hasLoadedMembers) return showAdminToast("회원 목록을 먼저 불러와 주세요.", true);
  if (!filteredMembers.length) return showAdminToast(allMembers.length ? "필터 결과에 회원이 없습니다." : "등록된 회원이 없습니다.", true);
  memberExportPending = true;
  try {
    const proceed = await openAdminConfirm({
      title: "회원 명단 다운로드",
      message: `회원 ${filteredMembers.length}명의 수강 내역과 학부모 자녀 정보를 함께 불러와 저장합니다. 계속하시겠습니까?`,
      confirmLabel: "다운로드",
    });
    if (!proceed) return;
    const memberIds = filteredMembers.map((row) => row.uid);
    const [enrollments, links] = await Promise.all([
      fetchScopedExportRows(db, "enrollments", "userId", memberIds),
      fetchScopedExportRows(db, "studentParentLinks", "memberUid", memberIds),
    ]);
    const activeLinks = links.filter((row) => row.status === "active");
    const childIds = activeLinks.map((row) => row.studentUid);
    const [childEnrollments, childMemberships] = await Promise.all([
      fetchScopedExportRows(db, "enrollments", "userId", childIds),
      fetchScopedExportRows(db, "offlineClassMembers", "studentUid", childIds),
    ]);
    const [courses, classes, students] = await Promise.all([
      fetchExportDocuments(db, "courses", [...enrollments, ...childEnrollments].map((row) => row.courseId)),
      fetchExportDocuments(db, "offlineClasses", childMemberships.map((row) => row.classId)),
      fetchExportDocuments(db, "students", links.map((row) => row.studentUid)),
    ]);
    const members = new Map(filteredMembers.map((row) => [row.uid, row]));
    const rows = filteredMembers.map((member) => ({
      "회원 유형": getMemberPurposeLabel(member.memberPurpose),
      이름: member.name || "",
      이메일: member.email || "",
      연락처: member.phone || "",
      "가입 경로": getSignupSourceLabel(member),
      가입일: formatDate(member.createdAt),
      상태: String(member.status || "active") === "active" ? "활성" : "비활성",
      "이용약관 동의": getConsentStatusLabel(member.termsAgreed),
      "개인정보 동의": getConsentStatusLabel(member.privacyAgreed),
      "광고성 정보 수신": getMarketingConsentStatusLabel(getMarketingConsent(member)),
      "활성 온라인 강좌": new Set(enrollments.filter((row) => row.userId === member.uid && String(row.status || "active") === "active").map((row) => row.courseId).filter(Boolean)).size,
      "활성 자녀 연결": links.filter((row) => row.memberUid === member.uid && row.status === "active").length,
    }));
    const courseRows = enrollments.map((row) => ({
      회원UID: row.userId || "", 회원명: members.get(row.userId)?.name || "",
      강좌UID: row.courseId || "", 강좌명: courses.get(row.courseId)?.title || "확인 불가",
      수강상태: row.status || "active", 등록일: formatDate(row.createdAt),
    }));
    const childRows = links.map((row) => {
      const child = students.get(row.studentUid) || row.studentSnapshot || {};
      return {
        회원UID: row.memberUid || "", 회원명: members.get(row.memberUid)?.name || "",
        학생UID: row.studentUid || "", 학생명: child.name || "확인 불가",
        학교: child.school || "", 학년: GRADE_LABELS[child.grade] || child.grade || "",
        학생연락처: child.phone || "",
        학생정보출처: students.has(row.studentUid) ? "현재 프로필" : (row.studentSnapshot ? "연결 시 스냅샷" : "확인 불가"),
        관계: row.relationDisplay || ATTEMPT_RELATION_LABELS[row.relationLabel] || row.relationLabel || "",
        상태: row.status || "확인 필요", 연결일: formatDate(row.createdAt), 해제일: formatDate(row.revokedAt),
      };
    });
    const childRelations = new Map();
    activeLinks.forEach((row) => {
      if (!childRelations.has(row.studentUid)) childRelations.set(row.studentUid, []);
      childRelations.get(row.studentUid).push(row);
    });
    const childCourseRows = childEnrollments.flatMap((row) => (childRelations.get(row.userId) || []).map((link) => ({
      회원UID: link.memberUid || "", 회원명: members.get(link.memberUid)?.name || "",
      학생UID: row.userId || "", 학생명: students.get(row.userId)?.name || link.studentSnapshot?.name || "확인 불가",
      강좌UID: row.courseId || "", 강좌명: courses.get(row.courseId)?.title || "확인 불가",
      수강상태: row.status || "active",
    })));
    const childClassRows = childMemberships.flatMap((row) => (childRelations.get(row.studentUid) || []).map((link) => ({
      회원UID: link.memberUid || "", 회원명: members.get(link.memberUid)?.name || "",
      학생UID: row.studentUid || "", 학생명: students.get(row.studentUid)?.name || link.studentSnapshot?.name || "확인 불가",
      반UID: row.classId || "", 반명: classes.get(row.classId)?.className || "확인 불가",
      배정상태: row.status || "active", 입반일: formatDate(row.joinedAt || row.createdAt),
    })));
    const filters = getFilterValues();
    const isFiltered = !!(filters.keyword || filters.purpose || filters.signupSource);
    const done = await writeAdminXlsx(XLSX, {
      sheets: [
        { name: "회원", rows },
        { name: "회원수강", rows: courseRows },
        { name: "자녀연결", rows: childRows },
        { name: "자녀수강", rows: childCourseRows },
        { name: "자녀입반", rows: childClassRows },
      ], button: $("#dlMembers"),
      filename: adminXlsxFilename("회원목록", rows.length, isFiltered ? "필터결과" : "전체"),
    });
    if (done) showAdminToast(`회원 ${rows.length}명 엑셀 파일을 다운로드했습니다.`);
  } catch (error) {
    console.error("[admin-members] export failed", error);
    showAdminToast(`엑셀 다운로드에 실패했습니다. ${error.message || "다시 시도해 주세요."}`, true);
  } finally {
    memberExportPending = false;
  }
});

$("#membersTableBody")?.addEventListener("click", (event) => {
  const detailButton = event.target.closest("[data-member-detail]");
  if (!detailButton) return;
  openMemberDetail(detailButton.getAttribute("data-member-detail") || "");
});

$("#memberDetailBody")?.addEventListener("click", (event) => {
  const attemptsButton = event.target.closest("[data-load-member-attempts]");
  if (attemptsButton) {
    loadMemberAttemptRows(attemptsButton.getAttribute("data-load-member-attempts") || "");
    return;
  }
  const attemptViewButton = event.target.closest("[data-member-attempt-view]");
  if (attemptViewButton) {
    renderMemberAttemptRows(
      currentMemberDetailUid,
      attemptViewButton.getAttribute("data-member-attempt-view") || "issues"
    );
    return;
  }
  const signupAttemptsButton = event.target.closest("[data-load-signup-attempts]");
  if (signupAttemptsButton) {
    loadSignupAttemptRows(signupAttemptsButton.getAttribute("data-load-signup-attempts") || "");
    return;
  }
  if (event.target.closest("#manualChildSearchButton")) {
    searchManualLinkStudents();
    return;
  }
  const linkButton = event.target.closest("[data-manual-link-student]");
  if (linkButton) {
    createManualChildLink(linkButton.getAttribute("data-manual-link-student") || "");
    return;
  }
  const unlinkButton = event.target.closest("[data-unlink-child]");
  if (unlinkButton) {
    revokeManualChildLink(
      unlinkButton.getAttribute("data-unlink-child") || "",
      unlinkButton.getAttribute("data-member-uid") || ""
    );
  }
});

$("#memberDetailBody")?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.target.closest("#manualChildSearchInput")) {
    event.preventDefault();
    searchManualLinkStudents();
  }
});

$("#closeMemberDetailModal")?.addEventListener("click", closeMemberDetail);
$("#memberDetailModal")?.addEventListener("click", (event) => {
  if (event.target === event.currentTarget) closeMemberDetail();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeMemberDetail();
  }
});
