import { app, db, requireRole } from "/assets/js/firebase-init.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-functions.js";
import { normalizeAccessType, normalizeCourseForReadOnly } from "/assets/js/utils/course-readonly.js";
import { CONSENT_SOURCE_SETTINGS, LEGAL_POLICY_VERSION } from "/assets/js/utils/legal-policy.js";
import { loadSchoolCsvText } from "/assets/js/utils/school-csv.js";

const functions = getFunctions(app, "us-central1");
const linkMemberChildFn = httpsCallable(functions, "linkMemberChild");

const MEMBER_PURPOSE_LABELS = {
  parent: "학부모 회원",
  general: "일반 회원",
};

const SIGNUP_SOURCE_LABELS = {
  search: "인터넷 검색",
  friend: "지인 소개",
  sns: "SNS",
  ad: "광고, 홍보",
  other: "기타"
};

const RELATION_LABELS = {
  father: "부",
  mother: "모",
  guardian: "보호자"
};

const GRADE_LABELS = {
  1: "중1",
  2: "중2",
  3: "중3",
  4: "고1",
  5: "고2",
  6: "고3"
};

const CHILD_LINK_FAILURE_MESSAGE = "입력한 학생 정보를 확인해 주세요.";
const CHILD_LINK_GENERIC_ERROR_MESSAGE = "자녀 연동 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
const MARKETING_CONSENT_DAILY_LIMIT = 3;
const MARKETING_CONSENT_LIMIT_MESSAGE = "광고성 정보 수신 설정은 하루 최대 3회까지 변경할 수 있습니다. 필요하면 학원으로 문의해 주세요.";
const MARKETING_CONSENT_SUCCESS_MESSAGE = "광고성 정보 수신 설정을 저장했습니다.";
const DASHBOARD_SAVE_ERROR_MESSAGE = "저장 중 문제가 발생했습니다. 다시 시도해 주세요.";
let schoolOptions = [];

function setText(id, value) {
  const element = document.getElementById(id);
  if (!element) return;
  element.textContent = value || "-";
  element.classList.remove("dashboard-skeleton", "dashboard-skeleton--stat", "dashboard-skeleton--text");
}

function formatMemberPurpose(value) {
  return MEMBER_PURPOSE_LABELS[value] || value || "-";
}

function formatSignupSource(member = {}) {
  const source = String(member.signupSource || "").trim();
  if (!source) return "";
  const label = SIGNUP_SOURCE_LABELS[source] || source;
  const other = String(member.signupSourceOther || "").trim();
  return source === "other" && other ? `${label} (${other})` : label;
}

function escapeHtml(value) {
  if (value == null) return "";
  const div = document.createElement("div");
  div.textContent = String(value);
  return div.innerHTML;
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  return 0;
}

function formatDate(value) {
  const millis = toMillis(value);
  if (!millis) return "-";
  return new Date(millis).toLocaleDateString("ko-KR");
}

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isMarketingConsentEnabled(consent = {}) {
  return consent?.sms === true && consent?.email === true;
}

function createMarketingConsentUpdate(checked, currentConsent = {}) {
  const now = serverTimestamp();
  return {
    sms: checked,
    email: checked,
    agreedAt: checked ? now : currentConsent.agreedAt || null,
    updatedAt: now,
    withdrawnAt: checked ? null : now,
    source: CONSENT_SOURCE_SETTINGS,
    policyVersion: LEGAL_POLICY_VERSION
  };
}

function createMarketingLimitError() {
  const error = new Error(MARKETING_CONSENT_LIMIT_MESSAGE);
  error.code = "marketing-consent-limit";
  return error;
}

function setMemberProfileMessage(message, type = "") {
  const element = document.getElementById("memberProfileMessage");
  if (!element) return;
  element.textContent = message || "";
  element.dataset.type = type;
}

function showDashboardToast(message, type = "success") {
  const toastApi = window.toast;
  if (toastApi?.[type]) {
    toastApi[type](message);
    return;
  }
  if (typeof toastApi === "function") {
    toastApi(message, type);
    return;
  }
  console[type === "error" ? "error" : "log"](message);
}

function formatDateOrFallback(value, fallback) {
  const formatted = formatDate(value);
  return formatted === "-" ? fallback : formatted;
}

function formatGrade(value) {
  const key = String(value || "").trim();
  return GRADE_LABELS[key] || key || "-";
}

function formatRelation(value) {
  return RELATION_LABELS[value] || value || "-";
}

function summarizeScheduleDays(source = {}) {
  if (Array.isArray(source.scheduleItems) && source.scheduleItems.length) {
    const days = source.scheduleItems
      .map((item) => String(item?.day || "").trim())
      .filter(Boolean);
    if (days.length) return [...new Set(days)].join(", ");
  }
  if (Array.isArray(source.scheduleDays) && source.scheduleDays.length) {
    const days = source.scheduleDays
      .map((day) => String(day || "").trim())
      .filter(Boolean);
    if (days.length) return [...new Set(days)].join(", ");
  }
  const day = String(source.day || "").trim();
  return day;
}

function setChildLinkMessage(message, type = "") {
  const element = document.getElementById("memberChildLinkMessage");
  if (!element) return;
  element.textContent = message || "";
  element.dataset.type = type;
}

function normalizePhoneDigits(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 11);
}

function formatPhoneNumber(value) {
  const digits = normalizePhoneDigits(value);
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

async function saveMemberProfile(uid, payload) {
  const name = String(payload.name || "").trim();
  const phone = String(payload.phone || "").trim();
  const memberRef = doc(db, "members", uid);

  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(memberRef);
    if (!snap.exists()) {
      throw new Error("회원 정보를 찾을 수 없습니다.");
    }

    transaction.update(memberRef, {
      name,
      phone,
      updatedAt: serverTimestamp()
    });
  });

  return { name, phone };
}

async function saveMemberMarketingConsent(uid, checked) {
  const memberRef = doc(db, "members", uid);

  return runTransaction(db, async (transaction) => {
    const snap = await transaction.get(memberRef);
    if (!snap.exists()) {
      throw new Error("회원 정보를 찾을 수 없습니다.");
    }

    const currentData = snap.data() || {};
    const currentConsent = currentData.marketingConsent || {};
    const currentMarketingEnabled = isMarketingConsentEnabled(currentConsent);
    const nextMarketingEnabled = checked === true;

    if (currentMarketingEnabled === nextMarketingEnabled) {
      return { changed: false };
    }

    const today = getLocalDateKey();
    const currentDate = String(currentData.marketingConsentChangeDate || "");
    const currentCount = Number(currentData.marketingConsentChangeCount || 0);
    const nextCount = currentDate === today ? currentCount + 1 : 1;

    if (currentDate === today && currentCount >= MARKETING_CONSENT_DAILY_LIMIT) {
      throw createMarketingLimitError();
    }

    transaction.update(memberRef, {
      marketingConsent: createMarketingConsentUpdate(nextMarketingEnabled, currentConsent),
      marketingConsentChangeDate: today,
      marketingConsentChangeCount: nextCount,
      updatedAt: serverTimestamp()
    });

    return { changed: true };
  });
}

function setupChildPhoneFormatting() {
  const input = document.getElementById("childStudentPhone");
  if (!input) return;
  input.addEventListener("input", () => {
    input.value = formatPhoneNumber(input.value);
  });
}

function parseSchoolCsv(text) {
  const names = new Set();
  String(text || "").split(/\r?\n/).forEach((line) => {
    const cells = line
      .split(",")
      .map((cell) => cell.replace(/^"|"$/g, "").trim())
      .filter(Boolean);
    const schoolName = cells.find((cell) => /학교$/.test(cell));
    if (schoolName) names.add(schoolName);
  });
  return Array.from(names).sort((a, b) => a.localeCompare(b, "ko"));
}

async function setupChildSchoolOptions() {
  const input = document.getElementById("childSchool");
  const optionsRoot = document.getElementById("childSchoolOptions");
  if (!input || !optionsRoot) return;

  try {
    schoolOptions = parseSchoolCsv(await loadSchoolCsvText());
  } catch (error) {
    console.warn("[member-dashboard] school list load failed:", error);
  }

  const renderOptions = () => {
    const keyword = input.value.trim().toLowerCase();
    const matches = schoolOptions
      .filter((school) => !keyword || school.toLowerCase().includes(keyword))
      .slice(0, 12);

    if (!matches.length) {
      optionsRoot.hidden = true;
      input.setAttribute("aria-expanded", "false");
      return;
    }

    optionsRoot.innerHTML = matches.map((school) => `
      <button type="button" class="member-school-option" role="option" data-school="${escapeHtml(school)}">${escapeHtml(school)}</button>
    `).join("");
    optionsRoot.hidden = false;
    input.setAttribute("aria-expanded", "true");
  };

  input.addEventListener("input", renderOptions);
  input.addEventListener("focus", renderOptions);
  optionsRoot.addEventListener("mousedown", (event) => {
    const option = event.target.closest("[data-school]");
    if (!option) return;
    event.preventDefault();
    input.value = option.getAttribute("data-school") || "";
    optionsRoot.hidden = true;
    input.setAttribute("aria-expanded", "false");
  });
  document.addEventListener("click", (event) => {
    if (event.target === input || optionsRoot.contains(event.target)) return;
    optionsRoot.hidden = true;
    input.setAttribute("aria-expanded", "false");
  });
}

function isActiveEnrollment(row) {
  return String(row?.status || "active").trim() === "active";
}

function isAvailableMemberCourse(course) {
  if (!course || typeof course !== "object") return false;
  if (normalizeAccessType(course.accessType) !== "memberOnly") return false;
  const status = String(course.status || "").trim().toLowerCase();
  if (status !== "published") return false;
  const visibility = String(course.visibility || "public").trim().toLowerCase();
  if (visibility === "private" || visibility === "hidden") return false;
  if (course.deleted === true || course.isDeleted === true) return false;
  if (course.blocked === true || course.isBlocked === true) return false;
  return true;
}

function getProgress(enrollment) {
  const parsed = Number(enrollment?.progress);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function setMemberCoursesMeta(text) {
  const meta = document.getElementById("memberCoursesMeta");
  if (meta) meta.textContent = text;
}

function setCourseCountSummary(count) {
  setText("memberCourseCountSummary", `${Number(count || 0).toLocaleString("ko-KR")}개`);
}

function renderMemberCoursesEmpty(message) {
  const grid = document.getElementById("memberCoursesGrid");
  if (!grid) return;
  grid.innerHTML = `
    <div class="member-course-empty">
      <p>${escapeHtml(message)}</p>
      <a href="/courses.html" class="btn sm">전체 강좌 보기</a>
    </div>
  `;
}

function renderMemberCourses(courseRows) {
  const grid = document.getElementById("memberCoursesGrid");
  if (!grid) return;

  if (!courseRows.length) {
    renderMemberCoursesEmpty("수강 중인 온라인 강좌가 없습니다.");
    return;
  }

  grid.innerHTML = courseRows.map((row) => {
    const course = row.course;
    const enrollment = row.enrollment;
    const courseId = String(enrollment.courseId || course.id || "").trim();
    const progress = getProgress(enrollment);
    const courseTitle = escapeHtml(course.title || "제목 없는 강좌");
    const instructorName = escapeHtml(course.instructorName || "강사 미정");
    const subject = escapeHtml(course.subjectLabel || course.subject || "일반");
    const grade = escapeHtml(course.gradeLabel || course.grade || "학년 미정");
    const year = escapeHtml(course.year || "연도 미정");
    const coursePath = `/members/member/course.html?courseId=${encodeURIComponent(courseId)}`;
    const detailPath = `/course-detail.html?courseId=${encodeURIComponent(courseId)}`;

    return `
      <article class="student-course-card">
        <h3>${courseTitle}</h3>
        <p class="student-course-meta">${subject} | ${grade} | ${year}</p>
        <p class="student-course-meta">강사: ${instructorName}</p>
        <p class="student-course-progress">학습 진도: ${progress}%</p>
        <div class="student-course-actions">
          <a class="btn primary sm" href="${coursePath}">강의 입장</a>
          <a class="btn sm" href="${detailPath}">상세 보기</a>
        </div>
      </article>
    `;
  }).join("");
}

function formatChildOnlineRows(rows) {
  if (!rows.length) return '<p class="muted">온라인 수강 기록이 없습니다.</p>';
  return `
    <ul class="member-child-detail-list">
      ${rows.map((row) => {
        const course = row.course || {};
        const enrollment = row.enrollment || {};
        const progress = getProgress(enrollment);
        return `
          <li>
            <strong>${escapeHtml(course.title || enrollment.courseId || "제목 없는 강좌")}</strong>
            <span>${escapeHtml(course.subjectLabel || course.subject || "과목 미정")} / ${escapeHtml(course.instructorName || "강사 미정")} / 진도 ${progress}%</span>
          </li>
        `;
      }).join("")}
    </ul>
  `;
}

function formatChildOfflineRows(rows) {
  if (!rows.length) return '<p class="muted">오프라인 반 기록이 없습니다.</p>';
  return `
    <ul class="member-child-detail-list">
      ${rows.map((row) => `
        <li>
          <strong>${escapeHtml(row.className || "반명 미정")}</strong>
          <span>강사: ${escapeHtml(row.instructorName || "강사 미정")}</span>
          <span>요일: ${escapeHtml(row.scheduleSummary || "요일 미정")}</span>
          <span>입반일: ${escapeHtml(formatDateOrFallback(row.joinedAt, "입반일 미정"))}</span>
        </li>
      `).join("")}
    </ul>
  `;
}

function renderLinkedChildren(rows) {
  const list = document.getElementById("memberLinkedChildrenList");
  if (!list) return;

  if (!rows.length) {
    list.innerHTML = '<p class="muted">아직 연동된 자녀가 없습니다.</p>';
    return;
  }

  list.innerHTML = rows.map((row) => {
    const snapshot = row.studentSnapshot || {};
    const onlineRows = row.onlineRows || [];
    const offlineRows = row.offlineRows || [];
    return `
      <article class="member-linked-child-card">
        <div class="member-linked-child-head">
          <div>
            <strong>${escapeHtml(snapshot.name || "이름 없음")}</strong>
            <span>${escapeHtml(snapshot.school || "-")} / ${escapeHtml(formatGrade(snapshot.grade))} / 관계 ${escapeHtml(row.relationDisplay || formatRelation(row.relationLabel))}</span>
          </div>
          <span class="member-linked-child-date">연동일 ${escapeHtml(formatDate(row.createdAt))}</span>
        </div>
        <div class="member-linked-child-counts" aria-label="자녀 요약">
          <span>온라인 ${onlineRows.length.toLocaleString("ko-KR")}개</span>
          <span>오프라인 ${offlineRows.length.toLocaleString("ko-KR")}개</span>
        </div>
        <details class="member-child-details">
          <summary>자녀 수강 요약 보기</summary>
          <div class="member-child-detail-grid">
            <section>
              <h4>온라인 강좌</h4>
              ${formatChildOnlineRows(onlineRows)}
            </section>
            <section>
              <h4>오프라인 반</h4>
              ${formatChildOfflineRows(offlineRows)}
            </section>
          </div>
        </details>
      </article>
    `;
  }).join("");
}

async function loadChildOnlineRows(studentUid) {
  const uid = String(studentUid || "").trim();
  if (!uid) return [];
  const enrollmentsSnapshot = await getDocs(query(collection(db, "enrollments"), where("userId", "==", uid)));
  const enrollmentRows = [];
  enrollmentsSnapshot.forEach((enrollDoc) => {
    const data = enrollDoc.data() || {};
    if (!isActiveEnrollment(data)) return;
    const courseId = String(data.courseId || "").trim();
    if (!courseId) return;
    enrollmentRows.push({ id: enrollDoc.id, ...data });
  });

  const rows = [];
  for (const enrollment of enrollmentRows) {
    let course = null;
    try {
      const courseSnap = await getDoc(doc(db, "courses", enrollment.courseId));
      course = courseSnap.exists()
        ? normalizeCourseForReadOnly({ id: courseSnap.id, ...courseSnap.data() })
        : null;
    } catch (error) {
      console.warn("[member-dashboard] child course load failed", enrollment.courseId, error);
    }
    rows.push({ enrollment, course: course || { title: "제목 없는 강좌" } });
  }
  return rows;
}

async function loadChildOfflineRows(studentUid) {
  const uid = String(studentUid || "").trim();
  if (!uid) return [];
  const membersSnapshot = await getDocs(query(collection(db, "offlineClassMembers"), where("studentUid", "==", uid)));
  const rows = [];
  membersSnapshot.forEach((memberDoc) => {
    const data = memberDoc.data() || {};
    if (String(data.status || "active").trim() !== "active") return;
    rows.push({
      className: data.classNameSnapshot || data.className || "",
      instructorName: data.instructorNameSnapshot || data.instructorName || "",
      scheduleSummary: data.scheduleSummarySnapshot || data.scheduleSummary || summarizeScheduleDays(data),
      joinedAt: data.joinedAt || data.createdAt || null
    });
  });
  return rows;
}

async function loadLinkedChildren(uid) {
  const list = document.getElementById("memberLinkedChildrenList");
  if (!uid || !list) return 0;

  list.innerHTML = '<p class="muted">연동된 자녀를 불러오는 중입니다.</p>';
  try {
    const linksSnapshot = await getDocs(query(collection(db, "studentParentLinks"), where("memberUid", "==", uid)));
    const rows = [];
    linksSnapshot.forEach((linkDoc) => {
      const data = linkDoc.data() || {};
      if (data.status !== "active") return;
      rows.push({ id: linkDoc.id, ...data });
    });

    rows.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
    for (const row of rows) {
      const studentUid = String(row.studentUid || "").trim();
      try {
        row.onlineRows = await loadChildOnlineRows(studentUid);
      } catch (error) {
        console.warn("[member-dashboard] child online summary failed", studentUid, error);
        row.onlineRows = [];
      }
      try {
        row.offlineRows = await loadChildOfflineRows(studentUid);
      } catch (error) {
        console.warn("[member-dashboard] child offline summary failed", studentUid, error);
        row.offlineRows = [];
        row.offlineSummaryUnavailable = true;
      }
    }
    renderLinkedChildren(rows);
    const onlineTotal = rows.reduce((sum, row) => sum + (row.onlineRows?.length || 0), 0);
    const offlineTotal = rows.reduce((sum, row) => sum + (row.offlineRows?.length || 0), 0);
    setText("memberCourseCountSummary", `${rows.length.toLocaleString("ko-KR")}명`);
    setText("memberChildCountSummary", `${onlineTotal.toLocaleString("ko-KR")}개`);
    setText("memberPurposeSummary", `${offlineTotal.toLocaleString("ko-KR")}개`);
    return rows.length;
  } catch (error) {
    console.error("[member-dashboard] linked children load failed:", error);
    list.innerHTML = '<p class="muted">연동된 자녀를 불러오지 못했습니다.</p>';
    setText("memberCourseCountSummary", "0명");
    setText("memberChildCountSummary", "0개");
    setText("memberPurposeSummary", "0개");
    return 0;
  }
}

function initChildLinkForm(uid) {
  const form = document.getElementById("memberChildLinkForm");
  const submitButton = document.getElementById("memberChildLinkSubmit");
  if (!form || !submitButton) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setChildLinkMessage("");

    const payload = {
      studentName: document.getElementById("childStudentName")?.value.trim() || "",
      school: document.getElementById("childSchool")?.value.trim() || "",
      grade: document.getElementById("childGrade")?.value || "",
      studentPhone: normalizePhoneDigits(document.getElementById("childStudentPhone")?.value || ""),
      relationLabel: document.getElementById("childRelationLabel")?.value || "guardian",
    };

    submitButton.disabled = true;
    submitButton.textContent = "연동 확인 중...";

    try {
      const response = await linkMemberChildFn(payload);
      const result = response?.data || {};
      if (result.ok === true || result.success === true) {
        setChildLinkMessage(result.message || "자녀 계정이 연동되었습니다.", "success");
        form.reset();
      } else {
        setChildLinkMessage(result.message || CHILD_LINK_FAILURE_MESSAGE, "error");
      }
      await loadLinkedChildren(uid);
    } catch (error) {
      console.error("[member-dashboard] child link failed:", error);
      setChildLinkMessage(CHILD_LINK_GENERIC_ERROR_MESSAGE, "error");
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "자녀 연동하기";
    }
  });
}

async function loadMemberCourses(uid) {
  const grid = document.getElementById("memberCoursesGrid");
  if (!uid || !grid) return;

  setMemberCoursesMeta("수강 강좌를 불러오는 중입니다.");
  grid.innerHTML = `<p class="student-course-empty">수강 강좌를 불러오는 중입니다.</p>`;

  try {
    const enrollmentsSnapshot = await getDocs(query(collection(db, "enrollments"), where("userId", "==", uid)));
    const enrollmentByCourseId = new Map();

    enrollmentsSnapshot.forEach((enrollDoc) => {
      const data = enrollDoc.data() || {};
      if (!isActiveEnrollment(data)) return;
      const courseId = String(data.courseId || "").trim();
      if (!courseId) return;
      const existing = enrollmentByCourseId.get(courseId);
      const nextSort = Math.max(toMillis(data.updatedAt), toMillis(data.createdAt));
      const currentSort = existing ? Math.max(toMillis(existing.updatedAt), toMillis(existing.createdAt)) : -1;
      if (!existing || nextSort >= currentSort) {
        enrollmentByCourseId.set(courseId, { id: enrollDoc.id, ...data });
      }
    });

    const courseIds = Array.from(enrollmentByCourseId.keys());
    if (!courseIds.length) {
      renderMemberCoursesEmpty("수강 중인 온라인 강좌가 없습니다.");
      setMemberCoursesMeta("아직 수강 신청한 강좌가 없습니다.");
      setCourseCountSummary(0);
      return 0;
    }

    const courseRows = [];
    for (const courseId of courseIds) {
      try {
        const courseSnap = await getDoc(doc(db, "courses", courseId));
        if (!courseSnap.exists()) continue;
        const normalized = normalizeCourseForReadOnly({ id: courseSnap.id, ...courseSnap.data() });
        if (!isAvailableMemberCourse(normalized)) continue;
        courseRows.push({ course: normalized, enrollment: enrollmentByCourseId.get(courseId) });
      } catch (error) {
        console.warn("[member-dashboard] failed to load course doc", courseId, error);
      }
    }

    courseRows.sort((a, b) => {
      const aTime = Math.max(toMillis(a.enrollment?.updatedAt), toMillis(a.enrollment?.createdAt));
      const bTime = Math.max(toMillis(b.enrollment?.updatedAt), toMillis(b.enrollment?.createdAt));
      return bTime - aTime;
    });

    renderMemberCourses(courseRows);
    setMemberCoursesMeta(`수강 중인 강좌 ${courseRows.length}개`);
    setCourseCountSummary(courseRows.length);
    return courseRows.length;
  } catch (error) {
    console.error("[member-dashboard] member courses load failed:", error);
    renderMemberCoursesEmpty("수강 강좌를 불러오는 중 오류가 발생했습니다.");
    setMemberCoursesMeta("수강 강좌를 불러오지 못했습니다.");
    setCourseCountSummary(0);
    return 0;
  }
}

function configureDashboardForPurpose(memberPurpose) {
  const isParent = memberPurpose === "parent";
  const summaryStats = document.getElementById("memberSummaryStats");
  const coursesCta = document.getElementById("memberCoursesCta");
  const parentSection = document.getElementById("memberParentSection");
  const coursesSection = document.getElementById("memberCoursesSection");
  const childLinkPlaceholder = document.getElementById("memberChildLinkPlaceholder");
  const childSummaryCard = document.getElementById("memberChildSummaryCard");
  const tertiarySummaryCard = document.getElementById("memberTertiarySummaryCard");

  if (summaryStats) summaryStats.dataset.purpose = isParent ? "parent" : "general";
  if (coursesCta) coursesCta.hidden = isParent;
  if (parentSection) parentSection.hidden = !isParent;
  if (coursesSection) coursesSection.hidden = isParent;
  if (childLinkPlaceholder) childLinkPlaceholder.hidden = !isParent;
  if (childSummaryCard) childSummaryCard.hidden = !isParent;
  if (tertiarySummaryCard) tertiarySummaryCard.hidden = !isParent;

  if (isParent) {
    setText("memberPrimarySummaryLabel", "연동 자녀");
    setText("memberChildSummaryLabel", "자녀 온라인 수강");
    setText("memberTertiarySummaryLabel", "자녀 오프라인 반");
    setText("memberCourseCountSummary", "0명");
    setText("memberChildCountSummary", "0개");
    setText("memberPurposeSummary", "0개");
    return;
  }

  setText("memberPrimarySummaryLabel", "내 온라인 강좌");
}

function populateMemberProfileForm(member = {}, user = {}) {
  const nameInput = document.getElementById("memberNameInput");
  const phoneInput = document.getElementById("memberPhoneInput");

  if (nameInput) nameInput.value = member.name || user.displayName || "";
  if (phoneInput) phoneInput.value = member.phone || "";
}

function setupMemberInfoModal(uid, member, user) {
  const modal = document.getElementById("memberInfoModal");
  const openButton = document.getElementById("openMemberInfoBtn");
  const closeButton = document.getElementById("closeMemberInfoModal");
  const form = document.getElementById("memberProfileForm");
  const saveButton = document.getElementById("memberProfileSaveBtn");
  if (!modal || !openButton) return;

  const close = () => {
    modal.hidden = true;
    document.body.classList.remove("modal-open");
    setMemberProfileMessage("");
  };

  openButton.addEventListener("click", () => {
    populateMemberProfileForm(member, user);
    setMemberProfileMessage("");
    modal.hidden = false;
    document.body.classList.add("modal-open");
    closeButton?.focus();
  });
  closeButton?.addEventListener("click", close);
  document.getElementById("cancelMemberProfileBtn")?.addEventListener("click", close);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) close();
  });

  const phoneInput = document.getElementById("memberPhoneInput");
  phoneInput?.addEventListener("input", () => {
    phoneInput.value = formatPhoneNumber(phoneInput.value);
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!uid) return;

    const name = document.getElementById("memberNameInput")?.value.trim() || "";
    const phone = document.getElementById("memberPhoneInput")?.value.trim() || "";

    if (!name || !phone) {
      setMemberProfileMessage("이름과 연락처를 입력해 주세요.", "error");
      return;
    }

    setMemberProfileMessage("저장 중입니다.");
    if (saveButton) saveButton.disabled = true;

    try {
      const saved = await saveMemberProfile(uid, { name, phone });
      member.name = saved.name;
      member.phone = saved.phone;
      populateMemberProfileForm(member, user);
      close();
      showDashboardToast("정보가 저장되었습니다.", "success");
    } catch (error) {
      console.error("[member-dashboard] profile save failed:", error);
      showDashboardToast(DASHBOARD_SAVE_ERROR_MESSAGE, "error");
    } finally {
      if (saveButton) saveButton.disabled = false;
    }
  });
}

function setupMemberMarketingConsentModal(uid, member) {
  const modal = document.getElementById("memberMarketingConsentModal");
  const openButton = document.getElementById("openMemberMarketingConsentBtn");
  const closeButton = document.getElementById("closeMemberMarketingConsentModal");
  const cancelButton = document.getElementById("cancelMemberMarketingConsentBtn");
  const form = document.getElementById("memberMarketingConsentForm");
  const input = document.getElementById("memberMarketingConsentInput");
  const saveButton = document.getElementById("memberMarketingConsentSaveBtn");
  if (!modal || !openButton || !form || !input) return;

  const close = () => {
    modal.hidden = true;
    document.body.classList.remove("modal-open");
    if (saveButton) saveButton.disabled = false;
  };

  openButton.addEventListener("click", () => {
    input.checked = isMarketingConsentEnabled(member.marketingConsent || {});
    modal.hidden = false;
    document.body.classList.add("modal-open");
    closeButton?.focus();
  });
  closeButton?.addEventListener("click", close);
  cancelButton?.addEventListener("click", close);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) close();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (saveButton) saveButton.disabled = true;

    try {
      const result = await saveMemberMarketingConsent(uid, input.checked === true);
      if (result?.changed !== false) {
        member.marketingConsent = {
          ...(member.marketingConsent || {}),
          sms: input.checked === true,
          email: input.checked === true
        };
      }
      showDashboardToast(result?.changed === false ? "변경된 내용이 없습니다." : MARKETING_CONSENT_SUCCESS_MESSAGE, "success");
      close();
    } catch (error) {
      console.error("[member-dashboard] marketing consent save failed:", error);
      const message = error?.code === "marketing-consent-limit"
        ? MARKETING_CONSENT_LIMIT_MESSAGE
        : DASHBOARD_SAVE_ERROR_MESSAGE;
      showDashboardToast(message, "error");
    } finally {
      if (saveButton) saveButton.disabled = false;
    }
  });
}

function setupMemberAccountDeletionModal() {
  const modal = document.getElementById("memberAccountDeletionModal");
  const openButton = document.getElementById("openMemberAccountDeletionBtn");
  const closeButton = document.getElementById("closeMemberAccountDeletionModal");
  if (!modal || !openButton) return;

  const close = () => {
    modal.hidden = true;
    document.body.classList.remove("modal-open");
  };

  openButton.addEventListener("click", () => {
    modal.hidden = false;
    document.body.classList.add("modal-open");
    closeButton?.focus();
  });
  closeButton?.addEventListener("click", close);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) close();
  });
}

(async () => {
  const statusEl = document.getElementById("memberDashboardStatus");

  try {
    const { user } = await requireRole("member");
    const memberSnap = await getDoc(doc(db, "members", user.uid));
    const member = memberSnap.exists() ? memberSnap.data() : {};

    setText("memberEmailCell", member.email || user.email || "");
    setText("memberPurposeCell", formatMemberPurpose(member.memberPurpose));
    setText("memberPurposeSummary", formatMemberPurpose(member.memberPurpose));
    setText("memberCreatedAtCell", formatDate(member.createdAt));
    populateMemberProfileForm(member, user);

    const purposeBadge = document.getElementById("memberPurposeBadge");
    if (purposeBadge) purposeBadge.textContent = formatMemberPurpose(member.memberPurpose);

    const signupSourceText = formatSignupSource(member);
    const signupSourceRow = document.getElementById("memberSignupSourceRow");
    if (signupSourceRow) signupSourceRow.hidden = member.memberPurpose !== "general" || !signupSourceText;
    setText("memberSignupSourceCell", signupSourceText);

    const createdAtRow = document.getElementById("memberCreatedAtRow");
    if (createdAtRow) createdAtRow.hidden = !toMillis(member.createdAt);

    setupMemberInfoModal(user.uid, member, user);
    setupMemberMarketingConsentModal(user.uid, member);
    setupMemberAccountDeletionModal();
    configureDashboardForPurpose(member.memberPurpose);

    if (member.memberPurpose === "parent") {
      setupChildPhoneFormatting();
      setupChildSchoolOptions();
      initChildLinkForm(user.uid);
      await loadLinkedChildren(user.uid);
    } else {
      setText("memberPurposeSummary", formatMemberPurpose(member.memberPurpose));
      await loadMemberCourses(user.uid);
    }

    if (statusEl) {
      statusEl.textContent = "";
      statusEl.hidden = true;
    }
  } catch (error) {
    console.error("[member-dashboard] initialization failed:", error);
    if (statusEl) {
      statusEl.textContent = "회원 정보를 불러오지 못했습니다. 다시 로그인해 주세요.";
      statusEl.hidden = false;
      statusEl.style.color = "var(--error-color)";
    }
  }
})();
