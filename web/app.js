//

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
  const reviewCount = document.getElementById("review-count");
  const reviewSummary = document.getElementById("review-summary");
  const reviewMatchCount = document.getElementById("review-match-count");
  const reviewSourceCount = document.getElementById("review-source-count");
  const reviewUpdatedAt = document.getElementById("review-updated-at");
  const reviewTags = document.getElementById("review-tags");
  const reviewStatusBadge = document.getElementById("review-status-badge");
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

  function normalizeTag(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function formatSourceCount(sourceCount) {
    const numericValue = Number(sourceCount);
    if (!Number.isFinite(numericValue) || numericValue < 0) {
      return "Source data unavailable";
    }
    return `${numericValue} source${numericValue === 1 ? "" : "s"}`;
  }

  function updateReviewTags(scan) {
    if (!reviewTags) {
      return;
    }

    const activeTags = new Set(
      (scan?.review_tags || []).map((tag) => normalizeTag(tag))
    );
    const isIdle = scan?.status === "idle";
    const matchedCount = Number(scan?.matched_count) || 0;
    const sourceTotal = Number(scan?.source_total);
    const hasSourceInfo = Number.isFinite(sourceTotal) && sourceTotal > 0;
    const latestUpdateText = scan?.last_updated
      ? formatUpdatedAt(scan.last_updated)
      : "No update timestamp available";

    reviewTags.querySelectorAll(".review-tag").forEach((tagEl) => {
      const tagKey = normalizeTag(tagEl.dataset.tag);
      const textKey = normalizeTag(tagEl.textContent);
      const isLow = tagKey === "low" || textKey.includes("low-confidence");
      const isMedium = tagKey === "medium" || textKey.includes("medium-confidence");
      const isHigh = tagKey === "high" || textKey.includes("high-confidence");

      let isActive = activeTags.has(tagKey) || activeTags.has(textKey);
      if (!isActive && isLow) {
        isActive = !isIdle && !scan?.conversion_error && !hasSourceInfo && matchedCount === 0;
      }
      if (!isActive && isMedium) {
        isActive = !isIdle && !scan?.conversion_error && hasSourceInfo && matchedCount === 0;
      }
      if (!isActive && isHigh) {
        isActive = !isIdle && !scan?.conversion_error && matchedCount > 0 && hasSourceInfo;
      }

      tagEl.classList.toggle("is-active", isActive);

      if (isLow) {
        tagEl.title = scan?.conversion_error
          ? "Could not evaluate confidence because the scan failed."
          : "Weak signal from the database.";
      } else if (isMedium) {
        tagEl.title = scan?.conversion_error
          ? "Could not evaluate confidence because the scan failed."
          : `Mixed signal. Latest update: ${latestUpdateText}.`;
      } else if (isHigh) {
        tagEl.title = scan?.conversion_error
          ? "Could not evaluate confidence because the scan failed."
          : `Strong signal with the clearest match. Latest update: ${latestUpdateText}.`;
      }
    });
  }

  function renderScanSummary(scan = {}, firebaseUsers = {}) {
    if (
      !reviewCount ||
      !reviewSummary ||
      !reviewMatchCount ||
      !reviewSourceCount ||
      !reviewUpdatedAt ||
      !reviewStatusBadge
    ) {
      return;
    }

    const conversionError = String(scan?.conversion_error || "").trim();
    const matchedUsers = Object.keys(firebaseUsers || {});
    const matchedCount = Number(scan?.matched_count);
    const safeMatchedCount = Number.isFinite(matchedCount) ? matchedCount : matchedUsers.length;
    const sourceTotal = Number(scan?.source_total);
    const latestUpdated = scan?.last_updated;
    const isIdle = scan?.status === "idle";
    const status = isIdle
      ? "idle"
      : conversionError
        ? "error"
        : safeMatchedCount > 0
          ? "positive"
          : "clear";

    reviewCount.textContent = isIdle
      ? "Waiting for a snip"
      : conversionError
        ? "Conversion error"
        : `${safeMatchedCount} detected autobuilder${safeMatchedCount === 1 ? "" : "s"}`;
    reviewCount.className = `review-count review-count--${status}`;
    reviewCount.title = isIdle
      ? "Run a snip to see the detected autobuilder count."
      : conversionError
        ? `Scan failed while converting usernames: ${conversionError}`
        : safeMatchedCount > 0
          ? `${safeMatchedCount} matched autobuilder${safeMatchedCount === 1 ? "" : "s"} found in the scan.`
          : "No matched autobuilders found in the scan.";

    reviewSummary.textContent = isIdle
      ? "Drop an image or snip the leaderboard to see the detected count, source coverage, and latest database update."
      : conversionError
        ? "Could not convert usernames from the capture."
        : safeMatchedCount > 0
          ? "Potential matches were found. Review the source coverage and latest update below."
          : "No autobuilders were detected in this scan.";

    reviewMatchCount.textContent = isIdle
      ? "-"
      : conversionError
        ? "?"
        : String(safeMatchedCount);
    reviewMatchCount.className = `review-stat-value review-stat-value--${status}`;
    reviewMatchCount.title = reviewCount.title;

    reviewSourceCount.textContent = isIdle
      ? "-"
      : formatSourceCount(sourceTotal);
    reviewSourceCount.title = isIdle
      ? "Source count will appear after the first scan."
      : Number.isFinite(sourceTotal)
        ? `Based on ${sourceTotal} source${sourceTotal === 1 ? "" : "s"} in the database.`
        : "Source count unavailable.";

    reviewUpdatedAt.textContent = isIdle
      ? "-"
      : formatUpdatedAt(latestUpdated);
    reviewUpdatedAt.title = isIdle
      ? "Latest database update will appear after the first scan."
      : latestUpdated
        ? `Latest database update: ${formatUpdatedAt(latestUpdated)}`
        : "No update timestamp available.";

    reviewStatusBadge.textContent = isIdle
      ? "Idle"
      : conversionError
        ? "Amber"
        : safeMatchedCount > 0
          ? "Red"
          : "Green";
    reviewStatusBadge.className = `status-badge status-badge--${status}`;

    updateReviewTags({
      ...scan,
      matched_count: safeMatchedCount,
      source_total: Number.isFinite(sourceTotal) ? sourceTotal : null,
    });
  }

  function renderInitialReviewPanel() {
    renderScanSummary(
      {
        status: "idle",
        matched_count: null,
        source_total: null,
        last_updated: null,
        review_tags: [],
      },
      {}
    );
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
        renderScanSummary(
          result?.scan || {
            status: "error",
            conversion_error: result?.error || "Capture failed.",
          },
          {}
        );
        return;
      }

      showPreview(dataUrl);
      renderScanSummary(result?.scan || {}, result?.firebase_users || result?.firebase_matches || {});
      callPythonUpload();
      setStatus("Snip ready.");
    } catch (error) {
      console.error(error);
      setStatus("Snipping failed; try again.");
      renderScanSummary(
        {
          status: "error",
          conversion_error: String(error?.message || error || "Snipping failed"),
        },
        {}
      );
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

  renderInitialReviewPanel();
  setTimeout(() => {
    startOcrSetup();
  }, 250);
})();
