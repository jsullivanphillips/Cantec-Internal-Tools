// static/js/keys_home.js
(function () {
  const input = document.getElementById("keySearch");
  const resultsBox = document.getElementById("searchResults");

  const signedOutLoading = document.getElementById("signedOutLoading");
  const signedOutError = document.getElementById("signedOutError");
  const signedOutList = document.getElementById("signedOutList");

  let debounceTimer = null;
  let lastQuery = "";

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
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
        const who = k.key_location ? escapeHtml(k.key_location) : "Unknown";
        const when = k.inserted_at ? escapeHtml(k.inserted_at) : "";
        const meta = [
          k.area ? escapeHtml(k.area) : null,
          k.route ? escapeHtml(k.route) : null,
          when ? `Last update ${when}` : null,
        ].filter(Boolean).join(" • ");

        return `
          <a class="keys-home__signedOutItem" href="/keys/${k.id}">
            <div class="keys-home__signedOutRow">
              <div class="keys-home__signedOutLeft">
                <div class="keys-home__signedOutKey"><strong>${escapeHtml(k.keycode || "(no keycode)")}</strong></div>
                ${meta ? `<div class="keys-home__signedOutMeta">${meta}</div>` : ""}
              </div>
              <div class="keys-home__signedOutBadge">
                OUT — ${who}
              </div>
            </div>
          </a>
        `;
      })
      .join("");
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
      renderSignedOut(json.data || []);
    } catch (err) {
      signedOutError.textContent = "Could not load signed-out keys. Refresh to try again.";
      signedOutError.style.display = "block";
      signedOutList.innerHTML = "";
    } finally {
      signedOutLoading.style.display = "none";
    }
  }

  loadSignedOut();
})();
