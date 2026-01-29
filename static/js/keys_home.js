// static/js/keys_home.js
(function () {
  const input = document.getElementById("keySearch");
  const resultsBox = document.getElementById("searchResults");

  const signedOutLoading = document.getElementById("signedOutLoading");
  const signedOutError = document.getElementById("signedOutError");
  const signedOutList = document.getElementById("signedOutList");
  const signedOutSortBtn = document.getElementById("signedOutSortBtn");

  // -----------------------------
  // Scanner elements
  // -----------------------------
  const openScannerBtn = document.getElementById("openScannerBtn");
  const closeScannerBtn = document.getElementById("closeScannerBtn");
  const scannerPanel = document.getElementById("scannerPanel");
  const resultBox = document.getElementById("resultBox");
  const noCameraMsg = document.getElementById("noCameraMsg");
  const videoElem = document.getElementById("preview");
  const scannerCard = document.getElementById("scannerCard");

  let debounceTimer = null;
  let lastQuery = "";

  let signedOutItems = [];
  let signedOutSort = "desc"; // "desc" = newest first, "asc" = oldest first

  // Scanner state
  let codeReader = null;
  let hasNavigated = false;
  let scanning = false;

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function daysSinceISO(iso) {
    if (!iso) return 0;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 0;
    const ms = Date.now() - d.getTime();
    return Math.floor(ms / (1000 * 60 * 60 * 24));
  }

  function signedOutAgeClass(insertedAtIso) {
    const days = daysSinceISO(insertedAtIso);
    if (days >= 5) return "keys-home__signedOutItem--danger";
    if (days >= 3) return "keys-home__signedOutItem--warn";
    return "";
  }

  function isoToMs(iso) {
    if (!iso) return 0;
    const d = new Date(iso);
    const t = d.getTime();
    return Number.isNaN(t) ? 0 : t;
  }

  function sortSignedOutItems(items, dir) {
    const mult = dir === "asc" ? 1 : -1;

    return [...items].sort((a, b) => {
      const ta = isoToMs(a.inserted_at);
      const tb = isoToMs(b.inserted_at);
      // primary: inserted_at
      if (ta !== tb) return (ta - tb) * mult;
      // secondary tie-break: keycode (stable-ish)
      const ka = (a.keycode || "").toLowerCase();
      const kb = (b.keycode || "").toLowerCase();
      return ka.localeCompare(kb);
    });
  }

  function updateSignedOutSortBtn() {
    if (!signedOutSortBtn) return;

    const isNewest = signedOutSort === "desc";
    signedOutSortBtn.setAttribute("aria-pressed", String(!isNewest));
    signedOutSortBtn.innerHTML = isNewest
      ? `<i class="bi bi-sort-down"></i> Sort: Newest`
      : `<i class="bi bi-sort-up"></i> Sort: Oldest`;
  }

  function applySignedOutSortAndRender() {
    const sorted = sortSignedOutItems(signedOutItems, signedOutSort);
    renderSignedOut(sorted);
    updateSignedOutSortBtn();
  }



  // -----------------------------
  // Scanner helpers
  // -----------------------------
  async function startScanner() {
    if (scanning) return;
    if (!videoElem || !scannerPanel || !resultBox || !noCameraMsg) return;

    // ZXing not loaded
    if (typeof ZXingBrowser === "undefined") {
      noCameraMsg.textContent = "Scanner library failed to load.";
      noCameraMsg.style.display = "block";
      return;
    }

    hasNavigated = false;
    scanning = true;

    resultBox.textContent = "Scan a barcode…";
    noCameraMsg.style.display = "none";

    // show UI before requesting camera (feels faster)
    scannerPanel.style.display = "block";

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((d) => d.kind === "videoinput");

      if (videoInputs.length === 0) {
        noCameraMsg.textContent = "No camera devices detected.";
        noCameraMsg.style.display = "block";
        scanning = false;
        return;
      }

      codeReader = new ZXingBrowser.BrowserMultiFormatReader();

      await codeReader.decodeFromVideoDevice(null, videoElem, (result, err) => {
        if (!result || hasNavigated) return;

        const barcodeText = (result.text || "").trim();
        if (!barcodeText) return;

        hasNavigated = true;
        resultBox.textContent = "Scanned Barcode: " + barcodeText;

        // stop scanning before navigating
        stopScanner();

        window.location.href = `/keys/by-barcode/${encodeURIComponent(barcodeText)}`;
      });
    } catch (e) {
      console.error(e);
      noCameraMsg.textContent = "Camera initialization error.";
      noCameraMsg.style.display = "block";
      scanning = false;
    }
  }

  function stopScanner() {
    scanning = false;

    // Stop ZXing
    if (codeReader) {
      try {
        codeReader.reset();
      } catch (_) {}
      codeReader = null;
    }

    // Force-stop camera stream so iOS releases camera immediately
    if (videoElem && videoElem.srcObject) {
      try {
        const tracks = videoElem.srcObject.getTracks?.() || [];
        tracks.forEach((t) => t.stop());
      } catch (_) {}
      videoElem.srcObject = null;
    }
  }

  function initScannerUI() {
    if (!openScannerBtn || !scannerPanel) return;

    // Hide scanner entirely if camera APIs are unavailable
    if (!canUseCamera()) {
      scannerCard.style.display = "none";
      return;
    }

    openScannerBtn.addEventListener("click", () => {
      startScanner();
    });

    closeScannerBtn.addEventListener("click", () => {
      stopScanner();
      scannerPanel.style.display = "none";
    });

    window.addEventListener("beforeunload", () => {
      stopScanner();
    });
  }


  // -----------------------------
  // Search
  // -----------------------------
  function hideResults() {
    resultsBox.style.display = "none";
    resultsBox.innerHTML = "";
  }

  function renderResults(items) {
    if (!items.length) {
      resultsBox.style.display = "block";
      resultsBox.innerHTML = `
        <div class="keys-home__resultItem keys-home__resultItem--muted">
          No matches found.
        </div>
      `;
      return;
    }

    resultsBox.style.display = "block";
    resultsBox.innerHTML = items
      .map((k) => {
        const addresses = (k.addresses || []).join(" • ");
        const subtitleParts = [];

        if (k.area) subtitleParts.push(k.area);
        if (k.route) subtitleParts.push(k.route);
        if (k.barcode) subtitleParts.push("Barcode " + k.barcode);

        const subtitle = subtitleParts.join(" • ");

        return `
          <a class="keys-home__resultItem" href="/keys/${k.id}">
            <div class="keys-home__resultTop">
              <div class="keys-home__resultKey"><strong>${escapeHtml(k.keycode || "(no keycode)")}</strong></div>
            </div>
            ${subtitle ? `<div class="keys-home__resultSub">${escapeHtml(subtitle)}</div>` : ""}
            ${addresses ? `<div class="keys-home__resultAddr">${escapeHtml(addresses)}</div>` : ""}
          </a>
        `;
      })
      .join("");
  }

  async function runSearch(q) {
    if (q.length < 2) {
      hideResults();
      return;
    }

    lastQuery = q;

    const resp = await fetch(`/api/keys/search?q=${encodeURIComponent(q)}`);
    if (!resp.ok) {
      hideResults();
      return;
    }

    const json = await resp.json();
    if (q !== lastQuery) return; // out-of-order guard

    renderResults(json.data || []);
  }

  if (input) {
    input.addEventListener("input", (e) => {
      const q = e.target.value.trim();
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => runSearch(q), 200);
    });

    document.addEventListener("click", (e) => {
      if (!resultsBox.contains(e.target) && e.target !== input) {
        hideResults();
      }
    });
  }

  function formatShortDateTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";

    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // -----------------------------
  // Signed out list
  // -----------------------------
  function renderSignedOut(items) {
    if (!items.length) {
      signedOutList.innerHTML = `
        <div class="keys-home__empty">
          No keys are currently signed out.
        </div>
      `;
      return;
    }

    signedOutList.innerHTML = items
      .map((k) => {
        const isBag = !!k.is_key_bag;
        const who = k.key_location ? escapeHtml(k.key_location) : "Unknown";
        const when = k.inserted_at ? escapeHtml(formatShortDateTime(k.inserted_at)) : "";

        const meta = [
          k.area ? escapeHtml(k.area) : null,
          k.route ? escapeHtml(k.route) : null,
          when ? `Last update ${when}` : null,
        ].filter(Boolean).join(" • ");

        const addresses = Array.isArray(k.addresses) ? k.addresses.join(" • ") : "";

        // ✅ NEW: age-based border class
        const ageClass = signedOutAgeClass(k.inserted_at);
        const daysOut = daysSinceISO(k.inserted_at);
        const ageLabel = daysOut >= 1 ? `${daysOut}d out` : "Out today";

        return `
          <a class="keys-home__signedOutItem ${ageClass}" href="/keys/${k.id}">
            <div class="keys-home__signedOutRow">
              <div class="keys-home__signedOutLeft">
                <div class="keys-home__signedOutKey">
                  <strong>${escapeHtml(k.keycode || "(no keycode)")}</strong>
                  ${isBag ? `<span class="keys-home__muted" style="margin-left:8px;">(Key bag)</span>` : ``}
                </div>
                ${meta ? `<div class="keys-home__signedOutMeta">${meta}</div>` : ""}
                ${addresses ? `<div class="keys-home__signedOutAddr">${escapeHtml(addresses)}</div>` : ""}
              </div>

              <div class="keys-home__signedOutBadge">
                ${isBag ? `BAG OUT — ${who}` : `OUT — ${who}`}
                <span class="keys-home__ageTag">${escapeHtml(ageLabel)}</span>
              </div>
            </div>
          </a>
        `;
      })
      .join("");
  }



  function canUseCamera() {
    return (
      typeof navigator !== "undefined" &&
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.enumerateDevices === "function"
    );
  }


    async function loadSignedOut() {
      if (!signedOutList) return;

      signedOutError.style.display = "none";
      signedOutError.textContent = "";
      signedOutLoading.style.display = "block";

      try {
        const resp = await fetch("/api/keys/signed-out");
        if (!resp.ok) throw new Error("Failed to load signed-out keys");

        const json = await resp.json();
        signedOutItems = json.data || [];
        applySignedOutSortAndRender();
      } catch (err) {
        signedOutError.textContent = "Could not load signed-out keys. Refresh to try again.";
        signedOutError.style.display = "block";
        signedOutList.innerHTML = "";
      } finally {
        signedOutLoading.style.display = "none";
      }
    }


  // Init
  initScannerUI();
  loadSignedOut();
  if (signedOutSortBtn) {
    signedOutSortBtn.addEventListener("click", () => {
      signedOutSort = signedOutSort === "desc" ? "asc" : "desc";
      applySignedOutSortAndRender();
    });
    updateSignedOutSortBtn();
  }
})();
