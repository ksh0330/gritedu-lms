import { db, requireRole } from "/assets/js/firebase-init.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { normalizeCourseForReadOnly } from "/assets/js/utils/course-readonly.js";

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
  notFound: "일치 정보 없음",
  ambiguous: "복수 후보",
  invalidInput: "입력 확인 필요",
  notMember: "회원 정보 없음",
  notParent: "학부모 회원 아님",
  rateLimited: "시도 제한"
};

const DETAIL_SAMPLE_LIMIT = 3;
const ATTEMPT_LIMIT = 3;
const PAGE_SIZE = 10;
const TABLE_COLSPAN = 7;

const $ = (selector, root = document) => root.querySelector(selector);

let allMembers = [];
let filteredMembers = [];
let hasLoadedMembers = false;
let currentPage = 1;
const courseCache = new Map();
const offlineClassCache = new Map();

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

function getConsentStatusLabel(value) {
  return value === true ? "동의" : "미동의";
}

function getConsentSourceLabel(value) {
  const source = String(value || "").trim();
  const labels = {
    signup: "온라인 가입",
    admin: "관리자 등록",
    settings: "설정 변경"
  };
  return labels[source] || source || "미기록";
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
  if (meta) meta.textContent = text;
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
  setMeta("현황 불러오기를 누르면 회원 목록을 확인할 수 있습니다.");
  setTableMessage("현황 불러오기를 눌러 회원 목록을 불러오세요.");
  renderPagination();
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
    keyword: $("#memberKeywordFilter")?.value.trim().toLowerCase() || "",
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

function renderMembersTable() {
  const tbody = $("#membersTableBody");
  if (!tbody || !hasLoadedMembers) return;

  applyFilters();
  const totalPages = Math.max(1, Math.ceil(filteredMembers.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  if (!filteredMembers.length) {
    setTableMessage(allMembers.length ? "조건에 맞는 회원이 없습니다." : "등록된 회원이 없습니다.");
    setMeta(`전체 ${allMembers.length.toLocaleString("ko-KR")}명 / 표시 0명`);
    renderPagination();
    return;
  }

  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const endIndex = Math.min(startIndex + PAGE_SIZE, filteredMembers.length);
  const pageMembers = filteredMembers.slice(startIndex, endIndex);

  tbody.innerHTML = pageMembers.map((member) => {
    const uid = String(member.uid || "").trim();
    return `
      <tr>
        <td><span class="member-purpose-pill">${escapeHtml(getMemberPurposeLabel(member.memberPurpose))}</span></td>
        <td>${escapeHtml(member.name || "-")}</td>
        <td>${escapeHtml(member.email || "-")}</td>
        <td>${escapeHtml(member.phone || "-")}</td>
        <td>${escapeHtml(getSignupSourceLabel(member))}</td>
        <td>${escapeHtml(formatDate(member.createdAt))}</td>
        <td><button type="button" class="btn sm" data-member-detail="${escapeHtml(uid)}">상세</button></td>
      </tr>
    `;
  }).join("");

  setMeta(`전체 ${allMembers.length.toLocaleString("ko-KR")}명 / 표시 ${startIndex + 1}-${endIndex}명`);
  renderPagination();
}

function renderPagination() {
  const pagination = $("#memberPagination");
  if (!pagination) return;
  if (!hasLoadedMembers || filteredMembers.length <= PAGE_SIZE) {
    pagination.innerHTML = "";
    return;
  }

  const totalPages = Math.ceil(filteredMembers.length / PAGE_SIZE);
  const pageButtons = Array.from({ length: totalPages }, (_, index) => index + 1)
    .map((page) => `<button type="button" class="btn sm ${page === currentPage ? "primary" : ""}" data-member-page="${page}" ${page === currentPage ? "disabled" : ""}>${page}</button>`)
    .join("");

  pagination.innerHTML = `
    <button type="button" class="btn sm" data-member-page="${currentPage - 1}" ${currentPage <= 1 ? "disabled" : ""}>이전</button>
    ${pageButtons}
    <button type="button" class="btn sm" data-member-page="${currentPage + 1}" ${currentPage >= totalPages ? "disabled" : ""}>다음</button>
  `;
}

async function loadMembersPage() {
  const loadButton = $("#refreshMembersBtn");
  if (loadButton) loadButton.disabled = true;
  setTableMessage("회원 목록을 불러오는 중입니다.");
  setMeta("회원 목록을 불러오는 중입니다.");

  try {
    await loadMembers();
    hasLoadedMembers = true;
    currentPage = 1;
    if (loadButton) loadButton.textContent = "새로고침";
    renderMembersTable();
  } catch (error) {
    console.error("[admin-members] member list load failed", error);
    setTableMessage("회원 목록을 불러오지 못했습니다.");
    setMeta("회원 목록 로드 실패");
  } finally {
    if (loadButton) loadButton.disabled = false;
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

async function getCourseTitle(courseId) {
  const course = await loadCourse(courseId);
  return course?.title || "제목 없는 강좌";
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
  return Promise.all(enrollments.map(async (enrollment) => ({
    ...enrollment,
    courseTitle: await getCourseTitle(enrollment.courseId)
  })));
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
    name: student.name || snapshot.name || "이름 없음",
    school: student.school || snapshot.school || "-",
    grade: student.grade || snapshot.grade || "",
    linkedAt: link.createdAt || link.updatedAt || null,
    onlineRows,
    offlineRows
  };
}

async function loadMemberDetailData(uid) {
  // Detail reads are intentionally scoped to the selected member and linked children only.
  const memberRef = doc(db, "members", uid);
  const [memberSnap, enrollmentsSnap, linksSnap] = await Promise.all([
    getDoc(memberRef),
    getDocs(query(collection(db, "enrollments"), where("userId", "==", uid))),
    getDocs(query(collection(db, "studentParentLinks"), where("memberUid", "==", uid)))
  ]);
  const listMember = allMembers.find((item) => item.uid === uid) || {};
  const member = {
    uid,
    ...listMember,
    ...(memberSnap.exists() ? (memberSnap.data() || {}) : {})
  };
  const memberEnrollments = enrollmentsSnap.docs
    .map((docSnap) => docSnap.data() || {})
    .filter(isActiveRow);
  const linkedChildren = linksSnap.docs
    .map((docSnap) => docSnap.data() || {})
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
    const progress = Number.isFinite(Number(enrollment.progress)) ? Math.round(Number(enrollment.progress)) : 0;
    return `<li><strong>${escapeHtml(enrollment.courseTitle)}</strong> / 진도 ${Math.max(0, Math.min(100, progress))}% / ${escapeHtml(formatDate(enrollment.updatedAt || enrollment.createdAt))}</li>`;
  });

  return `<ul class="member-detail-list">${items.join("")}</ul>`;
}

function buildLinkedChildrenHtml(children = []) {
  if (!children.length) return '<div class="muted detail-empty">연결된 자녀가 없습니다.</div>';

  const items = children.map((child) => {
    const onlineItems = child.onlineRows.slice(0, DETAIL_SAMPLE_LIMIT).map((row) => row.courseTitle);
    const offlineItems = child.offlineRows.slice(0, DETAIL_SAMPLE_LIMIT);
    return `
      <li>
        <div class="member-detail-child-head">
          <strong>${escapeHtml(child.name)}</strong>
          <span>${escapeHtml(child.school || "-")} / ${escapeHtml(getGradeLabel(child.grade))} / 연동일 ${escapeHtml(formatDate(child.linkedAt))}</span>
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
      </li>
    `;
  });

  return `<ul class="member-detail-list">${items.join("")}</ul>`;
}

function buildAttemptsSection(uid) {
  return `
    <section class="member-detail-section">
      <div class="member-attempts-head">
        <h3>최근 자녀 연동 시도 3건</h3>
        <button type="button" class="btn sm" data-load-member-attempts="${escapeHtml(uid)}">최근 3건 보기</button>
      </div>
      <div id="memberAttemptsBody" class="member-attempts-body muted">자녀 연동 시도 기록은 운영 점검용으로만 사용됩니다.</div>
    </section>
  `;
}

async function openMemberDetail(uid) {
  const modal = $("#memberDetailModal");
  const body = $("#memberDetailBody");
  if (!modal || !body) return;

  body.innerHTML = '<p class="muted">회원 상세 정보를 불러오는 중입니다.</p>';
  modal.hidden = false;
  document.body.classList.add("modal-open");

  try {
    const detail = await loadMemberDetailData(uid);
    const { member, enrollments, children } = detail;
    const marketingConsent = getMarketingConsent(member);
    const consentRows = [
      ["이용약관 동의", getConsentStatusLabel(member.termsAgreed)],
      ["개인정보 동의", getConsentStatusLabel(member.privacyAgreed)],
      ["광고성 정보 수신", getMarketingConsentStatusLabel(marketingConsent)],
      ...getMarketingConsentDateRows(marketingConsent)
    ];
    const childOnlineTotal = children.reduce((sum, child) => sum + child.onlineRows.length, 0);
    const childOfflineTotal = children.reduce((sum, child) => sum + child.offlineRows.length, 0);
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
        <section class="member-detail-section">
          <h3>연결된 자녀 <span>${children.length.toLocaleString("ko-KR")}명</span></h3>
          <p class="muted">
            자녀 온라인 수강: <strong>${childOnlineTotal.toLocaleString("ko-KR")}개</strong>
            / 오프라인 반: <strong>${childOfflineTotal.toLocaleString("ko-KR")}개</strong>
          </p>
          ${buildLinkedChildrenHtml(children)}
        </section>
        ${buildAttemptsSection(uid)}
        <section class="member-detail-section">
          <h3>가입/수정일</h3>
          <dl class="member-detail-grid">
            <div><dt>가입일</dt><dd>${escapeHtml(formatDate(member.createdAt))}</dd></div>
            <div><dt>수정일</dt><dd>${escapeHtml(formatDate(member.updatedAt))}</dd></div>
          </dl>
        </section>
      </div>
    `;
  } catch (error) {
    console.error("[admin-members] detail load failed", error);
    body.innerHTML = '<p class="muted">회원 상세 정보를 불러오지 못했습니다.</p>';
  }
}

function closeMemberDetail() {
  const modal = $("#memberDetailModal");
  if (!modal) return;
  modal.hidden = true;
  document.body.classList.remove("modal-open");
}

async function loadRecentAttempts(uid) {
  const attemptsBody = $("#memberAttemptsBody");
  const attemptsButton = [...document.querySelectorAll("[data-load-member-attempts]")]
    .find((button) => button.getAttribute("data-load-member-attempts") === uid);
  if (!attemptsBody) return;

  attemptsBody.textContent = "최근 자녀 연동 시도를 불러오는 중입니다.";
  if (attemptsButton) attemptsButton.disabled = true;

  try {
    let snap;
    try {
      snap = await getDocs(query(
        collection(db, "memberChildLinkAttempts"),
        where("memberUid", "==", uid),
        orderBy("createdAt", "desc"),
        limit(ATTEMPT_LIMIT)
      ));
    } catch (orderedError) {
      console.warn("[admin-members] ordered attempts query failed; falling back to member-scoped query", orderedError);
      snap = await getDocs(query(collection(db, "memberChildLinkAttempts"), where("memberUid", "==", uid)));
    }

    const rows = snap.docs
      .map((docSnap) => docSnap.data() || {})
      .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
      .slice(0, ATTEMPT_LIMIT);

    if (!rows.length) {
      attemptsBody.innerHTML = '<div class="muted detail-empty">최근 자녀 연동 시도가 없습니다.</div>';
      return;
    }

    attemptsBody.classList.remove("muted");
    attemptsBody.innerHTML = `
      <ul class="member-detail-list">
        ${rows.map((row) => {
          const input = row.input || {};
          return `
            <li>
              <strong>${escapeHtml(formatDate(row.createdAt))}</strong>
              / ${escapeHtml(getAttemptResultLabel(row.result))}
              / ${escapeHtml(input.studentName || "자녀 이름 없음")}
            </li>
          `;
        }).join("")}
      </ul>
    `;
  } catch (error) {
    console.warn("[admin-members] attempts load failed", error);
    attemptsBody.innerHTML = '<div class="muted detail-empty">최근 자녀 연동 시도를 불러오지 못했습니다.</div>';
  } finally {
    if (attemptsButton) attemptsButton.hidden = true;
  }
}

[
  "#memberKeywordFilter",
  "#memberPurposeFilter",
  "#memberSignupSourceFilter"
].forEach((selector) => {
  $(selector)?.addEventListener("input", () => {
    currentPage = 1;
    renderMembersTable();
  });
  $(selector)?.addEventListener("change", () => {
    currentPage = 1;
    renderMembersTable();
  });
});

$("#refreshMembersBtn")?.addEventListener("click", loadMembersPage);

$("#membersTableBody")?.addEventListener("click", (event) => {
  const detailButton = event.target.closest("[data-member-detail]");
  if (!detailButton) return;
  openMemberDetail(detailButton.getAttribute("data-member-detail") || "");
});

$("#memberPagination")?.addEventListener("click", (event) => {
  const pageButton = event.target.closest("[data-member-page]");
  if (!pageButton) return;
  const nextPage = Number(pageButton.getAttribute("data-member-page"));
  if (!Number.isFinite(nextPage)) return;
  currentPage = nextPage;
  renderMembersTable();
});

$("#memberDetailBody")?.addEventListener("click", (event) => {
  const attemptsButton = event.target.closest("[data-load-member-attempts]");
  if (!attemptsButton) return;
  loadRecentAttempts(attemptsButton.getAttribute("data-load-member-attempts") || "");
});

$("#closeMemberDetailModal")?.addEventListener("click", closeMemberDetail);
$("#memberDetailModal")?.addEventListener("click", (event) => {
  if (event.target === event.currentTarget) closeMemberDetail();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMemberDetail();
});
