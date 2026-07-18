import "/assets/js/utils/toast.js";
import { auth, signOut, getUserRole, getDashboardUrl } from "/assets/js/firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";
import { initKakaoChannelFloatingButton } from "/assets/js/utils/kakao-channel.js";
import { getPublicSettingDoc } from "/assets/js/utils/settings-cache.js";

const THEME_KEY = "grit-theme";
const themeToggleHandler = new WeakMap();

async function initFooterSettings() {
  try {
    const result = await getPublicSettingDoc("footer");
    if (!result.exists || !result.data) return;
    const data = result.data;
    const setText = (id, value) => { const el = document.getElementById(id); if (el && value) el.textContent = value; };
    const setUrl = (id, value) => { const el = document.getElementById(id); if (el && /^https:\/\//i.test(String(value || ""))) el.href = value; };
    setText("footerCompanyName", data.companyName);
    setText("footerBusinessNumber", data.businessNumber);
    setText("footerRepresentative", data.representative);
    setText("footerAddress", data.address);
    setText("footerPhone", data.phone);
    const phone = document.getElementById("footerPhone");
    if (phone && data.phone) phone.href = `tel:${String(data.phone).replace(/[^0-9+]/g, "")}`;
    setUrl("footerInstagram", data.instagramUrl);
    setUrl("footerYoutube", data.youtubeUrl);
    setUrl("footerBlog", data.blogUrl);
  } catch (error) {
    console.warn("[footer] 설정을 불러오지 못했습니다.", error);
  }
}

function getCurrentBuildVersion() {
  const metaVersion = document
    .querySelector('meta[name="grit-build-version"]')
    ?.getAttribute("content")
    ?.trim();
  return metaVersion || "";
}

function withBuildVersion(url) {
  const buildVersion = getCurrentBuildVersion();
  if (!buildVersion || typeof url !== "string") return url;
  if (!url.startsWith("/assets/partials/")) return url;
  if (!url.endsWith(".html")) return url;
  if (url.includes("?")) return url;
  return `${url}?v=${encodeURIComponent(buildVersion)}`;
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);

  const logoImg = document.getElementById("logoImg");
  if (logoImg) {
    const lightSrc = logoImg.getAttribute("data-light");
    const darkSrc = logoImg.getAttribute("data-dark");
    logoImg.src =
      lightSrc && darkSrc
        ? theme === "dark"
          ? darkSrc
          : lightSrc
        : theme === "dark"
        ? darkSrc || logoImg.src
        : lightSrc || logoImg.src;
  }

  const footerLogoImg = document.getElementById("footerLogoImg");
  if (footerLogoImg) {
    const lightSrc = footerLogoImg.getAttribute("data-light");
    const darkSrc = footerLogoImg.getAttribute("data-dark");
    footerLogoImg.src =
      lightSrc && darkSrc
        ? theme === "dark"
          ? darkSrc
          : lightSrc
        : theme === "dark"
        ? darkSrc || footerLogoImg.src
        : lightSrc || footerLogoImg.src;
  }

  const themeIcon = document.getElementById("themeIcon");
  if (themeIcon) {
    themeIcon.src =
      theme === "dark" ? "/assets/lightmode.png" : "/assets/darkmode.png";
  }

  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (error) {
    // Ignore localStorage errors
  }
}

function currentTheme() {
  try {
    return (
      localStorage.getItem(THEME_KEY) ||
      (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    );
  } catch {
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme");
  applyTheme(current === "dark" ? "light" : "dark");
}

function initTheme() {
  applyTheme(currentTheme());

  const themeToggle = document.getElementById("themeToggle");
  if (themeToggle) {
    const existingHandler = themeToggleHandler.get(themeToggle);
    if (existingHandler) {
      themeToggle.removeEventListener("click", existingHandler);
    }
    themeToggleHandler.set(themeToggle, toggleTheme);
    themeToggle.addEventListener("click", toggleTheme);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initTheme);
} else {
  initTheme();
}

async function updateMyClassLink(user) {
  const myClassLink = document.getElementById("menu-myclass");
  if (myClassLink) {
    if (user) {
      try {
        const role = await getUserRole(user);
        if (role) {
          const dashboardUrl = getDashboardUrl(role);
          myClassLink.href = dashboardUrl;
        } else {
          myClassLink.href = "/members/dashboard.html";
        }
      } catch (error) {
        console.warn("역할 확인 실패:", error);
        myClassLink.href = "/members/dashboard.html";
      }
    } else {
      myClassLink.href = "/members/dashboard.html";
    }
  }
}

const requiresLoginHandlers = new WeakMap();
const logoutHandlers = new WeakMap();
let logoutHandler = null;
let isLoggingOut = false;

function updateAuthMenu(user) {
  const body = document.body;

  if (user) {
    body.classList.add("logged-in");
    body.classList.remove("logged-out");
  } else {
    body.classList.add("logged-out");
    body.classList.remove("logged-in");
  }

  const loginBtn = document.getElementById("menu-login");
  const logoutBtn = document.getElementById("menu-logout");
  const loginBtnMobile = document.getElementById("menu-login-mobile");
  const logoutBtnMobile = document.getElementById("menu-logout-mobile");

  if (user) {
    if (loginBtn) {
      loginBtn.style.display = "none";
    }
    if (logoutBtn) {
      logoutBtn.style.display = "";
    }
    if (loginBtnMobile) {
      loginBtnMobile.style.display = "none";
    }
    if (logoutBtnMobile) {
      logoutBtnMobile.style.display = "";
    }
  } else {
    if (loginBtn) {
      loginBtn.style.display = "";
    }
    if (logoutBtn) {
      logoutBtn.style.display = "none";
    }
    if (loginBtnMobile) {
      loginBtnMobile.style.display = "";
    }
    if (logoutBtnMobile) {
      logoutBtnMobile.style.display = "none";
    }
  }

  updateMyClassLink(user);

  if (!logoutHandler) {
    logoutHandler = async (e) => {
      if (!isLoggingOut) {
        isLoggingOut = true;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        try {
          await signOut(auth);

          const navUl = document.querySelector(".grit-nav > ul");
          const menuToggle = document.getElementById("menuToggle");
          const body = document.body;

          if (navUl?.classList.contains("open")) {
            navUl.classList.remove("open");
            if (menuToggle) {
              menuToggle.classList.remove("active");
              menuToggle.setAttribute("aria-expanded", "false");
            }
            body.classList.remove("nav-open");
          }

          toast.success("로그아웃 되었습니다.", 2000);
          setTimeout(() => {
            window.location.href = "/";
          }, 500);
        } catch (error) {
          isLoggingOut = false;
          console.error("로그아웃 실패:", error);
          alert("로그아웃 중 오류가 발생했습니다.");
        }
      }
    };
  }

  if (logoutBtn) {
    const existingHandler = logoutHandlers.get(logoutBtn);
    if (existingHandler) {
      logoutBtn.removeEventListener("click", existingHandler);
    }
    logoutHandlers.set(logoutBtn, logoutHandler);
    logoutBtn.addEventListener("click", logoutHandler, true);
  }

  if (logoutBtnMobile) {
    const existingHandler = logoutHandlers.get(logoutBtnMobile);
    if (existingHandler) {
      logoutBtnMobile.removeEventListener("click", existingHandler);
    }
    logoutHandlers.set(logoutBtnMobile, logoutHandler);
    logoutBtnMobile.addEventListener("click", logoutHandler, true);
  }
}

let isLoggedIn = false;

function initRequiresLogin() {
  const requiresLoginLinks = document.querySelectorAll(".requires-login");

  if (requiresLoginLinks.length !== 0) {
    requiresLoginLinks.forEach((link, index) => {
      const existingHandler = requiresLoginHandlers.get(link);
      if (existingHandler) {
        link.removeEventListener("click", existingHandler, true);
        link.removeEventListener("click", existingHandler, false);
      }

      const handler = (e) => {
        if (auth.currentUser === null) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          const href = link.getAttribute("href");
          toast.warning("로그인이 필요합니다.", 2000);
          setTimeout(() => {
            window.location.href = "/members/login.html";
          }, 1000);
          return false;
        }
      };

      link.addEventListener("click", handler, true);
      requiresLoginHandlers.set(link, handler);
    });
  }
}

async function loadInclude(element) {
  const includeType = element.getAttribute("data-include");
  if (!includeType) return;

  if (element.innerHTML.trim().length > 0) {
    if (includeType === "header") {
      initMobileMenu();
      setTimeout(() => {
        initTheme();
      }, 50);
      updateAuthMenu(auth.currentUser);
      initRequiresLogin();
    } else if (includeType === "footer") {
      setTimeout(() => {
        initScrollToTop();
        initTheme();
        initFooterSettings();
      }, 100);
    }
  } else {
    try {
      const response = await fetch(withBuildVersion(`/assets/partials/${includeType}.html`));
      if (!response.ok) {
        console.warn(`Failed to load ${includeType}.html: ${response.statusText}`);
        return;
      }

      const html = await response.text();
      element.innerHTML = html;

      if (includeType === "header") {
        initMobileMenu();
        setTimeout(() => {
          initTheme();
        }, 50);
        updateAuthMenu(auth.currentUser);
        initRequiresLogin();
        setTimeout(() => {
          if (document.querySelectorAll(".requires-login").length > 0) {
            initRequiresLogin();
          }
        }, 200);
      } else if (includeType === "footer") {
        setTimeout(() => {
          initScrollToTop();
          initTheme();
          initFooterSettings();
        }, 100);
      }
    } catch (error) {
      console.error(`Error loading ${includeType}.html:`, error);
    }
  }
}

const mobileMenuInitialized = new WeakSet();

/** 이전 모바일 메뉴에서 등록한 resize / nav 관찰자 (헤더 DOM 교체 시 누수 방지) */
let mobileMenuResizeHandler = null;
let navOpenClassObserver = null;

let headerRebindScheduled = false;

/** 인라인 스크립트 등으로 헤더 HTML이 나중에 덮어씌워져도 햄버거/테마/로그인 UI를 다시 붙인다 */
function scheduleHeaderRebind() {
  if (headerRebindScheduled) return;
  headerRebindScheduled = true;
  queueMicrotask(() => {
    headerRebindScheduled = false;
    if (!document.getElementById("menuToggle")) return;
    initMobileMenu();
    initTheme();
    updateAuthMenu(auth.currentUser);
    initRequiresLogin();
  });
}

function setupHeaderIncludeObserver() {
  const host = document.querySelector('[data-include="header"]');
  if (!host || host.dataset.gritHeaderBound === "1") return;
  host.dataset.gritHeaderBound = "1";
  const mo = new MutationObserver(() => {
    scheduleHeaderRebind();
  });
  mo.observe(host, { childList: true, subtree: true });
}

function initMobileMenu() {
  const menuToggle = document.getElementById("menuToggle");
  const navUl = document.querySelector(".grit-nav > ul");
  const body = document.body;

  if (!menuToggle || !navUl || mobileMenuInitialized.has(menuToggle)) {
    return;
  }

  mobileMenuInitialized.add(menuToggle);

  if (mobileMenuResizeHandler) {
    window.removeEventListener("resize", mobileMenuResizeHandler);
    mobileMenuResizeHandler = null;
  }
  if (navOpenClassObserver) {
    navOpenClassObserver.disconnect();
    navOpenClassObserver = null;
  }

  function createMobileAuthSlot() {
    const existingSlot = navUl.querySelector(".only-mobile.auth-slot");
    if (existingSlot) {
      existingSlot.remove();
    }

    document.getElementById("menu-login");
    document.getElementById("menu-logout");

    const authSlot = document.createElement("li");
    authSlot.className = "only-mobile auth-slot";

    const loginLink = document.createElement("a");
    loginLink.href = "/members/login.html";
    loginLink.className = "toplink";
    loginLink.id = "menu-login-mobile";
    loginLink.setAttribute("data-auth", "login");
    loginLink.textContent = "로그인";

    const logoutLink = document.createElement("a");
    logoutLink.href = "#";
    logoutLink.className = "toplink";
    logoutLink.id = "menu-logout-mobile";
    logoutLink.setAttribute("data-auth", "logout");
    logoutLink.textContent = "로그아웃";

    authSlot.appendChild(loginLink);
    authSlot.appendChild(logoutLink);
    navUl.insertBefore(authSlot, navUl.firstChild);
    updateAuthMenu(auth.currentUser);
  }

  function handleResize() {
    if (window.innerWidth <= 1440) {
      menuToggle.style.display = "flex";
      if (!navUl.querySelector(".only-mobile.auth-slot")) {
        createMobileAuthSlot();
      }
    } else {
      menuToggle.style.display = "none";
      navUl.classList.remove("open");
      menuToggle.classList.remove("active");
      menuToggle.setAttribute("aria-expanded", "false");
      body.classList.remove("nav-open");

      const authSlot = navUl.querySelector(".only-mobile.auth-slot");
      if (authSlot) {
        authSlot.remove();
      }
    }
  }

  function closeMobileNav() {
    navUl.classList.remove("open");
    menuToggle.classList.remove("active");
    menuToggle.setAttribute("aria-expanded", "false");
    body.classList.remove("nav-open");
    navUl.querySelectorAll("li.has-sub").forEach((subLi) => {
      subLi.removeAttribute("data-open");
      const subLink = subLi.querySelector("a.toplink");
      if (subLink) subLink.setAttribute("aria-expanded", "false");
    });
  }

  function shouldUseMobileNav() {
    return window.innerWidth <= 1440;
  }

  function handleMobileNavLinkNavigate(link) {
    if (!shouldUseMobileNav()) return;
    const href = (link.getAttribute("href") || "").trim();
    if (!href || href === "#") return;
    closeMobileNav();
  }

  function setupMenuItems() {
    navUl
      .querySelectorAll("li:not(.only-mobile.auth-slot)")
      .forEach((li) => {
        const link = li.querySelector("a.toplink");
        if (!link) return;

        if (link.classList.contains("requires-login")) {
          return;
        }

        const clonedLink = link.cloneNode(true);
        link.parentNode.replaceChild(clonedLink, link);

        if (li.classList.contains("has-sub")) {
          clonedLink.addEventListener("click", (e) => {
            if (!shouldUseMobileNav()) return;
            e.preventDefault();
            e.stopPropagation();

            const isOpen = li.getAttribute("data-open") === "true";

            navUl.querySelectorAll("li.has-sub").forEach((subLi) => {
              if (subLi !== li) {
                subLi.removeAttribute("data-open");
                const subLink = subLi.querySelector("a");
                if (subLink) {
                  subLink.setAttribute("aria-expanded", "false");
                }
              }
            });

            if (isOpen) {
              li.removeAttribute("data-open");
              clonedLink.setAttribute("aria-expanded", "false");
            } else {
              li.setAttribute("data-open", "true");
              clonedLink.setAttribute("aria-expanded", "true");
            }
          });
        } else {
          clonedLink.addEventListener("click", () => {
            handleMobileNavLinkNavigate(clonedLink);
            navUl.querySelectorAll("a.toplink").forEach((a) => {
              a.classList.remove("is-active");
            });
            clonedLink.classList.add("is-active");
          });
        }
      });

    navUl.querySelectorAll(".submenu a").forEach((subLink) => {
      const clonedSubLink = subLink.cloneNode(true);
      subLink.parentNode.replaceChild(clonedSubLink, subLink);
      clonedSubLink.addEventListener("click", () => {
        handleMobileNavLinkNavigate(clonedSubLink);
        navUl.querySelectorAll("a.toplink").forEach((link) => {
          link.classList.remove("is-active");
        });

        const parentLink = clonedSubLink
          .closest("li.has-sub")
          ?.querySelector("a.toplink");
        if (parentLink) {
          parentLink.classList.add("is-active");
        }
      });
    });
  }

  function isMyClassPath(pathname) {
    return (
      pathname === "/members/dashboard.html" ||
      pathname.startsWith("/members/students/") ||
      pathname.startsWith("/members/instructors/") ||
      pathname.startsWith("/members/admin/")
    );
  }

  function setActiveMenu() {
    const currentPath = window.location.pathname;
    const topLinks = navUl.querySelectorAll("a.toplink");
    const subLinks = navUl.querySelectorAll(".submenu a");

    topLinks.forEach((link) => {
      link.classList.remove("is-active");
    });

    let found = false;

    if (isMyClassPath(currentPath)) {
      const myClassLink = navUl.querySelector("#menu-myclass");
      if (myClassLink) {
        myClassLink.classList.add("is-active");
        found = true;
      }
    }

    subLinks.forEach((subLink) => {
      const href = subLink.getAttribute("href");
      if (href) {
        const path = href.split("#")[0];
        if (currentPath === path || currentPath.endsWith(path)) {
          found = true;
          const parentLink = subLink
            .closest("li.has-sub")
            ?.querySelector("a.toplink");
          if (parentLink) {
            parentLink.classList.add("is-active");
            const parentLi = subLink.closest("li.has-sub");
            if (parentLi) {
              parentLi.setAttribute("data-open", "true");
              parentLink.setAttribute("aria-expanded", "true");
            }
          }
        }
      }
    });

    if (!found) {
      topLinks.forEach((link) => {
        const href = link.getAttribute("href");
        if (href) {
          const path = href.split("#")[0];
          if (
            currentPath === path ||
            currentPath.endsWith(path) ||
            (path !== "/" &&
              currentPath.includes(path.replace(/^\//, "").replace(".html", "")))
          ) {
            link.classList.add("is-active");
            const parentLi = link.closest("li.has-sub");
            if (parentLi) {
              parentLi.setAttribute("data-open", "true");
              link.setAttribute("aria-expanded", "true");
            }
          }
        }
      });
    }
  }

  if (menuToggle && navUl) {
    handleResize();
    mobileMenuResizeHandler = handleResize;
    window.addEventListener("resize", mobileMenuResizeHandler);

    menuToggle.addEventListener("click", () => {
      if (navUl.classList.contains("open")) {
        closeMobileNav();
      } else {
        if (window.innerWidth <= 1440 && !navUl.querySelector(".only-mobile.auth-slot")) {
          createMobileAuthSlot();
        }
        navUl.classList.add("open");
        menuToggle.classList.add("active");
        menuToggle.setAttribute("aria-expanded", "true");
        body.classList.add("nav-open");
        setTimeout(() => {
          initRequiresLogin();
        }, 50);
      }
    });

    document.addEventListener(
      "click",
      (event) => {
        if (!navUl.classList.contains("open")) return;
        if (event.target.closest(".grit-nav")) return;
        if (event.target.closest("#menuToggle")) return;
        closeMobileNav();
      },
      true
    );

    setTimeout(() => {
      setupMenuItems();
      setActiveMenu();
      initRequiresLogin();
    }, 200);

    navOpenClassObserver = new MutationObserver(() => {
      if (navUl.classList.contains("open")) {
        setupMenuItems();
        setActiveMenu();
        setTimeout(() => {
          initRequiresLogin();
        }, 50);
      }
    });
    navOpenClassObserver.observe(navUl, {
      attributes: true,
      attributeFilter: ["class"]
    });
  }
}

function initIncludes() {
  document.querySelectorAll("[data-include]").forEach(loadInclude);

  function checkAndInitHeader() {
    const headerElement = document.querySelector('[data-include="header"]');
    if (headerElement && headerElement.innerHTML.trim().length > 0) {
      const menuToggle = document.getElementById("menuToggle");
      const navUl = document.querySelector(".grit-nav > ul");

      if (
        menuToggle &&
        navUl &&
        !menuToggle.hasAttribute("data-initialized")
      ) {
        setTimeout(() => {
          initMobileMenu();
          setTimeout(() => {
            initTheme();
          }, 50);
          updateAuthMenu(auth.currentUser);
          initRequiresLogin();
          menuToggle.setAttribute("data-initialized", "true");
        }, 100);
      } else if (!menuToggle || !navUl) {
        setTimeout(checkAndInitHeader, 50);
      }
    }
  }

  setTimeout(checkAndInitHeader, 200);
}

function initScrollToTop() {
  const goTopBtn = document.getElementById("goTop");

  function updateVisibility() {
    if (window.scrollY > 300) {
      goTopBtn.classList.add("visible");
    } else {
      goTopBtn.classList.remove("visible");
    }
  }

  if (goTopBtn) {
    goTopBtn.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    window.addEventListener("scroll", updateVisibility, { passive: true });
    updateVisibility();
  }
}

function initScrollToTopAfterFooter() {
  if (document.querySelector(".grit-footer")) {
    initScrollToTop();
  } else {
    setTimeout(initScrollToTopAfterFooter, 100);
  }
}

onAuthStateChanged(auth, (user) => {
  isLoggedIn = user !== null;
  updateAuthMenu(user);
  setTimeout(() => {
    if (document.querySelector(".requires-login")) {
      initRequiresLogin();
    }
  }, 50);
});

isLoggedIn = auth.currentUser !== null;

if (!isLoggedIn) {
  document.body.classList.add("logged-out");
  document.body.classList.remove("logged-in");
}

function bootstrapCommonUi() {
  initIncludes();
  setupHeaderIncludeObserver();
  initKakaoChannelFloatingButton();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrapCommonUi);
} else {
  bootstrapCommonUi();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    setTimeout(initScrollToTopAfterFooter, 200);
  });
} else {
  setTimeout(initScrollToTopAfterFooter, 200);
}

export { applyTheme, toggleTheme };
