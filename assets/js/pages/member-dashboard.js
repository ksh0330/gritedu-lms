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
import { getCurrentCourseCompletion } from "/assets/js/utils/course-completion.js";
import { CONSENT_SOURCE_SETTINGS, LEGAL_POLICY_VERSION } from "/assets/js/utils/legal-policy.js";
import { loadSchoolCsvText } from "/assets/js/utils/school-csv.js";
import { getSettingDoc } from "/assets/js/utils/settings-cache.js";
import { withAsyncTimeout } from "/assets/js/utils/async-timeout.js";
import {
  getSubjectColorStyle,
  loadSharedSubjectColorMap,
  mergeSubjectColorMap,
} from "/assets/js/utils/subject-colors.js";

const functions = getFunctions(app, "us-central1");
const linkMemberChildFn = httpsCallable(functions, "linkMemberChild");
let subjectColorMap = mergeSubjectColorMap({});

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
  6: "고3",
  7: "졸업/N수"
};

const CHILD_LINK_FAILURE_MESSAGE = "입력한 학생 정보를 확인해 주세요.";
const CHILD_LINK_GENERIC_ERROR_MESSAGE = "자녀 연동 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
const MARKETING_CONSENT_DAILY_LIMIT = 3;
const MARKETING_CONSENT_LIMIT_MESSAGE = "광고성 정보 수신 설정은 하루 최대 3회까지 변경할 수 있습니다. 필요하면 학원으로 문의해 주세요.";
const MARKETING_CONSENT_SUCCESS_MESSAGE = "광고성 정보 수신 설정을 저장했습니다.";
const DASHBOARD_SAVE_ERROR_MESSAGE = "저장 중 문제가 발생했습니다. 다시 시도해 주세요.";
let schoolOptions = [];
let isChildLinkInFlight = false;

function getCallableErrorCode(error) {
  return String(error?.code || "").toLowerCase();
}

function getChildLinkResultMessage(result = {}) {
  const code = String(result.code || result.result || "");
  const messages = {
    notFound: "일치하는 학생 정보를 찾지 못했습니다. 학생의 등록 정보와 입력값을 다시 확인해 주세요.",
    invalidInput: "입력 형식을 확인해 주세요. 이름·학교·학년·전화번호와 관계를 모두 입력해야 합니다.",
    ambiguous: "같은 정보의 학생이 여러 명 확인됩니다. 안전한 연동을 위해 학원으로 문의해 주세요.",
    rateLimited: "연동 시도 횟수가 많습니다. 잠시 후 다시 시도해 주세요.",
    inactiveMember: "현재 회원 상태에서는 자녀를 연동할 수 없습니다. 학원으로 문의해 주세요.",
    notParent: "학부모 회원 계정에서만 자녀를 연동할 수 있습니다.",
    notMember: "회원 정보를 확인하지 못했습니다. 다시 로그인해 주세요."
  };
  return result.message || messages[code] || CHILD_LINK_FAILURE_MESSAGE;
}

function getChildLinkCallableErrorMessage(error) {
  const code = getCallableErrorCode(error);
  if (code.includes("unauthenticated")) return "로그인이 만료되었습니다. 다시 로그인해 주세요.";
  if (code.includes("resource-exhausted")) {
    return "연동 시도 횟수가 많습니다. 잠시 후 다시 시도해 주세요.";
  }
  if (code.includes("unavailable") || code.includes("deadline-exceeded")) {
    return "네트워크 연결이 불안정합니다. 잠시 후 다시 시도해 주세요.";
  }
  return CHILD_LINK_GENERIC_ERROR_MESSAGE;
}

function setChildLinkFormPending(form, submitButton, pending) {
  isChildLinkInFlight = pending;
  form.setAttribute("aria-busy", pending ? "true" : "false");
  Array.from(form.elements).forEach((control) => {
    if (pending) {
      control.dataset.childLinkWasDisabled = control.disabled ? "true" : "false";
      control.disabled = true;
      return;
    }
    control.disabled = control.dataset.childLinkWasDisabled === "true";
    delete control.dataset.childLinkWasDisabled;
  });
  submitButton.textContent = pending ? "연동 처리 중..." : "자녀 연동하기";
}

function lockDashboardScroll() {
  document.documentElement.classList.add("modal-open");
  document.body.classList.add("modal-open");
}

function unlockDashboardScroll() {
  document.documentElement.classList.remove("modal-open");
  document.body.classList.remove("modal-open");
}

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
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
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

const SCHEDULE_DAY_LABELS = {
  mon: "월",
  tue: "화",
  wed: "수",
  thu: "목",
  fri: "금",
  sat: "토",
  sun: "일",
};

function formatScheduleTime(value) {
  const text = String(value || "").trim();
  return text.length >= 5 ? text.slice(0, 5) : text;
}

function normalizeScheduleItems(source = {}, fieldName = "scheduleItems") {
  if (Array.isArray(source[fieldName]) && source[fieldName].length) {
    return source[fieldName].map((item) => ({
      day: String(item?.day || "").trim(),
      startTime: formatScheduleTime(item?.startTime),
      endTime: formatScheduleTime(item?.endTime),
      room: String(item?.room || "").trim(),
    })).filter((item) => item.day);
  }
  if (fieldName !== "scheduleItems") return [];
  const days = Array.isArray(source.scheduleDays) ? source.scheduleDays : [];
  return days.map((day) => ({
    day: String(day || "").trim(),
    startTime: formatScheduleTime(source.startTime),
    endTime: formatScheduleTime(source.endTime),
    room: String(source.room || "").trim(),
  })).filter((item) => item.day);
}

function formatScheduleLines(source, fieldName) {
  return normalizeScheduleItems(source, fieldName).map((item) => {
    const day = SCHEDULE_DAY_LABELS[item.day] || item.day;
    const time = item.startTime && item.endTime
      ? `${item.startTime}–${item.endTime}`
      : item.startTime || item.endTime;
    return [day, time, item.room].filter(Boolean).join(" ");
  });
}

function formatInstructorNames(source = {}) {
  const names = Array.isArray(source.instructorNames)
    ? source.instructorNames.map((name) => String(name || "").trim()).filter(Boolean)
    : [];
  return names.join(", ") || String(source.instructorName || "").trim();
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
  if (!["memberOnly", "approvalRequired"].includes(normalizeAccessType(course.accessType))) return false;
  const status = String(course.status || "").trim().toLowerCase();
  if (status !== "published") return false;
  const visibility = String(course.visibility || "public").trim().toLowerCase();
  if (visibility === "private" || visibility === "hidden") return false;
  if (course.deleted === true || course.isDeleted === true) return false;
  if (course.blocked === true || course.isBlocked === true) return false;
  return true;
}

function renderMemberCoursesEmpty(message) {
  const grid = document.getElementById("memberCoursesGrid");
  if (!grid) return;
  grid.innerHTML = `
    <div class="member-course-empty">
      <p>${escapeHtml(message)}</p>
      <a href="/courses" class="btn sm">전체 강좌 보기</a>
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
    const progress = row.completion?.progress;
    const progressText = progress == null ? "확인 불가" : `${progress}%`;
    const courseTitle = escapeHtml(course.title || "제목 없는 강좌");
    const instructorName = escapeHtml(course.instructorName || "강사 미정");
    const subjectValue = course.subjectLabel || course.subject || "일반";
    const subject = escapeHtml(subjectValue);
    const subjectColorStyle = getSubjectColorStyle(subjectValue, subjectColorMap);
    const grade = escapeHtml(course.gradeLabel || course.grade || "학년 미정");
    const year = escapeHtml(course.year || "연도 미정");
    const coursePath = `/members/member/course.html?courseId=${encodeURIComponent(courseId)}`;
    const detailPath = `/course-detail?courseId=${encodeURIComponent(courseId)}`;

    return `
      <article class="student-course-card${subjectColorStyle ? " has-subject-color" : ""}"${subjectColorStyle ? ` style="${subjectColorStyle}"` : ""}>
        <div class="student-dashboard-card-badges">
          <span class="student-dashboard-card-badge${subjectColorStyle ? " has-subject-color" : ""}"${subjectColorStyle ? ` style="${subjectColorStyle}"` : ""}>${subject}</span>
          <span class="student-dashboard-card-badge">${grade}</span>
          <span class="student-dashboard-card-badge">${year}</span>
        </div>
        <h3>${courseTitle}</h3>
        <p class="student-course-meta">강사: ${instructorName}</p>
        <div class="student-course-progress" aria-label="학습 완료율 ${progressText}">
          <div class="student-course-progress__head"><span>학습 완료율</span><strong>${progressText}</strong></div>
          <div class="student-course-progress__track" aria-hidden="true"><span style="width:${progress ?? 0}%"></span></div>
        </div>
        <div class="student-course-actions">
          <a class="btn primary sm" href="${coursePath}">강의 입장</a>
          <a class="btn sm" href="${detailPath}">상세 보기</a>
        </div>
      </article>
    `;
  }).join("");
}

function formatChildOnlineRows(rows, unavailable = false) {
  if (!rows.length) {
    return unavailable
      ? '<p class="muted">온라인 수강 정보를 불러오지 못했습니다.</p>'
      : '<p class="muted">온라인 수강 기록이 없습니다.</p>';
  }
  const warning = unavailable
    ? '<p class="muted">일부 강좌 정보를 불러오지 못했습니다.</p>'
    : "";
  return `
    ${warning}
    <ul class="member-child-detail-list">
      ${rows.map((row) => {
        const course = row.course || {};
        const enrollment = row.enrollment || {};
        const progress = row.completion?.progress;
        const subjectValue = course.subjectLabel || course.subject || "과목 미정";
        const subjectColorStyle = getSubjectColorStyle(subjectValue, subjectColorMap);
        const progressLabel = progress == null
          ? "학습 현황 확인 불가"
          : progress >= 100
          ? "수강 완료"
          : progress > 0
            ? `수강 중 (학습 완료율 ${progress}%)`
            : "수강 전";
        const progressType = progress == null ? "before" : progress >= 100 ? "complete" : progress > 0 ? "active" : "before";
        return `
          <li class="member-child-learning-card${subjectColorStyle ? " has-subject-color" : ""}"${subjectColorStyle ? ` style="${subjectColorStyle}"` : ""}>
            <div class="member-child-card-badges">
              <span class="member-child-subject-badge${subjectColorStyle ? " has-subject-color" : ""}">${escapeHtml(subjectValue)}</span>
            </div>
            <div class="member-child-course-title">
              <strong>${escapeHtml(course.title || enrollment.courseId || "제목 없는 강좌")}</strong>
              <span class="member-child-progress member-child-progress--${progressType}">${escapeHtml(progressLabel)}</span>
            </div>
            <dl class="member-child-course-meta">
              <div><dt>강사</dt><dd>${escapeHtml(course.instructorName || "강사 미정")}</dd></div>
            </dl>
          </li>
        `;
      }).join("")}
    </ul>
  `;
}

function formatChildOfflineRows(rows, unavailable = false) {
  if (!rows.length) {
    return unavailable
      ? '<p class="muted">오프라인 반 정보를 불러오지 못했습니다.</p>'
      : '<p class="muted">오프라인 반 기록이 없습니다.</p>';
  }
  const warning = unavailable
    ? '<p class="muted">일부 오프라인 반 정보를 불러오지 못했습니다.</p>'
    : "";
  return `
    ${warning}
    <ul class="member-child-detail-list">
      ${rows.map((row) => {
        const subjectValue = row.subject || "과목 미정";
        const subjectColorStyle = getSubjectColorStyle(subjectValue, subjectColorMap);
        const scheduleLines = row.scheduleVisible === false ? ["일정 비공개"] : formatScheduleLines(row, "scheduleItems");
        const clinicLines = row.scheduleVisible === false ? ["일정 비공개"] : formatScheduleLines(row, "clinicScheduleItems");
        const renderLines = (lines, fallback) => lines.length
          ? lines.map((line) => escapeHtml(line)).join("<br>")
          : escapeHtml(fallback);
        return `
          <li class="member-child-learning-card${subjectColorStyle ? " has-subject-color" : ""}"${subjectColorStyle ? ` style="${subjectColorStyle}"` : ""}>
            <div class="member-child-card-badges">
              <span class="member-child-subject-badge${subjectColorStyle ? " has-subject-color" : ""}">${escapeHtml(subjectValue)}</span>
            </div>
            <strong>${escapeHtml(row.className || "반명 미정")}</strong>
            <dl class="member-child-course-meta member-child-course-meta--offline">
              <div><dt>강사</dt><dd>${escapeHtml(row.instructorName || "강사 미정")}</dd></div>
              <div><dt>수업 일정</dt><dd>${renderLines(scheduleLines, "수업 일정 미정")}</dd></div>
              <div><dt>클리닉 일정</dt><dd>${renderLines(clinicLines, "클리닉 일정 미정")}</dd></div>
              <div><dt>입반일</dt><dd>${escapeHtml(formatDateOrFallback(row.joinedAtMillis || row.joinedAt, "입반일 미정"))}</dd></div>
            </dl>
          </li>
        `;
      }).join("")}
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
    const onlineCountLabel = row.onlineSummaryUnavailable && !onlineRows.length
      ? "온라인 확인 불가"
      : `온라인 ${onlineRows.length.toLocaleString("ko-KR")}`;
    const offlineCountLabel = row.offlineSummaryUnavailable && !offlineRows.length
      ? "오프라인 확인 불가"
      : `오프라인 ${offlineRows.length.toLocaleString("ko-KR")}`;
    return `
      <details class="member-linked-child-card">
        <summary class="member-linked-child-head">
          <div class="member-linked-child-identity">
            <strong>${escapeHtml(snapshot.name || "이름 없음")}</strong>
            <span>${escapeHtml(snapshot.school || "-")} · ${escapeHtml(formatGrade(snapshot.grade))} · ${escapeHtml(row.relationDisplay || formatRelation(row.relationLabel))}</span>
          </div>
          <div class="member-linked-child-summary-side">
            <div class="member-linked-child-counts" aria-label="자녀 수강 요약">
              <span>${escapeHtml(onlineCountLabel)}</span>
              <span>${escapeHtml(offlineCountLabel)}</span>
            </div>
            <span class="member-linked-child-toggle" aria-hidden="true"></span>
          </div>
        </summary>
        <div class="member-linked-child-body">
          <div class="member-child-profile-heading">
            <strong>학생 정보</strong>
            <span class="member-linked-child-date">연동일 ${escapeHtml(formatDate(row.createdAt))}</span>
          </div>
          <dl class="member-child-profile">
            <div><dt>학교</dt><dd>${escapeHtml(snapshot.school || "-")}</dd></div>
            <div><dt>학년</dt><dd>${escapeHtml(formatGrade(snapshot.grade))}</dd></div>
            <div><dt>관계</dt><dd>${escapeHtml(row.relationDisplay || formatRelation(row.relationLabel))}</dd></div>
          </dl>
          <div class="member-child-details">
            <div class="member-child-detail-grid">
              <section>
                <h4>온라인 강좌 <span>${row.onlineSummaryUnavailable && !onlineRows.length ? "-" : onlineRows.length.toLocaleString("ko-KR")}</span></h4>
                ${formatChildOnlineRows(onlineRows, row.onlineSummaryUnavailable)}
              </section>
              <section>
                <h4>오프라인 반 <span>${row.offlineSummaryUnavailable && !offlineRows.length ? "-" : offlineRows.length.toLocaleString("ko-KR")}</span></h4>
                ${formatChildOfflineRows(offlineRows, row.offlineSummaryUnavailable)}
              </section>
            </div>
          </div>
        </div>
      </details>
    `;
  }).join("");
}

function loadCachedDocument(cache, collectionName, documentId) {
  const id = String(documentId || "").trim();
  if (!id) return Promise.resolve({data: null, failed: false});
  if (!cache.has(id)) {
    cache.set(id, getDoc(doc(db, collectionName, id))
      .then((snapshot) => ({
        data: snapshot.exists() ? {id: snapshot.id, ...snapshot.data()} : null,
        failed: false
      }))
      .catch((error) => {
        console.warn(`[member-dashboard] ${collectionName} document load failed`, id, error);
        return {data: null, failed: true};
      }));
  }
  return cache.get(id);
}

async function loadChildOnlineRows(studentUid, courseCache) {
  const uid = String(studentUid || "").trim();
  if (!uid) return {rows: [], unavailable: false};
  const enrollmentsSnapshot = await getDocs(query(collection(db, "enrollments"), where("userId", "==", uid)));
  const enrollmentRows = [];
  enrollmentsSnapshot.forEach((enrollDoc) => {
    const data = enrollDoc.data() || {};
    if (!isActiveEnrollment(data)) return;
    const courseId = String(data.courseId || "").trim();
    if (!courseId) return;
    enrollmentRows.push({ id: enrollDoc.id, ...data });
  });

  const rows = await Promise.all(enrollmentRows.map(async (enrollment) => {
    const result = await loadCachedDocument(courseCache, "courses", enrollment.courseId);
    const course = result.data ? normalizeCourseForReadOnly(result.data) : null;
    const completion = course && normalizeAccessType(course.accessType) !== "approvalRequired"
      ? getCurrentCourseCompletion(enrollment.courseId, course.weeks, enrollment.watchedVideos)
      : null;
    return {
      enrollment,
      course: course || {title: result.failed ? "강좌 정보 확인 불가" : "제목 없는 강좌"},
      completion,
      courseUnavailable: result.failed
    };
  }));
  return {rows, unavailable: rows.some((row) => row.courseUnavailable)};
}

async function loadChildOfflineRows(studentUid, offlineClassCache) {
  const uid = String(studentUid || "").trim();
  if (!uid) return {rows: [], unavailable: false};
  const membersSnapshot = await getDocs(query(collection(db, "offlineClassMembers"), where("studentUid", "==", uid)));
  const memberships = membersSnapshot.docs
    .map((memberDoc) => ({ id: memberDoc.id, ...memberDoc.data() }))
    .filter((data) => String(data.status || "active").trim() === "active")
    .filter((data) => String(data.classId || "").trim());

  const rows = await Promise.all(memberships.map(async (membership) => {
    const classId = String(membership.classId || "").trim();
    const result = await loadCachedDocument(offlineClassCache, "offlineClasses", classId);
    const classRow = result.data || {};
    return {
      classId,
      className: classRow.className || membership.classNameSnapshot || membership.className || (result.failed ? "반 정보 확인 불가" : ""),
      subject: classRow.subject || membership.subjectSnapshot || membership.subject || "",
      instructorName: formatInstructorNames(classRow) || membership.instructorNameSnapshot || membership.instructorName || "",
      scheduleVisible: classRow.scheduleVisible !== false,
      scheduleItems: classRow.scheduleItems || membership.scheduleItemsSnapshot || [],
      clinicScheduleItems: classRow.clinicScheduleItems || membership.clinicScheduleItemsSnapshot || [],
      scheduleDays: classRow.scheduleDays || membership.scheduleDaysSnapshot || [],
      startTime: classRow.startTime || membership.startTimeSnapshot || "",
      endTime: classRow.endTime || membership.endTimeSnapshot || "",
      room: classRow.room || membership.roomSnapshot || "",
      joinedAt: membership.joinedAt || membership.createdAt || null,
      classUnavailable: result.failed
    };
  }));
  return {
    rows: rows.sort((a, b) => String(a.className || "").localeCompare(String(b.className || ""), "ko")),
    unavailable: rows.some((row) => row.classUnavailable)
  };
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
    const courseCache = new Map();
    const offlineClassCache = new Map();
    await Promise.all(rows.map(async (row) => {
      const studentUid = String(row.studentUid || "").trim();
      try {
        const online = await loadChildOnlineRows(studentUid, courseCache);
        row.onlineRows = online.rows;
        row.onlineSummaryUnavailable = online.unavailable;
      } catch (error) {
        console.warn("[member-dashboard] child online summary failed", studentUid, error);
        row.onlineRows = [];
        row.onlineSummaryUnavailable = true;
      }
      try {
        const offline = await loadChildOfflineRows(studentUid, offlineClassCache);
        row.offlineRows = offline.rows;
        row.offlineSummaryUnavailable = offline.unavailable;
      } catch (error) {
        console.warn("[member-dashboard] child offline summary failed", studentUid, error);
        row.offlineRows = [];
        row.offlineSummaryUnavailable = true;
      }
    }));
    renderLinkedChildren(rows);
    return rows.length;
  } catch (error) {
    console.error("[member-dashboard] linked children load failed:", error);
    list.innerHTML = '<p class="muted">연동된 자녀를 불러오지 못했습니다.</p>';
    return 0;
  }
}

function initChildLinkForm(uid) {
  const form = document.getElementById("memberChildLinkForm");
  const submitButton = document.getElementById("memberChildLinkSubmit");
  if (!form || !submitButton) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (isChildLinkInFlight) return;
    setChildLinkMessage("");

    const payload = {
      studentName: document.getElementById("childStudentName")?.value.trim() || "",
      school: document.getElementById("childSchool")?.value.trim() || "",
      grade: document.getElementById("childGrade")?.value || "",
      studentPhone: normalizePhoneDigits(document.getElementById("childStudentPhone")?.value || ""),
      relationLabel: document.getElementById("childRelationLabel")?.value || "guardian",
    };

    setChildLinkFormPending(form, submitButton, true);
    setChildLinkMessage("학생 정보를 확인하고 연동하고 있습니다...", "info");

    try {
      const response = await withAsyncTimeout(linkMemberChildFn(payload));
      const result = response?.data || {};
      if (result.ok === true || result.success === true) {
        setChildLinkMessage(result.message || "자녀 계정이 연동되었습니다.", "success");
        form.reset();
        await loadLinkedChildren(uid);
      } else {
        setChildLinkMessage(getChildLinkResultMessage(result), "error");
      }
    } catch (error) {
      console.error("[member-dashboard] child link failed:", error);
      setChildLinkMessage(getChildLinkCallableErrorMessage(error), "error");
    } finally {
      setChildLinkFormPending(form, submitButton, false);
    }
  });
}

async function loadMemberCourses(uid) {
  const grid = document.getElementById("memberCoursesGrid");
  if (!uid || !grid) return;

  grid.innerHTML = `<p class="student-course-empty">수강 강좌를 불러오는 중입니다.</p>`;

  try {
    subjectColorMap = await loadSharedSubjectColorMap(getSettingDoc);
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
      return 0;
    }

    const courseRows = [];
    for (const courseId of courseIds) {
      try {
        const courseSnap = await getDoc(doc(db, "courses", courseId));
        if (!courseSnap.exists()) continue;
        const normalized = normalizeCourseForReadOnly({ id: courseSnap.id, ...courseSnap.data() });
        if (!isAvailableMemberCourse(normalized)) continue;
        let weeks = normalized.weeks;
        if (normalizeAccessType(normalized.accessType) === "approvalRequired") {
          try {
            const privateSnap = await getDoc(doc(db, "coursePrivateContent", courseId));
            weeks = privateSnap.exists() ? privateSnap.data()?.weeks : null;
          } catch (error) {
            console.warn("[member-dashboard] protected course content unavailable", courseId, error);
            weeks = null;
          }
        }
        const enrollment = enrollmentByCourseId.get(courseId);
        courseRows.push({
          course: normalized,
          enrollment,
          completion: Array.isArray(weeks)
            ? getCurrentCourseCompletion(courseId, weeks, enrollment.watchedVideos)
            : null
        });
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
    return courseRows.length;
  } catch (error) {
    console.error("[member-dashboard] member courses load failed:", error);
    renderMemberCoursesEmpty("수강 강좌를 불러오는 중 오류가 발생했습니다.");
    return 0;
  }
}

function configureDashboardForPurpose(memberPurpose) {
  const isParent = memberPurpose === "parent";
  const coursesCta = document.getElementById("memberCoursesCta");
  const parentSection = document.getElementById("memberParentSection");
  const coursesSection = document.getElementById("memberCoursesSection");
  const childLinkPlaceholder = document.getElementById("memberChildLinkPlaceholder");

  if (coursesCta) coursesCta.hidden = isParent;
  if (parentSection) parentSection.hidden = !isParent;
  if (coursesSection) coursesSection.hidden = isParent;
  if (childLinkPlaceholder) childLinkPlaceholder.hidden = !isParent;
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
    unlockDashboardScroll();
    setMemberProfileMessage("");
    openButton.focus({ preventScroll: true });
  };

  openButton.addEventListener("click", () => {
    populateMemberProfileForm(member, user);
    setMemberProfileMessage("");
    modal.hidden = false;
    lockDashboardScroll();
    closeButton?.focus({ preventScroll: true });
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
    unlockDashboardScroll();
    if (saveButton) saveButton.disabled = false;
    openButton.focus({ preventScroll: true });
  };

  openButton.addEventListener("click", () => {
    input.checked = isMarketingConsentEnabled(member.marketingConsent || {});
    modal.hidden = false;
    lockDashboardScroll();
    closeButton?.focus({ preventScroll: true });
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
    unlockDashboardScroll();
    openButton.focus({ preventScroll: true });
  };

  openButton.addEventListener("click", () => {
    modal.hidden = false;
    lockDashboardScroll();
    closeButton?.focus({ preventScroll: true });
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
      subjectColorMap = await loadSharedSubjectColorMap(getSettingDoc);
      await loadLinkedChildren(user.uid);
    } else {
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
