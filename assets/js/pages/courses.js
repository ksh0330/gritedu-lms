// /assets/js/pages/courses.js
// Public all-courses page (read-only rendering from `courses` source of truth)

import { app } from "/assets/js/firebase-init.js";
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { getPublicSettingDoc } from "/assets/js/utils/settings-cache.js";
import {
  createCourseLabelMaps,
  normalizeCourseForReadOnly
} from "/assets/js/utils/course-readonly.js";
import {
  getCourseGradeLabels,
  getCourseSubjectOptions,
  getCourseYearLabels,
  mergeCourseCatalog
} from "/assets/js/utils/course-catalog.js";

const db = getFirestore(app);
const COURSES_COLLECTION = "courses";

const grid = document.getElementById("contentGrid");
const empty = document.getElementById("contentEmpty");
const searchInput = document.getElementById("courseSearch");
const searchMeta = document.getElementById("coursesSearchMeta");
const yearFilterEl = document.getElementById("filterYear");
const gradeFilterEl = document.getElementById("filterGrade");
const subjectFilterEl = document.getElementById("filterSubject");

const ITEMS_PER_PAGE_DESKTOP = 18;
const ITEMS_PER_PAGE_MOBILE = 9;
const EXCERPT_MAX = 140;

const TEXT_FALLBACK_TITLE = "\uC81C\uBAA9 \uC5C6\uB294 \uAC15\uC88C";
const TEXT_FALLBACK_DESC = "\uAC15\uC88C \uC18C\uAC1C\uAC00 \uC900\uBE44 \uC911\uC785\uB2C8\uB2E4. \uC790\uC138\uD55C \uC218\uC5C5 \uC548\uB0B4\uB294 \uC0C1\uB2F4\uC744 \uD1B5\uD574 \uD655\uC778\uD574 \uC8FC\uC138\uC694.";
const TEXT_META_ARIA = "\uAC15\uC88C \uBA54\uD0C0 \uC815\uBCF4";
const TEXT_RESULT_FOUND = "\uC870\uAC74\uC5D0 \uB9DE\uB294 \uAC15\uC88C";
const TEXT_RESULT_NOT_FOUND = "\uC870\uAC74\uC5D0 \uB9DE\uB294 \uAC15\uC88C\uB97C \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.";
const TEXT_EMPTY = "\uD574\uB2F9 \uC870\uAC74\uC758 \uAC15\uC88C\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.";

let currentPage = 1;
let searchKeyword = "";
let allCourses = [];
let filteredCourses = [];
let labelMaps = createCourseLabelMaps({});
let mergedCourseCatalog = mergeCourseCatalog({});
let instructorsByUid = {};
const filterState = {
  year: "all",
  grade: "all",
  subject: "all"
};

function getItemsPerPage() {
  try {
    return window.matchMedia("(max-width: 640px)").matches
      ? ITEMS_PER_PAGE_MOBILE
      : ITEMS_PER_PAGE_DESKTOP;
  } catch {
    return ITEMS_PER_PAGE_DESKTOP;
  }
}

function escapeHtml(value) {
  if (value == null) return "";
  const div = document.createElement("div");
  div.textContent = String(value);
  return div.innerHTML;
}

function toDisplayValue(value) {
  const text = String(value || "").trim();
  return text || "-";
}

function toInstructorDisplayValue(value) {
  const text = String(value || "").trim();
  if (!text || text === "강사 미정") return "";
  return text;
}

function normalizeSubjectFilterValue(value) {
  return String(value || "").trim();
}

function normalizeGradeFilterValue(course) {
  const label = String(course.gradeLabel || "").trim();
  if (label) return label;
  return toDisplayValue(course.grade);
}

function normalizeYearFilterValue(course) {
  return toDisplayValue(course.year);
}

function getSubjectAccentClass(course) {
  const rawCode = String(course.subjectCode || course.subject || "").trim().toUpperCase();
  const rawLabel = String(course.subjectLabel || course.subject || "").trim();

  if (rawCode === "KOR" || rawLabel === "\uAD6D\uC5B4") return "subject-ko";
  if (rawCode === "ENG" || rawLabel === "\uC601\uC5B4") return "subject-en";
  if (rawCode === "MATH" || rawLabel === "\uC218\uD559") return "subject-ma";
  if (rawCode === "SCI" || rawLabel === "\uACFC\uD559") return "subject-sc";
  if (rawCode === "ESSAY" || rawLabel === "\uC218\uB9AC\uB17C\uC220") return "subject-etc";
  if (rawCode === "ETC" || rawLabel === "\uAE30\uD0C0" || rawLabel === "\uC77C\uBC18") return "subject-etc";
  return "subject-etc";
}

function toSearchBlob(course) {
  return [
    course.title,
    course.shortDescription,
    course.subjectLabel,
    course.gradeLabel,
    course.instructorName,
    course.year,
    course.subject,
    course.grade
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase())
    .join(" ");
}

function matchesSearch(blob, keyword) {
  const normalized = keyword.trim().toLowerCase();
  if (!normalized) return true;
  const tokens = normalized.split(/\s+/).filter(Boolean);
  return tokens.every((token) => blob.includes(token));
}

function showSkeleton() {
  if (!grid) return;
  const count = getItemsPerPage();
  grid.innerHTML = Array(count)
    .fill(0)
    .map(
      () => `
      <div class="skeleton-course">
        <div class="skeleton skeleton-course-title"></div>
        <div class="skeleton skeleton-course-meta" style="width:80%"></div>
      </div>
    `
    )
    .join("");
}

function renderCard(course) {
  const title = escapeHtml(course.title || TEXT_FALLBACK_TITLE);
  const descriptionRaw = String(course.shortDescription || TEXT_FALLBACK_DESC);
  const excerpt = descriptionRaw.length > EXCERPT_MAX
    ? `${descriptionRaw.slice(0, EXCERPT_MAX)}...`
    : descriptionRaw;

  const year = escapeHtml(toDisplayValue(course._filterYear));
  const grade = escapeHtml(toDisplayValue(course._filterGrade));
  const subject = escapeHtml(toDisplayValue(course._displaySubject));
  const instructor = escapeHtml(course._displayInstructor || "");
  const subjectClass = getSubjectAccentClass(course);

  return `
    <article class="course-card course-card--public ${subjectClass}" data-course-id="${escapeHtml(course.id)}" role="link" tabindex="0" aria-label="${title}">
      <div class="course-card__meta-band" aria-label="${TEXT_META_ARIA}">
        <span class="course-card__meta-item">${year}</span>
        <span class="course-card__meta-sep" aria-hidden="true">|</span>
        <span class="course-card__meta-item">${grade}</span>
        <span class="course-card__meta-sep" aria-hidden="true">|</span>
        <span class="course-card__meta-item course-card__meta-item--subject">${subject}</span>
        <span class="course-card__meta-sep" aria-hidden="true">|</span>
        <span class="course-card__meta-item">${instructor}</span>
      </div>
      <div class="course-card__content-block">
        <h3 class="course-card__title">${title}</h3>
        <p class="course-card__excerpt muted">${escapeHtml(excerpt)}</p>
      </div>
    </article>
  `;
}

function hasActiveFilter() {
  return filterState.year !== "all" || filterState.grade !== "all" || filterState.subject !== "all";
}

function updateSearchMeta(totalCount) {
  if (!searchMeta) return;
  const keyword = searchKeyword.trim();
  const activeFilter = hasActiveFilter();

  if (!keyword && !activeFilter) {
    searchMeta.hidden = true;
    searchMeta.textContent = "";
    return;
  }

  searchMeta.hidden = false;
  if (totalCount > 0) {
    searchMeta.textContent = `${TEXT_RESULT_FOUND} ${totalCount}\uAC1C`;
  } else {
    searchMeta.textContent = TEXT_RESULT_NOT_FOUND;
  }
}

function itemSortKey(course) {
  const timestamp = course.createdAt?.toDate?.();
  if (timestamp instanceof Date) return timestamp.getTime();
  return 0;
}

function hidePagination() {
  const pagination = document.getElementById("contentPagination");
  if (!pagination) return;
  pagination.onclick = null;
  pagination.style.display = "none";
  pagination.innerHTML = "";
}

function renderContentPaginationBar(totalPages, itemsPerPage, totalItems) {
  const pagination = document.getElementById("contentPagination");
  if (!pagination) return;

  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
  const endItem = Math.min(currentPage * itemsPerPage, totalItems);
  const rangeText = totalItems === 0 ? "" : `${startItem}-${endItem} / ${totalItems}`;

  if (totalPages <= 1) {
    pagination.onclick = null;
    pagination.style.display = "flex";
    pagination.className = "courses-pagination";
    pagination.innerHTML = `
      <div class="courses-pagination-inner">
        <p class="courses-pagination-info" aria-live="polite">${rangeText}</p>
      </div>
    `;
    return;
  }

  const current = currentPage;
  const firstDisabled = current <= 1;
  const lastDisabled = current >= totalPages;

  const groupSize = 5;
  let start = Math.max(1, current - Math.floor(groupSize / 2));
  let end = Math.min(totalPages, start + groupSize - 1);
  if (end - start < groupSize - 1) start = Math.max(1, end - groupSize + 1);

  let pages = "";
  for (let index = start; index <= end; index += 1) {
    const active = index === current
      ? ' style="background:var(--brand);color:#fff;border-color:var(--brand)"'
      : "";
    pages += `<button type="button" class="pagination-btn pagination-num courses-pagination-num" data-content-p="${index}"${active}>${index}</button>`;
  }

  pagination.style.display = "flex";
  pagination.className = "courses-pagination";
  pagination.innerHTML = `
    <div class="courses-pagination-inner">
      <div class="courses-pagination-controls">
        <button type="button" class="pagination-btn courses-pagination-arrow" data-content-p="first" ${firstDisabled ? "disabled" : ""}>&lt;&lt;</button>
        <button type="button" class="pagination-btn courses-pagination-arrow" data-content-p="prev" ${firstDisabled ? "disabled" : ""}>&lt;</button>
        <div class="courses-pagination-pages">${pages}</div>
        <button type="button" class="pagination-btn courses-pagination-arrow" data-content-p="next" ${lastDisabled ? "disabled" : ""}>&gt;</button>
        <button type="button" class="pagination-btn courses-pagination-arrow" data-content-p="last" ${lastDisabled ? "disabled" : ""}>&gt;&gt;</button>
      </div>
      <p class="courses-pagination-info" aria-live="polite">${rangeText}</p>
    </div>
  `;

  pagination.onclick = (event) => {
    const button = event.target.closest("button[data-content-p]");
    if (!button || button.disabled) return;

    const action = button.getAttribute("data-content-p");
    const pageCount = Math.max(1, Math.ceil(filteredCourses.length / getItemsPerPage()));

    let nextPage = current;
    if (action === "first") nextPage = 1;
    else if (action === "prev") nextPage = current - 1;
    else if (action === "next") nextPage = current + 1;
    else if (action === "last") nextPage = pageCount;
    else nextPage = Number.parseInt(action, 10);

    if (!Number.isInteger(nextPage) || nextPage < 1 || nextPage > pageCount) return;

    currentPage = nextPage;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
}

function render() {
  if (!grid) return;

  if (filteredCourses.length === 0) {
    grid.innerHTML = "";
    if (empty) {
      empty.hidden = false;
      empty.textContent = TEXT_EMPTY;
    }
    hidePagination();
    return;
  }

  if (empty) empty.hidden = true;

  const itemsPerPage = getItemsPerPage();
  const total = filteredCourses.length;
  const totalPages = Math.ceil(total / itemsPerPage);
  const start = itemsPerPage * (currentPage - 1);
  const pageItems = filteredCourses.slice(start, start + itemsPerPage);

  grid.innerHTML = pageItems.map(renderCard).join("");
  renderContentPaginationBar(totalPages, itemsPerPage, total);
}

function matchesFilter(course) {
  if (filterState.year !== "all" && course._filterYear !== filterState.year) return false;
  if (filterState.grade !== "all" && course._filterGrade !== filterState.grade) return false;
  if (filterState.subject !== "all" && course._filterSubject !== filterState.subject) return false;
  return true;
}

function applyFilters() {
  let next = allCourses.slice();

  if (hasActiveFilter()) {
    next = next.filter(matchesFilter);
  }

  if (searchKeyword.trim()) {
    next = next.filter((course) => matchesSearch(course._searchBlob || "", searchKeyword));
  }

  next.sort((a, b) => {
    const timeDiff = itemSortKey(b) - itemSortKey(a);
    if (timeDiff !== 0) return timeDiff;
    return (a.title || "").localeCompare(b.title || "", "ko");
  });

  filteredCourses = next;
  currentPage = 1;
  updateSearchMeta(filteredCourses.length);
  render();
}

function replaceFilterOptions(selectEl, values, allLabel) {
  if (!selectEl) return;
  const current = selectEl.value || "all";
  const options = values
    .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
    .join("");

  selectEl.innerHTML = `<option value="all">${escapeHtml(allLabel)}</option>${options}`;
  selectEl.value = values.includes(current) ? current : "all";
}

function replaceLabeledFilterOptions(selectEl, items, allLabel) {
  if (!selectEl) return;
  const current = selectEl.value || "all";
  const values = items.map((item) => String(item.value));
  const options = items
    .map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`)
    .join("");

  selectEl.innerHTML = `<option value="all">${escapeHtml(allLabel)}</option>${options}`;
  selectEl.value = values.includes(current) ? current : "all";
}

function populateFilterOptions() {
  const years = getCourseYearLabels(mergedCourseCatalog);
  const grades = getCourseGradeLabels(mergedCourseCatalog);
  const subjects = getCourseSubjectOptions(mergedCourseCatalog);

  replaceFilterOptions(yearFilterEl, years, "\uC5F0\uB3C4");
  replaceFilterOptions(gradeFilterEl, grades, "\uD559\uB144");
  replaceLabeledFilterOptions(subjectFilterEl, subjects, "\uACFC\uBAA9");
}

async function loadCatalogSettings() {
  try {
    const catalogResult = await getPublicSettingDoc("courseCatalog");
    mergedCourseCatalog = mergeCourseCatalog(catalogResult.exists ? catalogResult.data : {});
    labelMaps = createCourseLabelMaps(catalogResult.exists ? catalogResult.data : {});
  } catch (error) {
    console.warn("[courses] failed to load catalog settings", error);
    mergedCourseCatalog = mergeCourseCatalog({});
    labelMaps = createCourseLabelMaps({});
  }
  populateFilterOptions();
}

async function loadInstructorMap() {
  instructorsByUid = {};
}

function buildLegacyFlags(course) {
  const flags = [];
  if (course.legacyFlags.descriptionFromBody) flags.push("description:body");
  if (course.legacyFlags.categoryFromKind) flags.push("category:kind");
  if (course.legacyFlags.instructorFromLegacyField) flags.push("instructor:instructor");
  if (course.legacyFlags.examFieldsPresent) flags.push("exam_fields_present");
  return flags;
}

async function loadCourses() {
  try {
    const publishedQuery = query(
      collection(db, COURSES_COLLECTION),
      where("status", "==", "published"),
      where("visibility", "==", "public")
    );
    const snapshot = await getDocs(publishedQuery);

    const mapped = snapshot.docs
      .map((snap) => normalizeCourseForReadOnly(
        { id: snap.id, ...snap.data() },
        {
          labelMaps,
          instructorsByUid
        }
      ))
      .filter((course) => course.status === "published")
      .map((course) => ({
        ...course,
        _searchBlob: toSearchBlob(course),
        _legacyFlags: buildLegacyFlags(course),
        _filterYear: normalizeYearFilterValue(course),
        _filterGrade: normalizeGradeFilterValue(course),
        _filterSubject: normalizeSubjectFilterValue(course.subjectCode || course.subject),
        _displaySubject: toDisplayValue(course.subjectLabel),
        _displayInstructor: toInstructorDisplayValue(course.instructorName)
      }));

    allCourses = mapped;

    if (grid && grid.querySelector(".skeleton-course")) {
      grid.innerHTML = "";
    }

    const docsUsingLegacyFallback = allCourses.filter((course) => course._legacyFlags.length > 0);
    if (docsUsingLegacyFallback.length > 0) {
      console.warn("[courses] legacy field fallback used", {
        count: docsUsingLegacyFallback.length,
        sample: docsUsingLegacyFallback.slice(0, 5).map((course) => ({ id: course.id, flags: course._legacyFlags }))
      });
    }

    populateFilterOptions();
    applyFilters();
  } catch (error) {
    if (error.code !== "permission-denied") {
      console.error("[courses] failed to load courses", error);
    }
    allCourses = [];
    filteredCourses = [];
    render();
  }
}

function openCourseDetailFromCard(cardElement) {
  const courseIdValue = cardElement.getAttribute("data-course-id");
  if (!courseIdValue) return;
  window.location.href = `/course-detail.html?courseId=${encodeURIComponent(courseIdValue)}`;
}

function setupInteractions() {
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      searchKeyword = searchInput.value || "";
      applyFilters();
    });
  }

  if (yearFilterEl) {
    yearFilterEl.addEventListener("change", () => {
      filterState.year = yearFilterEl.value || "all";
      applyFilters();
    });
  }

  if (gradeFilterEl) {
    gradeFilterEl.addEventListener("change", () => {
      filterState.grade = gradeFilterEl.value || "all";
      applyFilters();
    });
  }

  if (subjectFilterEl) {
    subjectFilterEl.addEventListener("change", () => {
      filterState.subject = subjectFilterEl.value || "all";
      applyFilters();
    });
  }

  let resizeTimer = null;
  let lastItemsPerPage = getItemsPerPage();
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const nextItemsPerPage = getItemsPerPage();
      if (nextItemsPerPage === lastItemsPerPage) return;
      lastItemsPerPage = nextItemsPerPage;
      const totalPages = Math.max(1, Math.ceil(filteredCourses.length / nextItemsPerPage));
      if (currentPage > totalPages) currentPage = totalPages;
      render();
    }, 150);
  });

  if (!grid) return;

  grid.addEventListener("click", (event) => {
    const card = event.target.closest(".course-card");
    if (!card) return;
    openCourseDetailFromCard(card);
  });

  grid.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const card = event.target.closest(".course-card");
    if (!card) return;
    event.preventDefault();
    openCourseDetailFromCard(card);
  });
}

async function bootstrap() {
  if (grid) showSkeleton();
  setupInteractions();

  await Promise.all([
    loadCatalogSettings(),
    loadInstructorMap()
  ]);

  await loadCourses();
}

bootstrap();
