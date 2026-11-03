/**
 * 스켈레톤 UI 유틸리티 함수
 * 부드러운 전환 효과와 접근성을 제공합니다.
 */

/**
 * 스켈레톤 요소를 부드럽게 표시합니다.
 * @param {HTMLElement|string} element - 스켈레톤 요소 또는 선택자
 * @param {number} delay - 표시 지연 시간 (ms)
 */
export function showSkeleton(element, delay = 0) {
  const el = typeof element === 'string' ? document.querySelector(element) : element;
  if (!el) return;
  
  const show = () => {
    el.classList.remove('skeleton-fade-out');
    el.classList.add('skeleton-fade-in');
    el.style.display = '';
    el.style.opacity = '';
    el.style.visibility = '';
    el.style.pointerEvents = '';
  };
  
  if (delay > 0) {
    setTimeout(show, delay);
  } else {
    show();
  }
}

/**
 * 스켈레톤 요소를 부드럽게 숨깁니다.
 * @param {HTMLElement|string} element - 스켈레톤 요소 또는 선택자
 * @param {number} fadeDuration - 페이드 아웃 지속 시간 (ms)
 * @param {boolean} removeFromDOM - DOM에서 완전히 제거할지 여부
 */
export function hideSkeleton(element, fadeDuration = 300, removeFromDOM = false) {
  const el = typeof element === 'string' ? document.querySelector(element) : element;
  if (!el) return;
  
  el.classList.remove('skeleton-fade-in');
  el.classList.add('skeleton-fade-out');
  
  setTimeout(() => {
    if (removeFromDOM) {
      el.remove();
    } else {
      el.style.display = 'none';
    }
  }, fadeDuration);
}

/**
 * 여러 스켈레톤 요소를 한 번에 관리합니다.
 * @param {Object} config - 설정 객체
 * @param {HTMLElement|string} config.element - 스켈레톤 요소
 * @param {boolean} config.show - 표시 여부
 * @param {number} config.delay - 지연 시간
 * @param {number} config.fadeDuration - 페이드 지속 시간
 * @param {boolean} config.removeFromDOM - DOM 제거 여부
 */
export function toggleSkeleton(config) {
  const { element, show, delay = 0, fadeDuration = 300, removeFromDOM = false } = config;
  
  if (show) {
    showSkeleton(element, delay);
  } else {
    hideSkeleton(element, fadeDuration, removeFromDOM);
  }
}

/**
 * 스켈레톤 카운터를 사용하여 모든 스켈레톤이 로드될 때까지 대기한 후 숨깁니다.
 * @param {HTMLElement|string} skeletonElement - 스켈레톤 요소
 * @param {Object} counter - 카운터 객체 { current: number, total: number }
 * @param {number} fadeDuration - 페이드 아웃 지속 시간
 */
export function hideSkeletonWhenReady(skeletonElement, counter, fadeDuration = 300) {
  counter.current = (counter.current || 0) + 1;
  
  if (counter.current >= counter.total) {
    hideSkeleton(skeletonElement, fadeDuration);
  }
}

/**
 * 스켈레톤 그리드를 생성합니다.
 * @param {Object} config - 설정 객체
 * @param {number} config.count - 생성할 스켈레톤 개수
 * @param {string} config.type - 스켈레톤 타입 ('course', 'instructor', 'gallery', 'list')
 * @param {string} config.container - 컨테이너 선택자
 * @returns {HTMLElement[]} 생성된 스켈레톤 요소 배열
 */
export function createSkeletonGrid({ count, type = 'course', container }) {
  const containerEl = typeof container === 'string' ? document.querySelector(container) : container;
  if (!containerEl) return [];
  
  const skeletons = [];
  
  for (let i = 0; i < count; i++) {
    const skeleton = document.createElement('div');
    skeleton.className = `skeleton-${type}`;
    
    if (type === 'course') {
      skeleton.innerHTML = `
        <div class="skeleton skeleton-course-label"></div>
        <div class="skeleton skeleton-course-title"></div>
        <div class="skeleton skeleton-course-meta"></div>
      `;
    } else if (type === 'instructor') {
      skeleton.className = 'skeleton-instructor';
    } else if (type === 'gallery') {
      skeleton.className = 'skeleton-gallery';
    } else if (type === 'list') {
      skeleton.className = 'skeleton-list-item';
    }
    
    containerEl.appendChild(skeleton);
    skeletons.push(skeleton);
  }
  
  return skeletons;
}

/**
 * 모든 스켈레톤을 제거합니다.
 * @param {HTMLElement|string} container - 컨테이너 요소 또는 선택자
 */
export function removeAllSkeletons(container) {
  const containerEl = typeof container === 'string' ? document.querySelector(container) : container || document;
  const skeletons = containerEl.querySelectorAll('.skeleton, .skeleton-course, .skeleton-instructor, .skeleton-gallery, .skeleton-list-item');
  
  skeletons.forEach(skeleton => {
    hideSkeleton(skeleton, 200, true);
  });
}

// 전역으로도 사용 가능하도록 window 객체에 추가 (선택사항)
if (typeof window !== 'undefined') {
  window.skeletonUtils = {
    show: showSkeleton,
    hide: hideSkeleton,
    toggle: toggleSkeleton,
    hideWhenReady: hideSkeletonWhenReady,
    createGrid: createSkeletonGrid,
    removeAll: removeAllSkeletons
  };
}
