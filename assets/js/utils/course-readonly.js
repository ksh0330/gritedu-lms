// /assets/js/utils/course-readonly.js
// Shared canonical normalization helpers for `courses`.

import { mergeCourseCatalog, buildLabelMaps } from "/assets/js/utils/course-catalog.js";

const FALLBACK_GRADE = { G1: "중1", G2: "중2", G3: "중3" };
const FALLBACK_SUBJECT = {
  KOR: "국어",
  MATH: "수학",
  ENG: "영어",
  SCI: "과학",
  ESSAY: "수리논술",
  ETC: "일반"
};

/** catalog·fallback에 없는 내부 과목 code의 공개 표시명 */
export const UNKNOWN_INTERNAL_SUBJECT_PUBLIC_LABEL = "기타";

const INTERNAL_SUBJECT_CODE_RE = /^[A-Z][A-Z0-9_]*$/;

export function isInternalSubjectCode(value) {
  const code = asText(value);
  return Boolean(code && INTERNAL_SUBJECT_CODE_RE.test(code));
}

const ACCESS_LABEL = {
  public: "공개",
  memberOnly: "회원전용",
  member: "회원전용",
  paid: "유료"
};

const VISIBILITY_LABEL = {
  public: "공개",
  unlisted: "일부 공개",
  private: "비공개",
  hidden: "비공개"
};

const STATUS_LABEL = {
  published: "게시",
  draft: "임시저장",
  archived: "보관"
};

const COURSE_FORMAT_LABEL = {
  single: "특강 / 단일 영상",
  series: "시리즈 / 주차별 영상",
  weekly: "시리즈 / 주차별 영상"
};

const COURSE_FORMAT_BADGE_LABEL = {
  single: "특강",
  series: "시리즈",
  weekly: "시리즈"
};

const ACCESS_TYPE_BADGE_LABEL = {
  public: "공개 강좌",
  memberOnly: "회원전용 강좌",
  member: "회원전용 강좌",
  paid: "유료"
};

export const COURSE_DETAIL_SECTION_PRESETS = [
  { type: "introduction", label: "강좌 소개", defaultTitle: "강좌 소개", defaultOrder: 10, defaultVisible: true },
  { type: "instructor", label: "강사 정보", defaultTitle: "강사 정보", defaultOrder: 20, defaultVisible: true },
  { type: "learningContent", label: "학습 내용", defaultTitle: "학습 내용", defaultOrder: 30, defaultVisible: true },
  { type: "materials", label: "교재/자료", defaultTitle: "교재/자료", defaultOrder: 40, defaultVisible: true },
  { type: "learningObjectives", label: "학습 목표", defaultTitle: "학습 목표", defaultOrder: 50, defaultVisible: true },
  { type: "targetAudience", label: "수강 대상", defaultTitle: "수강 대상", defaultOrder: 60, defaultVisible: true },
  { type: "curriculum", label: "커리큘럼", defaultTitle: "커리큘럼", defaultOrder: 70, defaultVisible: true },
  { type: "preview", label: "미리보기", defaultTitle: "미리보기", defaultOrder: 80, defaultVisible: true },
  { type: "custom", label: "사용자 정의", defaultTitle: "추가 정보", defaultOrder: 200, defaultVisible: true }
];

const COURSE_DETAIL_SECTION_PRESET_MAP = COURSE_DETAIL_SECTION_PRESETS.reduce((acc, preset) => {
  acc[preset.type] = preset;
  return acc;
}, {});

const DEFAULT_DETAIL_SECTION_TYPES = ["introduction", "instructor", "learningContent", "materials"];

function asText(value) {
  if (value == null) return "";
  return String(value).trim();
}

function toNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function getFirstParagraph(value) {
  const text = asText(value);
  if (!text) return "";
  return text.split(/\n{2,}/).map((chunk) => chunk.trim()).find(Boolean) || "";
}

function deriveShortDescription(explicitShortDescription, fullDescription) {
  const explicit = asText(explicitShortDescription);
  if (explicit) return explicit;

  const firstParagraph = getFirstParagraph(fullDescription);
  if (!firstParagraph) return "";
  if (firstParagraph.length <= 180) return firstParagraph;
  return `${firstParagraph.slice(0, 177)}...`;
}

function normalizeTextList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => asText(item)).filter(Boolean);
  }
  const text = asText(value);
  if (!text) return [];
  return text
    .split(/\r?\n|,/) 
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeLesson(rawLesson, lessonIndex, weekContext = {}) {
  const isObject = rawLesson && typeof rawLesson === "object" && !Array.isArray(rawLesson);
  const url = isObject
    ? asText(rawLesson.url) || asText(rawLesson.fullUrl) || asText(rawLesson.videoUrl)
    : asText(rawLesson);
  if (!url) return null;

  const fallbackTitle = weekContext.title
    ? weekContext.lessonCount > 1
      ? `${weekContext.title} ${lessonIndex + 1}차시`
      : weekContext.title
    : `${lessonIndex + 1}차시`;

  const title = isObject ? asText(rawLesson.title) || fallbackTitle : fallbackTitle;
  const lessonId = isObject
    ? asText(rawLesson.id) || `${weekContext.id || "week"}_lesson_${lessonIndex + 1}`
    : `${weekContext.id || "week"}_lesson_${lessonIndex + 1}`;

  const type = isObject
    ? asText(rawLesson.type) || (url.includes(".mp4") ? "mp4" : "youtube")
    : (url.includes(".mp4") ? "mp4" : "youtube");

  const durationMinutes = isObject
    ? toNumberOrNull(rawLesson.durationMinutes ?? rawLesson.durationMin ?? rawLesson.duration)
    : null;

  return {
    id: lessonId,
    title,
    url,
    type,
    isPreview: Boolean(isObject && (rawLesson.isPreview === true || rawLesson.preview === true)),
    durationMinutes
  };
}

function normalizeWeek(rawWeek, index) {
  const week = rawWeek && typeof rawWeek === "object" ? rawWeek : {};
  const weekId = asText(week.id) || `week_${index + 1}`;
  const weekNumber = Number.isFinite(Number(week.weekNumber))
    ? Number(week.weekNumber)
    : index + 1;
  const title = asText(week.title) || `${weekNumber}주차`;
  const description = asText(week.description || week.content);

  const rawVideos = Array.isArray(week.videos)
    ? week.videos
    : Array.isArray(week.lessons)
      ? week.lessons
      : Array.isArray(week.video)
        ? week.video
        : asText(week.video || week.videoUrl)
          ? [week.video || week.videoUrl]
          : [];

  const context = { id: weekId, title, lessonCount: rawVideos.length };
  const lessons = rawVideos
    .map((item, lessonIndex) => normalizeLesson(item, lessonIndex, context))
    .filter(Boolean);

  const videos = lessons.map((lesson) => ({
    id: lesson.id,
    title: lesson.title || "",
    url: lesson.url
  }));

  const weekDuration = toNumberOrNull(week.durationMinutes ?? week.durationMin ?? week.duration);
  const lessonDurationTotal = lessons.reduce((sum, lesson) => sum + (lesson.durationMinutes || 0), 0);

  return {
    id: weekId,
    weekNumber,
    title,
    description,
    content: description,
    summary: asText(week.summary),
    isPreview: Boolean(week.isPreview === true || week.preview === true),
    videos,
    lessons,
    lessonCount: videos.length,
    durationMinutes: weekDuration != null ? weekDuration : (lessonDurationTotal > 0 ? lessonDurationTotal : null)
  };
}

export function normalizeCurriculumWeeks(rawWeeks, legacyVideoUrl = "") {
  const weeksFromRaw = Array.isArray(rawWeeks)
    ? rawWeeks
      .map((week, index) => normalizeWeek(week, index))
      .filter((week) => week.lessonCount > 0 || Boolean(week.description))
    : [];

  if (weeksFromRaw.length > 0) {
    return weeksFromRaw;
  }

  const legacyVideo = asText(legacyVideoUrl);
  if (!legacyVideo) return [];

  return [
    {
      id: "week_1",
      weekNumber: 1,
      title: "1주차",
      description: "",
      content: "",
      summary: "",
      isPreview: false,
      videos: [
        {
          id: "week_1_video_1",
          title: "1차시",
          url: legacyVideo
        }
      ],
      lessons: [
        {
          id: "week_1_lesson_1",
          title: "1차시",
          url: legacyVideo,
          type: legacyVideo.includes(".mp4") ? "mp4" : "youtube",
          isPreview: false,
          durationMinutes: null
        }
      ],
      lessonCount: 1,
      durationMinutes: null
    }
  ];
}

function getPrimaryVideoUrl(curriculumWeeks) {
  if (!Array.isArray(curriculumWeeks)) return "";
  for (const week of curriculumWeeks) {
    for (const video of week.videos || []) {
      const url = asText(video?.url || video);
      if (url) return url;
    }
    for (const lesson of week.lessons || []) {
      const url = asText(lesson?.url);
      if (url) return url;
    }
  }
  return "";
}

function getTotalLessons(curriculumWeeks, explicitTotalLessons = null) {
  const explicit = toNumberOrNull(explicitTotalLessons);
  if (explicit != null) return explicit;
  if (!Array.isArray(curriculumWeeks)) return 0;
  return curriculumWeeks.reduce((sum, week) => {
    const count = Number.isFinite(Number(week.lessonCount))
      ? Number(week.lessonCount)
      : (Array.isArray(week.videos) ? week.videos.length : 0);
    return sum + count;
  }, 0);
}

function getTotalDurationMinutes(curriculumWeeks, explicitDuration = null) {
  const explicit = toNumberOrNull(explicitDuration);
  if (explicit != null) return explicit;
  if (!Array.isArray(curriculumWeeks)) return null;
  const total = curriculumWeeks.reduce((sum, week) => sum + (week.durationMinutes || 0), 0);
  return total > 0 ? total : null;
}

function detectPreviewAvailability(course) {
  if (asText(course.previewVideoUrl) || asText(course.previewUrl)) return true;
  if (course.preview === true || course.previewEnabled === true) return true;
  return false;
}

export function normalizeAccessType(value) {
  const normalized = asText(value).toLowerCase();
  if (normalized === "public") return "public";
  if (normalized === "memberonly" || normalized === "member_only" || normalized === "member") {
    return "memberOnly";
  }
  if (normalized === "paid") return "paid";
  return "public";
}

function toAccessType(value) {
  return normalizeAccessType(value);
}

function toVisibility(value) {
  const normalized = asText(value).toLowerCase();
  if (normalized === "unlisted" || normalized === "private" || normalized === "hidden") return normalized;
  return "public";
}

function toStatus(value) {
  const normalized = asText(value).toLowerCase();
  if (normalized === "draft" || normalized === "archived") return normalized;
  return "published";
}

export function normalizeCourseFormat(value, weekCount = 0) {
  const normalized = asText(value).toLowerCase();
  if (normalized === "single") return "single";
  if (normalized === "series" || normalized === "weekly") return "series";
  return weekCount > 1 ? "series" : "single";
}

export function getCourseFormatLabel(courseFormat) {
  const key = normalizeCourseFormat(courseFormat);
  return COURSE_FORMAT_LABEL[key] || COURSE_FORMAT_LABEL.single;
}

export function getCourseFormatBadgeLabel(courseFormat) {
  const key = normalizeCourseFormat(courseFormat);
  return COURSE_FORMAT_BADGE_LABEL[key] || COURSE_FORMAT_BADGE_LABEL.single;
}

export function getAccessTypeBadgeLabel(accessType) {
  const key = normalizeAccessType(accessType);
  return ACCESS_TYPE_BADGE_LABEL[key] || ACCESS_TYPE_BADGE_LABEL.public;
}

export function getSubjectAccentClass(subjectCode, subjectLabel = "") {
  const rawCode = asText(subjectCode).toUpperCase();
  const rawLabel = asText(subjectLabel);
  if (rawCode === "KOR" || rawLabel === "국어") return "subject-ko";
  if (rawCode === "ENG" || rawLabel === "영어") return "subject-en";
  if (rawCode === "MATH" || rawLabel === "수학") return "subject-ma";
  if (rawCode === "SCI" || rawLabel === "과학") return "subject-sc";
  if (rawCode === "ESSAY" || rawLabel === "수리논술") return "subject-etc";
  if (rawCode === "ETC" || rawLabel === "기타" || rawLabel === "일반") return "subject-etc";
  return "subject-etc";
}

function normalizeSectionType(rawType) {
  const value = asText(rawType).toLowerCase();
  if (!value) return "custom";

  if (value === "intro" || value === "introduction" || value === "courseintro" || value === "course_introduction") {
    return "introduction";
  }
  if (value === "instructor" || value === "instructorinfo" || value === "instructor_info") {
    return "instructor";
  }
  if (value === "learningcontent" || value === "learning_content" || value === "learning" || value === "weeks" || value === "week") {
    return "learningContent";
  }
  if (value === "materials" || value === "material" || value === "textbooks" || value === "textbook") {
    return "materials";
  }
  if (value === "learningobjectives" || value === "learning_objectives" || value === "objectives") {
    return "learningObjectives";
  }
  if (value === "targetaudience" || value === "target_audience" || value === "audience") {
    return "targetAudience";
  }
  if (value === "curriculum") return "curriculum";
  if (value === "preview") return "preview";
  if (value === "custom") return "custom";
  return "custom";
}

function sanitizeSectionId(rawId, fallbackType, index) {
  const raw = asText(rawId) || `${fallbackType}_${index + 1}`;
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  if (cleaned) return cleaned;
  return `${fallbackType}_${index + 1}`;
}

function normalizeDetailSectionEntry(rawEntry, index) {
  if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) return null;
  const type = normalizeSectionType(rawEntry.type || rawEntry.key || rawEntry.sectionType || rawEntry.id);
  const preset = COURSE_DETAIL_SECTION_PRESET_MAP[type] || COURSE_DETAIL_SECTION_PRESET_MAP.custom;
  const id = sanitizeSectionId(rawEntry.id || rawEntry.key, type, index);
  const title = asText(rawEntry.title) || preset.defaultTitle;
  const content = asText(rawEntry.content || rawEntry.body || rawEntry.text);
  const orderCandidate = Number(rawEntry.order ?? rawEntry.sortOrder ?? rawEntry.index);
  const order = Number.isFinite(orderCandidate) ? orderCandidate : (preset.defaultOrder + index);

  return {
    id,
    type,
    title,
    content,
    visible: rawEntry.visible !== false && rawEntry.enabled !== false,
    order
  };
}

function ensureUniqueSectionIds(sections) {
  const seen = new Set();
  return sections.map((section, index) => {
    let nextId = section.id;
    if (seen.has(nextId)) {
      nextId = `${nextId}_${index + 1}`;
    }
    seen.add(nextId);
    return {
      ...section,
      id: nextId
    };
  });
}

function normalizeSectionMap(rawMap) {
  return Object.entries(rawMap)
    .map(([key, value], index) => {
      if (value == null) return null;
      if (typeof value === "boolean") {
        return {
          id: key,
          type: key,
          title: "",
          visible: value,
          content: "",
          order: (index + 1) * 10
        };
      }
      if (typeof value === "object") {
        return {
          id: key,
          type: key,
          ...value
        };
      }
      return {
        id: key,
        type: key,
        title: "",
        visible: true,
        content: asText(value),
        order: (index + 1) * 10
      };
    })
    .filter(Boolean);
}

export function getDefaultCourseDetailSections() {
  return DEFAULT_DETAIL_SECTION_TYPES.map((type, index) => {
    const preset = COURSE_DETAIL_SECTION_PRESET_MAP[type];
    return {
      id: sanitizeSectionId(type, type, index),
      type,
      title: preset.defaultTitle,
      content: "",
      visible: preset.defaultVisible !== false,
      order: preset.defaultOrder
    };
  });
}

export function normalizeCourseDetailSections(rawSections, options = {}) {
  const fallbackToDefaults = options.fallbackToDefaults !== false;
  let entries = [];

  if (Array.isArray(rawSections)) {
    entries = rawSections;
  } else if (rawSections && typeof rawSections === "object") {
    entries = normalizeSectionMap(rawSections);
  }

  let normalized = entries
    .map((entry, index) => normalizeDetailSectionEntry(entry, index))
    .filter(Boolean);

  const seenType = new Set();
  normalized = normalized.filter((section) => {
    if (section.type === "custom") return true;
    if (seenType.has(section.type)) return false;
    seenType.add(section.type);
    return true;
  });

  normalized = ensureUniqueSectionIds(normalized)
    .sort((a, b) => {
      const orderDiff = (a.order || 0) - (b.order || 0);
      if (orderDiff !== 0) return orderDiff;
      return a.title.localeCompare(b.title, "ko");
    })
    .map((section, index) => ({
      ...section,
      order: Number.isFinite(Number(section.order)) ? Number(section.order) : (index + 1) * 10
    }));

  if (normalized.length === 0 && fallbackToDefaults) {
    return getDefaultCourseDetailSections();
  }

  return normalized;
}

export function createCourseLabelMaps(catalogSettingData = {}) {
  return buildLabelMaps(mergeCourseCatalog(catalogSettingData || {}));
}

export function getSubjectLabel(subjectCode, labelMaps = {}) {
  const code = asText(subjectCode);
  if (!code) return "";
  const fromCatalog = labelMaps?.subject?.[code];
  if (fromCatalog) return fromCatalog;
  const fromFallback = FALLBACK_SUBJECT[code];
  if (fromFallback) return fromFallback;
  if (isInternalSubjectCode(code)) return UNKNOWN_INTERNAL_SUBJECT_PUBLIC_LABEL;
  return code;
}

export function getGradeLabel(gradeCode, labelMaps = {}) {
  const code = asText(gradeCode);
  if (!code) return "";
  const fromCatalog = labelMaps?.grade?.[code];
  if (fromCatalog) return fromCatalog;
  return FALLBACK_GRADE[code] || code;
}

export function getAccessLabel(accessType) {
  const key = toAccessType(accessType);
  return ACCESS_LABEL[key] || ACCESS_LABEL.public;
}

export function getStatusLabel(status) {
  const key = toStatus(status);
  return STATUS_LABEL[key] || STATUS_LABEL.published;
}

export function getVisibilityLabel(visibility) {
  const key = toVisibility(visibility);
  return VISIBILITY_LABEL[key] || VISIBILITY_LABEL.public;
}

export function buildCanonicalWeeksFromPrimaryVideo(primaryVideoUrl, existingCourse = {}) {
  const normalizedPrimaryVideo = asText(primaryVideoUrl);
  const baseWeeks = normalizeCurriculumWeeks(existingCourse.weeks, existingCourse.videoUrl);

  if (!normalizedPrimaryVideo) return baseWeeks;

  if (baseWeeks.length === 0) {
    return normalizeCurriculumWeeks([], normalizedPrimaryVideo);
  }

  const clone = baseWeeks.map((week) => ({
    ...week,
    videos: Array.isArray(week.videos) ? week.videos.map((video) => ({ ...video })) : []
  }));

  if (!Array.isArray(clone[0].videos) || clone[0].videos.length === 0) {
    clone[0].videos = [
      {
        id: `${clone[0].id || "week_1"}_video_1`,
        title: "1차시",
        url: normalizedPrimaryVideo
      }
    ];
  } else {
    clone[0].videos[0] = {
      ...clone[0].videos[0],
      url: normalizedPrimaryVideo
    };
  }

  return clone.map((week, index) => normalizeWeek(week, index));
}

export function buildCanonicalCoursePayload(input = {}, options = {}) {
  const existingCourse = options.existingCourse || {};

  const title = asText(input.title);
  const shortDescription = deriveShortDescription(input.shortDescription, input.description || input.fullDescription) || null;
  const description = asText(input.description || input.fullDescription) || null;
  const subject = asText(input.subject) || null;
  const instructorUid = asText(input.instructorUid) || null;
  const instructorId = asText(input.instructorId) || asText(existingCourse.instructorId) || null;
  const instructorName = asText(input.instructorName) || null;
  const grade = asText(input.grade) || null;
  const year = asText(input.year) || null;
  const lectureContent = asText(input.lectureContent) || null;
  const status = toStatus(input.status || existingCourse.status || "published");

  const rawWeeksInput = Array.isArray(input.weeks)
    ? input.weeks
    : (Array.isArray(input.curriculumWeeks) ? input.curriculumWeeks : []);

  let weeks = rawWeeksInput.length > 0
    ? normalizeCurriculumWeeks(rawWeeksInput)
    : buildCanonicalWeeksFromPrimaryVideo(input.previewVideoUrl || input.primaryVideoUrl, existingCourse);

  const courseFormat = normalizeCourseFormat(input.courseFormat, weeks.length);
  if (courseFormat === "single") {
    const firstWeek = weeks[0] || normalizeWeek({
      id: "week_1",
      weekNumber: 1,
      title: "1주차",
      description: "",
      videos: []
    }, 0);
    weeks = [normalizeWeek({ ...firstWeek, weekNumber: 1 }, 0)];
  }

  const normalizedWeeksForSave = weeks.map((week, index) => {
    const videos = (Array.isArray(week.videos) ? week.videos : week.lessons || [])
      .map((video) => ({
        title: asText(video?.title),
        url: asText(video?.url || video?.fullUrl || video?.videoUrl || video)
      }))
      .filter((video) => video.url)
      .map((video) => ({
        ...(video.title ? { title: video.title } : {}),
        url: video.url
      }));

    return {
      title: asText(week.title) || `${index + 1}주차`,
      description: asText(week.description || week.content),
      videos
    };
  });

  const previewVideoUrl = asText(input.previewVideoUrl) || null;

  return {
    title,
    shortDescription,
    description,
    subject,
    instructorUid,
    instructorId,
    instructorName,
    grade,
    year,
    lectureContent,
    previewVideoUrl,
    courseFormat,
    weeks: normalizedWeeksForSave,
    status
  };
}

export function normalizeCourseForReadOnly(rawCourse, options = {}) {
  const course = rawCourse || {};
  const id = asText(course.id);
  const labelMaps = options.labelMaps || {};
  const hiddenSet = options.hiddenCourseIds || new Set();
  const instructorsByUid = options.instructorsByUid || {};

  const subjectCode = asText(course.subject);
  const subjectLabel = getSubjectLabel(subjectCode, labelMaps) || "일반";

  const category = asText(course.category) || asText(course.kind) || subjectLabel || "미분류";
  const title = asText(course.title) || "제목 없는 강좌";

  const fullDescription = asText(course.description) || asText(course.body);
  const shortDescription = deriveShortDescription(
    asText(course.shortDescription) || asText(course.summary) || asText(course.subtitle),
    fullDescription
  );

  const thumbnail = asText(course.thumbnail) || asText(course.coverImage) || asText(course.image);

  const instructorUid = asText(course.instructorUid);
  const instructorId = asText(course.instructorId);
  let instructorName = asText(course.instructorName) || asText(course.instructor);
  if (!instructorName && instructorUid && instructorsByUid[instructorUid]) {
    instructorName = asText(instructorsByUid[instructorUid]?.name);
  }
  if (!instructorName) instructorName = "강사 미정";

  const gradeCode = asText(course.grade);
  const gradeLabel = getGradeLabel(gradeCode, labelMaps);
  const year = asText(course.year || course.schoolYear);

  const accessType = toAccessType(course.accessType);
  const accessLabel = getAccessLabel(accessType);

  const visibility = toVisibility(course.visibility);
  const isHiddenBySetting = Boolean(id && hiddenSet.has(id));
  const isVisibilityPrivate = visibility === "private" || visibility === "hidden";
  const isUnlisted = visibility === "unlisted";
  const isCatalogHidden = isHiddenBySetting || isVisibilityPrivate || isUnlisted;
  const isDetailBlocked = isHiddenBySetting || isVisibilityPrivate;

  const status = toStatus(course.status);
  const statusLabel = getStatusLabel(status);
  const visibilityLabel = isHiddenBySetting ? "목록 비노출" : getVisibilityLabel(visibility);

  const curriculumWeeks = normalizeCurriculumWeeks(course.weeks, course.videoUrl);
  const hasExplicitDetailSections = Object.prototype.hasOwnProperty.call(course, "detailSections");
  const detailSections = normalizeCourseDetailSections(course.detailSections, {
    fallbackToDefaults: !hasExplicitDetailSections
  });

  const learningObjectives = normalizeTextList(course.learningObjectives || course.objectives || course.goals);
  const targetAudience = asText(course.targetAudience || course.audience);
  const lectureContent = asText(course.lectureContent || course.learningContent || "");

  const courseFormat = normalizeCourseFormat(course.courseFormat, curriculumWeeks.length);
  const previewVideoUrl = asText(course.previewVideoUrl || course.previewUrl);
  const previewAvailable = detectPreviewAvailability({ ...course, previewVideoUrl });

  const totalLessons = getTotalLessons(curriculumWeeks, course.totalLessons);
  const totalDurationMinutes = getTotalDurationMinutes(
    curriculumWeeks,
    course.totalDurationMinutes ?? course.durationMinutes ?? course.duration
  );
  const primaryVideoUrl = getPrimaryVideoUrl(curriculumWeeks);

  const legacyFlags = {
    descriptionFromBody: !asText(course.description) && Boolean(asText(course.body)),
    categoryFromKind: !asText(course.category) && Boolean(asText(course.kind)),
    instructorFromLegacyField: !asText(course.instructorName) && Boolean(asText(course.instructor)),
    shortDescriptionDerived: !asText(course.shortDescription) && !asText(course.summary),
    weeksFromLegacyVideoUrl: (!Array.isArray(course.weeks) || course.weeks.length === 0) && Boolean(asText(course.videoUrl)),
    examFieldsPresent: ["month", "schoolYear", "videoUrl", "examType", "qFrom", "qTo"].some(
      (field) => course[field] != null && String(course[field]).trim() !== ""
    )
  };

  return {
    ...course,
    id,
    title,
    shortDescription,
    fullDescription,
    description: fullDescription,
    summary: shortDescription,
    thumbnail,
    category,
    subjectCode,
    subjectLabel,
    gradeCode,
    gradeLabel,
    year,
    instructorUid,
    instructorId,
    instructorName,
    accessType,
    accessLabel,
    visibility,
    isHiddenBySetting,
    isCatalogHidden,
    isDetailBlocked,
    isUnlisted,
    status,
    statusLabel,
    isHidden: isCatalogHidden,
    visibilityLabel,
    learningObjectives,
    targetAudience,
    lectureContent,
    previewVideoUrl,
    courseFormat,
    curriculumWeeks,
    weeks: curriculumWeeks,
    detailSections,
    previewAvailable,
    totalLessons,
    totalDurationMinutes,
    primaryVideoUrl,
    legacyFlags
  };
}
