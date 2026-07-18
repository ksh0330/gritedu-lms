import { db } from "/assets/js/firebase-init.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

const LABELS = {
  academy: "학원정보조회",
  fee: "교습비",
  refund: "환불규정",
};

function validUrls(value) {
  return Array.isArray(value)
    ? value.map((url) => String(url || "").trim()).filter((url) => /^https:\/\/assets\.gritedu\.kr\/public\/footer\/[\w./-]+\.(?:jpe?g|png|webp)$/i.test(url))
    : [];
}

async function loadTuitionImages() {
  try {
    const snapshot = await getDoc(doc(db, "settings", "tuitionImages"));
    const data = snapshot.exists() ? snapshot.data() : {};
    document.querySelectorAll("[data-tuition-gallery]").forEach((root) => {
      const section = root.dataset.tuitionGallery;
      const urls = validUrls(data[section]);
      root.classList.toggle("tuition-image-gallery", urls.length > 0);
      root.innerHTML = urls.length ? urls.map((url, index) => {
        const image = document.createElement("img");
        image.src = url;
        image.alt = `${LABELS[section]} ${index + 1}페이지`;
        image.loading = index === 0 ? "eager" : "lazy";
        image.decoding = "async";
        return image.outerHTML;
      }).join("") : `<p class="tuition-gallery-status">등록된 ${LABELS[section]} 이미지가 없습니다.</p>`;
    });
  } catch (error) {
    console.warn("교습비 안내 이미지를 불러오지 못했습니다.", error);
    document.querySelectorAll("[data-tuition-gallery]").forEach((root) => {
      root.innerHTML = '<p class="tuition-gallery-status tuition-gallery-status--error">이미지를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>';
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", loadTuitionImages, { once: true });
} else {
  loadTuitionImages();
}
