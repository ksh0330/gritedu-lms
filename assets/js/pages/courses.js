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
import { getPublicSettingDoc, getSettingDoc } from "/assets/js/utils/settings-cache.js";
import {
  bindCommittedSearch,
  normalizeListPageSize,
  renderListPagination,
} from "/assets/js/utils/list-controls.js";
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
import {
  getSubjectColorStyle,
  loadSharedSubjectColorMap,
  mergeSubjectColorMap,
} from "/assets/js/utils/subject-colors.js";

const db = getFirestore(app);
const COURSES_COLLECTION = "courses";

const grid = document.getElementById("contentGrid");
const empty = document.getElementById("contentEmpty");
const searchInput = document.getElementById("courseSearch");
const searchMeta = document.getElementById("coursesSearchMeta");
const yearFilterEl = document.getElementById("filterYear");
const gradeFilterEl = document.getElementById("filterGrade");
const subjectFilterEl = document.getElementById("filterSubject");
const pageSizeEl = document.getElementById("coursePageSize");
const searchButton = document.getElementById("publicCourseSearchButton");

const EXCERPT_MAX = 140;

const TEXT_FALLBACK_TITLE = "\uC81C\uBAA9 \uC5C6\uB294 \uAC15\uC88C";
const TEXT_FALLBACK_DESC = "\uAC15\uC88C \uC18C\uAC1C\uAC00 \uC900\uBE44 \uC911\uC785\uB2C8\uB2E4. \uC790\uC138\uD55C \uC218\uC5C5 \uC548\uB0B4\uB294 \uC0C1\uB2F4\uC744 \uD1B5\uD574 \uD655\uC778\uD574 \uC8FC\uC138\uC694.";
const TEXT_META_ARIA = "\uAC15\uC88C \uBA54\uD0C0 \uC815\uBCF4";
const TEXT_RESULT_NOT_FOUND = "\uC870\uAC74\uC5D0 \uB9DE\uB294 \uAC15\uC88C\uB97C \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.";
const TEXT_EMPTY = "\uD574\uB2F9 \uC870\uAC74\uC758 \uAC15\uC88C\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.";

let currentPage = 1;
let itemsPerPage = 10;
let searchKeyword = "";
let allCourses = [];
let filteredCourses = [];
let labelMaps = createCourseLabelMaps({});
let mergedCourseCatalog = mergeCourseCatalog({});
let subjectColorMap = mergeSubjectColorMap({});
let instructorsByUid = {};
const filterState = {
  year: "all",
  grade: "all",
  subject: "all"
};

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
  grid.classList.remove("is-empty");
  const count = itemsPerPage;
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
  const subjectRaw = toDisplayValue(course._displaySubject);
  const subject = escapeHtml(subjectRaw);
  const instructor = escapeHtml(course._displayInstructor || "");
  const subjectColorStyle = getSubjectColorStyle(subjectRaw, subjectColorMap);

  return `
    <article class="course-card course-card--public${subjectColorStyle ? " has-subject-color" : ""}" data-course-id="${escapeHtml(course.id)}" data-subject="${subject}"${subjectColorStyle ? ` style="${subjectColorStyle}"` : ""} role="link" tabindex="0" aria-label="${title}">
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

  searchMeta.hidden = totalCount > 0;
  searchMeta.textContent = totalCount > 0 ? "" : TEXT_RESULT_NOT_FOUND;
}

function itemSortKey(course) {
  const timestamp = course.createdAt?.toDate?.();
  if (timestamp instanceof Date) return timestamp.getTime();
  return 0;
}

function renderContentPaginationBar(totalItems) {
  const pagination = document.getElementById("contentPagination");
  if (!pagination) return;
  const state = renderListPagination(pagination, {
    currentPage,
    onPageChange: (nextPage) => {
      currentPage = nextPage;
      render();
    },
    pageSize: itemsPerPage,
    totalItems,
  });
  currentPage = state.currentPage;
}

function render() {
  if (!grid) return;

  if (filteredCourses.length === 0) {
    grid.classList.add("is-empty");
    grid.innerHTML = `<p class="muted courses-grid-empty">${TEXT_EMPTY}</p>`;
    if (empty) empty.hidden = true;
    renderContentPaginationBar(0);
    return;
  }

  grid.classList.remove("is-empty");
  if (empty) empty.hidden = true;

  const total = filteredCourses.length;
  const start = itemsPerPage * (currentPage - 1);
  const pageItems = filteredCourses.slice(start, start + itemsPerPage);

  grid.innerHTML = pageItems.map(renderCard).join("");
  renderContentPaginationBar(total);
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

async function loadSubjectColors() {
  try {
    subjectColorMap = await loadSharedSubjectColorMap(getSettingDoc);
  } catch (error) {
    console.warn("[courses] failed to load subject colors, using defaults", error);
    subjectColorMap = mergeSubjectColorMap({});
  }
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
  window.location.href = `/course-detail?courseId=${encodeURIComponent(courseIdValue)}`;
}

function setupInteractions() {
  bindCommittedSearch(searchInput, searchButton, (keyword) => {
    searchKeyword = keyword;
    applyFilters();
  });

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

  pageSizeEl?.addEventListener("change", () => {
    itemsPerPage = normalizeListPageSize(pageSizeEl.value);
    currentPage = 1;
    render();
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
    loadSubjectColors(),
    loadInstructorMap()
  ]);

  await loadCourses();
}

bootstrap();
