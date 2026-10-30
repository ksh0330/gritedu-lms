export const LIST_PAGE_SIZE_OPTIONS = Object.freeze([10, 20, 50]);

export function normalizeListPageSize(value, fallback = 10) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return LIST_PAGE_SIZE_OPTIONS.includes(parsed) ? parsed : fallback;
}

export function bindCommittedSearch(input, button, onCommit) {
  if (!input || typeof onCommit !== "function") return () => {};

  const commit = () => onCommit(String(input.value || "").trim().toLowerCase());
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    commit();
  });
  button?.addEventListener("click", commit);
  return commit;
}

export function getListPageState(totalItems, currentPage, pageSize) {
  const safeTotal = Math.max(0, Number(totalItems) || 0);
  const safePageSize = normalizeListPageSize(pageSize);
  const totalPages = Math.max(1, Math.ceil(safeTotal / safePageSize));
  const safeCurrentPage = Math.min(
    totalPages,
    Math.max(1, Number.parseInt(String(currentPage || 1), 10) || 1)
  );
  const startIndex = (safeCurrentPage - 1) * safePageSize;
  const endIndex = Math.min(startIndex + safePageSize, safeTotal);

  return {
    currentPage: safeCurrentPage,
    endIndex,
    rangeEnd: safeTotal ? endIndex : 0,
    rangeStart: safeTotal ? startIndex + 1 : 0,
    startIndex,
    totalItems: safeTotal,
    totalPages,
  };
}

export function renderListPagination(container, {
  currentPage = 1,
  onPageChange,
  pageSize = 10,
  totalItems = 0,
} = {}) {
  const state = getListPageState(totalItems, currentPage, pageSize);
  if (!container) return state;

  const groupSize = 5;
  let pageStart = Math.max(1, state.currentPage - Math.floor(groupSize / 2));
  let pageEnd = Math.min(state.totalPages, pageStart + groupSize - 1);
  if (pageEnd - pageStart < groupSize - 1) {
    pageStart = Math.max(1, pageEnd - groupSize + 1);
  }

  let pageButtons = "";
  for (let page = pageStart; page <= pageEnd; page += 1) {
    const active = page === state.currentPage;
    pageButtons += `<button type="button" class="btn sm${active ? " primary" : ""}" data-list-page="${page}"${active ? ' aria-current="page" disabled' : ""}>${page}</button>`;
  }

  const hasMultiplePages = state.totalPages > 1;
  const firstDisabled = state.currentPage <= 1 ? " disabled" : "";
  const lastDisabled = state.currentPage >= state.totalPages ? " disabled" : "";
  const controls = hasMultiplePages
    ? `<div class="admin-list-pagination__controls">
        <button type="button" class="btn sm" data-list-page="first"${firstDisabled} aria-label="첫 페이지">&lt;&lt;</button>
        <button type="button" class="btn sm" data-list-page="prev"${firstDisabled} aria-label="이전 페이지">&lt;</button>
        <div class="admin-list-pagination__pages">${pageButtons}</div>
        <button type="button" class="btn sm" data-list-page="next"${lastDisabled} aria-label="다음 페이지">&gt;</button>
        <button type="button" class="btn sm" data-list-page="last"${lastDisabled} aria-label="마지막 페이지">&gt;&gt;</button>
      </div>`
    : "";

  container.classList.add("admin-list-pagination");
  container.hidden = !hasMultiplePages;
  container.innerHTML = controls;
  container.onclick = (event) => {
    const button = event.target.closest("button[data-list-page]");
    if (!button || button.disabled || typeof onPageChange !== "function") return;
    const action = button.dataset.listPage;
    let nextPage = state.currentPage;
    if (action === "first") nextPage = 1;
    else if (action === "prev") nextPage -= 1;
    else if (action === "next") nextPage += 1;
    else if (action === "last") nextPage = state.totalPages;
    else nextPage = Number.parseInt(action || "", 10);
    if (!Number.isInteger(nextPage) || nextPage < 1 || nextPage > state.totalPages) return;
    onPageChange(nextPage);
  };

  return state;
}
