// 오프라인 회차 영상 URL 분리 저장 도우미.
// 회차 목록(offlineClassSessions)은 Rules 가 문서별 입반일·수동 해제를 강제할 수 없으므로,
// 영상 URL은 단건 조회만 허용되는 offlineSessionPrivate/{sessionId} 에 둔다(coursePrivateContent 와 같은 방식).
// 이전 전(legacy) 문서는 회차 문서의 videos/videoUrl 을 그대로 읽는다.

export const OFFLINE_SESSION_PRIVATE_COLLECTION = "offlineSessionPrivate";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function toMillis(value) {
  if (value == null) return null;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value?.seconds === "number") return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
  return null;
}

/**
 * 입반 시각(Timestamp)을 학원 기준(KST) 날짜 문자열로 바꾼다. Rules 의 kstDateString 과 같은 계산이어야
 * 학생 회차 목록 쿼리의 sessionDate 하한이 Rules 에서 증명된다. 값이 없으면 null(목록 조회 안 함).
 */
export function kstJoinDateKey(joinedAt) {
  const ms = toMillis(joinedAt);
  if (ms == null || !Number.isFinite(ms)) return null;
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
}

export function hasInlineSessionVideos(session) {
  if (String(session?.videoUrl || "").trim()) return true;
  const videos = session?.videos;
  if (Array.isArray(videos)) return videos.length > 0;
  return Boolean(videos && typeof videos === "object" && Object.keys(videos).length);
}

/** 영상이 있다고 표시됐는데 회차 문서에 URL이 없으면 분리 문서에서 읽어야 한다. */
export function sessionNeedsPrivateVideos(session) {
  return session?.hasVideo === true && !hasInlineSessionVideos(session);
}

/** 회차 문서에 저장할 공개 메타 필드. 영상 URL은 넣지 않는다. */
export function buildSessionVideoMeta(videos, hasVideo) {
  return { hasVideo: hasVideo === true, videoCount: hasVideo === true ? videos.length : 0 };
}

/** 분리 문서 내용. 영상이 없으면 null(문서를 지운다). */
export function buildSessionPrivatePayload({ classId, videos, hasVideo }) {
  if (hasVideo !== true || !videos.length) return null;
  return { classId, videos, videoUrl: videos[0].url };
}

/**
 * 펼친 회차의 영상만 필요할 때 한 번 읽어 페이지 메모리에 보관한다. 목록을 그릴 때 N건을 읽지 않는다.
 * load(sessionId): 분리 문서 data 또는 null, parse(data): 영상 배열, onChange(): 다시 그리기.
 */
export function createSessionVideoStore({ load, parse, onChange = null }) {
  const states = new Map();

  function view(session, inlineVideos = []) {
    if (!sessionNeedsPrivateVideos(session)) {
      return { loading: false, failed: false, videos: inlineVideos, count: inlineVideos.length };
    }
    const state = states.get(session.id);
    if (state?.status === "ready") return { loading: false, failed: false, videos: state.videos, count: state.videos.length };
    const count = Number(session.videoCount) || 0;
    return { loading: state?.status !== "failed", failed: state?.status === "failed", videos: [], count };
  }

  async function ensure(session) {
    if (!sessionNeedsPrivateVideos(session) || states.has(session.id)) return;
    states.set(session.id, { status: "loading" });
    try {
      const data = await load(session.id);
      states.set(session.id, { status: "ready", videos: data ? parse(data) : [] });
    } catch (error) {
      console.warn("[offline-session-videos] video load failed:", error?.code || error);
      states.set(session.id, { status: "failed" });
    }
    onChange?.();
  }

  return { view, ensure };
}
