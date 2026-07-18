// /assets/js/utils/page-content.js
// Firestore에서 페이지 콘텐츠 자동 로드 (공통 유틸리티)
import { app } from "/assets/js/firebase-init.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

const db = getFirestore(app);
const slug = location.pathname.split("/").pop().replace(".html","") || "index";
const wrap = document.querySelector("main");

if (wrap) {
  (async () => {
    try {
      const snap = await getDoc(doc(db,"pages",slug));
      if (snap.exists()) {
        const data = snap.data();
        wrap.insertAdjacentHTML("beforeend", data.body || "");
      }
    } catch(e){ 
      console.warn("페이지 콘텐츠 로드 실패:", e); 
    }
  })();
}

