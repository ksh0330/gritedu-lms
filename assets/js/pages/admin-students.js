// /assets/js/pages/admin-students.js
// 학생 관리 페이지
import { db, requireRole } from "/assets/js/firebase-init.js";
import {
  doc, getDoc, serverTimestamp,
  collection, getDocs, query, where, writeBatch
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { formatGrade, normalizeGrade } from "/assets/js/utils/grade.js";
import { openAdminConfirm } from "/assets/js/utils/admin-dialog.js";
import { setAdminRefreshButtonState } from "/assets/js/utils/admin-refresh.js";
import {
  bindCommittedSearch,
  normalizeListPageSize,
  renderListPagination,
} from "/assets/js/utils/list-controls.js";
import * as XLSX from "https://cdn.sheetjs.com/xlsx-latest/package/xlsx.mjs";
import { adminXlsxFilename, writeAdminXlsx } from "/assets/js/utils/admin-xlsx.js";
import { fetchExportDocuments, fetchScopedExportRows } from "/assets/js/utils/admin-export-scope.js";
import { showAdminToast } from "/assets/js/utils/admin-toast.js";

// 역할 가드: 관리자만 접근 가능
(async () => {
  try {
    await requireRole("admin", "/members/login.html");
  } catch (err) {
    // requireRole에서 이미 리다이렉션 처리됨
  }
})();

const $ = (s, r = document) => r.querySelector(s);

function toast(msg, err = false) {
  showAdminToast(msg, err);
}

// 학생 목록 로드
const tbody = $("#tblStudents")?.querySelector('tbody');
const searchInput = $("#searchStudents");
let allStudents = [];
let filteredStudents = [];
let studentCourseDetails = {}; // 학생별 온라인 강의 상세 정보
let studentOfflineClassDetails = {}; // 학생별 오프라인 반 상세 정보
let studentCourseIds = {}; // 학생별 활성 온라인 강의 ID
let studentOfflineClassIds = {}; // 학생별 활성 오프라인 반 ID
let courseEnrollmentCounts = {}; // 학생별 온라인 강의 수 캐시
let offlineClassCounts = {}; // 학생별 오프라인 반 수 캐시
const courseTitlePromises = new Map();
const offlineClassNamePromises = new Map();
const studentSummaryErrors = new Set();
let currentPage = 1;
let itemsPerPage = 10;
let appliedSearchKeyword = "";
const summaryQueryChunkSize = 10;
const maxAtomicOfflineMemberSnapshotUpdates = 499;
let studentRenderToken = 0;
let hasLoadedStudentStatus = false;
let isStudentStatusLoading = false;
let enrollmentDetailReturnFocus = null;
let enrollmentDetailRequest = 0;

function isActiveEnrollment(row) {
  return String(row?.status || "active").trim() === "active";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatCountBadge(count) {
  return `${Number(count || 0).toLocaleString("ko-KR")}개`;
}

function formatDate(value) {
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  if (!date || Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("ko-KR");
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

function getMarketingConsent(user = {}) {
  return user.marketingConsent && typeof user.marketingConsent === "object"
    ? user.marketingConsent
    : {};
}

function getMarketingConsentStatusLabel(consent = {}) {
  const sms = consent.sms === true;
  const email = consent.email === true;
  if (sms && email) return "동의";
  if (!sms && !email) return "미동의";
  return "일부 동의";
}

function getMarketingConsentDateRows(consent = {}) {
  const sms = consent.sms === true;
  const email = consent.email === true;

  if (sms && email) {
    return [["광고성 정보 수신일", formatDate(consent.agreedAt || consent.updatedAt)]];
  }

  if (!sms && !email && consent.withdrawnAt) {
    return [["광고성 정보 철회일", formatDate(consent.withdrawnAt)]];
  }

  if (!sms && !email) {
    return [["광고성 정보 수신일", "-"]];
  }

  return [["광고성 정보 수신일", formatDate(consent.updatedAt)]];
}

function getSignupSourceLabel(user = {}) {
  const rawSource = String(user.signupSource || user.source || "").trim().toLowerCase();
  if (rawSource) {
    const sourceMap = {
      sns: "SNS",
      friend: "친구 권유",
      ad: "광고/홍보",
      ads: "광고/홍보",
      promotion: "광고/홍보",
      other: user.signupSourceOther || user.sourceOther || "기타",
      signup: "회원가입",
      self: "회원가입",
      user: "회원가입",
      admin: "관리자 등록",
      manual: "관리자 등록",
      bulk: "일괄 등록",
      import: "일괄 등록"
    };
    return sourceMap[rawSource] || user.signupSource || user.source;
  }
  if (user.createdBy) return "관리자 등록";
  return "-";
}

function getSignupSourceValue(user = {}) {
  const rawSource = String(user.signupSource || user.source || "").trim().toLowerCase();
  if (["sns", "friend", "ad", "ads", "promotion", "other"].includes(rawSource)) {
    return rawSource === "ads" || rawSource === "promotion" ? "ad" : rawSource;
  }
  if (["signup", "self", "user"].includes(rawSource)) return "signup";
  if (["admin", "manual"].includes(rawSource) || user.createdBy) return "admin";
  if (["bulk", "import"].includes(rawSource)) return "bulk";
  return rawSource;
}

function setStudentStatusButtonsLoading(loading) {
  const loadBtn = $("#loadStudentsStatus");
  const refreshBtn = $("#refreshBtn");
  const downloadBtn = $("#dlStudents");

  if (loadBtn) {
    loadBtn.hidden = hasLoadedStudentStatus;
    loadBtn.disabled = loading;
    loadBtn.textContent = loading ? "불러오는 중..." : "현황 불러오기";
  }
  if (refreshBtn) {
    refreshBtn.hidden = !hasLoadedStudentStatus;
    setAdminRefreshButtonState(refreshBtn, loading, {
      disabledWhenReady: !hasLoadedStudentStatus,
    });
  }
  if (downloadBtn) {
    downloadBtn.disabled = loading || !hasLoadedStudentStatus || !filteredStudents.length;
    downloadBtn.title = !hasLoadedStudentStatus
      ? "학생 현황을 불러온 뒤 다운로드할 수 있습니다"
      : (filteredStudents.length ? "현재 검색 결과 전체를 엑셀로 다운로드" : "다운로드할 학생이 없습니다");
  }
}

function hasStudentSummary(uid) {
  return Object.prototype.hasOwnProperty.call(courseEnrollmentCounts, uid) &&
    Object.prototype.hasOwnProperty.call(offlineClassCounts, uid);
}

function resetStudentSummaryCache() {
  studentCourseDetails = {};
  studentOfflineClassDetails = {};
  studentCourseIds = {};
  studentOfflineClassIds = {};
  courseEnrollmentCounts = {};
  offlineClassCounts = {};
  courseTitlePromises.clear();
  offlineClassNamePromises.clear();
  studentSummaryErrors.clear();
}

function uniqueActiveIds(snapshot, idField) {
  const ids = new Set();
  snapshot.forEach((docSnap) => {
    const data = docSnap.data() || {};
    if (!isActiveEnrollment(data)) return;
    const id = String(data[idField] || "").trim();
    if (id) ids.add(id);
  });
  return Array.from(ids);
}

function buildOfflineMemberSnapshots({name, school, grade, phone}) {
  return {
    studentNameSnapshot: String(name || "").trim(),
    schoolSnapshot: String(school || "").trim(),
    gradeSnapshot: normalizeGrade(grade),
    phoneSnapshot: String(phone || "").trim(),
  };
}

function needsOfflineMemberSnapshotSync(current, snapshots) {
  return Object.entries(snapshots).some(([field, value]) =>
    String(current?.[field] ?? "") !== String(value ?? "")
  );
}

async function saveStudentWithOfflineMemberSnapshots(uid, profile) {
  const memberSnapshot = await getDocs(query(
    collection(db, "offlineClassMembers"),
    where("studentUid", "==", uid)
  ));
  const snapshots = buildOfflineMemberSnapshots(profile);
  const memberDocsToSync = memberSnapshot.docs.filter((memberDoc) =>
    needsOfflineMemberSnapshotSync(memberDoc.data(), snapshots)
  );

  if (memberDocsToSync.length > maxAtomicOfflineMemberSnapshotUpdates) {
    throw new Error("오프라인 반 배정이 너무 많아 학생 정보를 한 번에 저장할 수 없습니다.");
  }

  const updatedAt = serverTimestamp();
  const studentPayload = {
    name: snapshots.studentNameSnapshot,
    phone: snapshots.phoneSnapshot,
    school: snapshots.schoolSnapshot,
    grade: snapshots.gradeSnapshot,
    signupSource: String(profile.signupSource || "").trim(),
    signupSourceOther: String(profile.signupSourceOther || "").trim(),
    note: String(profile.note || "").trim(),
    updatedAt,
  };
  const email = String(profile.email || "").trim();
  if (email) studentPayload.email = email;
  if (typeof profile.gradeManualOverride === "boolean") {
    studentPayload.gradeManualOverride = profile.gradeManualOverride;
  }
  if (Number.isInteger(profile.lastAutoPromotionYear)) {
    studentPayload.lastAutoPromotionYear = profile.lastAutoPromotionYear;
  }

  const batch = writeBatch(db);
  batch.set(doc(db, "students", uid), studentPayload, {merge: true});
  memberDocsToSync.forEach((memberDoc) => {
    batch.update(memberDoc.ref, {...snapshots, updatedAt});
  });
  await batch.commit();

  return memberDocsToSync.length;
}

function chunkValues(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function buildUidConstraint(field, uids) {
  return uids.length === 1
    ? where(field, "==", uids[0])
    : where(field, "in", uids);
}

function collectActiveIdsByUid(snapshot, userField, idField, targetMap) {
  snapshot.forEach((docSnap) => {
    const data = docSnap.data() || {};
    if (!isActiveEnrollment(data)) return;
    const uid = String(data[userField] || "").trim();
    const id = String(data[idField] || "").trim();
    if (!uid || !id || !targetMap.has(uid)) return;
    targetMap.get(uid).add(id);
  });
}

async function loadStudentSummaryChunk(uids) {
  const courseIdsByUid = new Map(uids.map((uid) => [uid, new Set()]));
  const classIdsByUid = new Map(uids.map((uid) => [uid, new Set()]));

  try {
    const [enrollmentsSnap, offlineMembersSnap] = await Promise.all([
      getDocs(query(
        collection(db, "enrollments"),
        buildUidConstraint("userId", uids)
      )),
      getDocs(query(
        collection(db, "offlineClassMembers"),
        buildUidConstraint("studentUid", uids)
      ))
    ]);

    collectActiveIdsByUid(
      enrollmentsSnap,
      "userId",
      "courseId",
      courseIdsByUid
    );
    collectActiveIdsByUid(
      offlineMembersSnap,
      "studentUid",
      "classId",
      classIdsByUid
    );

    uids.forEach((uid) => {
      studentCourseIds[uid] = Array.from(courseIdsByUid.get(uid));
      studentOfflineClassIds[uid] = Array.from(classIdsByUid.get(uid));
      courseEnrollmentCounts[uid] = studentCourseIds[uid].length;
      offlineClassCounts[uid] = studentOfflineClassIds[uid].length;
      studentSummaryErrors.delete(uid);
    });
    return true;
  } catch (error) {
    console.warn("[admin-students] summary batch load failed:", uids, error);
    uids.forEach((uid) => studentSummaryErrors.add(uid));
    return false;
  }
}

async function loadStudentSummaries(students, {retryErrors = false} = {}) {
  const uids = [...new Set(students
    .filter((student) => student?.role === "student")
    .map((student) => String(student.uid || "").trim())
    .filter((uid) =>
      uid &&
      !hasStudentSummary(uid) &&
      (retryErrors || !studentSummaryErrors.has(uid))
    ))];
  let failedCount = 0;
  for (const uidChunk of chunkValues(uids, summaryQueryChunkSize)) {
    const succeeded = await loadStudentSummaryChunk(uidChunk);
    if (!succeeded) failedCount += uidChunk.length;
  }
  return failedCount;
}

async function resolveCourseTitle(courseId) {
  if (!courseTitlePromises.has(courseId)) {
    courseTitlePromises.set(courseId, (async () => {
      try {
        const snap = await getDoc(doc(db, "courses", courseId));
        if (!snap.exists()) return "삭제되었거나 확인 불가한 강좌";
        const data = snap.data() || {};
        return data.title || "제목 없는 강좌";
      } catch (_error) {
        return "삭제되었거나 확인 불가한 강좌";
      }
    })());
  }
  return courseTitlePromises.get(courseId);
}

async function resolveOfflineClassName(classId) {
  if (!offlineClassNamePromises.has(classId)) {
    offlineClassNamePromises.set(classId, (async () => {
      try {
        const snap = await getDoc(doc(db, "offlineClasses", classId));
        if (!snap.exists()) return "삭제되었거나 확인 불가한 반";
        const data = snap.data() || {};
        return data.className || data.title || data.name || "이름 없는 반";
      } catch (_error) {
        return "삭제되었거나 확인 불가한 반";
      }
    })());
  }
  return offlineClassNamePromises.get(classId);
}

async function loadStudentEnrollmentDetail(uid) {
  const hasCourseDetails = Object.prototype.hasOwnProperty.call(studentCourseDetails, uid);
  const hasOfflineDetails = Object.prototype.hasOwnProperty.call(studentOfflineClassDetails, uid);
  if (hasCourseDetails && hasOfflineDetails) {
    return {
      onlineCourses: studentCourseDetails[uid] || [],
      offlineClasses: studentOfflineClassDetails[uid] || []
    };
  }

  let courseIds = studentCourseIds[uid];
  let classIds = studentOfflineClassIds[uid];
  if (!Array.isArray(courseIds) || !Array.isArray(classIds)) {
    const [enrollmentsSnap, offlineMembersSnap] = await Promise.all([
      getDocs(query(collection(db, "enrollments"), where("userId", "==", uid))),
      getDocs(query(collection(db, "offlineClassMembers"), where("studentUid", "==", uid)))
    ]);
    courseIds = uniqueActiveIds(enrollmentsSnap, "courseId");
    classIds = uniqueActiveIds(offlineMembersSnap, "classId");
    studentCourseIds[uid] = courseIds;
    studentOfflineClassIds[uid] = classIds;
    courseEnrollmentCounts[uid] = courseIds.length;
    offlineClassCounts[uid] = classIds.length;
    studentSummaryErrors.delete(uid);
  }

  const [onlineCourses, offlineClasses] = await Promise.all([
    Promise.all(courseIds.map(async (courseId) => ({
      courseId,
      title: await resolveCourseTitle(courseId)
    }))),
    Promise.all(classIds.map(async (classId) => ({
      classId,
      className: await resolveOfflineClassName(classId)
    })))
  ]);

  studentCourseDetails[uid] = onlineCourses.sort((a, b) => a.title.localeCompare(b.title, "ko"));
  studentOfflineClassDetails[uid] = offlineClasses.sort((a, b) => a.className.localeCompare(b.className, "ko"));
  courseEnrollmentCounts[uid] = studentCourseDetails[uid].length;
  offlineClassCounts[uid] = studentOfflineClassDetails[uid].length;

  return {
    onlineCourses: studentCourseDetails[uid],
    offlineClasses: studentOfflineClassDetails[uid]
  };
}

// Load all users list
async function loadAllUsers() {
  const studentsSnapshot = await getDocs(collection(db, "students"));
  const studentsList = [];
  studentsSnapshot.forEach((docSnap) => {
    const data = docSnap.data() || {};
    studentsList.push({
      ...data,
      uid: docSnap.id,
      role: 'student',
      grade: normalizeGrade(data.grade)
    });
  });

  allStudents = studentsList;
}

if (tbody) {
  tbody.innerHTML = '<tr><td colspan="9" class="muted">학생 현황을 불러오려면 상단의 현황 불러오기를 눌러주세요.</td></tr>';
  setStudentStatusButtonsLoading(false);
}

window.loadStudentStatus = async () => {
  if (isStudentStatusLoading) return;
  isStudentStatusLoading = true;
  hasLoadedStudentStatus = false;
  setStudentStatusButtonsLoading(true);
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="9" class="muted">학생 현황을 불러오는 중입니다.</td></tr>';
  }
  try {
    resetStudentSummaryCache();
    await loadAllUsers();
    currentPage = 1;
    const failedCount = await applyFilters({
      resetPage: false,
      loadSummaries: true,
    });
    hasLoadedStudentStatus = true;
    if (failedCount > 0) {
      toast(`학생 ${failedCount}명의 수강 현황을 불러오지 못했습니다.`, true);
    } else {
      toast("학생 현황을 불러왔습니다.");
    }
  } catch (error) {
    console.error("User list load failed:", error);
    toast("학생 목록을 불러오지 못했습니다. 현황 불러오기 또는 새로고침으로 다시 시도해 주세요.", true);
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="9" class="muted">학생 목록을 불러오지 못했습니다.</td></tr>';
    }
  } finally {
    isStudentStatusLoading = false;
    setStudentStatusButtonsLoading(false);
  }
};

window.refreshStudents = async () => {
  if (!hasLoadedStudentStatus) return;
  await window.loadStudentStatus();
};

$("#refreshBtn")?.addEventListener("click", window.refreshStudents);

// 검색 적용
async function applyFilters({resetPage = true, loadSummaries = true} = {}) {
  let filtered = [...allStudents];

  // 검색 필터
  const keyword = appliedSearchKeyword;
  if (keyword) {
    filtered = filtered.filter(user => {
      const name = (user.name || '').toLowerCase();
      const email = (user.email || '').toLowerCase();
      const school = (user.school || '').toLowerCase();
      const phone = (user.phone || '').toLowerCase();
      return name.includes(keyword) || email.includes(keyword) || school.includes(keyword) || phone.includes(keyword);
    });
  }

  filteredStudents = filtered;
  setStudentStatusButtonsLoading(isStudentStatusLoading);
  if (resetPage) currentPage = 1;
  return renderStudents(filtered, {loadSummaries});
}

// 입력 중에는 결과를 바꾸지 않고 Enter/검색 버튼으로만 메모리 필터를 적용한다.
bindCommittedSearch(searchInput, $("#studentsSearchButton"), (keyword) => {
  appliedSearchKeyword = keyword;
  applyFilters({resetPage: true, loadSummaries: false});
});

$("#studentsPageSize")?.addEventListener("change", (event) => {
  itemsPerPage = normalizeListPageSize(event.target.value);
  currentPage = 1;
  applyFilters({resetPage: false, loadSummaries: true});
});

// 학생 목록은 최신순으로 고정 정렬
function sortStudents(students) {
  const sorted = [...students];

  sorted.sort((a, b) => {
    const aVal = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
    const bVal = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
    return bVal - aVal;
  });

  return sorted;
}

// 통계 업데이트
function updateStudentStats() {
  const total = allStudents.length;
  const studentsCount = allStudents.filter(s => s.role === 'student').length;
  // parents feature disabled (policy OFF, 2024-12-19) - parentsCount 제거
  const loadedStudents = allStudents.filter(s => s.role === 'student' && hasStudentSummary(s.uid));
  const enrolled = loadedStudents.filter(s => ((courseEnrollmentCounts[s.uid] || 0) > 0 || (offlineClassCounts[s.uid] || 0) > 0)).length;
  
  const statTotal = $("#statTotal");
  const statStudents = $("#statStudents");
  // parents feature disabled (policy OFF, 2024-12-19) - statParents 제거
  const statEnrolled = $("#statEnrolled");
  
  if (statTotal) statTotal.textContent = total;
  if (statStudents) statStudents.textContent = studentsCount;
  // if (statParents) statParents.textContent = parentsCount; 제거됨
  if (statEnrolled) {
    statEnrolled.textContent = loadedStudents.length ? `${enrolled}+` : "-";
    statEnrolled.title = "현재 조회된 학생 요약 기준입니다. 전체 수강생 산정은 LMS 집계 또는 상세 조회를 사용하세요.";
  }
}

async function renderStudents(students, {loadSummaries = true} = {}) {
  if (!tbody) return;
  const renderToken = ++studentRenderToken;

  let sortedStudents = sortStudents(students);
  if (sortedStudents.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="muted">조건에 맞는 학생이 없습니다.</td></tr>';
    renderPagination(0);
    return;
  }

  const totalPages = Math.ceil(sortedStudents.length / itemsPerPage);
  if (currentPage > totalPages) currentPage = totalPages || 1;
  if (currentPage < 1) currentPage = 1;

  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const studentsToShow = sortedStudents.slice(startIndex, endIndex);
  const failedCount = loadSummaries
    ? await loadStudentSummaries(studentsToShow)
    : 0;
  if (renderToken !== studentRenderToken) return failedCount;
  updateStudentStats(allStudents);

  const rows = await Promise.all(studentsToShow.map(async user => {
    const isStudent = user.role === 'student';
    const courseCount = isStudent ? (courseEnrollmentCounts[user.uid] || user.courseEnrollmentCount || 0) : 0;
    const offlineCount = isStudent ? (offlineClassCounts[user.uid] || user.offlineClassCount || 0) : 0;
    const summaryFailed = studentSummaryErrors.has(user.uid);
    const summaryMissing = !hasStudentSummary(user.uid);
    const courseCountLabel = summaryFailed
      ? "조회 실패"
      : summaryMissing ? "미조회" : formatCountBadge(courseCount);
    const offlineCountLabel = summaryFailed
      ? "조회 실패"
      : summaryMissing ? "미조회" : formatCountBadge(offlineCount);

    const schoolDisplay = user.school || '-';
    const gradeDisplay = formatGrade(user.grade);
    const signupSourceDisplay = getSignupSourceLabel(user);

    const managementButtons = isStudent
      ? `<div class="student-action-buttons">
          <button class="btn sm" onclick="openEnrollmentDetailModal('${user.uid}')" title="학생 상세 정보">상세</button>
          <button class="btn sm" onclick="editUser('${user.uid}', '${user.role}')" title="학생 정보 수정">수정</button>
        </div>`
      : `<div class="student-action-buttons">
          <button class="btn sm" onclick="editUser('${user.uid}', '${user.role}')" title="학생 정보 수정">수정</button>
        </div>`;

    const phoneDisplay = user.phone || '-';

    return `
    <tr>
      <td><strong>${escapeHtml(user.name || '-')}</strong></td>
      <td>${escapeHtml(schoolDisplay)}</td>
      <td>${gradeDisplay}</td>
      <td style="font-size:13px;">${escapeHtml(phoneDisplay)}</td>
      <td style="font-size:12px;color:var(--muted);">${escapeHtml(user.email || '-')}</td>
      <td>${escapeHtml(signupSourceDisplay)}</td>
      <td><span class="count-chip">${courseCountLabel}</span></td>
      <td><span class="count-chip count-chip--offline">${offlineCountLabel}</span></td>
      <td>${managementButtons}</td>
    </tr>
    `;
  }));

  tbody.innerHTML = rows.join('');

  renderPagination(sortedStudents.length);
  return failedCount;
}

// Pagination UI
function renderPagination(totalItems) {
  const state = renderListPagination($("#paginationContainer"), {
    currentPage,
    itemLabel: "명",
    onPageChange: (page) => window.goToPage(page),
    pageSize: itemsPerPage,
    totalItems,
  });
  currentPage = state.currentPage;
}

// 페이지 이동 함수
window.goToPage = async (page) => {
  currentPage = page;
  await applyFilters({resetPage: false, loadSummaries: true});
};

// 사용자 수정/삭제 기능
let currentEditUser = null;

// 사용자 수정 모달 열기
window.editUser = async (uid, role) => {
  const user = allStudents.find(u => u.uid === uid);
  if (!user) {
    toast("사용자 정보를 찾을 수 없습니다.", true);
    return;
  }

  currentEditUser = { uid, role, ...user };

  const modal = $("#editUserModal");
  const nameInput = $("#editUserName");
  const schoolInput = $("#editUserSchool");
  const gradeInput = $("#editUserGrade");
  const phoneInput = $("#editUserPhone");
  const signupSourceInput = $("#editUserSignupSource");
  const signupSourceOtherInput = $("#editUserSignupSourceOther");
  const signupSourceOtherGroup = $("#editUserSignupSourceOtherGroup");
  const noteInput = $("#editUserNote");

  if (modal && nameInput) {
    nameInput.value = user.name || '';
    if (phoneInput) phoneInput.value = user.phone || '';
    if (signupSourceInput) signupSourceInput.value = getSignupSourceValue(user);
    if (signupSourceOtherInput) signupSourceOtherInput.value = user.signupSourceOther || user.sourceOther || '';
    if (signupSourceOtherGroup) signupSourceOtherGroup.style.display = signupSourceInput?.value === "other" ? "" : "none";
    if (noteInput) noteInput.value = user.note || '';
    
    if (role === "student") {
      if (schoolInput) schoolInput.value = user.school || "";
      if (gradeInput) gradeInput.value = normalizeGrade(user.grade);
      const schoolGroup = $("#editUserSchoolGroup");
      const gradeGroup = $("#editUserGradeGroup");
      if (schoolGroup) schoolGroup.style.display = "";
      if (gradeGroup) gradeGroup.style.display = "";
    }

    modal.style.display = 'flex';
    document.body.classList.add('modal-open');
    document.documentElement.classList.add('modal-open');
  }
};

// 사용자 수정 모달 닫기
window.closeEditModal = () => {
  const modal = $("#editUserModal");
  if (modal) {
    modal.style.display = 'none';
    document.body.classList.remove('modal-open');
    document.documentElement.classList.remove('modal-open');
    currentEditUser = null;
  }
  const form = $("#editUserForm");
  if (form) form.reset();
};

// 사용자 수정 폼 제출
const editUserForm = $("#editUserForm");
$("#editUserSignupSource")?.addEventListener("change", (event) => {
  const otherGroup = $("#editUserSignupSourceOtherGroup");
  if (otherGroup) {
    otherGroup.style.display = event.target.value === "other" ? "" : "none";
  }
});

if (editUserForm) {
  editUserForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    if (!currentEditUser) {
      toast("수정할 사용자 정보가 없습니다.", true);
      return;
    }

    const nameInput = $("#editUserName");
    const schoolInput = $("#editUserSchool");
    const gradeInput = $("#editUserGrade");
    const phoneInput = $("#editUserPhone");
    const signupSourceInput = $("#editUserSignupSource");
    const signupSourceOtherInput = $("#editUserSignupSourceOther");
    const noteInput = $("#editUserNote");

    if (!nameInput || !nameInput.value.trim()) {
      toast("이름을 입력해주세요.", true);
      return;
    }

    const newName = nameInput.value.trim();
    const newSchool = schoolInput ? schoolInput.value.trim() : '';
    const newGrade = gradeInput ? normalizeGrade(gradeInput.value) : '';
    const newPhone = phoneInput ? phoneInput.value.trim() : '';
    const newSignupSource = signupSourceInput ? signupSourceInput.value.trim() : '';
    const newSignupSourceOther = newSignupSource === "other" && signupSourceOtherInput
      ? signupSourceOtherInput.value.trim()
      : '';
    const newNote = noteInput ? noteInput.value.trim() : '';

    try {
      const { uid, role } = currentEditUser;
      if (role !== "student") {
        throw new Error("Parents feature is currently disabled (policy OFF).");
      }

      const gradeChanged = normalizeGrade(currentEditUser.grade) !== newGrade;
      await saveStudentWithOfflineMemberSnapshots(uid, {
        name: newName,
        school: newSchool,
        phone: newPhone,
        grade: newGrade,
        email: currentEditUser.email || "",
        signupSource: newSignupSource,
        signupSourceOther: newSignupSourceOther,
        note: newNote,
        ...(gradeChanged ? {
          gradeManualOverride: false,
          lastAutoPromotionYear: new Date().getFullYear(),
        } : {}),
      });

      toast("사용자 정보가 수정되었습니다.");
      window.closeEditModal(true);
      // 목록 새로고침
      setTimeout(() => {
        loadAllUsers();
      }, 500);
    } catch (error) {
      console.error("사용자 수정 실패:", error);
      toast("수정 실패: " + (error.message || error), true);
    }
  });
}

// 수정 모달 배경 클릭 시 닫기
const editModal = $("#editUserModal");
if (editModal) {
  editModal.addEventListener('click', (e) => {
    if (e.target === editModal) {
      window.closeEditModal();
    }
  });
}

// 수강 정보 상세 모달 열기
window.openEnrollmentDetailModal = async (uid) => {
  const student = allStudents.find(s => s.uid === uid && s.role === 'student');
  if (!student) {
    toast("학생 정보를 찾을 수 없습니다.", true);
    return;
  }

  const modal = $("#enrollmentDetailModal");
  const content = $("#enrollmentDetailContent");

  if (!modal || !content) return;

  enrollmentDetailReturnFocus = document.activeElement;
  const requestId = ++enrollmentDetailRequest;
  content.innerHTML = '<div class="muted" style="padding:8px;">로딩 중...</div>';
  modal.style.display = 'flex';
  modal.querySelector(".modal-close")?.focus();
  document.body.classList.add('modal-open');
  document.documentElement.classList.add('modal-open');

  try {
    const { onlineCourses, offlineClasses } = await loadStudentEnrollmentDetail(uid);
    if (requestId !== enrollmentDetailRequest) return;
    const marketingConsent = getMarketingConsent(student);
    const basicRows = [
      ["이름", student.name || "-"],
      ["학교", student.school || "-"],
      ["학년", formatGrade(student.grade) || "-"],
      ["전화번호", student.phone || "-"],
      ["이메일", student.email || "-"],
      ["가입 경로", getSignupSourceLabel(student)],
      ["가입일", formatDate(student.createdAt)]
    ];
    const consentRows = [
      ["이용약관 동의", getConsentStatusLabel(student.termsAgreed)],
      ["개인정보 동의", getConsentStatusLabel(student.privacyAgreed)],
      ["광고성 정보 수신", getMarketingConsentStatusLabel(marketingConsent)],
      ...getMarketingConsentDateRows(marketingConsent)
    ];

    const renderNameList = (items, emptyText, nameKey) => {
      if (items.length === 0) return `<div class="muted detail-empty">${emptyText}</div>`;
      return `<ul class="student-detail-list">${items.map(item => `<li>${escapeHtml(item[nameKey])}</li>`).join("")}</ul>`;
    };

    content.innerHTML = `
      <div class="student-detail">
        <section class="student-detail-section">
          <h3>기본 정보</h3>
          <dl class="student-detail-grid">
            ${basicRows.map(([label, value]) => `
              <div>
                <dt>${escapeHtml(label)}</dt>
                <dd>${escapeHtml(value)}</dd>
              </div>
            `).join("")}
          </dl>
        </section>

        <section class="student-detail-section">
          <h3>동의 정보</h3>
          <dl class="student-detail-grid">
            ${consentRows.map(([label, value]) => `
              <div>
                <dt>${escapeHtml(label)}</dt>
                <dd>${escapeHtml(value)}</dd>
              </div>
            `).join("")}
          </dl>
        </section>

        <section class="student-detail-section">
          <h3>온라인 강좌 <span>${formatCountBadge(onlineCourses.length)}</span></h3>
          ${renderNameList(onlineCourses, "수강 중인 온라인 강좌가 없습니다.", "title")}
        </section>

        <section class="student-detail-section">
          <h3>오프라인 반 <span>${formatCountBadge(offlineClasses.length)}</span></h3>
          ${renderNameList(offlineClasses, "배정된 오프라인 반이 없습니다.", "className")}
        </section>

        <div class="modal-actions">
          <button class="btn" onclick="closeEnrollmentDetailModal()">닫기</button>
        </div>
      </div>
    `;
  } catch (error) {
    if (requestId !== enrollmentDetailRequest) return;
    console.error("Enrollment detail load failed:", error);
    content.innerHTML = '<div class="muted" style="padding:8px;">상세 정보를 불러오지 못했습니다.</div>';
  }
};

// Close enrollment detail modal
window.closeEnrollmentDetailModal = () => {
  enrollmentDetailRequest += 1;
  const modal = $("#enrollmentDetailModal");
  if (modal) {
    modal.style.display = 'none';
    document.body.classList.remove('modal-open');
    document.documentElement.classList.remove('modal-open');
  }
  if (enrollmentDetailReturnFocus?.isConnected) enrollmentDetailReturnFocus.focus();
  enrollmentDetailReturnFocus = null;
};

// 수강 정보 상세 모달 외부 클릭 시 닫기
const enrollmentDetailModal = $("#enrollmentDetailModal");
if (enrollmentDetailModal) {
  document.addEventListener('keydown', (event) => {
    if (enrollmentDetailModal.style.display !== 'flex') return;
    if (event.key === 'Escape') {
      event.preventDefault();
      window.closeEnrollmentDetailModal();
    } else if (event.key === 'Tab') {
      const focusable = Array.from(enrollmentDetailModal.querySelectorAll('button:not([disabled]), a[href]'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  enrollmentDetailModal.addEventListener('click', (e) => {
    if (e.target === enrollmentDetailModal) {
      window.closeEnrollmentDetailModal();
    }
  });
}

// 엑셀 다운로드
let studentExportPending = false;
$("#dlStudents")?.addEventListener("click", async () => {
  if (studentExportPending) return;
  if (!hasLoadedStudentStatus) return toast("학생 현황을 먼저 불러와 주세요.", true);
  if (!filteredStudents.length) return toast(allStudents.length ? "검색 결과에 학생이 없습니다." : "등록된 학생이 없습니다.", true);
  studentExportPending = true;
  try {
    const proceed = await openAdminConfirm({
      title: "학생 명단 다운로드",
      message: `학생 ${filteredStudents.length}명의 수강 강좌, 오프라인 반, 학부모 정보를 함께 불러와 저장합니다. 계속하시겠습니까?`,
      confirmLabel: "다운로드",
    });
    if (!proceed) return;

    const studentIds = filteredStudents.map((user) => user.uid);
    const [enrollments, classMembers, parentLinks] = await Promise.all([
      fetchScopedExportRows(db, "enrollments", "userId", studentIds),
      fetchScopedExportRows(db, "offlineClassMembers", "studentUid", studentIds),
      fetchScopedExportRows(db, "studentParentLinks", "studentUid", studentIds),
    ]);
    const [courses, classes, members] = await Promise.all([
      fetchExportDocuments(db, "courses", enrollments.map((row) => row.courseId)),
      fetchExportDocuments(db, "offlineClasses", classMembers.map((row) => row.classId)),
      fetchExportDocuments(db, "members", parentLinks.map((row) => row.memberUid)),
    ]);
    const students = new Map(filteredStudents.map((row) => [row.uid, row]));
    const activeEnrollments = enrollments.filter(isActiveEnrollment);
    const activeClasses = classMembers.filter(isActiveEnrollment);
    const countFor = (items, field, uid) => new Set(items.filter((row) => row[field] === uid).map((row) => row.courseId || row.classId).filter(Boolean)).size;
    const usersWithEnrollments = filteredStudents.map((user) => ({
      이름: user.name || "",
      학교: user.school || "",
      학년: formatGrade(user.grade),
      전화번호: user.phone || "",
      이메일: user.email || "",
      가입일: formatDate(user.createdAt),
      상태: String(user.status || "active") === "active" ? "활성" : "비활성",
      가입경로: getSignupSourceLabel(user),
      이용약관동의: getConsentStatusLabel(user.termsAgreed),
      개인정보동의: getConsentStatusLabel(user.privacyAgreed),
      동의출처: getConsentSourceLabel(user.consentSource),
      적용버전: user.policyVersion || "",
      광고성정보수신동의: getMarketingConsentStatusLabel(getMarketingConsent(user)),
      마케팅동의일: formatDate(getMarketingConsent(user).agreedAt),
      마케팅수정일: formatDate(getMarketingConsent(user).updatedAt),
      마케팅철회일: formatDate(getMarketingConsent(user).withdrawnAt),
      온라인강좌수: countFor(activeEnrollments, "userId", user.uid),
      오프라인반수: countFor(activeClasses, "studentUid", user.uid),
      활성학부모연결수: parentLinks.filter((row) => row.studentUid === user.uid && row.status === "active").length,
      비고: user.note || ""
    }));

    const courseRows = enrollments.map((row) => ({
      학생UID: row.userId || "", 학생명: students.get(row.userId)?.name || "",
      강좌UID: row.courseId || "", 강좌명: courses.get(row.courseId)?.title || "확인 불가",
      수강상태: row.status || "active", 등록일: formatDate(row.createdAt),
    }));
    const classRows = classMembers.map((row) => ({
      학생UID: row.studentUid || "", 학생명: students.get(row.studentUid)?.name || "",
      반UID: row.classId || "", 반명: classes.get(row.classId)?.className || "확인 불가",
      배정상태: row.status || "active",
      입반일: formatDate(row.joinedAt || row.createdAt),
    }));
    const parentRows = parentLinks.map((row) => ({
      학생UID: row.studentUid || "", 학생명: students.get(row.studentUid)?.name || "",
      회원UID: row.memberUid || "", 학부모명: members.get(row.memberUid)?.name || row.memberSnapshot?.name || "확인 불가",
      학부모연락처: members.get(row.memberUid)?.phone || row.memberSnapshot?.phone || "",
      보호자정보출처: members.has(row.memberUid) ? "현재 프로필" : (row.memberSnapshot?.name ? "연결 시 스냅샷" : "확인 불가"),
      관계: row.relationDisplay || row.relationLabel || "", 상태: row.status || "확인 필요",
      연결일: formatDate(row.createdAt), 해제일: formatDate(row.revokedAt),
    }));

    const done = await writeAdminXlsx(XLSX, {
      sheets: [
        { name: "학생목록", rows: usersWithEnrollments },
        { name: "온라인수강", rows: courseRows },
        { name: "오프라인입반", rows: classRows },
        { name: "학부모연결", rows: parentRows },
      ], button: $("#dlStudents"),
      filename: adminXlsxFilename("학생목록", usersWithEnrollments.length, appliedSearchKeyword ? "검색결과" : "전체"),
    });
    if (done) toast(`학생 ${usersWithEnrollments.length}명 엑셀 파일을 다운로드했습니다.`);
  } catch (error) {
    console.error("엑셀 다운로드 실패:", error);
    toast("엑셀 다운로드 실패: " + (error.message || error), true);
  } finally {
    studentExportPending = false;
  }
});
