const MAX_IMAGE_LOAD_ATTEMPTS = 2;

const attemptCounts = new Map();
const exhaustedUrls = new Set();

export function getImageLoadKey(url) {
  return String(url || '').trim().split(/[?#]/)[0];
}

export function shouldLoadImage(url) {
  const key = getImageLoadKey(url);
  return Boolean(key) && !exhaustedUrls.has(key);
}

export function isImageLoadExhausted(url) {
  return exhaustedUrls.has(getImageLoadKey(url));
}

export function recordImageLoadFailure(url) {
  const key = getImageLoadKey(url);
  if (!key) return true;

  const nextCount = (attemptCounts.get(key) || 0) + 1;
  attemptCounts.set(key, nextCount);
  if (nextCount >= MAX_IMAGE_LOAD_ATTEMPTS) {
    exhaustedUrls.add(key);
    return true;
  }
  return false;
}

export function recordImageLoadSuccess(url) {
  const key = getImageLoadKey(url);
  if (!key) return;
  attemptCounts.delete(key);
  exhaustedUrls.delete(key);
}

export function resetImageLoadGuard(url) {
  const key = getImageLoadKey(url);
  if (!key) return;
  attemptCounts.delete(key);
  exhaustedUrls.delete(key);
}

export function clearImageLoadGuards() {
  attemptCounts.clear();
  exhaustedUrls.clear();
}

export function assignImageSrc(img, url, options = {}) {
  const {
    onSuccess,
    onGiveUp,
    fallbackSrc = '',
    allowFallbackOnce = false,
  } = options;

  if (!img) return false;

  const normalizedUrl = String(url || '').trim();
  if (!normalizedUrl) {
    img.removeAttribute('data-load-key');
    img.removeAttribute('data-load-state');
    img.removeAttribute('src');
    return false;
  }

  const key = getImageLoadKey(normalizedUrl);
  if (exhaustedUrls.has(key)) {
    if (typeof onGiveUp === 'function') onGiveUp(img, normalizedUrl);
    return false;
  }

  if (img.dataset.loadKey === key && img.dataset.loadState === 'ok') {
    return true;
  }
  if (img.dataset.loadKey === key && img.dataset.loadState === 'pending') {
    return true;
  }

  img.dataset.loadKey = key;
  img.dataset.loadState = 'pending';

  img.onload = () => {
    if (img.dataset.loadKey !== key) return;
    img.dataset.loadState = 'ok';
    recordImageLoadSuccess(normalizedUrl);
    img.onload = null;
    img.onerror = null;
    if (typeof onSuccess === 'function') onSuccess(img, normalizedUrl);
  };

  img.onerror = () => {
    if (img.dataset.loadKey !== key) return;
    const exhausted = recordImageLoadFailure(normalizedUrl);
    img.onload = null;
    img.onerror = null;

    if (!exhausted && allowFallbackOnce && fallbackSrc) {
      assignImageSrc(img, fallbackSrc, {
        onSuccess,
        onGiveUp,
        allowFallbackOnce: false,
      });
      return;
    }

    img.dataset.loadState = exhausted ? 'failed' : 'error';
    if (typeof onGiveUp === 'function') onGiveUp(img, normalizedUrl);
  };

  img.src = normalizedUrl;
  return true;
}

export function bindGuardedImages(root, options = {}) {
  const {
    selector = 'img[data-guarded-src]',
    includeInlineSrc = false,
    onGiveUp,
    fallbackSrc = '',
    allowFallbackOnce = false,
  } = options;
  if (!root) return;

  const useFallback = allowFallbackOnce || Boolean(fallbackSrc);
  const imgs = includeInlineSrc
    ? root.querySelectorAll('img')
    : root.querySelectorAll(selector);

  imgs.forEach((img) => {
    const url = (
      img.getAttribute('data-guarded-src')
      || (includeInlineSrc ? img.getAttribute('src') : '')
      || ''
    ).trim();
    if (!url || /^(blob:|data:)/i.test(url)) return;

    const giveUp = (element, failedUrl) => {
      if (typeof onGiveUp === 'function') {
        onGiveUp(element, failedUrl);
        return;
      }
      element.style.display = 'none';
    };

    if (isImageLoadExhausted(url)) {
      if (useFallback && fallbackSrc && getImageLoadKey(fallbackSrc) !== getImageLoadKey(url)) {
        assignImageSrc(img, fallbackSrc, { onGiveUp: (element) => giveUp(element, url) });
      } else {
        giveUp(img, url);
      }
      return;
    }

    img.setAttribute('data-guarded-src', url);
    img.removeAttribute('src');
    assignImageSrc(img, url, {
      allowFallbackOnce: useFallback,
      fallbackSrc,
      onGiveUp: (element) => giveUp(element, url),
    });
  });
}

export function probeImageUrl(url) {
  const normalizedUrl = String(url || '').trim();
  if (!normalizedUrl || !shouldLoadImage(normalizedUrl)) {
    return Promise.resolve(false);
  }

  const key = getImageLoadKey(normalizedUrl);
  return new Promise((resolve) => {
    const probe = new Image();
    probe.onload = () => {
      recordImageLoadSuccess(normalizedUrl);
      resolve(true);
    };
    probe.onerror = () => {
      recordImageLoadFailure(normalizedUrl);
      resolve(false);
    };
    probe.src = normalizedUrl;
    probe.dataset.loadKey = key;
  });
}
