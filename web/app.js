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
  const ocrModal = document.getElementById("ocr-modal");
  const ocrModalTitle = document.getElementById("ocr-modal-title");
  const ocrModalText = document.getElementById("ocr-modal-text");
  let ocrReadyPromise = null;

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

  function showOcrModal(title, text) {
    if (!ocrModal) {
      return;
    }
    if (ocrModalTitle) {
      ocrModalTitle.textContent = title;
    }
    if (ocrModalText) {
      ocrModalText.textContent = text;
    }
    ocrModal.classList.add("is-visible");
    ocrModal.setAttribute("aria-hidden", "false");
  }

  function hideOcrModal() {
    if (!ocrModal) {
      return;
    }
    ocrModal.classList.remove("is-visible");
    ocrModal.setAttribute("aria-hidden", "true");
  }

  function normalizeConfidence(value) {
    const label = String(value || "").trim().toLowerCase();
    if (label === "low" || label === "medium" || label === "high") {
      return label;
    }
    return "unknown";
  }

  function confidenceToScore(record) {
    const label = normalizeConfidence(record?.confidence);
    const labelScores = {
      low: 34,
      medium: 66,
      high: 92,
    };

    if (label in labelScores) {
      return labelScores[label];
    }

    const flagCount = Number(record?.flag_count);
    if (Number.isFinite(flagCount)) {
      return Math.max(22, Math.min(94, 28 + flagCount * 12));
    }

    return 40;
  }

  function formatUpdatedAt(value) {
    if (value === null || value === undefined || value === "") {
      return "Unknown";
    }

    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return String(value);
    }

    const milliseconds = numericValue < 1e12 ? numericValue * 1000 : numericValue;
    const date = new Date(milliseconds);

    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  }

  async function prepareOcrModels() {
    if (!window.eel || !window.eel.ensure_ocr_ready) {
      return;
    }

    showOcrModal(
      "OCR setup",
      "App launched. Checking assets/ocr for EasyOCR models."
    );

    await new Promise((resolve) => requestAnimationFrame(resolve));

    showOcrModal(
      "Installing OCR models",
      "EasyOCR is preparing its files in assets/ocr. This only happens once."
    );

    await new Promise((resolve) => requestAnimationFrame(resolve));

    try {
      const result = await eel.ensure_ocr_ready()();

      if (result?.installed) {
        showOcrModal(
          "OCR install complete",
          "EasyOCR models were installed into assets/ocr and cached for next time."
        );
        setStatus(result?.message || "OCR models installed.");
        setTimeout(() => {
          hideOcrModal();
        }, 1800);
        return;
      }

      showOcrModal(
        "OCR ready",
        "EasyOCR models were already present in assets/ocr."
      );
      setStatus(result?.message || "OCR ready.");
      setTimeout(() => {
        hideOcrModal();
      }, 1000);
    } catch (error) {
      console.error(error);
      showOcrModal(
        "OCR setup failed",
        "EasyOCR could not be prepared. Check the backend console for details."
      );
      setStatus("OCR setup failed.");
      setTimeout(() => {
        hideOcrModal();
      }, 1800);
    }
  }

  function startOcrSetup() {
    if (!ocrReadyPromise) {
      ocrReadyPromise = prepareOcrModels();
    }
    return ocrReadyPromise;
  }

  function renderConfidencePreview({
    title = "Waiting for input",
    meta = "Drop an image or snip the leaderboard to preview results.",
    confidenceText = "0%",
    sourceText = "No sources",
    extraText = "Preview only",
    fillWidth = "0%",
    cardClass = "confidence-card--empty",
    fillClass = "confidence-meter-fill--neutral",
  } = {}) {
    if (!detectedServers) {
      return;
    }

    detectedServers.innerHTML = `
      <article class="confidence-card ${cardClass}">
        <div class="confidence-card-top">
          <div>
            <p class="confidence-card-name">${title}</p>
            <p class="confidence-card-meta">${meta}</p>
          </div>
          <span class="confidence-pill">${confidenceText}</span>
        </div>
        <div class="confidence-meter" aria-hidden="true">
          <span class="confidence-meter-fill ${fillClass}" style="width: ${fillWidth}"></span>
        </div>
        <div class="confidence-facts">
          <span>${sourceText}</span>
          <span>${extraText}</span>
        </div>
      </article>
    `;
  }

  function renderLookupResults(firebaseUsers) {
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

    const usernames = Object.keys(firebaseUsers || {});
    if (usernames.length === 0) {
      resultsLine.textContent = "Detected autobuilders: none found.";
      renderConfidencePreview({
        title: "No match found",
        meta: "The scan did not find any matching Roblox IDs.",
        confidenceText: "0%",
        sourceText: "No sources",
        extraText: "Waiting for input",
      });
      return;
    }

    resultsLine.textContent = `Detected autobuilders: ${usernames.join(", ")}`;
    detectedServers.innerHTML = usernames
      .map((username) => {
        const record = firebaseUsers[username] || {};
        const confidenceLabel = normalizeConfidence(record.confidence);
        const confidenceScore = confidenceToScore(record);
        const flagCountValue = Number(record.flag_count);
        const flagCountText = Number.isFinite(flagCountValue)
          ? `${flagCountValue} flag${flagCountValue === 1 ? "" : "s"}`
          : "Flag count unavailable";
        const updatedText = formatUpdatedAt(record.last_updated);
        const robloxIdText = record.roblox_id
          ? `Roblox ID ${record.roblox_id}`
          : "Roblox ID unavailable";
        const confidenceText = confidenceLabel === "unknown"
          ? "Unknown"
          : confidenceLabel.charAt(0).toUpperCase() + confidenceLabel.slice(1);
        return `
          <article class="confidence-card confidence-card--${escapeHtml(confidenceLabel)}">
            <div class="confidence-card-top">
              <div>
                <p class="confidence-card-name">${escapeHtml(username)}</p>
                <p class="confidence-card-meta">${escapeHtml(robloxIdText)}</p>
              </div>
              <span class="confidence-pill">${escapeHtml(confidenceText)}</span>
            </div>
            <div class="confidence-meter" aria-hidden="true">
              <span class="confidence-meter-fill" style="width: ${confidenceScore}%"></span>
            </div>
            <div class="confidence-facts">
              <span>${escapeHtml(flagCountText)}</span>
              <span>Updated ${escapeHtml(updatedText)}</span>
            </div>
          </article>
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
      renderLookupResults(result?.firebase_users || result?.firebase_matches);
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

  renderConfidencePreview();
  setTimeout(() => {
    startOcrSetup();
  }, 250);
})();
