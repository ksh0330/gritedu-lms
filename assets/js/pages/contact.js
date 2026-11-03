import { app } from "/assets/js/firebase-init.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { escapeHtml } from "/assets/js/utils/html.js";
import {
  CONTACT_PUBLIC_PAGE_TITLE,
  buildContactLeftColumnHTML,
  buildContactLocationPanelHTML,
  migrateLegacyContactStructure,
  normalizeCanonicalContactLocation,
} from "/assets/js/utils/contact-location.js";

const db = getFirestore(app);
const main = document.querySelector("main.contact");

function showSkeleton() {
  const contactContent = document.getElementById("contact-content");
  if (contactContent) {
    contactContent.innerHTML = `
      <div class="skeleton" style="height:300px;border-radius:12px;margin-bottom:20px;"></div>
      <div class="skeleton" style="height:200px;border-radius:12px;"></div>
    `;
    contactContent.style.display = "";
  }
}

function removeSkeleton() {
  const contactContent = document.getElementById("contact-content");
  if (contactContent) {
    const skeletons = contactContent.querySelectorAll(".skeleton");
    skeletons.forEach((skeleton) => skeleton.remove());
  }
}

function getInitialLocationIndex(locations) {
  if (!Array.isArray(locations) || !locations.length) return 0;
  const preferredLabels = ["고등 1관", "고등1관", "1관"];
  for (let i = 0; i < locations.length; i++) {
    const label = String(locations[i]?.label || "").trim();
    if (preferredLabels.includes(label)) return i;
  }
  return 0;
}

function mountLocationTabs(mainEl, contactWrap, contactContent, pageTitle, locations) {
  if (contactWrap) contactWrap.style.display = "none";
  contactContent.style.display = "none";

  const root = document.createElement("div");
  root.className = "contact-wrap";
  root.style.opacity = "0";
  root.style.transition = "opacity 0.3s ease";

  const showTabs = locations.length > 1;
  const initialIndex = getInitialLocationIndex(locations);
  const tabsHtml = showTabs
    ? `<section class="grit-filter contact-location-filter" aria-label="관 선택" data-for="contact-locations">
        <div class="filter-group" id="contactLocationFilterChips">
          ${locations
            .map((loc, i) => {
              const lab = escapeHtml(loc.label || `관 ${i + 1}`);
              const isFirst = i === initialIndex;
              return `<button type="button" class="${isFirst ? "on" : ""}" data-index="${i}" aria-pressed="${isFirst ? "true" : "false"}">${lab}</button>`;
            })
            .join("")}
        </div>
      </section>`
    : "";

  root.innerHTML = `
    <h1 class="page-title">${escapeHtml(pageTitle)}</h1>
    ${tabsHtml}
    <section class="contact-grid" aria-label="상담 정보와 위치 안내">
      <div class="contact-card" id="contact-loc-left"></div>
      <div id="contact-loc-right"></div>
    </section>
  `;

  mainEl.appendChild(root);

  const leftEl = root.querySelector("#contact-loc-left");
  const rightEl = root.querySelector("#contact-loc-right");

  function showIndex(i) {
    const loc = locations[i];
    if (!loc || !leftEl || !rightEl) return;
    leftEl.innerHTML = buildContactLeftColumnHTML(loc);
    rightEl.innerHTML = buildContactLocationPanelHTML(loc);

    if (showTabs) {
      const filterBar = root.querySelector(".contact-location-filter");
      filterBar?.querySelectorAll("button[data-index]").forEach((btn) => {
        const j = parseInt(btn.getAttribute("data-index") || "0", 10);
        const on = j === i;
        btn.classList.toggle("on", on);
        btn.setAttribute("aria-pressed", on ? "true" : "false");
      });
    }
  }

  showIndex(initialIndex);

  if (showTabs) {
    const filterBar = root.querySelector(".contact-location-filter");
    filterBar?.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-index]");
      if (!btn || !filterBar.contains(btn)) return;
      const idx = parseInt(btn.getAttribute("data-index") || "0", 10);
      showIndex(idx);
    });
  }

  requestAnimationFrame(() => {
    root.style.opacity = "1";
  });
}

function showStaticFallback(contactWrap, contactContent) {
  removeSkeleton();
  if (contactWrap) {
    contactWrap.style.display = "";
    contactWrap.style.opacity = "1";
  }
  contactContent.style.display = "none";
}

if (main) {
  const contactWrap = main.querySelector(".contact-wrap");
  const contactContent = document.createElement("div");
  contactContent.id = "contact-content";
  contactContent.className = "contact-content";

  showSkeleton();

  if (contactWrap) {
    contactWrap.style.display = "none";
  }

  main.appendChild(contactContent);

  (async () => {
    try {
      const snap = await getDoc(doc(db, "pages", "contact"));
      if (!snap.exists()) {
        showStaticFallback(contactWrap, contactContent);
        return;
      }

      const data = snap.data();
      const structure = data.structure || {};
      const migrated = migrateLegacyContactStructure(structure);
      const locations = migrated.map(normalizeCanonicalContactLocation);

      if (locations.length > 0) {
        removeSkeleton();
        mountLocationTabs(main, contactWrap, contactContent, CONTACT_PUBLIC_PAGE_TITLE, locations);
        return;
      }

      // migration compatibility only — legacy HTML content before admin canonical save
      const content = String(data.content || "").trim();
      if (content) {
        removeSkeleton();
        contactContent.innerHTML = content;
        contactContent.style.display = "";
        if (contactWrap) {
          contactWrap.style.display = "none";
        }
        return;
      }

      showStaticFallback(contactWrap, contactContent);
    } catch (error) {
      if (error.code !== "permission-denied") {
        console.error("상담문의 콘텐츠 로드 실패:", error);
      }
      showStaticFallback(contactWrap, contactContent);
    }
  })();
}
