(function () {
  const DESIGN_WIDTH = 1280;
  const DESIGN_HEIGHT = 720;

  const screenElements = document.querySelectorAll(".app-screen");
  const sidebarNavButtons = document.querySelectorAll(".sidebar-nav-button");
  const openScannerButton = document.getElementById("open-scanner-button");
  const backToHomeButton = document.getElementById("back-to-home-button");
  const uploadButton = document.getElementById("upload-button");
  const captureButton = document.getElementById("capture-button");
  const uploadInput = document.getElementById("upload-input");
  const uploadZone = document.getElementById("upload-zone");
  const uploadStatus = document.getElementById("upload-status");
  const uploadPreview = document.getElementById("upload-preview");
  const uploadPreviewContainer = document.getElementById("upload-preview-container");
  const resultsLine = document.getElementById("results-line");
  const detectedServers = document.getElementById("detected-servers");

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

  function setStatus(text) {
    if (uploadStatus) {
      uploadStatus.textContent = text;
    }
  }

  function showPreview(dataUrl) {
    if (!uploadPreview || !uploadPreviewContainer) {
      return;
    }
    uploadPreview.src = dataUrl;
    uploadPreviewContainer.classList.add("is-visible");
    uploadPreviewContainer.classList.remove("is-empty");
  }

  function hidePreview() {
    if (!uploadPreview || !uploadPreviewContainer) {
      return;
    }
    uploadPreview.src = "";
    uploadPreviewContainer.classList.remove("is-visible");
    uploadPreviewContainer.classList.add("is-empty");
  }

  function renderLookupResults(firebaseMatches) {
    if (!resultsLine || !detectedServers) {
      return;
    }

    const escapeHtml = (value) =>
      String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");

    const usernames = Object.keys(firebaseMatches || {});
    if (usernames.length === 0) {
      resultsLine.textContent = "Detected autobuilders: none found in Firebase.";
      detectedServers.innerHTML = `
        <div class="server-confidence-block">
          <div class="score-row">
            <span>No server matches</span>
            <span class="confidence-percent">0%</span>
          </div>
          <div class="confidence-bar">
            <span class="confidence-bar-fill" style="width: 0%"></span>
          </div>
        </div>
      `;
      return;
    }

    resultsLine.textContent = `Detected autobuilders: ${usernames.join(", ")}`;
    detectedServers.innerHTML = usernames
      .map((username, index) => {
        const servers = firebaseMatches[username] || [];
        const serverList = Array.isArray(servers) ? servers.join(", ") : String(servers);
        const confidence = Math.max(20, 100 - index * 10);
        return `
          <div class="server-confidence-block">
            <div class="score-row">
              <span>${escapeHtml(username)}</span>
              <span class="confidence-percent">${confidence}%</span>
            </div>
            <div class="confidence-bar">
              <span class="confidence-bar-fill" style="width: ${confidence}%"></span>
            </div>
            <p class="text-block text-muted text-small">${escapeHtml(serverList)}</p>
          </div>
        `;
      })
      .join("");
  }

  async function captureRegion() {
    setStatus("Snipping selected area...");

    if (!window.eel) {
      setStatus("Eel bridge is not available.");
      return;
    }

    try {
      const result = await eel.capture_snip()();
      const dataUrl = result?.image_data;

      if (!dataUrl) {
        setStatus(
          result?.error || "Capture failed. Make sure the snipping package is installed."
        );
        return;
      }

      showPreview(dataUrl);
      renderLookupResults(result?.firebase_matches);
      callPythonUpload();
      setStatus("Snip ready.");
    } catch (error) {
      console.error(error);
      setStatus("Snipping failed; try again.");
    }
  }

  async function callPythonUpload() {
    if (!window.eel) {
      setStatus("Eel bridge is not available.");
      return;
    }

    setStatus("Registering upload with Python...");

    try {
      const result = await eel.handle_upload_click()();
      setStatus(result?.message || "Upload registered with Python.");
    } catch (error) {
      setStatus("Python call failed. Check backend/main.py.");
      console.error(error);
    }
  }

  function handleFile(file) {
    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      hidePreview();
      setStatus("Please drop an image file.");
      return;
    }

    hidePreview();
    setStatus("Reading image...");

    const reader = new FileReader();
    reader.onload = () => {
      showPreview(reader.result);
      callPythonUpload();
    };

    reader.onerror = () => {
      setStatus("Unable to read the image file.");
    };

    reader.readAsDataURL(file);
  }

  sidebarNavButtons.forEach((btn) => {
    btn.addEventListener("click", () => showScreen(btn.dataset.screen));
  });
  openScannerButton?.addEventListener("click", () => showScreen("scanner"));
  backToHomeButton?.addEventListener("click", () => showScreen("home"));

  uploadButton?.addEventListener("click", () => {
    uploadInput?.click();
  });

  captureButton?.addEventListener("click", captureRegion);

  uploadInput?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) {
      handleFile(file);
    }
    event.target.value = "";
  });

  uploadZone?.addEventListener("dragover", (event) => {
    event.preventDefault();
    uploadZone.classList.add("is-dragover");
  });

  uploadZone?.addEventListener("dragleave", () => {
    uploadZone.classList.remove("is-dragover");
  });

  uploadZone?.addEventListener("drop", (event) => {
    event.preventDefault();
    uploadZone.classList.remove("is-dragover");
    const file = event.dataTransfer?.files?.[0];
    handleFile(file);
  });

  updateViewportScale();
  addEventListener("resize", updateViewportScale);

  try {
    resizeTo(DESIGN_WIDTH, DESIGN_HEIGHT);
  } catch (_) {}
})();
