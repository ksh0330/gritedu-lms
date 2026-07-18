import { db } from "/assets/js/firebase-init.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export const DEFAULT_DDAY_SETTINGS = Object.freeze({
  enabled: false,
  title: "2027학년도 수능",
  targetDate: "",
  placements: {
    home: true,
    dashboard: true
  }
});

let stylesInjected = false;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseDateParts(dateString) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateString || ""));
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;

  return { year, month, day };
}

function getKstDayNumber(date = new Date()) {
  return Math.floor((date.getTime() + KST_OFFSET_MS) / MS_PER_DAY);
}

function getTargetDayNumber(dateString) {
  const parts = parseDateParts(dateString);
  if (!parts) return null;

  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / MS_PER_DAY);
}

function formatTargetDate(dateString) {
  const parts = parseDateParts(dateString);
  if (!parts) return "";

  return `${parts.year}.${String(parts.month).padStart(2, "0")}.${String(parts.day).padStart(2, "0")}`;
}

function formatDdayDisplay(days) {
  if (days > 0) return `D-Day ${days}`;
  if (days === 0) return "D-Day";
  return `D+${Math.abs(days)}`;
}

function normalizePlacements(placements = {}) {
  return {
    home: placements.home !== false,
    dashboard: placements.dashboard !== false
  };
}

export function normalizeDdaySettings(data = {}) {
  return {
    ...DEFAULT_DDAY_SETTINGS,
    ...data,
    title: String(data.title || DEFAULT_DDAY_SETTINGS.title).trim(),
    targetDate: String(data.targetDate || "").trim(),
    placements: normalizePlacements(data.placements)
  };
}

export function calculateDday(targetDate, now = new Date()) {
  const targetDayNumber = getTargetDayNumber(targetDate);
  if (targetDayNumber === null) return null;

  const days = targetDayNumber - getKstDayNumber(now);
  let text = "D-Day";
  if (days > 0) text = `D-${days}`;
  if (days < 0) text = `D+${Math.abs(days)}`;

  return {
    days,
    text,
    displayText: formatDdayDisplay(days),
    targetDateText: formatTargetDate(targetDate)
  };
}

export async function loadDdaySettings() {
  const snapshot = await getDoc(doc(db, "pages", "dday"));
  if (!snapshot.exists()) return normalizeDdaySettings();

  return normalizeDdaySettings(snapshot.data());
}

function injectDdayStyles() {
  if (stylesInjected) return;
  stylesInjected = true;

  const style = document.createElement("style");
  style.textContent = `
    .grit-dday {
      width: 100%;
      margin-top: 10px;
    }
    .grit-dday-card {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
      color: var(--text, #111827);
      box-shadow: none;
    }
    .grit-dday-card--dashboard {
      width: auto;
      justify-content: flex-start;
      margin: 8px 0 0;
    }
    .grit-dday-meta {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .grit-dday-title {
      font-size: 15px;
      font-weight: 700;
      color: #fff;
    }
    .grit-dday-card--dashboard .grit-dday-title {
      color: var(--text, #111827);
    }
    .grit-dday-number {
      flex: 0 0 auto;
      font-size: clamp(18px, 3vw, 28px);
      line-height: 1;
      color: var(--brand, #2563eb);
      letter-spacing: -0.03em;
    }
    @media (max-width: 640px) {
      .grit-dday-card {
        width: auto;
        justify-content: flex-start;
      }
    }
  `;
  document.head.appendChild(style);
}

function shouldRender(settings, placement) {
  if (!settings.enabled || !settings.targetDate || !calculateDday(settings.targetDate)) return false;
  if (!placement) return true;

  const placements = normalizePlacements(settings.placements);
  if (placement === "dashboard" || placement === "student") return placements.dashboard;
  return placements[placement] !== false;
}

export function renderDday(element, settings, options = {}) {
  const dday = calculateDday(settings.targetDate);
  if (!element || !dday) return;

  injectDdayStyles();
  const variant = options.variant === "dashboard" ? "dashboard" : "home";
  const title = settings.title || DEFAULT_DDAY_SETTINGS.title;

  element.hidden = false;
  element.classList.add("grit-dday");
  element.innerHTML = `
    <div class="grit-dday-card grit-dday-card--${variant}" role="status" aria-label="${escapeHtml(`${title} ${dday.displayText}`)}">
      <span class="grit-dday-meta">
        <span class="grit-dday-title">${escapeHtml(title)}</span>
      </span>
      <strong class="grit-dday-number">${escapeHtml(dday.displayText)}</strong>
    </div>
  `;
}

export async function mountDday(target, options = {}) {
  const element = typeof target === "string" ? document.querySelector(target) : target;
  if (!element) return null;

  try {
    const settings = await loadDdaySettings();
    const placement = options.placement || options.variant;
    if (!shouldRender(settings, placement)) {
      element.hidden = true;
      element.innerHTML = "";
      return null;
    }

    renderDday(element, settings, options);
    return settings;
  } catch (error) {
    console.error("[dday] D-day 설정 로드 실패:", error);
    element.hidden = true;
    return null;
  }
}
