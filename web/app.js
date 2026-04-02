(function () {
  const DESIGN_WIDTH = 1280;
  const DESIGN_HEIGHT = 720;

  const screenElements = document.querySelectorAll(".app-screen");
  const sidebarNavButtons = document.querySelectorAll(".sidebar-nav-button");
  const openScannerButton = document.getElementById("open-scanner-button");
  const backToHomeButton = document.getElementById("back-to-home-button");

  const screenIdByName = {
    home: "home-screen",
    scanner: "scanner-screen",
  };

  function showScreen(screenName) {
    const targetId = screenIdByName[screenName];
    screenElements.forEach((el) => {
      el.classList.toggle("active", el.id === targetId);
    });
    sidebarNavButtons.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.screen === screenName);
    });
  }

  function updateViewportScale() {
    const scale = Math.min(
      innerWidth / DESIGN_WIDTH,
      innerHeight / DESIGN_HEIGHT
    );
    document.documentElement.style.setProperty("--ui-scale", String(scale));
  }

  sidebarNavButtons.forEach((btn) => {
    btn.addEventListener("click", () => showScreen(btn.dataset.screen));
  });
  openScannerButton?.addEventListener("click", () => showScreen("scanner"));
  backToHomeButton?.addEventListener("click", () => showScreen("home"));

  updateViewportScale();
  addEventListener("resize", updateViewportScale);

  try {
    resizeTo(DESIGN_WIDTH, DESIGN_HEIGHT);
  } catch (_) {}
})();
