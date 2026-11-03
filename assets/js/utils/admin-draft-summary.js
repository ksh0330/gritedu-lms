// 선택 항목 관리의 '저장본 ↔ 현재 초안' 차이 요약. 최근 변경 한 건이 아니라 두 목록을 비교한 결과이므로
// 원래 상태로 되돌린 변경은 자동으로 빠진다. DB·listener·저장소를 쓰지 않고 페이지 메모리 값만 다룬다.

import { escapeHtml } from "/assets/js/utils/html.js";

const CATEGORY_LABELS = [
  ["added", "추가"],
  ["renamed", "이름"],
  ["recolored", "색상"],
  ["state", "노출"],
  ["moved", "순서"],
  ["removed", "제거"],
];

const emptyDiff = () => ({ added: [], renamed: [], recolored: [], state: [], moved: [], removed: [] });

/** keys 를 유지한 채 움직이지 않아도 되는 항목(최장 증가 부분 수열)을 뺀 나머지가 실제로 옮겨진 항목이다. */
function findMovedKeys(savedKeys, currentKeys) {
  const savedIndex = new Map(savedKeys.map((key, index) => [key, index]));
  const sequence = currentKeys.filter((key) => savedIndex.has(key));
  const lengths = sequence.map(() => 1);
  const previous = sequence.map(() => -1);
  let best = -1;
  sequence.forEach((key, i) => {
    for (let j = 0; j < i; j += 1) {
      if (savedIndex.get(sequence[j]) < savedIndex.get(key) && lengths[j] + 1 > lengths[i]) {
        lengths[i] = lengths[j] + 1;
        previous[i] = j;
      }
    }
    if (best < 0 || lengths[i] > lengths[best]) best = i;
  });
  const stable = new Set();
  for (let i = best; i >= 0; i = previous[i]) stable.add(sequence[i]);
  return sequence.filter((key) => !stable.has(key));
}

/**
 * 고유 키가 있는 목록(강좌 과목·시간표 그룹·학교급·이미지)의 차이.
 * colorOf/stateOf 는 선택이며, 양쪽 값이 모두 있을 때만 비교한다(색상이 아직 없는 새 값을 변경으로 세지 않는다).
 */
export function diffOrderedList({ saved = [], current = [], keyOf, labelOf, colorOf = null, stateOf = null }) {
  const diff = emptyDiff();
  const savedByKey = new Map(saved.map((item) => [keyOf(item), item]));
  const currentByKey = new Map(current.map((item) => [keyOf(item), item]));
  current.forEach((item) => {
    const key = keyOf(item);
    const before = savedByKey.get(key);
    const label = labelOf(item);
    if (!before) {
      diff.added.push(label);
      return;
    }
    const beforeLabel = labelOf(before);
    if (beforeLabel !== label) diff.renamed.push({ from: beforeLabel, to: label });
    if (colorOf) {
      const beforeColor = colorOf(before);
      const color = colorOf(item);
      if (beforeColor && color && beforeColor !== color) diff.recolored.push(label);
    }
    if (stateOf && stateOf(before) !== stateOf(item)) diff.state.push({ label, to: stateOf(item) });
  });
  saved.forEach((item) => {
    if (!currentByKey.has(keyOf(item))) diff.removed.push(labelOf(item));
  });
  const moved = findMovedKeys(saved.map(keyOf), current.map(keyOf));
  diff.moved = moved.map((key) => labelOf(currentByKey.get(key)));
  return diff;
}

/**
 * 값 자체가 식별자인 문자열 목록(학년·연도·학교·강사 과목)의 차이.
 * 이름을 고치면 값이 바뀌므로 같은 자리에서 사라지고 생긴 값, 또는 한 건씩 남은 값은 이름 변경으로 본다.
 */
export function diffStringList({ saved = [], current = [], colorOf = null }) {
  const savedSet = new Set(saved);
  const currentSet = new Set(current);
  const removed = saved.filter((value) => !currentSet.has(value));
  const added = current.filter((value) => !savedSet.has(value));
  const pairs = [];
  removed.slice().forEach((value) => {
    const replacement = current[saved.indexOf(value)];
    if (replacement !== undefined && added.includes(replacement)) {
      pairs.push({ from: value, to: replacement });
      removed.splice(removed.indexOf(value), 1);
      added.splice(added.indexOf(replacement), 1);
    }
  });
  if (removed.length === 1 && added.length === 1) {
    pairs.push({ from: removed.pop(), to: added.pop() });
  }
  const diff = emptyDiff();
  diff.added = added;
  diff.removed = removed;
  diff.renamed = pairs;
  if (colorOf) {
    diff.recolored = pairs.filter(({ from, to }) => colorOf(from) && colorOf(to, true) && colorOf(from) !== colorOf(to, true)).map(({ to }) => to);
    current.forEach((value) => {
      if (savedSet.has(value) && colorOf(value) && colorOf(value, true) && colorOf(value) !== colorOf(value, true)) diff.recolored.push(value);
    });
  }
  // 이름이 바뀐 값은 저장본 자리의 이름으로 바꿔 비교해야 순서 변경으로 잘못 세지 않는다.
  const renamedTo = new Map(pairs.map(({ from, to }) => [to, from]));
  const comparable = current.map((value) => renamedTo.get(value) || value);
  diff.moved = findMovedKeys(saved, comparable).map((value) => pairs.find(({ from }) => from === value)?.to || value);
  return diff;
}

const diffSize = (diff) => CATEGORY_LABELS.reduce((sum, [key]) => sum + diff[key].length, 0);

/** sections: [{ title, diff }]. 변경이 없는 구역은 뺀다. */
export function summarizeDraftSections(sections = []) {
  const kept = sections.filter((section) => diffSize(section.diff) > 0);
  const counts = {};
  CATEGORY_LABELS.forEach(([key]) => {
    counts[key] = kept.reduce((sum, section) => sum + section.diff[key].length, 0);
  });
  return { total: kept.reduce((sum, section) => sum + diffSize(section.diff), 0), counts, sections: kept };
}

function detailLines(diff) {
  const lines = [];
  if (diff.added.length) lines.push(`추가: ${diff.added.join(", ")}`);
  if (diff.renamed.length) lines.push(`이름: ${diff.renamed.map(({ from, to }) => `${from} → ${to}`).join(", ")}`);
  if (diff.recolored.length) lines.push(`색상: ${diff.recolored.join(", ")}`);
  if (diff.state.length) lines.push(`노출: ${diff.state.map(({ label, to }) => `${label} → ${to}`).join(", ")}`);
  if (diff.moved.length) lines.push(`순서: ${diff.moved.join(", ")}`);
  if (diff.removed.length) lines.push(`목록에서 제거: ${diff.removed.join(", ")}`);
  return lines;
}

/** 요약 한 줄. 예: '변경 3건'. 종류별 내용은 '변경 내용 보기'에 펼쳐 보여준다. */
export function describeDraftSummary(summary) {
  return `변경 ${summary.total}건`;
}

export function buildDraftSummaryHtml(summary) {
  const sections = summary.sections.map((section) => `
    <div class="admin-draft-summary__section">
      <p class="admin-draft-summary__title">${escapeHtml(section.title)}</p>
      <ul class="admin-draft-summary__list">${detailLines(section.diff).map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>
    </div>`).join("");
  return `
    <p class="admin-draft-summary__line">${escapeHtml(describeDraftSummary(summary))}</p>
    <details class="admin-draft-summary__details">
      <summary>변경 내용 보기</summary>
      ${sections}
    </details>`;
}

/**
 * 요약 영역·배지·'변경 취소' 버튼을 함께 갱신한다. 변경이 없으면 요약을 숨기고 취소 버튼을 끈다.
 * badges: [{ el, text }]
 */
export function renderDraftSummary({ host = null, badges = [], resetButton = null, summary }) {
  const dirty = summary.total > 0;
  if (host) {
    const wasOpen = Boolean(host.querySelector?.(".admin-draft-summary__details")?.open);
    host.hidden = !dirty;
    host.innerHTML = dirty ? buildDraftSummaryHtml(summary) : "";
    const details = wasOpen && dirty ? host.querySelector?.(".admin-draft-summary__details") : null;
    if (details) details.open = true;
  }
  badges.forEach(({ el, text }) => {
    if (!el) return;
    el.dataset.draftState = dirty ? "dirty" : "clean";
    el.textContent = dirty ? text : "";
    el.hidden = !dirty;
  });
  if (resetButton) resetButton.disabled = !dirty;
  return dirty;
}
