import { db } from "/assets/js/firebase-init.js";
import {
  getDoc,
  getDocs,
  doc,
  deleteDoc,
  collection,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import {
  normalizeCourseForReadOnly,
  normalizeAccessType
} from "/assets/js/utils/course-readonly.js";
import { dom, state, escapeHtml, toMillis, toast } from "/assets/js/pages/student-dashboard/context.js";
import { loadCourseReadOnlyContext } from "/assets/js/pages/student-dashboard/settings.js";
import { updateCourseStatCounts } from "/assets/js/pages/student-dashboard/stats.js";

export const UNENROLL_CONFIRM_PHRASE = "수강취소하겠습니다";

let pendingUnenroll = null;
let unenrollInFlight = false;
let unenrollModalBound = false;

export function isMemberOnlyCourseRow(row) {
  const course = row?.course;
  if (!course || typeof course !== "object") return false;
  return normalizeAccessType(course.accessType) === "memberOnly";
}

export async function deleteStudentEnrollment(enrollmentId) {
  const id = String(enrollmentId || "").trim();
  if (!id) throw new Error("수강 정보를 확인할 수 없습니다.");
  await deleteDoc(doc(db, "enrollments", id));
}

function setMyCoursesMeta(text) {
  if (!dom.myCoursesMeta) return;
  dom.myCoursesMeta.textContent = text;
}

function getCourseProgress(enrollment) {
  const parsed = Number(enrollment?.progress);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function getCourseFilterKey(enrollment) {
  const progress = getCourseProgress(enrollment);
  if (progress >= 100) return "completed";
  if (progress <= 0) return "before-start";
  return "in-progress";
}

function getCourseFilterLabel(filterKey) {
  if (filterKey === "before-start") return "수강 전";
  if (filterKey === "completed") return "수강 완료";
  return "수강 중";
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

function isActiveEnrollment(row) {
  return String(row?.status || "active").trim() === "active";
}

function renderMyCoursesEmpty(message, legacyCount = 0) {
  if (!dom.myCoursesGrid) return;
  dom.myCoursesGrid.innerHTML = `<p class="student-course-empty">${escapeHtml(message)}</p>`;
  if (legacyCount > 0) {
    console.warn("[student-dashboard] legacy enrollments without courseId detected", { legacyCount });
  }
}

function renderMyCoursesCards(courseRows, legacyCount = 0, filterKey = "in-progress") {
  if (!dom.myCoursesGrid) return;
  if (courseRows.length === 0) {
    renderMyCoursesEmpty(`${getCourseFilterLabel(filterKey)} 강좌가 없습니다.`, legacyCount);
    return;
  }

  const cards = courseRows.map((row) => {
    const course = row.course;
    const enrollment = row.enrollment;
    const progress = getCourseProgress(enrollment);
    const courseTitle = escapeHtml(course.title || "제목 없는 강좌");
    const instructorName = escapeHtml(course.instructorName || "강사 미정");
    const subject = escapeHtml(course.subjectLabel || course.subject || "일반");
    const grade = escapeHtml(course.gradeLabel || course.grade || "학년 미정");
    const year = escapeHtml(course.year || "연도 미정");
    const canonicalCourseId = String(enrollment?.courseId || course.id || "").trim();
    const coursePath = `/members/students/course.html?courseId=${encodeURIComponent(canonicalCourseId)}`;
    const detailPath = `/course-detail.html?courseId=${encodeURIComponent(canonicalCourseId)}`;
    const enrollmentId = escapeHtml(String(enrollment?.id || "").trim());
    const showUnenroll =
      isMemberOnlyCourseRow(row) &&
      enrollmentId &&
      canonicalCourseId;
    const unenrollButton = showUnenroll
      ? `<button type="button" class="btn sm danger student-course-unenroll-btn" data-unenroll-course data-enrollment-id="${enrollmentId}" data-course-id="${escapeHtml(canonicalCourseId)}" data-course-title="${courseTitle}">수강취소</button>`
      : "";

    return `
      <article class="student-course-card">
        <h3>${courseTitle}</h3>
        <p class="student-course-meta">${subject} | ${grade} | ${year}</p>
        <p class="student-course-meta">강사: ${instructorName}</p>
        <p class="student-course-progress">학습 진도: ${progress}%</p>
        <div class="student-course-actions">
          <a class="btn primary sm" href="${coursePath}">강의 입장</a>
          <a class="btn sm" href="${detailPath}">상세 보기</a>
          ${unenrollButton}
        </div>
      </article>
    `;
  });

  dom.myCoursesGrid.innerHTML = cards.join("");
  if (legacyCount > 0) {
    console.warn("[student-dashboard] legacy enrollments without courseId detected", { legacyCount });
  }
}

export function updateCourseFilterButtons() {
  dom.courseFilterButtons.forEach((button) => {
    const isActive = button.dataset.filter === state.currentCourseFilter;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  });
}

export function applyCourseFilter() {
  const filteredRows = state.allMyCourseRows.filter(
    (row) => getCourseFilterKey(row.enrollment) === state.currentCourseFilter
  );
  renderMyCoursesCards(filteredRows, state.latestLegacyCount, state.currentCourseFilter);
  setMyCoursesMeta(`${getCourseFilterLabel(state.currentCourseFilter)} ${filteredRows.length}개 / 전체 ${state.allMyCourseRows.length}개`);
}

export async function loadMyCourses() {
  if (!state.user?.uid || !dom.myCoursesGrid) return;

  setMyCoursesMeta("수강 강좌를 불러오는 중입니다.");
  dom.myCoursesGrid.innerHTML = `<p class="student-course-empty">수강 강좌를 불러오는 중입니다.</p>`;

  try {
    await loadCourseReadOnlyContext();
    const enrollmentsSnapshot = await getDocs(query(collection(db, "enrollments"), where("userId", "==", state.user.uid)));

    const enrollmentByCourseId = new Map();
    let legacyWithoutCourseId = 0;

    enrollmentsSnapshot.forEach((enrollDoc) => {
      const data = enrollDoc.data() || {};
      if (!isActiveEnrollment(data)) return;
      const enrolledCourseId = typeof data.courseId === "string" ? data.courseId.trim() : "";
      if (!enrolledCourseId) {
        if (data.classId) legacyWithoutCourseId += 1;
        console.warn("[student-dashboard] skipping enrollment without courseId", {
          enrollmentId: enrollDoc.id,
          userId: data.userId || null,
          classId: data.classId || null
        });
        return;
      }

      const existing = enrollmentByCourseId.get(enrolledCourseId);
      const nextSort = Math.max(toMillis(data.updatedAt), toMillis(data.createdAt));
      const currentSort = existing ? Math.max(toMillis(existing.updatedAt), toMillis(existing.createdAt)) : -1;
      if (!existing || nextSort >= currentSort) {
        enrollmentByCourseId.set(enrolledCourseId, { id: enrollDoc.id, ...data });
      }
    });

    const courseIds = Array.from(enrollmentByCourseId.keys());
    if (courseIds.length === 0) {
      state.allMyCourseRows = [];
      state.latestLegacyCount = legacyWithoutCourseId;
      updateCourseStatCounts();
      renderMyCoursesEmpty("수강 중인 강좌가 없습니다.", legacyWithoutCourseId);
      setMyCoursesMeta("아직 수강 신청한 강좌가 없습니다.");
      return;
    }

    const courseResults = await Promise.all(courseIds.map(async (courseId) => {
      try {
        const courseSnap = await getDoc(doc(db, "courses", courseId));
        if (!courseSnap.exists()) {
          console.warn("[student-dashboard] enrollment points to missing course", {
            enrollmentId: enrollmentByCourseId.get(courseId)?.id || null,
            courseId
          });
          return null;
        }
        const normalized = normalizeCourseForReadOnly(
          { id: courseSnap.id, ...courseSnap.data() },
          {
            labelMaps: state.courseLabelMaps,
            hiddenCourseIds: state.hiddenCourseIds,
            instructorsByUid: state.instructorsByUid
          }
        );
        if (!isStudentCourseAvailable(normalized)) return { filteredUnsafe: true };
        return {
          filteredUnsafe: false,
          row: { course: normalized, enrollment: enrollmentByCourseId.get(courseId) }
        };
      } catch (error) {
        console.warn("[student-dashboard] failed to load course doc", courseId, error);
        return null;
      }
    }));

    const courseRows = [];
    let filteredUnsafeCount = 0;
    courseResults.forEach((result) => {
      if (!result) return;
      if (result.filteredUnsafe) {
        filteredUnsafeCount += 1;
        return;
      }
      if (result.row) courseRows.push(result.row);
    });

    courseRows.sort((a, b) => {
      const aTime = Math.max(toMillis(a.enrollment?.updatedAt), toMillis(a.enrollment?.createdAt));
      const bTime = Math.max(toMillis(b.enrollment?.updatedAt), toMillis(b.enrollment?.createdAt));
      return bTime - aTime;
    });

    state.allMyCourseRows = courseRows;
    state.latestLegacyCount = legacyWithoutCourseId;
    updateCourseStatCounts();
    applyCourseFilter();
    if (filteredUnsafeCount > 0) {
      console.warn("[student-dashboard] filtered non-student-safe courses", { filteredUnsafeCount });
    }
  } catch (error) {
    console.error("[student-dashboard] my courses load failed", error);
    state.allMyCourseRows = [];
    updateCourseStatCounts();
    renderMyCoursesEmpty("수강 강좌를 불러오는 중 오류가 발생했습니다.");
    setMyCoursesMeta("수강 강좌를 불러오지 못했습니다.");
  }
}

function setUnenrollStatus(message, isError = false) {
  if (!dom.unenrollStatus) return;
  dom.unenrollStatus.textContent = message || "";
  dom.unenrollStatus.style.color = isError ? "var(--error-color)" : "var(--muted)";
}

function updateUnenrollConfirmButton() {
  if (!dom.confirmUnenrollBtn || !dom.unenrollPhraseInput) return;
  const phraseOk = dom.unenrollPhraseInput.value.trim() === UNENROLL_CONFIRM_PHRASE;
  dom.confirmUnenrollBtn.disabled = unenrollInFlight || !phraseOk || !pendingUnenroll;
}

function closeUnenrollModal() {
  if (!dom.unenrollModal) return;
  dom.unenrollModal.style.display = "none";
  dom.unenrollModal.hidden = true;
  document.body.classList.remove("modal-open");
  document.documentElement.classList.remove("modal-open");
  pendingUnenroll = null;
  unenrollInFlight = false;
  if (dom.unenrollPhraseInput) dom.unenrollPhraseInput.value = "";
  setUnenrollStatus("");
  updateUnenrollConfirmButton();
}

function openUnenrollModal(payload) {
  if (!dom.unenrollModal) return;
  pendingUnenroll = {
    enrollmentId: String(payload?.enrollmentId || "").trim(),
    courseId: String(payload?.courseId || "").trim(),
    courseTitle: String(payload?.courseTitle || "").trim() || "제목 없는 강좌"
  };
  if (dom.unenrollCourseTitle) {
    dom.unenrollCourseTitle.textContent = pendingUnenroll.courseTitle;
  }
  if (dom.unenrollPhraseInput) dom.unenrollPhraseInput.value = "";
  setUnenrollStatus("");
  updateUnenrollConfirmButton();
  dom.unenrollModal.hidden = false;
  dom.unenrollModal.style.display = "flex";
  document.body.classList.add("modal-open");
  document.documentElement.classList.add("modal-open");
  dom.unenrollPhraseInput?.focus();
}

async function confirmUnenroll() {
  if (!pendingUnenroll || unenrollInFlight) return;
  if (dom.unenrollPhraseInput?.value.trim() !== UNENROLL_CONFIRM_PHRASE) {
    setUnenrollStatus("확인 문구를 정확히 입력해 주세요.", true);
    return;
  }

  const { enrollmentId, courseId } = pendingUnenroll;
  unenrollInFlight = true;
  updateUnenrollConfirmButton();
  setUnenrollStatus("수강 취소 처리 중입니다...");

  try {
    await deleteStudentEnrollment(enrollmentId);
    state.allMyCourseRows = state.allMyCourseRows.filter(
      (row) => String(row.enrollment?.id || "") !== enrollmentId
    );
    updateCourseStatCounts();
    applyCourseFilter();
    closeUnenrollModal();
    toast("수강이 취소되었습니다. 강좌 상세에서 다시 수강신청할 수 있습니다.");
  } catch (error) {
    if (error?.code === "permission-denied") {
      setUnenrollStatus("수강 취소 권한이 없습니다. 로그인 상태를 확인해 주세요.", true);
    } else if (error?.code === "not-found") {
      setUnenrollStatus("이미 취소된 수강입니다. 목록을 새로고침합니다.", true);
      state.allMyCourseRows = state.allMyCourseRows.filter(
        (row) => String(row.enrollment?.id || "") !== enrollmentId
      );
      updateCourseStatCounts();
      applyCourseFilter();
      closeUnenrollModal();
    } else {
      console.error("[student-dashboard] unenroll failed", error);
      setUnenrollStatus(`수강 취소에 실패했습니다: ${error?.message || "알 수 없는 오류"}`, true);
    }
  } finally {
    unenrollInFlight = false;
    updateUnenrollConfirmButton();
  }
}

export function setupUnenrollModal() {
  if (unenrollModalBound || !dom.unenrollModal) return;
  unenrollModalBound = true;

  dom.closeUnenrollModal?.addEventListener("click", closeUnenrollModal);
  dom.cancelUnenrollBtn?.addEventListener("click", closeUnenrollModal);
  dom.confirmUnenrollBtn?.addEventListener("click", () => {
    confirmUnenroll();
  });
  dom.unenrollPhraseInput?.addEventListener("input", updateUnenrollConfirmButton);

  dom.myCoursesGrid?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-unenroll-course]");
    if (!button) return;
    event.preventDefault();
    openUnenrollModal({
      enrollmentId: button.getAttribute("data-enrollment-id") || "",
      courseId: button.getAttribute("data-course-id") || "",
      courseTitle: button.getAttribute("data-course-title") || ""
    });
  });
}

export function bindUnenrollModal(elements, options = {}) {
  const refs = elements;
  const onSuccess = typeof options.onSuccess === "function" ? options.onSuccess : null;

  if (refs.modal?.dataset.unenrollBound === "1") return;
  if (refs.modal) refs.modal.dataset.unenrollBound = "1";

  let localPending = null;
  let localInFlight = false;

  const setStatus = (message, isError = false) => {
    if (!refs.status) return;
    refs.status.textContent = message || "";
    refs.status.style.color = isError ? "var(--error-color)" : "var(--muted)";
  };

  const updateConfirm = () => {
    if (!refs.confirmBtn || !refs.phraseInput) return;
    const phraseOk = refs.phraseInput.value.trim() === UNENROLL_CONFIRM_PHRASE;
    refs.confirmBtn.disabled = localInFlight || !phraseOk || !localPending;
  };

  const closeModal = () => {
    if (!refs.modal) return;
    refs.modal.style.display = "none";
    refs.modal.hidden = true;
    document.body.classList.remove("modal-open");
    document.documentElement.classList.remove("modal-open");
    localPending = null;
    localInFlight = false;
    if (refs.phraseInput) refs.phraseInput.value = "";
    setStatus("");
    updateConfirm();
  };

  const openModal = (payload) => {
    localPending = {
      enrollmentId: String(payload?.enrollmentId || "").trim(),
      courseId: String(payload?.courseId || "").trim(),
      courseTitle: String(payload?.courseTitle || "").trim() || "제목 없는 강좌"
    };
    if (refs.courseTitleEl) refs.courseTitleEl.textContent = localPending.courseTitle;
    if (refs.phraseInput) refs.phraseInput.value = "";
    setStatus("");
    updateConfirm();
    refs.modal.hidden = false;
    refs.modal.style.display = "flex";
    document.body.classList.add("modal-open");
    document.documentElement.classList.add("modal-open");
    refs.phraseInput?.focus();
  };

  const confirm = async () => {
    if (!localPending || localInFlight) return;
    if (refs.phraseInput?.value.trim() !== UNENROLL_CONFIRM_PHRASE) {
      setStatus("확인 문구를 정확히 입력해 주세요.", true);
      return;
    }

    const { enrollmentId, courseId } = localPending;
    localInFlight = true;
    updateConfirm();
    setStatus("수강 취소 처리 중입니다...");

    try {
      await deleteStudentEnrollment(enrollmentId);
      closeModal();
      if (onSuccess) {
        await onSuccess({ enrollmentId, courseId });
      }
    } catch (error) {
      if (error?.code === "permission-denied") {
        setStatus("수강 취소 권한이 없습니다. 로그인 상태를 확인해 주세요.", true);
      } else if (error?.code === "not-found") {
        setStatus("이미 취소된 수강입니다.", true);
        closeModal();
        if (onSuccess) await onSuccess({ enrollmentId, courseId });
      } else {
        console.error("[student-course] unenroll failed", error);
        setStatus(`수강 취소에 실패했습니다: ${error?.message || "알 수 없는 오류"}`, true);
      }
    } finally {
      localInFlight = false;
      updateConfirm();
    }
  };

  refs.closeBtn?.addEventListener("click", closeModal);
  refs.cancelBtn?.addEventListener("click", closeModal);
  refs.confirmBtn?.addEventListener("click", confirm);
  refs.phraseInput?.addEventListener("input", updateConfirm);

  return { openModal, closeModal };
}

export function setupCourseFilters() {
  dom.courseFilterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.currentCourseFilter = button.dataset.filter || "in-progress";
      updateCourseFilterButtons();
      applyCourseFilter();
    });
  });
  setupUnenrollModal();
}
