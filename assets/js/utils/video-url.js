const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_PLAYLIST_PATTERN = /^[A-Za-z0-9_-]{12,128}$/;

export function extractYouTubeId(value) {
  const raw = String(value || "").trim();
  if (YOUTUBE_ID_PATTERN.test(raw)) return raw;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  if ((parsed.protocol !== "https:" && parsed.protocol !== "http:")
      || parsed.username || parsed.password || parsed.port) return null;
  const host = parsed.hostname.toLowerCase();
  let id = null;
  if (host === "youtu.be") {
    id = parsed.pathname.match(/^\/([A-Za-z0-9_-]{11})\/?$/)?.[1];
  } else if (host === "youtube.com" || host === "www.youtube.com" || host === "m.youtube.com") {
    if (parsed.pathname === "/watch") {
      id = parsed.searchParams.get("v");
    } else {
      id = parsed.pathname.match(/^\/(?:embed|live)\/([A-Za-z0-9_-]{11})\/?$/)?.[1];
    }
  }
  return id && YOUTUBE_ID_PATTERN.test(id) ? id : null;
}

export function normalizeVideoUrl(value) {
  const youtubeId = extractYouTubeId(value);
  if (youtubeId) {
    return {
      type: "youtube",
      id: youtubeId,
      embedUrl: `https://www.youtube.com/embed/${youtubeId}`,
      watchUrl: `https://www.youtube.com/watch?v=${youtubeId}`
    };
  }

  try {
    const parsed = new URL(String(value || "").trim());
    const host = parsed.hostname.toLowerCase();
    if ((parsed.protocol === "https:" || parsed.protocol === "http:")
        && !parsed.username && !parsed.password && !parsed.port
        && ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(host)
        && parsed.pathname === "/playlist") {
      const list = parsed.searchParams.get("list") || "";
      if (!YOUTUBE_PLAYLIST_PATTERN.test(list)) return null;
      return {
        type: "youtubePlaylist",
        id: list,
        embedUrl: `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(list)}`,
        watchUrl: `https://www.youtube.com/playlist?list=${encodeURIComponent(list)}`
      };
    }
  } catch {
    // Invalid or missing URL.
  }

  // Preserve direct MP4 playback while excluding script URLs and malformed sources.
  try {
    const parsed = new URL(String(value || "").trim());
    if ((parsed.protocol === "https:" || parsed.protocol === "http:")
        && !parsed.username && !parsed.password && /\.mp4$/i.test(parsed.pathname)) {
      return { type: "mp4", url: parsed.href };
    }
  } catch {
    // Invalid or missing URL.
  }
  return null;
}
