// /assets/js/firebase-init.js
// 프로젝트: gritedu-lms (Firebase 콘솔과 동일한 projectId 사용)
// 웹 클라이언트는 아래 firebaseConfig로 연결됨. API 키는 클라이언트용 공개 값이며,
// "환경 변수"로 따로 두지 않아도 동작한다. (Functions의 EMAIL_USER 등은 서버(Functions) Secret — 이 파일과 무관)
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js";
import {
  getAuth, setPersistence, browserLocalPersistence, browserSessionPersistence,
  signOut
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";
import {
  getFirestore
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCYZXuZ5ZGRgSEzvEGfbaUg6ViiyidSVKU",
  authDomain: "gritedu-lms.firebaseapp.com",
  projectId: "gritedu-lms",
  // Storage는 사용하지 않음 (이미지는 로컬 assets 폴더에 저장)
  // storageBucket: "gritedu-lms.appspot.com",
  messagingSenderId: "789104307613",
  appId: "1:789104307613:web:0d6acf64a261a1a86d9374"
};

const app  = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// 기본값: 세션 기반 지속성 (브라우저 탭/창을 닫으면 로그아웃)
const authPersistenceReady = (async () => {
  try {
    await setPersistence(auth, browserSessionPersistence);
  } catch (error) {
    console.warn('[firebase-init] setPersistence 실패:', error);
  }
})();

// persistence 타입 export (다른 모듈에서 필요시 사용)
export { browserLocalPersistence, browserSessionPersistence };

// 역할/권한 관련 유틸은 auth.js에서 단일 소스로 관리
export {
  getUserRole,
  checkRole,
  isAdmin,
  isInstructor,
  isStudent,
  isMember,
  getDashboardUrl,
  getCurrentUserWithWait,
  requireRole,
  guardPage,
} from "/assets/js/utils/auth.js";

export { app, auth, db, signOut, authPersistenceReady };
export default app;
