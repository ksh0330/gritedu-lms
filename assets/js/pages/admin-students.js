// /assets/js/pages/admin-students.js
// 학생 관리 페이지
import { db, requireRole } from "/assets/js/firebase-init.js";
import {
  doc, getDoc, setDoc, serverTimestamp,
  collection, getDocs, query, where
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { saveStudentProfile } from "/assets/js/utils/student-profile.js";
import { formatGrade, normalizeGrade } from "/assets/js/utils/grade.js";
import { confirmDiscardIfDirty, createFormDirtyTracker, openAdminConfirm } from "/assets/js/utils/admin-dialog.js";
import * as XLSX from "https://cdn.sheetjs.com/xlsx-latest/package/xlsx.mjs";

// 역할 가드: 관리자만 접근 가능
(async () => {
  try {
    await requireRole("admin", "/members/login.html");
  } catch (err) {
    // requireRole에서 이미 리다이렉션 처리됨
  }
})();

const $ = (s, r = document) => r.querySelector(s);
const editUserFormDirty = createFormDirtyTracker(document.querySelector("#editUserForm"));

function toast(msg, err = false) {
  const statusMsg = $("#statusMsg");
  if (statusMsg) {
    // 메시지 내용 설정
    statusMsg.textContent = msg;
    statusMsg.style.color = err ? "var(--error-color)" : "var(--success-color)";
    statusMsg.style.background = err ? "var(--error-bg)" : "var(--success-bg)";
    statusMsg.style.padding = "12px";
    statusMsg.style.borderRadius = "8px";
    statusMsg.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
    
    // 표시 (opacity와 pointer-events 변경)
    statusMsg.style.opacity = "1";
    statusMsg.style.pointerEvents = "auto";
    
    setTimeout(() => {
      if (statusMsg.textContent === msg) {
        // 숨김 (내용만 제거하고 위치는 유지)
        statusMsg.style.opacity = "0";
        statusMsg.style.pointerEvents = "none";
        setTimeout(() => {
          if (statusMsg.textContent === msg) {
            statusMsg.textContent = "";
            statusMsg.style.background = "";
            statusMsg.style.boxShadow = "";
          }
        }, 300); // 페이드아웃 애니메이션 시간
      }
    }, 3000);
  }
}

// 학생 목록 로드
const tbody = $("#tblStudents")?.querySelector('tbody');
const searchInput = $("#searchStudents");
let allStudents = [];
let filteredStudents = [];
let studentCourseDetails = {}; // 학생별 온라인 강의 상세 정보
let studentOfflineClassDetails = {}; // 학생별 오프라인 반 상세 정보
let courseEnrollmentCounts = {}; // 학생별 온라인 강의 수 캐시
let offlineClassCounts = {}; // 학생별 오프라인 반 수 캐시
const studentSummaryLoadPromises = new Map();
let studentsRenderToken = 0;
let currentPage = 1;
const itemsPerPage = 10;
let hasLoadedStudentStatus = false;
let isStudentStatusLoading = false;

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

function getMarketingDatesLabel(consent = {}) {
  const parts = [
    `동의: ${formatDate(consent.agreedAt)}`,
    `수정: ${formatDate(consent.updatedAt)}`,
    `철회: ${formatDate(consent.withdrawnAt)}`
  ];
  return parts.join(" / ");
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
  const refreshBtn = $("#refreshStudentsBtn");
  const downloadBtn = $("#dlStudents");

  if (loadBtn) {
    loadBtn.hidden = hasLoadedStudentStatus && !loading;
    loadBtn.disabled = loading;
    loadBtn.textContent = loading ? "불러오는 중..." : "현황 불러오기";
  }
  if (refreshBtn) {
    refreshBtn.hidden = !hasLoadedStudentStatus;
    refreshBtn.disabled = loading || !hasLoadedStudentStatus;
    refreshBtn.textContent = loading ? "새로고침 중..." : "새로고침";
  }
  if (downloadBtn) {
    downloadBtn.disabled = loading || !hasLoadedStudentStatus;
  }
}

function hasStudentSummary(uid) {
  return Object.prototype.hasOwnProperty.call(courseEnrollmentCounts, uid) &&
    Object.prototype.hasOwnProperty.call(offlineClassCounts, uid);
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

async function loadStudentEnrollmentSummary(uid) {
  if (!uid || hasStudentSummary(uid)) return;
  if (studentSummaryLoadPromises.has(uid)) {
    await studentSummaryLoadPromises.get(uid);
    return;
  }

  const loadPromise = (async () => {
    const [enrollmentsSnap, offlineMembersSnap] = await Promise.all([
      getDocs(query(collection(db, "enrollments"), where("userId", "==", uid))),
      getDocs(query(collection(db, "offlineClassMembers"), where("studentUid", "==", uid)))
    ]);

    courseEnrollmentCounts[uid] = uniqueActiveIds(enrollmentsSnap, "courseId").length;
    offlineClassCounts[uid] = uniqueActiveIds(offlineMembersSnap, "classId").length;
  })();

  studentSummaryLoadPromises.set(uid, loadPromise);
  try {
    await loadPromise;
  } catch (error) {
    console.warn("[admin-students] enrollment summary load failed:", uid, error);
    courseEnrollmentCounts[uid] = 0;
    offlineClassCounts[uid] = 0;
  } finally {
    studentSummaryLoadPromises.delete(uid);
  }
}

async function loadVisibleStudentSummaries(students) {
  await Promise.all(
    students
      .filter((student) => student?.role === "student")
      .map((student) => loadStudentEnrollmentSummary(student.uid))
  );
}

async function resolveCourseTitle(courseId) {
  try {
    const snap = await getDoc(doc(db, "courses", courseId));
    if (!snap.exists()) return "삭제되었거나 확인 불가한 강좌";
    const data = snap.data() || {};
    return data.title || "제목 없는 강좌";
  } catch (_error) {
    return "삭제되었거나 확인 불가한 강좌";
  }
}

async function resolveOfflineClassName(classId) {
  try {
    const snap = await getDoc(doc(db, "offlineClasses", classId));
    if (!snap.exists()) return "삭제되었거나 확인 불가한 반";
    const data = snap.data() || {};
    return data.className || data.title || data.name || "이름 없는 반";
  } catch (_error) {
    return "삭제되었거나 확인 불가한 반";
  }
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

  const [enrollmentsSnap, offlineMembersSnap] = await Promise.all([
    getDocs(query(collection(db, "enrollments"), where("userId", "==", uid))),
    getDocs(query(collection(db, "offlineClassMembers"), where("studentUid", "==", uid)))
  ]);

  const courseIds = uniqueActiveIds(enrollmentsSnap, "courseId");
  const classIds = uniqueActiveIds(offlineMembersSnap, "classId");

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
  try {
    const studentsSnapshot = await getDocs(collection(db, "students"));
    const studentsList = [];
    studentsSnapshot.forEach((docSnap) => {
      const data = docSnap.data() || {};
      studentsList.push({
        uid: docSnap.id,
        role: 'student',
        ...data,
        grade: normalizeGrade(data.grade)
      });
    });

    const allUsersList = [...studentsList];

    const usersWithEnrollments = allUsersList.map((user) => {
      if (user.role === 'student') {
        return {
          ...user,
          enrollmentCount: courseEnrollmentCounts[user.uid] || 0,
          courseEnrollmentCount: courseEnrollmentCounts[user.uid] || 0,
          offlineClassCount: offlineClassCounts[user.uid] || 0
        };
      }
    });

    allStudents = usersWithEnrollments;

    applyFilters();
    currentPage = 1;
  } catch (error) {
    console.error("User list load failed:", error);
    toast("Data load failed: " + (error.message || error), true);
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="9" class="muted">학생 목록을 불러오지 못했습니다.</td></tr>';
    }
  }
}

if (tbody) {
  tbody.innerHTML = '<tr><td colspan="9" class="muted">학생 현황을 불러오려면 상단의 현황 불러오기를 눌러주세요.</td></tr>';
  setStudentStatusButtonsLoading(false);
}

window.loadStudentStatus = async () => {
  if (isStudentStatusLoading) return;
  isStudentStatusLoading = true;
  setStudentStatusButtonsLoading(true);
  try {
    await loadAllUsers();
    hasLoadedStudentStatus = true;
    toast("학생 현황을 불러왔습니다.");
  } finally {
    isStudentStatusLoading = false;
    setStudentStatusButtonsLoading(false);
  }
};

window.refreshStudents = async () => {
  if (!hasLoadedStudentStatus) return;
  await window.loadStudentStatus();
};

// 검색 적용
function applyFilters() {
  let filtered = [...allStudents];

  // 검색 필터
  const keyword = searchInput?.value.trim().toLowerCase() || '';
  if (keyword) {
    filtered = filtered.filter(user => {
      const name = (user.name || '').toLowerCase();
      const email = (user.email || '').toLowerCase();
      const school = (user.school || '').toLowerCase();
      const phone = (user.phone || '').toLowerCase();
      return name.includes(keyword) || email.includes(keyword) || school.includes(keyword) || phone.includes(keyword);
    });
  }

  // 페이지 리셋
  currentPage = 1;
  renderStudents(filtered);
}

// 검색 기능
if (searchInput) {
  searchInput.addEventListener('input', async (e) => {
    applyFilters();
  });
}

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
function updateStudentStats(students) {
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

async function renderStudents(students) {
  if (!tbody) return;
  const renderToken = ++studentsRenderToken;

  let sortedStudents = sortStudents(students);
  filteredStudents = sortedStudents;

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
  await loadVisibleStudentSummaries(studentsToShow);
  if (renderToken !== studentsRenderToken) return;
  updateStudentStats(allStudents);

  const rows = await Promise.all(studentsToShow.map(async user => {
    const isStudent = user.role === 'student';
    const courseCount = isStudent ? (courseEnrollmentCounts[user.uid] || user.courseEnrollmentCount || 0) : 0;
    const offlineCount = isStudent ? (offlineClassCounts[user.uid] || user.offlineClassCount || 0) : 0;

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
      <td><span class="count-chip">${formatCountBadge(courseCount)}</span></td>
      <td><span class="count-chip count-chip--offline">${formatCountBadge(offlineCount)}</span></td>
      <td>${managementButtons}</td>
    </tr>
    `;
  }));

  tbody.innerHTML = rows.join('');

  renderPagination(sortedStudents.length);
}

// Pagination UI
function renderPagination(totalItems) {
  const paginationContainer = $("#paginationContainer");
  if (!paginationContainer) return;

  if (totalItems === 0) {
    paginationContainer.innerHTML = '';
    return;
  }

  const totalPages = Math.ceil(totalItems / itemsPerPage);
  
  if (totalPages <= 1) {
    paginationContainer.innerHTML = '';
    return;
  }

  let paginationHTML = '<div style="display:flex;justify-content:center;align-items:center;gap:8px;margin-top:20px;flex-wrap:wrap;">';
  
  // 이전 페이지 버튼
  if (currentPage > 1) {
    paginationHTML += `<button class="btn sm" onclick="goToPage(${currentPage - 1})" style="padding:6px 12px;">이전</button>`;
  } else {
    paginationHTML += `<button class="btn sm" disabled style="padding:6px 12px;opacity:0.5;cursor:not-allowed;">이전</button>`;
  }

  // 페이지 번호 버튼들
  const maxVisiblePages = 10;
  let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
  let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
  
  // 시작 페이지 조정
  if (endPage - startPage < maxVisiblePages - 1) {
    startPage = Math.max(1, endPage - maxVisiblePages + 1);
  }

  // 첫 페이지
  if (startPage > 1) {
    paginationHTML += `<button class="btn sm" onclick="goToPage(1)" style="padding:6px 12px;">1</button>`;
    if (startPage > 2) {
      paginationHTML += `<span style="padding:6px 4px;color:var(--muted);">...</span>`;
    }
  }

  // 페이지 번호들
  for (let i = startPage; i <= endPage; i++) {
    if (i === currentPage) {
      paginationHTML += `<button class="btn sm" style="padding:6px 12px;background:var(--brand);color:#fff;border-color:var(--brand);" disabled>${i}</button>`;
    } else {
      paginationHTML += `<button class="btn sm" onclick="goToPage(${i})" style="padding:6px 12px;">${i}</button>`;
    }
  }

  // 마지막 페이지
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      paginationHTML += `<span style="padding:6px 4px;color:var(--muted);">...</span>`;
    }
    paginationHTML += `<button class="btn sm" onclick="goToPage(${totalPages})" style="padding:6px 12px;">${totalPages}</button>`;
  }

  // 다음 페이지 버튼
  if (currentPage < totalPages) {
    paginationHTML += `<button class="btn sm" onclick="goToPage(${currentPage + 1})" style="padding:6px 12px;">다음</button>`;
  } else {
    paginationHTML += `<button class="btn sm" disabled style="padding:6px 12px;opacity:0.5;cursor:not-allowed;">다음</button>`;
  }

  // 페이지 정보 표시
  const startItem = (currentPage - 1) * itemsPerPage + 1;
  const endItem = Math.min(currentPage * itemsPerPage, totalItems);
  paginationHTML += `<span style="margin-left:16px;color:var(--muted);font-size:13px;">${startItem}-${endItem} / 총 ${totalItems}명</span>`;

  paginationHTML += '</div>';
  paginationContainer.innerHTML = paginationHTML;
}

// 페이지 이동 함수
window.goToPage = (page) => {
  currentPage = page;
  applyFilters();
  
  // 페이지 상단으로 스크롤
  const table = $("#tblStudents");
  if (table) {
    table.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
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
    editUserFormDirty.capture();
  }
};

// 사용자 수정 모달 닫기
window.closeEditModal = async (force = false) => {
  if (!force && !(await confirmDiscardIfDirty(editUserFormDirty))) return;
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

      await saveStudentProfile(uid, {
        name: newName,
        phone: newPhone,
        grade: newGrade,
        email: currentEditUser.email || ""
      });

      await setDoc(
        doc(db, "students", uid),
        {
          name: newName,
          phone: newPhone,
          school: newSchool,
          grade: newGrade,
          signupSource: newSignupSource,
          signupSourceOther: newSignupSourceOther,
          note: newNote,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );

      toast("사용자 정보가 수정되었습니다.");
      closeEditModal(true);
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
      closeEditModal();
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

  content.innerHTML = '<div class="muted" style="padding:8px;">로딩 중...</div>';
  modal.style.display = 'flex';
  document.body.classList.add('modal-open');
  document.documentElement.classList.add('modal-open');

  try {
    const { onlineCourses, offlineClasses } = await loadStudentEnrollmentDetail(uid);
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
    console.error("Enrollment detail load failed:", error);
    content.innerHTML = '<div class="muted" style="padding:8px;">상세 정보를 불러오지 못했습니다.</div>';
  }
};

// Close enrollment detail modal
window.closeEnrollmentDetailModal = () => {
  const modal = $("#enrollmentDetailModal");
  if (modal) {
    modal.style.display = 'none';
    document.body.classList.remove('modal-open');
    document.documentElement.classList.remove('modal-open');
  }
};

// 수강 정보 상세 모달 외부 클릭 시 닫기
const enrollmentDetailModal = $("#enrollmentDetailModal");
if (enrollmentDetailModal) {
  enrollmentDetailModal.addEventListener('click', (e) => {
    if (e.target === enrollmentDetailModal) {
      closeEnrollmentDetailModal();
    }
  });
}

// 엑셀 다운로드
$("#dlStudents")?.addEventListener("click", async () => {
  try {
    const unloadedStudents = allStudents.filter((user) => user.role === "student" && !hasStudentSummary(user.uid));
    if (unloadedStudents.length > 0) {
      const proceed = await openAdminConfirm({
        title: "엑셀 다운로드 확인",
        message:
        "엑셀에 온라인/오프라인 수강 수를 포함하려면 아직 조회하지 않은 학생 요약을 추가로 불러옵니다.\n" +
        `추가 조회 대상: ${unloadedStudents.length}명\n\n` +
        "계속 진행하시겠습니까?"
        ,
        confirmLabel: "불러와서 다운로드"
      });
      if (!proceed) return;
      await Promise.all(unloadedStudents.map((user) => loadStudentEnrollmentSummary(user.uid)));
      updateStudentStats(allStudents);
    }

    const usersWithEnrollments = allStudents.map((user) => ({
      이름: user.name || "",
      학교: user.school || "",
      학년: formatGrade(user.grade),
      전화번호: user.phone || "",
      이메일: user.email || "",
      가입경로: getSignupSourceLabel(user),
      이용약관동의: getConsentStatusLabel(user.termsAgreed),
      개인정보동의: getConsentStatusLabel(user.privacyAgreed),
      동의출처: getConsentSourceLabel(user.consentSource),
      적용버전: user.policyVersion || "",
      광고성정보수신동의: getMarketingConsentStatusLabel(getMarketingConsent(user)),
      마케팅동의일: formatDate(getMarketingConsent(user).agreedAt),
      마케팅수정일: formatDate(getMarketingConsent(user).updatedAt),
      마케팅철회일: formatDate(getMarketingConsent(user).withdrawnAt),
      온라인강좌수: courseEnrollmentCounts[user.uid] || 0,
      오프라인반수: offlineClassCounts[user.uid] || 0,
      비고: user.note || ""
    }));

    const ws = XLSX.utils.json_to_sheet(usersWithEnrollments);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "학생목록");
    XLSX.writeFile(wb, "그릿에듀_학생목록.xlsx");
    toast("엑셀 파일이 다운로드되었습니다.");
  } catch (error) {
    console.error("엑셀 다운로드 실패:", error);
    toast("엑셀 다운로드 실패: " + (error.message || error), true);
  }
});
