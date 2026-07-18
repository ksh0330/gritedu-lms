import { getPublicSettingDoc } from "/assets/js/utils/settings-cache.js";
import { getActiveScheduleGroups, getExactGroupScheduleImages, getScheduleDivisions, getScheduleGroups, resolveScheduleGroupQuery } from "/assets/js/utils/timetable-catalog.js";

const byId = (id) => document.getElementById(id);
let scheduleImages = [];
let selectedDivision = "all";
let scheduleDivisions = [];

function queryGroup() {
  return new URLSearchParams(location.search).get("group") || "";
}

function renderGroupNav(groups, selectedId) {
  const nav = byId("scheduleGroupNav");
  if (!nav) return;
  const active = getActiveScheduleGroups(groups);
  nav.hidden = active.length < 2;
  nav.innerHTML = "";
  if (active.length < 2) return;
  const list = document.createElement("div");
  list.className = "schedule-images-nav__list";
  active.forEach((group) => {
    const link = document.createElement("a");
    link.className = `schedule-images-nav__link${group.id === selectedId ? " on" : ""}`;
    link.href = `/schedule.html?group=${encodeURIComponent(group.id)}`;
    link.textContent = group.label;
    if (group.id === selectedId) link.setAttribute("aria-current", "page");
    list.appendChild(link);
  });
  nav.appendChild(list);
}

function showEmpty(message) {
  byId("scheduleImagesMain")?.querySelectorAll(".schedule-images-item").forEach((node) => node.remove());
  const empty = byId("scheduleImagesEmpty");
  if (empty) {
    empty.hidden = false;
    empty.textContent = message;
  }
}

function renderDivisionNav() {
  const nav = byId("scheduleDivisionNav");
  if (!nav) return;
  const filters = [["all", "전체"], ...scheduleDivisions.filter((item) => item.active !== false).map((item) => [item.key, item.label])];
  nav.innerHTML = "";
  filters.forEach(([value, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `schedule-division-nav__button${selectedDivision === value ? " on" : ""}`;
    button.dataset.scheduleDivision = value;
    button.setAttribute("aria-pressed", String(selectedDivision === value));
    button.textContent = label;
    nav.appendChild(button);
  });
}

function renderSelectedImages() {
  const filtered = selectedDivision === "all"
    ? scheduleImages
    : scheduleImages.filter((item) => item.division === selectedDivision);
  renderImages(filtered);
}

function openViewer(src, title) {
  const viewer = byId("scheduleImageViewer");
  const image = byId("scheduleImageViewerImage");
  if (!viewer || !image) return;
  image.src = src;
  image.alt = title;
  viewer.hidden = false;
  document.body.classList.add("modal-open");
}

function closeViewer() {
  const viewer = byId("scheduleImageViewer");
  if (!viewer) return;
  viewer.hidden = true;
  document.body.classList.remove("modal-open");
  if (byId("scheduleImageViewerImage")) byId("scheduleImageViewerImage").src = "";
}

function renderImages(images) {
  const main = byId("scheduleImagesMain");
  const empty = byId("scheduleImagesEmpty");
  if (!main) return;
  main.querySelectorAll(".schedule-images-item").forEach((node) => node.remove());
  if (empty) empty.hidden = true;
  if (!images.length) return showEmpty("등록된 시간표 이미지가 없습니다.");

  images.forEach((item, index) => {
    const details = document.createElement("details");
    details.className = "schedule-images-item schedule-images-accordion";
    if (index === 0) details.open = true;
    const summary = document.createElement("summary");
    summary.className = "schedule-images-accordion__summary";
    const name = document.createElement("span");
    name.textContent = item.name;
    const meta = document.createElement("small");
    meta.className = "schedule-images-accordion__division";
    meta.textContent = scheduleDivisions.find((division) => division.key === item.division)?.label || item.division;
    name.appendChild(meta);
    const indicator = document.createElement("span");
    indicator.className = "schedule-images-accordion__indicator";
    indicator.setAttribute("aria-hidden", "true");
    summary.append(name, indicator);

    const figure = document.createElement("figure");
    figure.className = "schedule-images-item__figure";
    const image = document.createElement("img");
    image.className = "schedule-images-item__image";
    image.src = item.url;
    image.alt = item.name;
    image.loading = index === 0 ? "eager" : "lazy";
    image.decoding = "async";
    image.title = "클릭하여 확대";
    const enlarge = () => openViewer(item.url, item.name);
    image.addEventListener("click", enlarge);
    const error = document.createElement("p");
    error.className = "muted schedule-images-item__error";
    error.hidden = true;
    error.textContent = "이미지를 불러올 수 없습니다.";
    image.addEventListener("error", () => { image.hidden = true; error.hidden = false; });
    figure.append(image, error);
    details.append(summary, figure);
    main.appendChild(details);
  });
}

function bindViewer() {
  const viewer = byId("scheduleImageViewer");
  viewer?.addEventListener("click", (event) => {
    if (event.target === viewer || event.target.classList.contains("schedule-image-viewer__stage")) closeViewer();
  });
}

function bindDivisionNav() {
  byId("scheduleDivisionNav")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-schedule-division]");
    if (!button) return;
    selectedDivision = button.dataset.scheduleDivision || "all";
    renderDivisionNav();
    renderSelectedImages();
  });
}

async function init() {
  bindViewer();
  bindDivisionNav();
  try {
    const { exists, data } = await getPublicSettingDoc("timetableCatalog");
    const stored = exists && data ? data : {};
    const groups = getScheduleGroups(stored);
    scheduleDivisions = getScheduleDivisions(stored);
    const groupId = resolveScheduleGroupQuery(stored, queryGroup());
    renderGroupNav(groups, groupId);
    const visibleDivisionKeys = new Set(scheduleDivisions.filter((item) => item.active !== false).map((item) => item.key));
    scheduleImages = getExactGroupScheduleImages(stored, groupId).filter((item) => visibleDivisionKeys.has(item.division));
    renderDivisionNav();
    renderSelectedImages();
  } catch (error) {
    console.error("[schedule] image load failed:", error);
    showEmpty("시간표 이미지를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
