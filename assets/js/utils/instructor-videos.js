// 강사 소개 영상 전용: 관리자 저장·재편집·미리보기와 공개 페이지가 같은 순서/중복 규칙을 사용한다.
const ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

function rawVideoValue(value) {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  return String(value.url || value.fullUrl || value.embedUrl || value.youtubeId || value.videoId || value.id || "").trim();
}

function normalizeVideo(value) {
  let raw = rawVideoValue(value);
  if (!raw) return null;
  if (ID_PATTERN.test(raw)) return youtubeVideo(raw);
  if (raw.startsWith("//")) raw = `https:${raw}`;
  else if (/^(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(raw)) raw = `https://${raw}`;
  let parsed;
  try { parsed = new URL(raw, globalThis.location?.origin || "https://gritedu.kr"); }
  catch { return null; }
  if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  let id = "";
  if (host === "youtu.be") id = parsed.pathname.split("/").filter(Boolean)[0] || "";
  else if (["youtube.com", "m.youtube.com"].includes(host)) {
    const parts = parsed.pathname.split("/").filter(Boolean);
    id = parsed.searchParams.get("v") || (["embed", "shorts", "live"].includes(parts[0]) ? parts[1] : "") || "";
  }
  if (id && ID_PATTERN.test(id)) return youtubeVideo(id);
  // 잘못된 YouTube 링크를 미디어 파일로 오인하지 않는다.
  if (["youtube.com", "m.youtube.com", "youtu.be"].includes(host)) return null;
  // 기존 직접 미디어 URL과 상대 파일 경로는 보존한다.
  if (!/^https?:\/\//i.test(raw) && !/^(\/|\.\/|\.\.\/)/.test(raw) && !/\.(mp4|webm|ogg|mov)([?#]|$)/i.test(raw)) return null;
  return { type: "media", url: /^[a-z][a-z0-9+.-]*:/i.test(raw) ? parsed.href : raw };
}

function youtubeVideo(id) {
  return { type: "youtube", id, url: `https://www.youtube.com/watch?v=${id}` };
}

export function collectInstructorVideos(instructor = {}) {
  const result = [];
  const seen = new Set();
  const add = (value) => {
    if (Array.isArray(value)) { value.forEach(add); return; }
    const raw = rawVideoValue(value);
    // 레거시 단일 필드에 여러 줄이 있어도 같은 방식으로 복원한다.
    for (const line of raw.split(/\r?\n/)) {
      const video = normalizeVideo(line);
      if (!video) continue;
      const key = video.type === "youtube" ? `youtube:${video.id}` : `media:${video.url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(video);
    }
  };
  add(instructor.videos);
  add(instructor.youtube_url);
  add(instructor.video);
  return result;
}

export function parseInstructorVideoLines(text) {
  const lines = String(text || "").split(/\r?\n/);
  const invalidLines = [];
  lines.forEach((line, index) => {
    if (line.trim() && !normalizeVideo(line)) invalidLines.push(index + 1);
  });
  const videos = collectInstructorVideos({ videos: lines }).map((video) => ({
    url: video.url,
    fullUrl: video.type === "youtube" ? `https://www.youtube.com/embed/${video.id}` : video.url,
    id: video.type === "youtube" ? video.id : "",
    title: video.type === "youtube" ? `YouTube Video ${video.id}` : "Video",
  }));
  return { videos, invalidLines };
}
