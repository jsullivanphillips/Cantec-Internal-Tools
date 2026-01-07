// static/js/key_detail.js
(function () {
  async function handleFormSubmit(formId, errorId) {
    const form = document.getElementById(formId);
    const errBox = document.getElementById(errorId);
    if (!form || !errBox) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      errBox.style.display = "none";
      errBox.textContent = "";

      const formData = new FormData(form);

      try {
        const resp = await fetch(form.action, {
          method: "POST",
          body: formData,
          headers: { "Accept": "application/json" },
        });

        if (!resp.ok) {
          let msg = "Request failed.";
          try {
            const data = await resp.json();
            msg = data?.message || data?.error || msg;
          } catch (_) {}
          errBox.textContent = msg;
          errBox.style.display = "block";
          return;
        }

        window.location.reload();
      } catch (err) {
        errBox.textContent = "Network error. Please try again.";
        errBox.style.display = "block";
      }
    });
  }

  function initDetailsToggle() {
    const btn = document.getElementById("toggleDetailsBtn");
    const panel = document.getElementById("detailsPanel");
    const label = document.getElementById("detailsBtnLabel");
    if (!btn || !panel || !label) return;

    btn.addEventListener("click", () => {
        const expanded = btn.getAttribute("aria-expanded") === "true";
        const next = !expanded;

        btn.setAttribute("aria-expanded", String(next));

        if (next) {
        panel.classList.remove("keyd-hidden");
        label.textContent = "Hide Details";
        } else {
        panel.classList.add("keyd-hidden");
        label.textContent = "Show Details";
        }
    });
    }


  function escapeHtml(str) {
    return String(str ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    function formatDate(iso) {
    if (!iso) return "-";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "-";
    // iPad-friendly short format
    return d.toLocaleString(undefined, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
    }

    function badgeClassForStatus(statusRaw) {
    const st = String(statusRaw || "").toLowerCase().trim();
    if (st === "signed out" || st === "out") return "keyd-badge-out";
    if (st === "returned" || st === "in" || st === "available") return "keyd-badge-in";
    return "keyd-badge-neutral";
    }

    async function initHistory() {
        const wrap = document.querySelector(".keyd-wrap");
        const keyId = wrap?.getAttribute("data-key-id");
        if (!keyId) return;

        const tbody = document.getElementById("historyTbody");
        const empty = document.getElementById("historyEmpty");
        const historyWrap = document.getElementById("historyWrap");
        const loadMoreBtn = document.getElementById("loadMoreHistoryBtn");
        if (!tbody || !empty || !historyWrap || !loadMoreBtn) return;

        let events = [];
        let visibleCount = 5;

        function render() {
            tbody.innerHTML = "";

            if (!events.length) {
            historyWrap.style.display = "none";
            loadMoreBtn.style.display = "none";
            empty.style.display = "block";
            return;
            }

            empty.style.display = "none";
            historyWrap.style.display = "block";

            const slice = events.slice(0, visibleCount);
            tbody.innerHTML = slice.map((e) => {
            const badgeClass = badgeClassForStatus(e.status);
            return `
                <tr>
                <td>${escapeHtml(formatDate(e.inserted_at))}</td>
                <td><span class="keyd-badge ${badgeClass}">${escapeHtml(e.status)}</span></td>
                <td>${escapeHtml(e.key_location)}</td>
                </tr>
            `;
            }).join("");

            if (visibleCount < events.length) {
            loadMoreBtn.style.display = "inline-block";
            loadMoreBtn.textContent = `Load more (${events.length - visibleCount})`;
            } else {
            loadMoreBtn.style.display = "none";
            }
        }

        loadMoreBtn.addEventListener("click", () => {
            visibleCount += 10; // reveal 10 more each click
            render();
        });

        try {
            const resp = await fetch(`/api/keys/${encodeURIComponent(keyId)}/history`, {
            headers: { "Accept": "application/json" },
            });
            if (!resp.ok) throw new Error("Failed to load history");
            const json = await resp.json();
            events = json?.data || [];
            render();
        } catch (err) {
            // fail "soft"
            empty.textContent = "Could not load history.";
            empty.style.display = "block";
            historyWrap.style.display = "none";
        }
    }



  // Init
  handleFormSubmit("signOutForm", "signOutError");
  handleFormSubmit("returnForm", "returnError");
  initDetailsToggle();
  initHistory();
})();
