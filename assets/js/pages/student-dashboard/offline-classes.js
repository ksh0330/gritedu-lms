import { db } from "/assets/js/firebase-init.js";
import { collection, doc, getDoc, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { dom, state, escapeHtml } from "/assets/js/pages/student-dashboard/context.js";
import { setOfflineClassStatCount } from "/assets/js/pages/student-dashboard/stats.js";

const SCHEDULE_DAYS = [
  { id: "mon", label: "월" },
  { id: "tue", label: "화" },
  { id: "wed", label: "수" },
  { id: "thu", label: "목" },
  { id: "fri", label: "금" },
  { id: "sat", label: "토" },
  { id: "sun", label: "일" }
];
const DAY_ORDER = SCHEDULE_DAYS.map((d) => d.id);

function formatTimeDisplay(value) {
  const t = String(value || "").trim();
  if (!t) return "";
  return t.length >= 5 ? t.slice(0, 5) : t;
}

function normalizeScheduleItems(classRow) {
  if (Array.isArray(classRow?.scheduleItems) && classRow.scheduleItems.length) {
    return classRow.scheduleItems
      .map((item) => ({
        day: String(item?.day || "").trim(),
        startTime: formatTimeDisplay(item?.startTime),
        endTime: formatTimeDisplay(item?.endTime),
        room: String(item?.room || "").trim()
      }))
      .filter((item) => item.day);
  }
  const days = Array.isArray(classRow?.scheduleDays) ? classRow.scheduleDays : [];
  if (!days.length) return [];
  const start = formatTimeDisplay(classRow?.startTime);
  const end = formatTimeDisplay(classRow?.endTime);
  const room = String(classRow?.room || "").trim();
  return days.map((day) => ({ day, startTime: start, endTime: end, room }));
}

function formatScheduleLine(item) {
  const dayLabel = SCHEDULE_DAYS.find((d) => d.id === item.day)?.label || item.day;
  const timePart =
    item.startTime && item.endTime
      ? `${item.startTime}–${item.endTime}`
      : item.startTime || item.endTime || "";
  const parts = [dayLabel, timePart, item.room].filter(Boolean);
  return parts.join(" ");
}

function formatSchedule(classRow) {
  const items = normalizeScheduleItems(classRow)
    .slice()
    .sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day));
  if (!items.length) return "-";
  return items.map((item) => formatScheduleLine(item)).join(" / ");
}

function formatScheduleHtml(classRow) {
  const items = normalizeScheduleItems(classRow)
    .slice()
    .sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day));
  if (!items.length) return '<span class="muted">-</span>';
  return items.map((item) => escapeHtml(formatScheduleLine(item))).join("<br>");
}

function formatSchoolGrade(classRow) {
  const school = String(classRow?.school || "").trim();
  const grade = String(classRow?.grade || "").trim();
  if (school && grade) return `${school} / ${grade}`;
  return school || grade || "-";
}

function isScheduleVisible(classRow) {
  return classRow?.scheduleVisible !== false;
}

function setOfflineMeta(text) {
  if (!dom.myOfflineClassesMeta) return;
  dom.myOfflineClassesMeta.textContent = text;
}

function renderOfflineEmpty(message) {
  if (!dom.myOfflineClassesGrid) return;
  dom.myOfflineClassesGrid.innerHTML = `<p class="student-offline-empty">${escapeHtml(message)}</p>`;
}

function renderOfflineList(rows) {
  if (!dom.myOfflineClassesGrid) return;
  if (!rows.length) {
    renderOfflineEmpty("배정된 오프라인 반이 없습니다.");
    return;
  }

  const items = rows
    .map(({ classRow, linkClassId }) => {
      const safeLinkClassId = escapeHtml(linkClassId);
      const path = `/members/students/offline-class.html?classId=${encodeURIComponent(linkClassId)}`;
      const className = escapeHtml(classRow.className || "반명 없음");
      const subject = escapeHtml(classRow.subject || "-");
      const schoolGrade = escapeHtml(formatSchoolGrade(classRow));
      const instructor = escapeHtml(classRow.instructorName || "미배정");
      const scheduleHtml = formatScheduleHtml(classRow);
      const scheduleBlock = isScheduleVisible(classRow)
        ? `
        <div class="student-offline-list-row__schedule">
          <span class="student-offline-list-row__schedule-label">시간표<br> </span>
          <span class="student-offline-list-row__schedule-value">${scheduleHtml}</span>
        </div>`
        : "";
      return `
      <article class="student-offline-list-row" data-class-id="${safeLinkClassId}">
        <div class="student-offline-list-row__main">
          <h3 class="student-offline-list-row__title">${className}</h3>
          <p class="student-offline-list-row__meta">${subject} / ${schoolGrade}</p>
          <p class="student-offline-list-row__meta">담당: ${instructor}T</p>
        </div>
        ${scheduleBlock}
        <div class="student-offline-list-row__action">
          <a class="btn primary sm" href="${path}">반 보기</a>
        </div>
      </article>`;
    })
    .join("");

  dom.myOfflineClassesGrid.innerHTML = items;
}

export async function loadMyOfflineClasses() {
  if (!state.user?.uid || !dom.myOfflineClassesGrid) return;

  setOfflineMeta("오프라인 반을 불러오는 중입니다.");
  dom.myOfflineClassesGrid.innerHTML =
    '<p class="student-offline-empty">오프라인 반을 불러오는 중입니다.</p>';

  try {
    const membersSnap = await getDocs(
      query(collection(db, "offlineClassMembers"), where("studentUid", "==", state.user.uid))
    );

    const activeMemberships = membersSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((m) => m.status !== "removed");

    if (!activeMemberships.length) {
      setOfflineClassStatCount(0);
      renderOfflineEmpty("배정된 오프라인 반이 없습니다.");
      setOfflineMeta("");
      return;
    }

    const results = await Promise.all(
      activeMemberships.map(async (membership) => {
        const linkClassId = String(membership.classId || "").trim();
        if (!linkClassId) {
          console.warn("[student-dashboard] offline membership missing classId", {
            membershipDocId: membership.id
          });
          return null;
        }
        try {
          const classSnap = await getDoc(doc(db, "offlineClasses", linkClassId));
          if (!classSnap.exists()) {
            console.warn("[student-dashboard] missing offline class", {
              linkClassId,
              membershipDocId: membership.id
            });
            return null;
          }
          if (classSnap.id !== linkClassId) {
            console.warn("[student-dashboard] class doc id mismatch", {
              linkClassId,
              docId: classSnap.id,
              membershipDocId: membership.id
            });
          }
          return {
            membership,
            linkClassId,
            classRow: { id: classSnap.id, ...classSnap.data() }
          };
        } catch (err) {
          console.warn("[student-dashboard] offline class load failed", linkClassId, err);
          return null;
        }
      })
    );

    const rows = results
      .filter(Boolean)
      .filter(({ classRow }) => classRow.status !== "archived")
      .sort((a, b) =>
        String(a.classRow.className || "").localeCompare(
          String(b.classRow.className || ""),
          "ko"
        )
      );

    setOfflineClassStatCount(rows.length);
    renderOfflineList(rows);
    setOfflineMeta(rows.length ? `배정된 오프라인 반 ${rows.length}개` : "");
  } catch (error) {
    console.error("[student-dashboard] offline classes load failed", error);
    setOfflineClassStatCount(0);
    renderOfflineEmpty("오프라인 반을 불러오는 중 오류가 발생했습니다.");
    setOfflineMeta("오프라인 반을 불러오지 못했습니다.");
  }
}
