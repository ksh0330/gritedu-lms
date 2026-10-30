import { db } from "/assets/js/firebase-init.js";
import { collection, doc, getDoc, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { dom, state, escapeHtml } from "/assets/js/pages/student-dashboard/context.js";
import { setOfflineClassStatCount } from "/assets/js/pages/student-dashboard/stats.js";
import { getSubjectColorStyle } from "/assets/js/utils/subject-colors.js";

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

function normalizeScheduleItems(classRow, fieldName = "scheduleItems") {
  if (Array.isArray(classRow?.[fieldName]) && classRow[fieldName].length) {
    return classRow[fieldName]
      .map((item) => ({
        day: String(item?.day || "").trim(),
        startTime: formatTimeDisplay(item?.startTime),
        endTime: formatTimeDisplay(item?.endTime),
        room: String(item?.room || "").trim()
      }))
      .filter((item) => item.day);
  }
  if (fieldName !== "scheduleItems") return [];
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

function formatScheduleHtml(classRow, fieldName = "scheduleItems") {
  const items = normalizeScheduleItems(classRow, fieldName)
    .slice()
    .sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day));
  if (!items.length) return '<span class="muted">-</span>';
  return items.map((item) => escapeHtml(formatScheduleLine(item))).join("<br>");
}

function formatSchoolGrade(classRow) {
  const school = (Array.isArray(classRow?.schools) && classRow.schools.length
    ? classRow.schools
    : [classRow?.school])
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(", ");
  const grade = String(classRow?.grade || "").trim();
  if (school && grade) return `${school} / ${grade}`;
  return school || grade || "-";
}

function formatInstructorNames(classRow) {
  const names = Array.isArray(classRow?.instructorNames) ? classRow.instructorNames : [];
  return names.map((value) => String(value || "").trim()).filter(Boolean).join(", ") ||
    String(classRow?.instructorName || "").trim() ||
    "미배정";
}

function isScheduleVisible(classRow) {
  return classRow?.scheduleVisible !== false;
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
      const subjectValue = classRow.subject || "-";
      const subject = escapeHtml(subjectValue);
      const subjectColorStyle = getSubjectColorStyle(subjectValue, state.subjectColorMap);
      const schoolGrade = escapeHtml(formatSchoolGrade(classRow));
      const instructor = escapeHtml(formatInstructorNames(classRow));
      const scheduleHtml = formatScheduleHtml(classRow);
      const clinicScheduleHtml = formatScheduleHtml(classRow, "clinicScheduleItems");
      const scheduleBlock = isScheduleVisible(classRow)
        ? `
        <div class="student-offline-list-row__schedule">
          <div class="student-offline-list-row__schedule-item">
            <span class="student-offline-list-row__schedule-label">수업 일정</span>
            <span class="student-offline-list-row__schedule-value">${scheduleHtml}</span>
          </div>
          <div class="student-offline-list-row__schedule-item">
            <span class="student-offline-list-row__schedule-label">클리닉</span>
            <span class="student-offline-list-row__schedule-value">${clinicScheduleHtml}</span>
          </div>
        </div>`
        : "";
      return `
      <article class="student-offline-list-row${subjectColorStyle ? " has-subject-color" : ""}" data-class-id="${safeLinkClassId}"${subjectColorStyle ? ` style="${subjectColorStyle}"` : ""}>
        <div class="student-offline-list-row__main">
          <div class="student-dashboard-card-badges">
            <span class="student-dashboard-card-badge${subjectColorStyle ? " has-subject-color" : ""}"${subjectColorStyle ? ` style="${subjectColorStyle}"` : ""}>${subject}</span>
            <span class="student-dashboard-card-badge student-dashboard-card-badge--wide">${schoolGrade}</span>
          </div>
          <h3 class="student-offline-list-row__title">${className}</h3>
          <p class="student-offline-list-row__meta">${instructor}T</p>
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
  } catch (error) {
    console.error("[student-dashboard] offline classes load failed", error);
    setOfflineClassStatCount(0);
    renderOfflineEmpty("오프라인 반을 불러오는 중 오류가 발생했습니다.");
  }
}
