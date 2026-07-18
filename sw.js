const PWA_LITE_VERSION = "2026-06-29-pwa-lite-v1";
const CACHE_PREFIX = "gritedu-pwa-lite";
const CACHE_NAME = `${CACHE_PREFIX}-${PWA_LITE_VERSION}`;
const OFFLINE_URL = "/offline.html";
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/assets/icons/icon-192.png",
  "/assets/icons/icon-512.png",
  "/assets/icons/apple-touch-icon.png"
];

const NEVER_CACHE_PATHS = new Set([
  "/version.json",
  "/members/login.html",
  "/members/signup.html",
  "/members/dashboard.html"
]);

const NEVER_CACHE_PREFIXES = [
  "/members/admin/",
  "/members/member/",
  "/members/students/",
  "/members/instructors/"
];

function isFirebaseOrGoogleSdkRequest(url) {
  const host = url.hostname;
  return (
    host === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/") ||
    host === "firestore.googleapis.com" ||
    host === "identitytoolkit.googleapis.com" ||
    host === "securetoken.googleapis.com" ||
    host === "firebaseinstallations.googleapis.com" ||
    host.endsWith(".googleapis.com") ||
    host.endsWith(".cloudfunctions.net") ||
    host.endsWith(".firebaseio.com")
  );
}

function isNeverCacheRequest(url) {
  return (
    NEVER_CACHE_PATHS.has(url.pathname) ||
    NEVER_CACHE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix)) ||
    isFirebaseOrGoogleSdkRequest(url)
  );
}

function isNavigationRequest(request) {
  const accept = request.headers.get("accept") || "";
  return request.mode === "navigate" || (
    request.destination === "document" &&
    accept.includes("text/html")
  );
}

async function getOfflineResponse() {
  const cached = await caches.match(OFFLINE_URL);
  if (cached) return cached;
  return new Response("현재 네트워크 연결이 필요합니다.", {
    status: 503,
    headers: {
      "Content-Type": "text/plain; charset=utf-8"
    }
  });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      const requests = PRECACHE_URLS.map((url) => new Request(url, { cache: "reload" }));
      return cache.addAll(requests);
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => Promise.all(
      cacheNames
        .filter((cacheName) => (
          cacheName.startsWith(`${CACHE_PREFIX}-`) &&
          cacheName !== CACHE_NAME
        ))
        .map((cacheName) => caches.delete(cacheName))
    ))
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (isNavigationRequest(request)) {
    event.respondWith(
      fetch(request).catch(() => getOfflineResponse())
    );
    return;
  }

  if (isNeverCacheRequest(url)) return;
});
