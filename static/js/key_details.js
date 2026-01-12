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

  function setButtonLoading(btn, isLoading, loadingText = "Working…") {
    if (!btn) return;

    if (isLoading) {
      btn.disabled = true;
      if (!btn.dataset.originalText) btn.dataset.originalText = btn.innerHTML;

      btn.innerHTML = `
        <span class="keyd-spinner" aria-hidden="true"></span>
        <span style="margin-left:8px;">${escapeHtml(loadingText)}</span>
      `;
    } else {
      btn.disabled = false;
      if (btn.dataset.originalText) {
        btn.innerHTML = btn.dataset.originalText;
        delete btn.dataset.originalText;
      }
    }
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

    function initSignOutWithAirTagWarning() {
      const form = document.getElementById("signOutForm");
      const errBox = document.getElementById("signOutError");
      if (!form || !errBox) return;

      const submitBtn = form.querySelector('button[type="submit"]');

      const wrap = document.querySelector(".keyd-wrap");
      const keyId = wrap?.getAttribute("data-key-id");
      const isKeyBag = (wrap?.getAttribute("data-is-key-bag") || "").trim() === "1";
      const bagCode = (wrap?.getAttribute("data-bag-code") || "").trim();

      // AirTag modal elements
      const airBackdrop = document.getElementById("airTagModalBackdrop");
      const airBody = document.getElementById("airTagModalBody");
      const airCancelBtn = document.getElementById("airTagModalCancelBtn");
      const airContinueBtn = document.getElementById("airTagModalContinueBtn");

      // Bag modal elements
      const bagBackdrop = document.getElementById("bagModalBackdrop");
      const bagBody = document.getElementById("bagModalBody");
      const bagCancelBtn = document.getElementById("bagModalCancelBtn");
      const bagContinueBtn = document.getElementById("bagModalContinueBtn");

      let isPosting = false;
      let isModalOpen = false;

      function showError(msg) {
        errBox.textContent = msg || "Request failed.";
        errBox.style.display = "block";
      }

      function clearError() {
        errBox.style.display = "none";
        errBox.textContent = "";
      }

      function openBackdrop(backdrop) {
        if (!backdrop) return;
        backdrop.style.display = "flex";
        backdrop.setAttribute("aria-hidden", "false");
      }

      function closeBackdrop(backdrop) {
        if (!backdrop) return;
        backdrop.style.display = "none";
        backdrop.setAttribute("aria-hidden", "true");
      }

      function disableModalButtons(cancelBtn, continueBtn, disabled) {
        if (cancelBtn) cancelBtn.disabled = !!disabled;
        if (continueBtn) continueBtn.disabled = !!disabled;
      }

      function confirmWithModal({ backdrop, bodyEl, cancelBtn, continueBtn, html }) {
        return new Promise((resolve) => {
          // If modal is missing for any reason, fail open (treat as "continue")
          if (!backdrop || !bodyEl || !cancelBtn || !continueBtn) {
            resolve(true);
            return;
          }

          // Prevent opening multiple modals at once
          if (isModalOpen) {
            resolve(false);
            return;
          }

          isModalOpen = true;
          bodyEl.innerHTML = html;
          openBackdrop(backdrop);

          const cleanup = () => {
            // remove listeners
            cancelBtn.removeEventListener("click", onCancel);
            continueBtn.removeEventListener("click", onContinue);
            backdrop.removeEventListener("click", onBackdropClick);
            document.removeEventListener("keydown", onKeyDown);

            // close UI + reset
            closeBackdrop(backdrop);
            disableModalButtons(cancelBtn, continueBtn, false);
            isModalOpen = false;
          };

          const onCancel = () => {
            cleanup();
            resolve(false);
          };

          const onContinue = () => {
            // lock buttons to prevent double tap
            disableModalButtons(cancelBtn, continueBtn, true);
            cleanup();
            resolve(true);
          };

          const onBackdropClick = (e) => {
            if (e.target === backdrop) onCancel();
          };

          const onKeyDown = (e) => {
            if (e.key === "Escape") onCancel();
          };

          cancelBtn.addEventListener("click", onCancel);
          continueBtn.addEventListener("click", onContinue);
          backdrop.addEventListener("click", onBackdropClick);
          document.addEventListener("keydown", onKeyDown);
        });
      }

      async function confirmBag(items) {
        const maxShow = 10;
        const shown = items.slice(0, maxShow);

        const rows = shown
          .map((it) => {
            const keycode = it.keycode || "-";
            const address = it.address || "-";
            const who = it.signed_out_to || "Unknown";
            return `
              <li style="margin: 6px 0;">
                <div><strong>${escapeHtml(keycode)}</strong> — ${escapeHtml(address)}</div>
                <div class="muted" style="margin-top:2px;">Signed out to ${escapeHtml(who)}</div>
              </li>
            `;
          })
          .join("");

        const more =
          items.length > maxShow
            ? `<div style="margin-top:8px;" class="muted">...and ${items.length - maxShow} more</div>`
            : "";

        const html = `
          <div><strong>Warning:</strong> ${items.length} key(s) on route <strong>${escapeHtml(
            bagCode
          )}</strong> are already signed out.</div>
          <div style="margin-top:8px;">
            <ul style="padding-left:18px; margin:0;">
              ${rows}
            </ul>
            ${more}
          </div>
          <div style="margin-top:10px;">If you continue, the bag will still be signed out, but those already-signed-out keys will remain unchanged.</div>
        `;

        return confirmWithModal({
          backdrop: bagBackdrop,
          bodyEl: bagBody,
          cancelBtn: bagCancelBtn,
          continueBtn: bagContinueBtn,
          html,
        });
      }

      async function confirmAirtag(airTag, d) {
        const keycode = d.keycode || "-";
        const address = d.address || "-";
        const who = d.signed_out_to || "Unknown";

        const html = `
          <div><strong>Warning:</strong> AirTag <strong>${escapeHtml(
            airTag
          )}</strong> is already signed out.</div>
          <div style="margin-top:6px;">
            <div><strong>Key:</strong> ${escapeHtml(keycode)}</div>
            <div><strong>Address:</strong> ${escapeHtml(address)}</div>
            <div><strong>Signed out to:</strong> ${escapeHtml(who)}</div>
          </div>
        `;

        return confirmWithModal({
          backdrop: airBackdrop,
          bodyEl: airBody,
          cancelBtn: airCancelBtn,
          continueBtn: airContinueBtn,
          html,
        });
      }

      async function postSignOut(formData) {
        if (isPosting) return;
        isPosting = true;
        setButtonLoading(submitBtn, true, "Signing out…");

        try {
          const resp = await fetch(form.action, {
            method: "POST",
            body: formData,
            headers: { Accept: "application/json" },
          });

          if (!resp.ok) {
            let msg = "Request failed.";
            try {
              const data = await resp.json();
              msg = data?.message || data?.error || msg;
            } catch (_) {}
            showError(msg);
            return;
          }

          window.location.reload();
        } catch (err) {
          showError("Network error. Please try again.");
        } finally {
          isPosting = false;
          setButtonLoading(submitBtn, false);
        }
      }

      async function fetchBagConflicts() {
        const params = new URLSearchParams();
        params.set("bag_code", bagCode);
        if (keyId) params.set("exclude_key_id", keyId);

        const resp = await fetch(`/api/keys/bag-signed-out?${params.toString()}`, {
          headers: { Accept: "application/json" },
        });
        if (!resp.ok) throw new Error("Bag check failed");
        const json = await resp.json();
        return json?.data || [];
      }

      async function fetchAirtagConflict(airTag) {
        const params = new URLSearchParams();
        params.set("air_tag", airTag);
        if (keyId) params.set("exclude_key_id", keyId);

        const resp = await fetch(`/api/keys/airtag-conflict?${params.toString()}`, {
          headers: { Accept: "application/json" },
        });
        if (!resp.ok) throw new Error("Airtag check failed");
        return await resp.json();
      }

      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (isPosting) return;

        clearError();

        const formData = new FormData(form);

        // 1) Bag warning (only for route bags)
        if (isKeyBag && bagCode) {
          try {
            const items = await fetchBagConflicts();
            if (items.length) {
              const ok = await confirmBag(items);
              if (!ok) return;
            }
          } catch (_) {
            // Fail open if bag check fails
          }
        }

        // 2) AirTag warning
        const airTag = String(formData.get("air_tag") || "").trim();
        if (airTag) {
          try {
            const json = await fetchAirtagConflict(airTag);
            if (json?.conflict && json?.data) {
              const ok = await confirmAirtag(airTag, json.data);
              if (!ok) return;
            }
          } catch (_) {
            // Fail open if airtag check fails
          }
        }

        // 3) Final POST
        await postSignOut(formData);
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
        setButtonLoading(confirmBtn, true, "Returning…");
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
          setButtonLoading(confirmBtn, false);
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
  initSignOutWithAirTagWarning();
  initReturnModal();             
  initActiveTechsPicker();
  initDetailsToggle();
  initHistory();
})();
