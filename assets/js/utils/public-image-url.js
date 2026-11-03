/**
 * R2 public image URL and local /assets fallback validation.
 */

export const R2_PUBLIC_BASE_URL = 'https://assets.gritedu.kr';

export const R2_PUBLIC_BASE_URLS = [
  R2_PUBLIC_BASE_URL,
  'https://pub-da6a2b2ce44042838244ab921f3eb694.r2.dev',
];

export const PUBLIC_IMAGE_FIELD = {
  popup: 'popup',
  instructorProfile: 'instructorProfile',
  instructorCurriculum: 'instructorCurriculum',
  story: 'story',
};

/** Render-time fallback only. Never persist this value to Firestore. */
export const INSTRUCTOR_PROFILE_PLACEHOLDER = `${R2_PUBLIC_BASE_URL}/public/instructors/profile/profile.webp`;

const R2_PUBLIC_PREFIXES = {
  [PUBLIC_IMAGE_FIELD.popup]: ['public/popup/'],
  [PUBLIC_IMAGE_FIELD.instructorProfile]: ['public/instructors/profile/'],
  // 신규 운영 prefix (강사 참고 자료 이미지)
  [PUBLIC_IMAGE_FIELD.instructorCurriculum]: ['public/instructors/image/'],
  [PUBLIC_IMAGE_FIELD.story]: ['public/story/', 'public/pages/story/'],
};

/** Legacy R2 prefixes — 기존 Firestore 데이터 읽기·재저장 호환용 */
const R2_LEGACY_READ_PREFIXES = {
  [PUBLIC_IMAGE_FIELD.instructorCurriculum]: ['public/instructors/curriculum/'],
};

const LOCAL_PATH_PATTERNS = {
  [PUBLIC_IMAGE_FIELD.popup]: /^\/assets\/popup\/[a-zA-Z0-9._-]+\.(webp|png|jpe?g)$/i,
  [PUBLIC_IMAGE_FIELD.instructorProfile]: /^\/assets\/instructors\/profile\/[a-zA-Z0-9._-]+\.(webp|png|jpe?g)$/i,
  [PUBLIC_IMAGE_FIELD.instructorCurriculum]: /^\/assets\/instructors\/curriculum\/[a-zA-Z0-9._-]+\.(webp|png|jpe?g)$/i,
};

const R2_RASTER_IMAGE_PATTERN = /\.(webp|png|jpe?g)$/i;

const R2_EXTENSION_PATTERNS = {
  [PUBLIC_IMAGE_FIELD.popup]: R2_RASTER_IMAGE_PATTERN,
  [PUBLIC_IMAGE_FIELD.instructorProfile]: R2_RASTER_IMAGE_PATTERN,
  [PUBLIC_IMAGE_FIELD.instructorCurriculum]: R2_RASTER_IMAGE_PATTERN,
  [PUBLIC_IMAGE_FIELD.story]: R2_RASTER_IMAGE_PATTERN,
};

const R2_KEY_PATTERN = /^[a-zA-Z0-9._/-]+$/;
const DANGEROUS_SCHEME_PATTERN = /^(javascript|data|blob|http):/i;

const BLOCKED_CONTENT_PATTERNS = [
  /data:image/i,
  /base64,/i,
  /\bblob:/i,
  /\bjavascript:/i,
  /\/assets\/story\//i,
  /\/assets\/contact\//i,
  /\/assets\/pages\//i,
];

function trimValue(value) {
  return String(value || '').trim();
}

function normalizeLocalAssetPath(value) {
  const raw = trimValue(value);
  if (!raw || DANGEROUS_SCHEME_PATTERN.test(raw)) return '';

  const normalized = raw
    .replace(/^file:\/+/i, '')
    .replace(/\\/g, '/')
    .replace(/^\/?d:\//i, '/d/')
    .replace(/^\/+/, '/');

  if (!normalized.startsWith('/assets/')) return '';
  return normalized.split(/[?#]/)[0];
}

function getR2BaseUrl(url) {
  const normalized = trimValue(url).replace(/\/+$/, '');
  return R2_PUBLIC_BASE_URLS.find((baseUrl) => (
    normalized === baseUrl || normalized.startsWith(`${baseUrl}/`)
  )) || '';
}

function getAllowedR2Prefixes(field, { includeLegacyRead = true } = {}) {
  const prefixes = [...(R2_PUBLIC_PREFIXES[field] || [])];
  if (includeLegacyRead) {
    const legacy = R2_LEGACY_READ_PREFIXES[field];
    if (legacy) prefixes.push(...legacy);
  }
  return prefixes;
}

function parseR2PublicUrl(value, field, options = {}) {
  const raw = trimValue(value);
  if (!raw || !/^https:\/\//i.test(raw)) return '';

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return '';
  }

  if (parsed.protocol !== 'https:') return '';
  const baseUrl = getR2BaseUrl(`${parsed.protocol}//${parsed.host}`);
  if (!baseUrl) return '';

  const pathname = parsed.pathname.replace(/^\/+/, '');
  if (!pathname || pathname.includes('/assets/')) return '';
  if (!R2_KEY_PATTERN.test(pathname)) return '';

  const prefixes = getAllowedR2Prefixes(field, options);
  if (!prefixes.some((prefix) => pathname.startsWith(prefix))) return '';

  const extPattern = R2_EXTENSION_PATTERNS[field];
  if (extPattern && !extPattern.test(pathname)) return '';

  return `${baseUrl}/${pathname}`;
}

function matchesLocalPath(path, field) {
  const pattern = LOCAL_PATH_PATTERNS[field];
  return pattern ? pattern.test(path) : false;
}

export function isRemotePublicImageUrl(value) {
  return Boolean(getR2BaseUrl(trimValue(value).split(/[?#]/)[0]));
}

export function isAllowedPublicImageUrl(value, options = {}) {
  const { field, allowEmpty = true, includeLegacyRead = true } = options;
  const raw = trimValue(value);
  if (!raw) return allowEmpty;
  if (DANGEROUS_SCHEME_PATTERN.test(raw)) return false;

  const localPath = normalizeLocalAssetPath(raw);
  if (localPath && matchesLocalPath(localPath, field)) return true;

  return Boolean(parseR2PublicUrl(raw, field, { includeLegacyRead }));
}

export function normalizePublicImageUrl(value, options = {}) {
  const { field, allowEmpty = true, includeLegacyRead = true } = options;
  const raw = trimValue(value);
  if (!raw) return allowEmpty ? '' : '';

  if (DANGEROUS_SCHEME_PATTERN.test(raw)) return '';

  const localPath = normalizeLocalAssetPath(raw);
  if (localPath && matchesLocalPath(localPath, field)) return localPath;

  return parseR2PublicUrl(raw, field, { includeLegacyRead });
}

export function sanitizePublicImageSrc(value, options = {}) {
  return normalizePublicImageUrl(value, { ...options, allowEmpty: true });
}

export function normalizePersistableInstructorProfilePhoto(value) {
  const raw = String(value || '').trim();
  if (!raw || DANGEROUS_SCHEME_PATTERN.test(raw)) return '';
  return normalizePublicImageUrl(raw, {
    field: PUBLIC_IMAGE_FIELD.instructorProfile,
    allowEmpty: false,
  });
}

export function resolveInstructorProfileImageUrl(value) {
  const safe = sanitizePublicImageSrc(value, { field: PUBLIC_IMAGE_FIELD.instructorProfile });
  return safe || INSTRUCTOR_PROFILE_PLACEHOLDER;
}

export function containsBlockedImageSource(value) {
  const raw = String(value || '');
  if (!raw) return false;
  return BLOCKED_CONTENT_PATTERNS.some((pattern) => pattern.test(raw));
}

export function getBlockedImageSourceMessage() {
  return 'story/contact 본문에는 이미지를 직접 첨부하지 않습니다. 공개 이미지는 팝업 또는 강사 이미지 영역에서 R2 URL로 관리하세요.';
}

export function getPopupImageValidationMessage() {
  return '팝업 이미지는 로컬 assets/popup 경로 또는 허용된 R2 URL(assets.gritedu.kr/public/popup/)만 사용할 수 있습니다. PNG/JPG/WEBP 형식을 권장합니다.';
}

export function getInstructorProfileValidationMessage() {
  return '강사 프로필 이미지는 로컬 assets/instructors/profile 경로 또는 허용된 R2 URL(assets.gritedu.kr/public/instructors/profile/)만 사용할 수 있습니다. PNG/JPG/WEBP 형식을 권장합니다.';
}

export function getInstructorCurriculumValidationMessage() {
  return '참고 자료 이미지는 허용된 R2 URL(assets.gritedu.kr/public/instructors/image/) 또는 rollback용 로컬 /assets/instructors/curriculum/ 경로만 사용할 수 있습니다. PNG/JPG/WEBP 형식을 권장합니다.';
}

export function getStoryImageValidationMessage() {
  return "Story 이미지는 assets.gritedu.kr/public/story/ 경로의 jpg, png, webp만 사용할 수 있습니다.";
}

export function normalizeStoryImageUrl(value, options = {}) {
  return normalizePublicImageUrl(value, {
    field: PUBLIC_IMAGE_FIELD.story,
    allowEmpty: options.allowEmpty !== false,
  });
}

export function isAllowedStoryImageUrl(value, options = {}) {
  return isAllowedPublicImageUrl(value, {
    field: PUBLIC_IMAGE_FIELD.story,
    allowEmpty: options.allowEmpty !== false,
  });
}

/** Canonical instructor profile photo path (Firestore field: photo). */
export function getInstructorProfilePhotoPath(source) {
  if (!source || typeof source !== 'object') return '';
  return String(source.photo || source.profilePhoto || source.imageUrl || '').trim();
}

export function sanitizePopupContentHtml(html) {
  const raw = String(html || '').trim();
  if (!raw) return '';

  const template = document.createElement('template');
  template.innerHTML = raw;

  template.content.querySelectorAll('img').forEach((img) => {
    const pathAttr = img.getAttribute('data-image-path') || img.getAttribute('data-save-path') || '';
    const candidate = pathAttr || img.getAttribute('src') || '';
    const safeSrc = sanitizePublicImageSrc(candidate, { field: PUBLIC_IMAGE_FIELD.popup });
    if (safeSrc) {
      img.setAttribute('src', safeSrc);
      img.removeAttribute('data-blob-url');
      img.removeAttribute('data-base64');
      img.removeAttribute('data-save-path');
      img.removeAttribute('data-image-path');
      return;
    }
    img.remove();
  });

  return template.innerHTML.trim();
}
