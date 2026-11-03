export function summarizeCourseCompletion(videoIds, watchedVideos) {
  const ids = [...new Set(videoIds)];
  const watched = new Set(watchedVideos);
  const completed = ids.filter((id) => watched.has(id)).length;
  // 100%(완료)는 현재 강좌의 영상을 모두 봤을 때만. 반올림으로 199/200 이 100%가 되지 않게 99%로 둔다.
  const rounded = ids.length ? Math.round((completed / ids.length) * 100) : 0;
  return {
    completed,
    total: ids.length,
    progress: completed < ids.length ? Math.min(rounded, 99) : rounded
  };
}

// Keep the IDs used by existing enrollment.watchedVideos records.
export function resolveCourseVideoId(courseId, weekId, video, videoIndex) {
  const stableId = typeof video === "object" && video !== null
    ? String(video.completionId || "").trim()
    : "";
  return stableId || `${courseId}_week_${weekId}_video_${videoIndex}`;
}

export function collectCourseVideoIds(courseId, weeks) {
  const ids = [];
  (Array.isArray(weeks) ? weeks : []).forEach((week, weekIndex) => {
    const weekId = week?.id || `week_${weekIndex}`;
    const getUrl = (video) => typeof video === "string"
      ? video
      : video?.url || video?.fullUrl || video?.videoUrl || "";
    const videos = Array.isArray(week?.videos) && week.videos.length
      ? week.videos.filter((video) => getUrl(video))
      : Array.isArray(week?.lessons) && week.lessons.length
        ? week.lessons.filter((video) => getUrl(video))
        : Array.isArray(week?.video || week?.videoUrl)
          ? (week.video || week.videoUrl)
          : (week?.video || week?.videoUrl) ? [week.video || week.videoUrl] : [];
    videos.forEach((video, videoIndex) => {
      if (getUrl(video)) ids.push(resolveCourseVideoId(courseId, weekId, video, videoIndex));
    });
  });
  return ids;
}

/**
 * 승인형 강좌는 보호 문서를 읽을 수 없는 학부모 화면에서 공개 문서의 completionVideoIds(URL 없음)로 계산한다.
 * 목록이 아직 없으면(보정 전) null 을 돌려 '확인 불가'로 둔다.
 */
export function getCompletionFromVideoIds(completionVideoIds, watchedVideos) {
  if (!Array.isArray(completionVideoIds)) return null;
  const ids = completionVideoIds.map((id) => String(id || "").trim()).filter(Boolean);
  return summarizeCourseCompletion(ids, Array.isArray(watchedVideos) ? watchedVideos : []);
}

export function getCurrentCourseCompletion(courseId, weeks, watchedVideos) {
  return summarizeCourseCompletion(
    collectCourseVideoIds(courseId, weeks),
    Array.isArray(watchedVideos) ? watchedVideos : []
  );
}

export function addCompletedVideo(videoIds, watchedVideos, videoId) {
  const current = Array.isArray(watchedVideos) ? watchedVideos : [];
  if (!videoIds.includes(videoId)) return null;
  const merged = current.includes(videoId) ? current : [...current, videoId];
  return {
    watchedVideos: merged,
    ...summarizeCourseCompletion(videoIds, merged)
  };
}

export async function completeVideoInTransaction(run, enrollmentRef, videoIds, videoId, timestamp) {
  if (!videoIds.includes(videoId)) throw new Error("완료할 영상을 확인할 수 없습니다.");
  return run(async (transaction) => {
    const snapshot = await transaction.get(enrollmentRef);
    if (!snapshot.exists()) throw new Error("수강 기록을 찾을 수 없습니다.");
    const saved = snapshot.data();
    const next = addCompletedVideo(videoIds, saved.watchedVideos, videoId);
    if (!Array.isArray(saved.watchedVideos) || !saved.watchedVideos.includes(videoId)) {
      transaction.update(enrollmentRef, {
        watchedVideos: next.watchedVideos,
        progress: next.progress,
        updatedAt: timestamp()
      });
    }
    return next;
  });
}
