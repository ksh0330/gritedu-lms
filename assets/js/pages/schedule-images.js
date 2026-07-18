// /assets/js/pages/schedule-images.js — public schedule image viewer

import { getPublicSettingDoc } from "/assets/js/utils/settings-cache.js";
import {
  getExactGroupScheduleImages,
  getScheduleGroups,
  resolveScheduleGroupLabel,
  resolveScheduleGroupQuery,
} from "/assets/js/utils/timetable-catalog.js";

function readGroupFromQuery() {
  const params = new URLSearchParams(location.search);
  return params.get("group") || "";
}

function updatePageGroupLabel(groupId, scheduleGroups) {
  const label = resolveScheduleGroupLabel(groupId, scheduleGroups);
  const title = document.querySelector(".schedule-images-page-header .page-title");
  const desc = document.querySelector(".schedule-images-page-desc");
  if (title) title.textContent = `${label} 시간표 이미지`;
  if (desc) {
    desc.textContent = `${label} 그룹에 등록된 시간표 이미지를 확인할 수 있습니다.`;
  }
  document.title = `${label} 시간표 이미지 | 그릿에듀학원`;
}

function showEmpty(message) {
  const empty = document.getElementById("scheduleImagesEmpty");
  const nav = document.getElementById("scheduleImagesNav");
  const main = document.getElementById("scheduleImagesMain");
  if (nav) nav.hidden = true;
  if (main) {
    Array.from(main.querySelectorAll(".schedule-images-item")).forEach((node) => node.remove());
  }
  if (empty) {
    empty.hidden = false;
    empty.textContent = message;
  }
}

function createImageSection(item, index) {
  const sectionId = `schedule-image-${index + 1}`;
  const section = document.createElement("section");
  section.id = sectionId;
  section.className = "schedule-images-item";

  const title = document.createElement("h2");
  title.className = "schedule-images-item__title";
  title.textContent = item.name;

  const figure = document.createElement("figure");
  figure.className = "schedule-images-item__figure";

  const img = document.createElement("img");
  img.className = "schedule-images-item__image";
  img.src = item.url;
  img.alt = item.name;
  img.loading = index === 0 ? "eager" : "lazy";
  img.decoding = "async";

  const error = document.createElement("p");
  error.className = "muted schedule-images-item__error";
  error.hidden = true;
  error.textContent = "이미지를 불러올 수 없습니다.";

  img.addEventListener("error", () => {
    img.hidden = true;
    error.hidden = false;
  });

  figure.appendChild(img);
  figure.appendChild(error);
  section.appendChild(title);
  section.appendChild(figure);
  return { section, sectionId, label: item.name };
}

function renderScheduleImages(images) {
  const nav = document.getElementById("scheduleImagesNav");
  const main = document.getElementById("scheduleImagesMain");
  const empty = document.getElementById("scheduleImagesEmpty");
  if (!main || !nav) return;

  main.querySelectorAll(".schedule-images-item").forEach((node) => node.remove());
  nav.innerHTML = "";
  if (empty) empty.hidden = true;

  if (!images.length) {
    showEmpty("등록된 시간표 이미지가 없습니다.");
    return;
  }

  nav.hidden = false;
  const navList = document.createElement("div");
  navList.className = "schedule-images-nav__list";

  images.forEach((item, index) => {
    const { section, sectionId, label } = createImageSection(item, index);
    main.appendChild(section);

    const link = document.createElement("a");
    link.href = `#${sectionId}`;
    link.className = "schedule-images-nav__link";
    link.textContent = label;
    navList.appendChild(link);
  });

  nav.appendChild(navList);
}

async function loadScheduleImages() {
  const queryGroup = readGroupFromQuery();
  try {
    const { exists, data } = await getPublicSettingDoc("timetableCatalog");
    const stored = exists && data ? data : {};
    const scheduleGroups = getScheduleGroups(stored);
    const groupId = resolveScheduleGroupQuery(stored, queryGroup);
    updatePageGroupLabel(groupId, scheduleGroups);
    const images = getExactGroupScheduleImages(stored, groupId);
    renderScheduleImages(images);
  } catch (error) {
    console.error("[schedule-images] load failed:", error);
    showEmpty("시간표 이미지를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
  }
}

function init() {
  loadScheduleImages().catch((error) => {
    console.error("[schedule-images] init failed:", error);
    showEmpty("시간표 이미지를 불러오지 못했습니다.");
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
