// 대시보드 목록을 (다시) 불러오는 동안 HTML 기본 skeleton과 같은 모양을 그린다.
// 크기는 assets/css/components/dashboard-skeleton.css 의 실측값을 따른다.
// 글자 안내('불러오는 중') 문단으로 바꾸면 높이가 달라져 화면이 두 번 움직이므로 쓰지 않는다.
const SKELETON_KINDS = new Set(["card", "offline-row", "child-card"]);

export function dashboardSkeletonHtml(kind, count, label) {
  const safeKind = SKELETON_KINDS.has(kind) ? kind : "card";
  const safeCount = Math.max(1, Math.min(6, Number(count) || 1));
  const item = `<div class="dashboard-skeleton dashboard-skeleton--${safeKind}" aria-hidden="true"></div>`;
  const text = String(label || "불러오는 중입니다.")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `${item.repeat(safeCount)}<span class="sr-only">${text}</span>`;
}
