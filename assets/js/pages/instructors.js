import { app } from "/assets/js/firebase-init.js";
import { getFirestore, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { getPublicSettingDoc } from "/assets/js/utils/settings-cache.js";
import { escapeHtml } from "/assets/js/utils/html.js";
import { normalizeCatalogList } from "/assets/js/utils/catalog-select-helpers.js";
import {
  instructorMatchesSubject,
  renderInstructorSubjectBadgesHtml,
  loadInstructorMenuSubjects,
  DEFAULT_INSTRUCTOR_MENU_SUBJECTS,
} from "/assets/js/utils/instructor-subjects.js";
import {
  resolveInstructorProfileImageUrl,
  INSTRUCTOR_PROFILE_PLACEHOLDER,
} from "/assets/js/utils/public-image-url.js";
import { bindGuardedImages } from "/assets/js/utils/image-load-guard.js";

const db = getFirestore(app);

const grid = document.getElementById("instructorGrid");
const empty = document.getElementById("instructorEmpty");
const PLACEHOLDER = INSTRUCTOR_PROFILE_PLACEHOLDER;

let ALL = [];
let currentSubject = "all";
let currentSearch = "";
let instructorOrder = [];
let instructorHidden = [];

function showSkeleton() {
  if (grid) {
    grid.innerHTML = Array(8).fill(0).map(() => '<div class="skeleton-instructor"></div>').join("");
  }
}

function clearInstructorGrid() {
  if (!grid) return;
  grid.replaceChildren();
}

function showInstructorEmptyState() {
  if (!empty) return;
  empty.hidden = false;
}

function hideInstructorEmptyState() {
  if (!empty) return;
  empty.hidden = true;
}

function cardHTML(instructor) {
  const raw = (instructor.photo || instructor.profilePhoto || instructor.imageUrl || "").trim();
  const photoUrl = resolveInstructorProfileImageUrl(raw);
  const name = (instructor.name || "").trim();
  const subjectBadges = renderInstructorSubjectBadgesHtml(instructor, currentSubject, escapeHtml);
  const brief = (instructor.brief || "").trim();
  const altText = name ? `${name} 강사` : "강사 이미지";

  return `
    <article class="inst-card" data-id="${escapeHtml(instructor.id)}" data-name="${escapeHtml(name.toLowerCase())}" tabindex="0" role="button" aria-label="${escapeHtml(name)}">
      <img data-guarded-src="${escapeHtml(photoUrl)}" alt="${escapeHtml(altText)}" loading="lazy" decoding="async" fetchpriority="low">
      <div class="inst-card-text-gradient"></div>
      <div class="inst-card-body">
        ${subjectBadges}
        <div class="inst-card-name-wrapper">
          ${brief ? `<p class="inst-card-intro">${escapeHtml(brief)}</p>` : ""}
          <h3 class="inst-card-name">${escapeHtml(name || "이름 미정")}</h3>
        </div>
      </div>
    </article>
  `;
}

function render(instructors) {
  if (!grid) return;

  clearInstructorGrid();

  if (!instructors.length) {
    showInstructorEmptyState();
    return;
  }

  hideInstructorEmptyState();
  grid.innerHTML = instructors.map((instructor) => cardHTML(instructor)).join("");
  bindGuardedImages(grid, {
    fallbackSrc: PLACEHOLDER,
    allowFallbackOnce: true,
  });
}

function applyInstructorOrder(t) {
  // instructorOrder가 없으면 기본 정렬 적용 (일관된 순서 유지)
  if (!instructorOrder || instructorOrder.length === 0) {
    // order 속성 또는 이름순으로 정렬하여 일관된 순서 유지
    return [...t].sort((a, b) => {
      const orderA = "number" == typeof a.order ? a.order : 999;
      const orderB = "number" == typeof b.order ? b.order : 999;
      if (orderA !== orderB) return orderA - orderB;
      return (a.name || "").localeCompare(b.name || "", "ko-KR");
    });
  }
  
  // home-instructors.js의 sortForHome과 동일한 로직 적용
  const idMap = new Map(t.map(inst => [inst.id, inst]));
  const docIdMap = new Map();
  
  t.forEach(inst => {
    if (inst.docId && inst.docId !== inst.id) {
      docIdMap.set(inst.docId, inst);
    }
  });
  
  const sorted = [];
  const used = new Set();
  
  // instructorOrder에 따라 순서대로 추가
  if (Array.isArray(instructorOrder)) {
    instructorOrder.forEach(id => {
      if (idMap.has(id)) {
        const inst = idMap.get(id);
        sorted.push(inst);
        used.add(inst.id);
        idMap.delete(id);
      } else if (docIdMap.has(id)) {
        const inst = docIdMap.get(id);
        sorted.push(inst);
        used.add(inst.id);
        idMap.delete(inst.id);
      }
    });
  }
  
  // 순서에 없는 항목들을 기존 순서대로 추가 (order 속성 또는 이름순)
  const remaining = Array.from(idMap.values())
    .filter(inst => !used.has(inst.id))
    .sort((a, b) => {
      const orderA = typeof a.order === "number" ? a.order : 999;
      const orderB = typeof b.order === "number" ? b.order : 999;
      if (orderA !== orderB) return orderA - orderB;
      return (a.name || "").localeCompare(b.name || "", "ko-KR");
    });
  
  sorted.push(...remaining);
  return sorted;
}

function applyFilter(t) {
  currentSubject = t || "all";
  filterAndRender();
}

function getInstructorIdentityValues(instructor) {
  return [
    instructor.id,
    instructor.docId,
    instructor.instructorId,
    instructor.uid
  ]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);
}

function filterAndRender() {
  // ALL 배열을 먼저 정렬된 상태로 가져옴
  let t = applyInstructorOrder(ALL);
  
  // 숨김 처리된 강사 제거
  const hiddenIds = new Set(
    instructorHidden
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(Boolean)
  );
  t = t.filter((instructor) => {
    return !getInstructorIdentityValues(instructor).some((id) => hiddenIds.has(id));
  });
  
  // 과목 필터 적용
  if ("all" !== currentSubject) {
    t = t.filter((instructor) => instructorMatchesSubject(instructor, currentSubject));
  }
  
  render(t);
}

if (grid) showSkeleton();

if (grid) {
  grid.addEventListener("click", t => {
    const r = t.target.closest(".inst-card");
    if (!r) return;
    const e = r.getAttribute("data-id");
    if (e) location.href = `/instructor-details.html?doc=${encodeURIComponent(e)}`;
  });
  
  grid.addEventListener("keydown", t => {
    if ("Enter" === t.key) {
      const r = t.target.closest(".inst-card");
      if (r) r.click();
    }
  });
}

const filterBar = document.querySelector('.grit-filter[data-for="instructors"]');
if (filterBar) {
  filterBar.addEventListener("click", (t) => {
    const r = t.target.closest("button[data-subject]");
    if (r) {
      filterBar.querySelectorAll("button[data-subject]").forEach((b) => {
        b.classList.remove("on");
        b.setAttribute("aria-pressed", "false");
      });
      r.classList.add("on");
      r.setAttribute("aria-pressed", "true");
      applyFilter(r.dataset.subject || "all");
    }
  });
}

function escapeFilterHtml(text) {
  if (text == null) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function renderInstructorSubjectChips(subjects) {
  const mount = document.getElementById("instructorFilterChips");
  if (!mount) return;
  const normalized = normalizeCatalogList(subjects);
  const chips = [
    { value: "all", label: "전체" },
    ...normalized.map((subject) => ({ value: subject, label: subject }))
  ];
  mount.innerHTML = chips
    .map((chip) => {
      const v = escapeFilterHtml(String(chip.value));
      const lab = escapeFilterHtml(chip.label);
      const isAll = String(chip.value) === "all";
      const cls = isAll ? "on" : "";
      const pressed = isAll ? "true" : "false";
      return `<button type="button" class="${cls}" data-subject="${v}" aria-pressed="${pressed}">${lab}</button>`;
    })
    .join("");
}

let instructorsData = {};

async function loadAllInstructors() {
  try {
    const [instructorsMenuResult, instructorsSnap] = await Promise.all([
      getPublicSettingDoc("instructorsMenu"),
      getDocs(collection(db, "instructors"))
    ]);

    const r = instructorsMenuResult.exists ? instructorsMenuResult.data : {};
    if (Array.isArray(r.instructorsOrder) && r.instructorsOrder.length > 0) {
      instructorOrder = r.instructorsOrder;
    } else if (Array.isArray(r.order)) {
      instructorOrder = r.order;
    } else {
      instructorOrder = [];
    }
    instructorHidden = Array.isArray(r.instructorsHidden) ? r.instructorsHidden : (Array.isArray(r.hidden) ? r.hidden : []);

    instructorsData = {};
    instructorsSnap.forEach(docSnap => {
      const data = docSnap.data();
      const e = data.instructorId || docSnap.id;
      instructorsData[docSnap.id] = { id: e, docId: docSnap.id, instructorId: e, ...data };
    });

    mergeAndRender();
  } catch (err) {
    console.error("[instructors] 강사 목록 로드 실패:", err);
    render([]);
  }
}

function mergeAndRender() {
  const t = [];
  const n = new Set;
  const s = { noName: [], duplicate: [] };
  
  Object.entries(instructorsData).forEach(([o, c]) => {
    const i = c.instructorId || o;
    const d = (c.name || "").trim();
    if (!d) return void s.noName.push({ docId: o, instructorId: i, data: c });
    if (n.has(d)) return s.duplicate.push({ docId: o, instructorId: i, name: d }), void 0;

    const l = {
      id: i,
      docId: o,
      instructorId: i,
      ...c,
      uid: c.uid || null,
      photo: c.photo || c.profilePhoto || "",
      hasAccount: !!c.uid
    };
    t.push(l);
    n.add(d);
  });

  ALL = t;
  filterAndRender();
}

async function bootstrapInstructorsPage() {
  try {
    const subjects = await loadInstructorMenuSubjects(getPublicSettingDoc);
    renderInstructorSubjectChips(subjects);
  } catch (e) {
    console.warn("[instructors] instructorsMenu.subjects 로드 실패, 기본 칩 사용:", e);
    renderInstructorSubjectChips(DEFAULT_INSTRUCTOR_MENU_SUBJECTS);
  }
  await loadAllInstructors();
}

bootstrapInstructorsPage();
