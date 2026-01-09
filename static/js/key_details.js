// static/js/key_detail.js
(function () {
  async function handleFormSubmit(formId, errorId, opts = {}) {
    const form = document.getElementById(formId);
    const errBox = document.getElementById(errorId);
    if (!form || !errBox) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      errBox.style.display = "none";
      errBox.textContent = "";

      if (typeof opts.beforeSubmit === "function") {
        const ok = opts.beforeSubmit(form, errBox);
        if (ok === false) return;
      }

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


  function initActiveTechsPicker() {
    const datalist = document.getElementById("activeTechs");
    const hint = document.getElementById("activeTechsHint");
    if (!datalist) return;

    function normalizeName(s) {
      return String(s || "").trim().replace(/\s+/g, " ");
    }

    async function loadTechs() {
      try {
        const resp = await fetch("/keys/active_techs", {
          headers: { "Accept": "application/json" },
        });
        if (!resp.ok) throw new Error("Failed");

        const json = await resp.json();
        const techs = json?.data || [];

        const optionsHtml = [];
        for (const t of techs) {
          const name = normalizeName(t?.name);
          if (!name) continue;
          optionsHtml.push(`<option value="${escapeHtml(name)}"></option>`);
        }

        datalist.innerHTML = optionsHtml.join("");
        if (hint) hint.style.display = "none";
      } catch (e) {
        if (hint) hint.style.display = "block";
      }
    }

    loadTechs();
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

    function initReturnModal() {
      const form = document.getElementById("returnForm");
      const errBox = document.getElementById("returnError");

      const backdrop = document.getElementById("returnModalBackdrop");
      const modalName = document.getElementById("returnModalName");
      const cancelBtn = document.getElementById("returnModalCancelBtn");
      const confirmBtn = document.getElementById("returnModalConfirmBtn");

      // If key isn't OUT, return form doesn't exist; fail quietly
      if (!form || !errBox || !backdrop || !modalName || !cancelBtn || !confirmBtn) return;

      let submitting = false;

      function openModal() {
        errBox.style.display = "none";
        errBox.textContent = "";

        backdrop.style.display = "flex";
        backdrop.setAttribute("aria-hidden", "false");

        // reset input each open (optional)
        modalName.value = "";
        setTimeout(() => modalName.focus(), 0);
      }

      function closeModal() {
        backdrop.style.display = "none";
        backdrop.setAttribute("aria-hidden", "true");
      }

      // Intercept the return form submit and open modal instead
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        openModal();
      });

      // Clicking backdrop closes (but clicking modal content does not)
      backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) closeModal();
      });

      cancelBtn.addEventListener("click", () => closeModal());

      // ESC closes modal
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && backdrop.style.display !== "none") {
          closeModal();
        }
      });

      confirmBtn.addEventListener("click", async () => {
        if (submitting) return;

        const name = (modalName.value || "").trim();
        if (!name) {
          // show error on the page (same box you already use)
          errBox.textContent = "Please enter who is returning the key.";
          errBox.style.display = "block";
          modalName.focus();
          return;
        }

        submitting = true;
        confirmBtn.disabled = true;
        cancelBtn.disabled = true;

        // Build form data to POST to the existing return endpoint
        const formData = new FormData(form);
        formData.set("returned_by", name);

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

          // success
          window.location.reload();
        } catch (err) {
          errBox.textContent = "Network error. Please try again.";
          errBox.style.display = "block";
        } finally {
          submitting = false;
          confirmBtn.disabled = false;
          cancelBtn.disabled = false;
          closeModal();
        }
      });
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

              // Prefer returned_by when present; otherwise use key_location
              const locOrPerson = e.returned_by
                ? `Returned by ${e.returned_by}`
                : e.key_location;

              return `
                <tr>
                  <td>${escapeHtml(formatDate(e.inserted_at))}</td>
                  <td><span class="keyd-badge ${badgeClass}">${escapeHtml(e.status)}</span></td>
                  <td>${escapeHtml(locOrPerson)}</td>
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
  initReturnModal();             
  initActiveTechsPicker();
  initDetailsToggle();
  initHistory();
})();
