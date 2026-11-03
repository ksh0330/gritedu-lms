import { db } from "/assets/js/firebase-init.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { showAdminToast } from "/assets/js/utils/admin-toast.js";
import {
  STORY_V2_DEFAULTS,
  isStoryV2Document,
  fillStoryV2Form,
  readStoryV2FromForm,
  validateStoryV2ForSave,
  buildStoryV2FirestorePayload,
} from "/assets/js/utils/story-page.js";

const $ = (selector, root = document) => root.querySelector(selector);

function toast(msg, err = false) {
  showAdminToast(msg, err);
}

export async function loadStoryContent() {
  try {
    const pageDoc = await getDoc(doc(db, "pages", "story"));
    const data = pageDoc.exists() ? pageDoc.data() : {};
    const initial = isStoryV2Document(data) ? data : STORY_V2_DEFAULTS;
    fillStoryV2Form(initial, document);
  } catch (error) {
    console.error("학원 안내 콘텐츠 로드 실패:", error);
    fillStoryV2Form(STORY_V2_DEFAULTS, document);
    toast(`콘텐츠 로드 실패: ${error.message}`, true);
  }
}

export async function saveStoryContent() {
  try {
    const formData = readStoryV2FromForm(document);
    const validation = validateStoryV2ForSave(formData);
    if (!validation.ok) {
      toast(validation.errors.join(" "), true);
      return;
    }
    const payload = buildStoryV2FirestorePayload(formData);
    await setDoc(
      doc(db, "pages", "story"),
      {
        ...payload,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    toast("저장되었습니다.");
  } catch (error) {
    console.error("학원 안내 콘텐츠 저장 실패:", error);
    toast(`저장 실패: ${error.message}`, true);
  }
}

window.saveStoryContent = saveStoryContent;
