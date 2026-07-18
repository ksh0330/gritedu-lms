import {
  loadStudentProfile,
  saveStudentMarketingConsent,
  saveStudentProfile
} from "/assets/js/utils/student-profile.js";
import { dom, state, toast } from "/assets/js/pages/student-dashboard/context.js";
import { setWelcomeMessage } from "/assets/js/pages/student-dashboard/settings.js";
import { normalizeGrade } from "/assets/js/utils/grade.js";

export function setupProfileModalHandlers() {
  if (dom.editProfileBtn) {
    dom.editProfileBtn.addEventListener("click", async () => {
      try {
        const userData = await loadStudentProfile(state.user?.uid);
        if (userData) {
          const editName = document.getElementById("editName");
          const editPhone = document.getElementById("editPhone");
          const editGrade = document.getElementById("editGrade");
          if (editName) editName.value = userData.name || "";
          if (editPhone) editPhone.value = userData.phone || "";
          if (editGrade) editGrade.value = normalizeGrade(userData.grade);
        }
        if (dom.editProfileModal) dom.editProfileModal.style.display = "flex";
      } catch (error) {
        console.error("사용자 정보 로드 실패:", error);
        if (dom.editProfileStatus) {
          dom.editProfileStatus.textContent = "사용자 정보를 불러오는 중 오류가 발생했습니다.";
          dom.editProfileStatus.style.color = "var(--error-color)";
        }
      }
    });
  }

  if (dom.closeEditProfileModal) {
    const closeProfileModal = () => {
      if (dom.editProfileModal) dom.editProfileModal.style.display = "none";
      if (dom.editProfileForm) dom.editProfileForm.reset();
      if (dom.editProfileStatus) dom.editProfileStatus.textContent = "";
    };
    dom.closeEditProfileModal.addEventListener("click", closeProfileModal);
    document.getElementById("cancelEditProfileBtn")?.addEventListener("click", closeProfileModal);
  }

  if (dom.editProfileForm) {
    dom.editProfileForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!dom.editProfileForm || !state.user?.uid) return;

      if (dom.editProfileStatus) dom.editProfileStatus.textContent = "";

      const formData = new FormData(dom.editProfileForm);
      const name = formData.get("name")?.trim() || "";
      const phone = formData.get("phone")?.trim() || "";
      const grade = normalizeGrade(formData.get("grade"));

      if (!name || !phone || !grade) {
        if (dom.editProfileStatus) {
          dom.editProfileStatus.textContent = "이름, 연락처, 학년은 필수 입력 항목입니다.";
          dom.editProfileStatus.style.color = "var(--error-color)";
        }
        return;
      }

      try {
        await saveStudentProfile(state.user.uid, {
          name,
          phone,
          grade,
          email: state.user?.email || "",
          gradeManualOverride: true
        });

        if (dom.editProfileModal) dom.editProfileModal.style.display = "none";
        dom.editProfileForm.reset();
        if (dom.editProfileStatus) dom.editProfileStatus.textContent = "";
        toast("정보가 저장되었습니다.", false);
        await setWelcomeMessage();
      } catch (error) {
        console.error("개인정보 수정 실패:", error);
        toast("저장 중 문제가 발생했습니다. 다시 시도해 주세요.", true);
      }
    });
  }

  if (dom.editProfileModal) {
    dom.editProfileModal.addEventListener("click", (e) => {
      if (e.target === dom.editProfileModal) {
        dom.editProfileModal.style.display = "none";
      }
    });
  }

  setupMarketingConsentModalHandlers();
  setupAccountDeletionModalHandlers();
}

function setupAccountDeletionModalHandlers() {
  const openButton = document.getElementById("openStudentAccountDeletionBtn");
  const modal = document.getElementById("studentAccountDeletionModal");
  const closeButton = document.getElementById("closeStudentAccountDeletionModal");
  if (!openButton || !modal) return;

  const close = () => {
    modal.style.display = "none";
    document.body.classList.remove("modal-open");
  };

  openButton.addEventListener("click", () => {
    modal.style.display = "flex";
    document.body.classList.add("modal-open");
    closeButton?.focus();
  });
  closeButton?.addEventListener("click", close);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal.style.display !== "none") close();
  });
}

function isMarketingConsentEnabled(consent = {}) {
  return consent?.sms === true && consent?.email === true;
}

function setupMarketingConsentModalHandlers() {
  const openButton = document.getElementById("openStudentMarketingConsentBtn");
  const modal = document.getElementById("studentMarketingConsentModal");
  const form = document.getElementById("studentMarketingConsentForm");
  const input = document.getElementById("studentMarketingConsentInput");
  const closeButton = document.getElementById("closeStudentMarketingConsentModal");
  const cancelButton = document.getElementById("cancelStudentMarketingConsentBtn");
  const saveButton = form?.querySelector('button[type="submit"]');
  if (!openButton || !modal || !form || !input) return;

  const close = () => {
    modal.style.display = "none";
    if (saveButton) saveButton.disabled = false;
  };

  openButton.addEventListener("click", async () => {
    try {
      const profile = await loadStudentProfile(state.user?.uid);
      input.checked = isMarketingConsentEnabled(profile?.marketingConsent || {});
      modal.style.display = "flex";
    } catch (error) {
      console.error("광고성 정보 수신 설정 로드 실패:", error);
      toast("저장 중 문제가 발생했습니다. 다시 시도하거나 학원으로 문의해 주세요.", true);
    }
  });

  closeButton?.addEventListener("click", close);
  cancelButton?.addEventListener("click", close);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) close();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (saveButton) saveButton.disabled = true;

    try {
      const result = await saveStudentMarketingConsent(state.user?.uid, input.checked === true);
      toast(result?.changed === false ? "변경된 내용이 없습니다." : "광고성 정보 수신 설정을 저장했습니다.", false);
      close();
    } catch (error) {
      console.error("광고성 정보 수신 설정 저장 실패:", error);
      const message = error?.code === "marketing-consent-limit"
        ? "광고성 정보 수신 설정은 하루 최대 3회까지 변경할 수 있습니다. 필요하면 학원으로 문의해 주세요."
        : "저장 중 문제가 발생했습니다. 다시 시도해 주세요.";
      toast(message, true);
      if (saveButton) saveButton.disabled = false;
    }
  });
}
