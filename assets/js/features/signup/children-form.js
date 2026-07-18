/**
 * 자녀 정보 폼 관리 모듈
 * 자녀 추가/삭제, 학교 검색, children 배열 serialize
 */

import { setupPhoneFormatting } from "./validators.js";
import { convertChildGrade } from "./validators.js";
import { loadSchoolCsvText } from "/assets/js/utils/school-csv.js";

let schoolList = [];
let currentSchoolInputId = null;
let selectedSchoolIndex = -1;
let childIndexCounter = 0;

const schoolSearchState = {
  currentPage: 1,
  itemsPerPage: 20,
  totalResults: 0,
  currentResults: []
};

function parseCsvRow(row) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < row.length; i += 1) {
    const char = row[i];

    if (char === '"') {
      if (inQuotes && row[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

/**
 * 학교 데이터 로드
 */
export async function loadSchoolData() {
  try {
    const rows = (await loadSchoolCsvText()).split(/\r?\n/).filter((line) => line.trim());
    schoolList = [];

    for (let i = 1; i < rows.length; i++) {
      const line = rows[i].trim();
      if (!line) continue;

      const parts = parseCsvRow(line);
      if (parts.length >= 3) {
        const name = parts[0].trim();
        const schoolType = parts[1].trim();
        const address = parts[2].trim();

        if (name) {
          schoolList.push({
            name,
            schoolType,
            address,
            displayInfo: [schoolType, address].filter(Boolean).join(" | ")
          });
        }
      }
    }
  } catch (error) {
    console.error("학교 목록 로드 실패:", error);
  }
}

/**
 * 학교 검색
 */
function searchSchools(query) {
  if (!query || query.trim().length < 1) {
    return [];
  }

  const searchTerm = query.trim();
  return schoolList.filter((school) => {
    const name = (school.name || "").trim();

    return (
      name.includes(searchTerm) ||
      name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  });
}

/**
 * HTML 엔티티 디코딩
 */
function decodeHtmlEntity(html) {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = html;
  return textarea.value;
}

/**
 * 학교 검색 결과 렌더링
 */
function renderSearchResults(query, page = 1) {
  const resultsContainer = document.getElementById("schoolSearchResults");
  if (!resultsContainer) return;

  if (!query || query.trim().length < 1) {
    schoolSearchState.currentPage = 1;
    schoolSearchState.totalResults = 0;
    schoolSearchState.currentResults = [];
    resultsContainer.innerHTML =
      '<div class="school-search-empty">검색어를 입력해 주세요.</div>';
    return;
  }

  const results = searchSchools(query);
  schoolSearchState.totalResults = results.length;
  schoolSearchState.currentPage = page;

  if (results.length === 0) {
    schoolSearchState.currentResults = [];
    resultsContainer.innerHTML = `
      <div class="school-search-empty">
        검색 결과가 없습니다.<br>
        아래 "직접 입력" 버튼을 눌러 학교명을 직접 입력하세요.
      </div>
    `;
    return;
  }

  const start = (page - 1) * schoolSearchState.itemsPerPage;
  const end = start + schoolSearchState.itemsPerPage;
  const pageResults = results.slice(start, end);
  schoolSearchState.currentResults = pageResults;

  const totalPages = Math.ceil(results.length / schoolSearchState.itemsPerPage);
  let html = "";

  pageResults.forEach((school, index) => {
    const escapedName = school.name.replace(/'/g, "&#39;").replace(/"/g, "&quot;");
    html += `
      <div class="school-search-item" data-school="${escapedName}" data-index="${start + index}">
        <div class="school-search-item-name">${school.name}</div>
        <div class="school-search-item-info">${school.displayInfo}</div>
      </div>
    `;
  });

  if (totalPages > 1) {
    html += '<div class="school-search-pagination">';

    if (page > 1) {
      html += `<button type="button" class="school-search-page-btn" data-page="${page - 1}">이전</button>`;
    }

    const maxVisible = 5;
    let startPage = Math.max(1, page - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);

    if (endPage - startPage < maxVisible - 1) {
      startPage = Math.max(1, endPage - maxVisible + 1);
    }

    if (startPage > 1) {
      html += `<button type="button" class="school-search-page-btn" data-page="1">1</button>`;
      if (startPage > 2) {
        html += '<span class="school-search-page-ellipsis">...</span>';
      }
    }

    for (let i = startPage; i <= endPage; i++) {
      html +=
        i === page
          ? `<button type="button" class="school-search-page-btn active" data-page="${i}">${i}</button>`
          : `<button type="button" class="school-search-page-btn" data-page="${i}">${i}</button>`;
    }

    if (endPage < totalPages) {
      if (endPage < totalPages - 1) {
        html += '<span class="school-search-page-ellipsis">...</span>';
      }
      html += `<button type="button" class="school-search-page-btn" data-page="${totalPages}">${totalPages}</button>`;
    }

    if (page < totalPages) {
      html += `<button type="button" class="school-search-page-btn" data-page="${page + 1}">다음</button>`;
    }

    html += "</div>";
    html += `<div class="school-search-pagination-info">총 ${results.length}개 결과 (${page}/${totalPages} 페이지)</div>`;
  }

  resultsContainer.innerHTML = html;

  resultsContainer.querySelectorAll(".school-search-item").forEach((item, index) => {
    item.addEventListener("click", () => {
      const schoolName = item.getAttribute("data-school");
      selectSchool(schoolName);
    });
    
    item.addEventListener("mouseenter", () => {
      selectedSchoolIndex = index;
      const items = resultsContainer.querySelectorAll(".school-search-item");
      updateSchoolSelection(items);
    });
  });

  resultsContainer.querySelectorAll(".school-search-page-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const pageNum = parseInt(btn.getAttribute("data-page"));
      if (pageNum && pageNum !== page) {
        renderSearchResults(query, pageNum);
        resultsContainer.scrollTop = 0;
      }
    });
  });
}

/**
 * 학교 선택 하이라이트 업데이트
 */
function updateSchoolSelection(items) {
  items.forEach((item, index) => {
    if (index === selectedSchoolIndex) {
      item.style.backgroundColor = "var(--hover)";
      item.style.borderColor = "var(--brand)";
      item.style.borderWidth = "2px";
    } else {
      item.style.backgroundColor = "";
      item.style.borderColor = "";
      item.style.borderWidth = "";
    }
  });
}

/**
 * 학교 검색 모달 초기화
 */
function initSchoolSearchModal() {
  const searchInput = document.getElementById("schoolSearchInput");
  if (!searchInput) return;

  let timeout;
  searchInput.setAttribute("lang", "ko");

  searchInput.addEventListener("input", (e) => {
    const value = e.target.value;
    clearTimeout(timeout);
    selectedSchoolIndex = -1; // 검색 시 선택 초기화
    timeout = setTimeout(() => {
      renderSearchResults(value);
    }, 100);
  });

  renderSearchResults("");

  searchInput.addEventListener("keydown", (e) => {
    const items = document.querySelectorAll(".school-search-item");
    
    if (e.key === "Enter") {
      e.preventDefault();
      if (selectedSchoolIndex >= 0 && items[selectedSchoolIndex]) {
        const schoolName = items[selectedSchoolIndex].getAttribute("data-school");
        if (schoolName) {
          selectSchool(schoolName);
        }
      } else {
        const firstItem = items[0];
        if (firstItem) {
          const schoolName = firstItem.getAttribute("data-school");
          if (schoolName) {
            selectSchool(schoolName);
          }
        }
      }
    } else if (e.key === "Escape") {
      closeSchoolSearchModal();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (items.length > 0) {
        selectedSchoolIndex = Math.min(selectedSchoolIndex + 1, items.length - 1);
        updateSchoolSelection(items);
        items[selectedSchoolIndex]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length > 0) {
        selectedSchoolIndex = Math.max(selectedSchoolIndex - 1, -1);
        updateSchoolSelection(items);
        if (selectedSchoolIndex >= 0) {
          items[selectedSchoolIndex]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
      }
    }
  });
}

/**
 * 학교 검색 초기화
 */
export async function initSchoolSearch() {
  await loadSchoolData();
  initSchoolSearchModal();
}

/**
 * 학교 검색 모달 열기
 */
export function openSchoolSearchModal(inputId, childIndex) {
  if (typeof childIndex === "number") {
    const childInputs = document.querySelectorAll(".child-school-input");
    const input = childInputs[childIndex];
    if (input) {
      currentSchoolInputId = input.id || `childSchool_${childIndex}`;
      if (!input.id) {
        input.id = `childSchool_${childIndex}`;
      }
    } else {
      currentSchoolInputId = inputId;
    }
  } else {
    currentSchoolInputId = inputId;
  }

  const modal = document.getElementById("schoolSearchModal");
  const searchInput = document.getElementById("schoolSearchInput");
  const resultsContainer = document.getElementById("schoolSearchResults");

  if (modal && searchInput) {
    modal.classList.remove("hidden");
    searchInput.value = "";
    searchInput.setAttribute("lang", "ko");

    if (resultsContainer) {
      resultsContainer.innerHTML =
        '<div class="school-search-empty">검색어를 입력해 주세요.</div>';
    }

    setTimeout(() => {
      searchInput.focus();
      if (searchInput.setSelectionRange) {
        searchInput.setSelectionRange(0, 0);
      }
    }, 100);
  }
}

/**
 * 학교 검색 모달 닫기
 */
export function closeSchoolSearchModal() {
  const modal = document.getElementById("schoolSearchModal");
  if (modal) {
    modal.classList.add("hidden");
    currentSchoolInputId = null;
  }
}

/**
 * 직접 입력 선택
 */
export function selectDirectInput() {
  if (!currentSchoolInputId) return;

  const input = document.getElementById(currentSchoolInputId);
  if (input) {
    input.removeAttribute("readonly");
    input.style.cursor = "text";
    input.focus();
    closeSchoolSearchModal();
  }
}

/**
 * 학교 선택
 */
export function selectSchool(schoolName) {
  if (!currentSchoolInputId) return;

  const input = document.getElementById(currentSchoolInputId);
  if (input) {
    const decodedName = decodeHtmlEntity(schoolName);
    input.value = decodedName;
    input.removeAttribute("readonly");
    input.style.cursor = "text";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    closeSchoolSearchModal();
  }
}

/**
 * 자녀 추가
 */
export function addChild(showStatusCallback) {
  const container = document.getElementById("childrenContainer");
  if (!container) return;

  childIndexCounter++;
  const childItem = document.createElement("div");
  childItem.className = "child-item";
  childItem.setAttribute("data-child-index", childIndexCounter.toString());

  const childNumber = childIndexCounter + 1;
  const schoolInputId = `childSchool_${childIndexCounter}`;

  childItem.innerHTML = `
    <div class="child-item-header">
      <h4>자녀 ${childNumber}</h4>
      <button type="button" class="btn-remove-child" onclick="window.removeChild(${childIndexCounter})">삭제</button>
    </div>
    <div class="form-group">
      <label>자녀 이름 <span class="required">*</span></label>
      <input type="text" class="child-name-input" data-child-index="${childIndexCounter}" required placeholder="자녀의 이름을 입력해 주세요" autocomplete="off" />
    </div>
    <div class="form-group">
      <label>학교 <span class="required">*</span></label>
      <input type="text" id="${schoolInputId}" class="child-school-input" data-child-index="${childIndexCounter}" required placeholder="자녀의 학교명을 입력해 주세요" autocomplete="off" readonly class="cursor-pointer" />
      <button type="button" class="btn mt-8 w-full" onclick="window.openSchoolSearchModal('${schoolInputId}', ${childIndexCounter})">학교 검색</button>
    </div>
    <div class="form-group">
      <label>학년 <span class="required">*</span></label>
      <select class="child-grade-select" data-child-index="${childIndexCounter}" required>
        <option value="">선택</option>
        <option value="3">중3</option>
        <option value="4">고1</option>
        <option value="5">고2</option>
        <option value="6">고3</option>
      </select>
    </div>
    <div class="form-group">
      <label>자녀 전화번호 <span class="required">*</span></label>
      <input type="tel" class="child-phone-input" data-child-index="${childIndexCounter}" required placeholder="010-1234-5678" inputmode="tel" autocomplete="tel" />
    </div>
  `;

  container.appendChild(childItem);

  setTimeout(() => {
    setupPhoneFormatting();
  }, 100);

  document.querySelectorAll(".child-item").forEach((item, index) => {
    const number = index + 1;
    item.querySelector("h4").textContent = `자녀 ${number}`;
    item.setAttribute("data-child-index", index.toString());
    item.querySelectorAll("input,select").forEach((input) => {
      input.setAttribute("data-child-index", index.toString());
    });
  });
}

/**
 * 자녀 삭제
 */
export function removeChild(index, showStatusCallback) {
  const childItem = document.querySelector(`.child-item[data-child-index="${index}"]`);
  if (!childItem) return;

  if (document.querySelectorAll(".child-item").length <= 1) {
    if (showStatusCallback) {
      showStatusCallback("최소 1명의 자녀 정보는 입력해야 합니다.", true);
    }
    return;
  }

  childItem.remove();

  document.querySelectorAll(".child-item").forEach((item, index) => {
    const number = index + 1;
    item.querySelector("h4").textContent = `자녀 ${number}`;
    item.setAttribute("data-child-index", index.toString());
    item.querySelectorAll("input,select").forEach((input) => {
      input.setAttribute("data-child-index", index.toString());
    });
  });
}

/**
 * children 배열 serialize (DOM에서 children 데이터 추출)
 */
export function serializeChildren() {
  const childItems = document.querySelectorAll(".child-item");
  const children = [];

  childItems.forEach((item, index) => {
    const name = item.querySelector(".child-name-input")?.value.trim() || "";
    const school = item.querySelector(".child-school-input")?.value.trim() || "";
    const grade = item.querySelector(".child-grade-select")?.value || "";
    const phone = item.querySelector(".child-phone-input")?.value.trim() || "";

    if (!name || !school || !grade || !phone) {
      return;
    }

    const phoneDigits = phone.replace(/[^\d]/g, "");
    if (phoneDigits.length < 10) {
      return;
    }

    children.push({
      name: name,
      school: school,
      grade: convertChildGrade(grade),
      phone: phone
    });
  });

  return children;
}

// Commit 1: 기존 signup.js가 window 객체에 함수를 할당하므로 여기서는 할당하지 않음
// Commit 2에서 기존 signup.js를 제거할 때 활성화 예정
// window.openSchoolSearchModal = openSchoolSearchModal;
// window.closeSchoolSearchModal = closeSchoolSearchModal;
// window.selectDirectInput = selectDirectInput;
// window.selectSchool = selectSchool;
