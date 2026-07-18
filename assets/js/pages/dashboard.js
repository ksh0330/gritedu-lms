import { auth, getUserRole, getDashboardUrl, getCurrentUserWithWait } from "/assets/js/firebase-init.js";

(async () => {
  const user = await getCurrentUserWithWait(3000);

  if (!user) {
    window.location.replace("/members/login.html");
    return;
  }

  const role = await getUserRole(user);
  if (role) {
    window.location.replace(getDashboardUrl(role));
    return;
  }

  window.location.replace("/");
})();
