// static/js/vehicle_inspection.js
(() => {
  const API_VEHICLES = "/api/vehicles/active";
  const API_SUBMIT = "/api/vehicle_submissions";
  const API_VEHICLE = "/api/vehicles/";

  const $ = (id) => document.getElementById(id);

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function fmtInt(n) {
    const x = typeof n === "number" && Number.isFinite(n) ? n : null;
    return x == null ? "—" : x.toLocaleString();
  }

  function fmtDateTime(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString();
  }

  function setAlert(kind, msg) {
    const wrap = $("vi-alert-wrap");
    if (!wrap) return;

    if (!msg) {
      wrap.innerHTML = "";
      return;
    }

    const cls =
      kind === "success" ? "alert-success"
      : kind === "warning" ? "alert-warning"
      : "alert-danger";

    wrap.innerHTML = `
      <div class="alert ${cls} py-2 mb-0" role="alert">
        ${escapeHtml(msg)}
      </div>
    `;
  }

  function setSubmitting(isSubmitting) {
    const btn = $("vi-submit");
    const t = btn?.querySelector(".vi-submit-text");
    const l = btn?.querySelector(".vi-submit-loading");

    if (btn) btn.disabled = !!isSubmitting;
    if (t) t.classList.toggle("d-none", !!isSubmitting);
    if (l) l.classList.toggle("d-none", !isSubmitting);

    // disable key inputs while submitting (optional)
    [
      "vi-vehicle",
      "vi-inspector-name",
      "vi-current-km",
      "vi-service-due-km",
      "vi-oil",
      "vi-coolant",
      "vi-transmission",
      "vi-warning-lights",
      "vi-safe-to-operate",
      "vi-notes",
      "vi-reset",
      "vi-vehicle-details"
    ].forEach(id => {
        const el = $(id);
        if (el) el.disabled = !!isSubmitting;
      });
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const state = {
    vehiclesById: new Map(), // vehicle_id -> vehicle object
    selectedVehicleId: null,
  };

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------
  function renderVehicleOptions(vehicles) {
    const sel = $("vi-vehicle");
    if (!sel) return;

    sel.innerHTML = `
      <option value="">Select a vehicle…</option>
      ${vehicles.map(v => `
        <option value="${escapeHtml(v.vehicle_id)}">
          ${escapeHtml(v.search_label)}
        </option>
      `).join("")}
    `;

    // Also wire the search UI list from the same data
    wireVehicleSearchUI(vehicles);
  }


  function setAssignedTech(text) {
    const el = $("vi-assigned-tech");
    if (el) el.textContent = text || "—";
  }

  function setLastSubmission(text) {
    const el = $("vi-last-submission");
    if (el) el.textContent = text || "—";
  }

  function showSuccessModal(detailText, streakWeeks) {
    const detail = $("vi-success-detail");
    if (detail) detail.textContent = detailText || "Saved.";

    // NEW: optional streak message line (add this element in HTML OR we’ll reuse detail if missing)
    const streakEl = $("vi-success-streak");

    const w = Number(streakWeeks);
    if (streakEl) {
      if (Number.isFinite(w) && w >= 2) {
        streakEl.classList.remove("d-none");
        streakEl.textContent = streakMessage(w);
      } else {
        streakEl.classList.add("d-none");
        streakEl.textContent = "";
      }
    } else {
      // If you haven't added a 2nd line in HTML yet, just append to detail
      if (detail && Number.isFinite(w) && w >= 2) {
        detail.textContent = `${detailText || "Saved."}  •  ${streakMessage(w)}`;
      }
    }

    const el = document.getElementById("viSuccessModal");
    if (!el || !window.bootstrap?.Modal) return;

    const modal = window.bootstrap.Modal.getOrCreateInstance(el, {
      backdrop: true,
      keyboard: true,
      focus: true,
    });

    modal.show();

    window.setTimeout(() => {
      try { modal.hide(); } catch (_) {}
    }, 3600);
  }

  function streakMessage(weeks) {
    if (weeks === 2) return "🔥 2 weeks in a row — nice!";
    if (weeks === 3) return "🔥 3-week streak — great consistency!";
    if (weeks >= 4 && weeks <= 7) return `🏆 ${weeks}-week streak — awesome work!`;
    return `🏆 ${weeks}-week streak — unreal consistency!`;
  }

  async function loadVehicleDeficiencies(vehicldeId) {
    const res = await fetch(`${API_VEHICLE}${vehicldeId}`, {
      headers: { "Accept": "application/json" },
    });
    if (!res.ok) {
      throw new Error(`Failed to load vehicles: HTTP ${res.status}`);
    }

    const data = await res.json();
    console.log(data);

    const deficiencies = Array.isArray(data?.deficiencies)
    ? data.deficiencies
    : Array.isArray(data?.open_deficiencies)
      ? data.open_deficiencies
      : [];
    
    const openish = deficiencies.filter(d => {
      const st = String(d?.status || "").toUpperCase();
      return st === "OPEN" || st === "BOOKED";
    });

    const tableWrap = document.getElementById("vi-deficiencies-table-wrap");
    const tbody = document.getElementById("vi-deficiencies-tbody");
    if (!tableWrap || !tbody) return;

    // Reset
    tbody.innerHTML = "";

    // Helpers
    function appendCreateRow() {
      const tr = document.createElement("tr");

      // Description column (left)
      const tdDesc = document.createElement("td");
      tdDesc.className = "text-start";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-sm btn-outline-primary";
      btn.textContent = "+ Create deficiency";
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation(); // important so it doesn't trigger row-click handlers
        openCreateDeficiencyModal(vehicldeId);
      });

      tdDesc.appendChild(btn);

      // Other columns (blank)
      const tdSev = document.createElement("td");
      const tdStatus = document.createElement("td");
      const tdUpdated = document.createElement("td");
      tdUpdated.className = "text-end";

      tr.appendChild(tdDesc);
      tr.appendChild(tdSev);
      tr.appendChild(tdStatus);
      tr.appendChild(tdUpdated);

      tbody.appendChild(tr);
    }


    if (openish.length === 0) {
      tableWrap.style.display = "";
      appendCreateRow(); // still show the button as the last row
      return;
    }

    tableWrap.style.display = "";

    for (const d of openish) {
      const tr = document.createElement("tr");

      const desc = document.createElement("td");
      desc.textContent = (d?.description || "").trim() || "—";

      const sev = document.createElement("td");
      sev.textContent = (d?.severity || "").trim() || "—";

      const status = document.createElement("td");
      status.textContent = (d?.status || "").trim() || "—";

      const updated = document.createElement("td");
      updated.className = "text-end";
      const raw = d?.updated_on || d?.updated_at || d?.updatedAt || null;
      updated.textContent = raw ? new Date(raw).toLocaleString() : "—";

      tr.appendChild(desc);
      tr.appendChild(sev);
      tr.appendChild(status);
      tr.appendChild(updated);

      // click row -> edit modal
      tr.style.cursor = "pointer";
      tr.addEventListener("click", () => openEditDeficiencyModal(d));

      tbody.appendChild(tr);
    }

    // MUST be last row
    appendCreateRow();
  }



  function applyVehicleSelection(vehicleId) {
    state.selectedVehicleId = vehicleId || null;

    if (!vehicleId) {
      $("vi-vehicle-details").hidden = true;

      const dueEl = $("vi-service-due-km");
      if (dueEl) dueEl.value = null;

      setAssignedTech("—");
      setLastSubmission("—");
      console.log("hiding deficienceis")
      // 🔒 Hide deficiencies section until a vehicle is selected
      const defWrap = $("vi-deficiencies-wrap");
      if (defWrap) defWrap.style.display = "none";

      return;
    }


    $("vi-vehicle-details").hidden = false;  
    $("vi-vehicle-details").href = `/fleet/vehicles/${(String(vehicleId))}`;

    const v = state.vehiclesById.get(Number(vehicleId)) || state.vehiclesById.get(vehicleId);
    if (!v) {
      setAssignedTech("—");
      setLastSubmission("—");
      return;
    }

    // Autofill inspector name from assigned tech (only if blank)
    const inspEl = $("vi-inspector-name");
    if (inspEl) {
      const cur = (inspEl.value || "").trim();
      if (!cur) {
        const suggested =
          (v.assigned_tech || "").trim() ||
          (v.current_driver_name || "").trim() ||
          "";
        if (suggested) inspEl.value = suggested;
      }
    }



    // Prefill KM due for service if available
    const dueEl = $("vi-service-due-km");
    if (dueEl) {
      const due =
        v.service_due_km ??
        v.km_due_for_service ??
        v.next_service_km ??
        v.next_service_due_km ??
        v.due_km ??
        null;

      if (due != null && Number.isFinite(Number(due))) {
        dueEl.value = String(Number(due));
      }
      else {
        dueEl.value = null;
      }
    }


    setAssignedTech(v.assigned_tech || v.current_driver_name || "—");
    setLastSubmission(fmtDateTime(v.last_submission_at || v.last_inspection_at));
    
    
    // Show deficiencies once a vehicle is selected
    const defWrap = $("vi-deficiencies-wrap");
    if (defWrap) defWrap.style.display = "";
    loadVehicleDeficiencies(vehicleId)

  }

  // ---------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------
  async function fetchActiveVehicles() {
    const res = await fetch(API_VEHICLES, { headers: { "Accept": "application/json" } });
    if (!res.ok) {
      throw new Error(`Failed to load vehicles: HTTP ${res.status}`);
    }
    return await res.json();
  }

  async function postSubmission(body) {
    const res = await fetch(API_SUBMIT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(body),
    });

    // Try to read json either way
    let payload = null;
    try { payload = await res.json(); } catch (_) {}

    if (!res.ok) {
      const msg = payload?.error || payload?.message || `Submit failed (HTTP ${res.status})`;
      throw new Error(msg);
    }
    return payload || { status: "ok" };
  }

  // ---------------------------------------------------------------------------
  // Form handling
  // ---------------------------------------------------------------------------
  function readForm() {
    const vehicleId = $("vi-vehicle")?.value || "";
    const inspectorName = ($("vi-inspector-name")?.value ?? "").trim();
    const currentKmRaw = $("vi-current-km")?.value ?? "";
    const dueKmRaw = $("vi-service-due-km")?.value ?? "";

    const oil = $("vi-oil")?.value ?? "";
    const coolant = $("vi-coolant")?.value ?? "";
    const notes = ($("vi-notes")?.value ?? "").trim();

    const currentKm = currentKmRaw !== "" ? Number(currentKmRaw) : null;
    const dueKm = dueKmRaw !== "" ? Number(dueKmRaw) : null;

    const transmission = $("vi-transmission")?.value ?? "";
    const warningLightsRaw = $("vi-warning-lights")?.value ?? "";
    const safeRaw = $("vi-safe-to-operate")?.value ?? "";

    // convert yes/no -> boolean (null if not checked)
    const warningLights =
      warningLightsRaw === "yes" ? true : warningLightsRaw === "no" ? false : null;

    const safeToOperate =
      safeRaw === "yes" ? true : safeRaw === "no" ? false : null;


    return {
      vehicle_id: vehicleId ? Number(vehicleId) : null,
      submitted_by: inspectorName || null,
      current_km: currentKm,
      service_due_km: dueKm,
      oil_level: oil || null,
      coolant_level: coolant || null,
      transmission_level: transmission || null,
      warning_lights: warningLights || null,
      safe_to_operate: safeToOperate || null,
      notes: notes || null,           
    };
  }

  function validateForm(data) {
    if (!data.vehicle_id) return "Please select a vehicle.";
    if (!data.submitted_by) return "Please enter your name (Inspector Name).";
    if (data.current_km == null || !Number.isFinite(data.current_km) || data.current_km < 0) {
      return "Please enter a valid Current KM.";
    }
    if (data.service_due_km != null) {
      if (!Number.isFinite(data.service_due_km) || data.service_due_km < 0) {
        return "KM Due For Service must be a valid number (or blank).";
      }
      // Optional: guard against due < current (allow if you want to record overdue)
      // if (data.service_due_km < data.current_km) return "Service Due KM cannot be less than Current KM.";
    }
    return null;
  }

  function resetForm(keepVehicle = true) {
    setAlert(null, null);

    if (!keepVehicle) {
      $("vi-vehicle").value = "";
      applyVehicleSelection(null);
    }

    $("vi-current-km").value = "";
    $("vi-service-due-km").value = "";
    $("vi-oil").value = "";
    $("vi-coolant").value = "";
    $("vi-notes").value = "";
    $("vi-transmission").value = "";
    $("vi-warning-lights").value = "";
    $("vi-safe-to-operate").value = "";
    $("vi-full-wrap")?.classList.add("d-none");
    $("vi-full-toggle")?.setAttribute("aria-expanded", "false");
    $("vi-full-toggle-icon")?.classList.add("bi-chevron-right");
    $("vi-full-toggle-icon")?.classList.remove("bi-chevron-down");


  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------
  async function init() {
    // wire reset
    $("vi-reset")?.addEventListener("click", () => resetForm(true));
    wireFullInspectionToggle();

    $("vi-vehicle-details").hidden = true

    // vehicle dropdown change
    $("vi-vehicle")?.addEventListener("change", (e) => {
      setAlert(null, null);
      applyVehicleSelection(e.target.value);
    });

    // form submit
    $("vi-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      setAlert(null, null);

      const data = readForm();
      const err = validateForm(data);
      if (err) {
        setAlert("warning", err);
        return;
      }

      try {
        setSubmitting(true);
        const resp = await postSubmission(data);

        // Strong confirmation
        const v = state.vehiclesById.get(Number(data.vehicle_id));
        const vehicleLabel = v?.search_label || v?.label || "Vehicle";

        const streakWeeks = resp?.inspection_on_time_streak_weeks;
        showSuccessModal(
          `${vehicleLabel} — saved at ${new Date().toLocaleTimeString()}`,
          streakWeeks
        );

        // Keep alert as secondary fallback (optional)
        setAlert("success", "Saved. Thanks!");

        resetForm(true);
        await loadVehicles({ preserveSelection: true });

      } catch (ex) {
        setAlert("danger", ex?.message || "Submit failed.");
      } finally {
        setSubmitting(false);
      }
    });

    // initial load
    await loadVehicles({ preserveSelection: true });

    // If URL has ?vehicle_id=123, auto-select it
    const params = new URLSearchParams(window.location.search);
    const preselect = params.get("vehicle_id");
    if (preselect) {
      const sel = $("vi-vehicle");
      if (sel) {
        sel.value = preselect;
        applyVehicleSelection(preselect);
      }
    }
  }

  function wireVehicleSearchUI(vehicles) {
    const input = $("vi-vehicle-search");
    const results = $("vi-vehicle-results");
    const sel = $("vi-vehicle");
    if (!input || !results || !sel) return;

    // Map for quick lookup: id -> vehicle
    const byId = new Map();
    for (const v of vehicles) byId.set(String(v.vehicle_id), v);

    function scoreMatch(label, q) {
      // simple "contains" match; can be improved later
      const s = String(label || "").toLowerCase();
      const query = String(q || "").toLowerCase().trim();
      if (!query) return 1;
      if (s.startsWith(query)) return 3;
      if (s.includes(query)) return 2;
      return 0;
    }

    function renderList(query) {
      const q = (query || "").trim().toLowerCase();

      // If empty query, show a short "top list" (or hide—your call)
      const items = vehicles
        .map(v => ({
          v,
          score: scoreMatch(v.search_label, q),
        }))
        .filter(x => q ? x.score > 0 : true)
        .sort((a, b) => b.score - a.score)
        .slice(0, 25); // cap for usability

      if (items.length === 0) {
        results.innerHTML = `<div class="list-group-item text-muted small">No matches.</div>`;
        results.classList.remove("d-none");
        return;
      }

      results.innerHTML = items.map(({ v }) => {
        const id = escapeHtml(v.vehicle_id);
        const label = escapeHtml(v.search_label || `${v.make_model || ""} ${v.license_plate || ""}`.trim() || `Vehicle ${id}`);
        return `
          <button type="button"
            class="list-group-item list-group-item-action"
            data-vehicle-id="${id}"
          >
            ${label}
          </button>
        `;
      }).join("");

      results.classList.remove("d-none");
    }

    function chooseVehicle(vehicleId) {
      const idStr = String(vehicleId || "");
      if (!idStr) return;

      // Set hidden select + trigger existing flow
      sel.value = idStr;
      sel.dispatchEvent(new Event("change", { bubbles: true }));

      const v = byId.get(idStr);
      if (v) input.value = v.search_label || "";

      results.classList.add("d-none");
    }

    // Clicking a result picks it
    results.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-vehicle-id]");
      if (!btn) return;
      chooseVehicle(btn.dataset.vehicleId);
    });

    // Typing filters
    input.addEventListener("input", () => {
      renderList(input.value);
    });

    // Focus shows list (helpful on mobile)
    input.addEventListener("focus", () => {
      renderList(input.value);
    });

    // Escape closes
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        results.classList.add("d-none");
        input.blur();
      }
    });

    // Click outside closes
    document.addEventListener("click", (e) => {
      const inside = e.target.closest("#vi-vehicle-results") || e.target.closest("#vi-vehicle-search");
      if (!inside) results.classList.add("d-none");
    });

    // When the hidden select changes (e.g., URL preselect), reflect it into the input
    sel.addEventListener("change", () => {
      const v = byId.get(String(sel.value || ""));
      if (v) input.value = v.search_label || "";
      else if (!sel.value) input.value = "";
    });

    // Initial render: keep closed until they focus/ type, but ready
    results.classList.add("d-none");
  }


  function wireFullInspectionToggle() {
    const btn = $("vi-full-toggle");
    const wrap = $("vi-full-wrap");
    const icon = $("vi-full-toggle-icon");
    if (!btn || !wrap || !icon) return;

    function setOpen(isOpen) {
      btn.setAttribute("aria-expanded", isOpen ? "true" : "false");
      wrap.classList.toggle("d-none", !isOpen);

      // chevron right when closed, down when open
      icon.classList.toggle("bi-chevron-right", !isOpen);
      icon.classList.toggle("bi-chevron-down", isOpen);
    }

    // default collapsed
    setOpen(false);

    btn.addEventListener("click", () => {
      const isOpen = btn.getAttribute("aria-expanded") === "true";
      setOpen(!isOpen);
    });

    // If the tech starts interacting with Full Inspection fields, auto-open.
    const autoOpenIds = [
      "vi-oil",
      "vi-coolant",
      "vi-transmission",
      "vi-warning-lights",
      "vi-safe-to-operate",
      "vi-notes",
    ];

    autoOpenIds.forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener("focus", () => setOpen(true), { passive: true });
      el.addEventListener("change", () => setOpen(true), { passive: true });
    });
}


  async function loadVehicles({ preserveSelection }) {
    const sel = $("vi-vehicle");
    const searchInput = $("vi-vehicle-search");
    const results = $("vi-vehicle-results");

    const prev = preserveSelection ? (sel?.value || "") : "";

    // show loading state in dropdown
    if (sel) {
      sel.innerHTML = `<option value="">Loading vehicles…</option>`;
      sel.disabled = true;
      if (searchInput) {
        searchInput.value = "";
        searchInput.disabled = true;
      }
      if (results) {
        results.innerHTML = "";
        results.classList.add("d-none");
      }

    }

    try {
      const payload = await fetchActiveVehicles();
      const vehicles = Array.isArray(payload?.vehicles) ? payload.vehicles : [];

      state.vehiclesById.clear();
      for (const v of vehicles) {
        // Normalize shape:
        // Backend might send: {vehicle_id, label, assigned_tech}
        // or a richer object later.
        const id = v.vehicle_id;
        state.vehiclesById.set(Number(id), v);
      }

      renderVehicleOptions(vehicles);

      if (sel) {
        sel.disabled = false;
        if (prev) sel.value = prev;
        if (searchInput) searchInput.disabled = false;

      }

      applyVehicleSelection(sel?.value || prev || null);
    } catch (e) {
      if (sel) {
        sel.disabled = false;
        if (searchInput) searchInput.disabled = false;
        sel.innerHTML = `<option value="">(Failed to load vehicles)</option>`;
      }
      
      setAlert("danger", e?.message || "Failed to load vehicles.");
      applyVehicleSelection(null);
    }
  }


  // ---------------------------------------------------------------------------
  // Edit deficiency (inspection page)
  // ---------------------------------------------------------------------------
  let __viEditDefModalBound = false;

  function defId(d) {
    return d?.id ?? d?.deficiency_id ?? null;
  }

  function normalizeDefRow(d) {
    // allow multiple backend shapes
    return {
      id: defId(d),
      description: (d?.description || "").toString(),
      severity: (d?.severity || "").toString().toUpperCase(),
      status: (d?.status || "").toString().toUpperCase(),
      updated_by: (d?.updated_by || d?.updatedBy || "").toString(),
    };
  }

  function clearEditDeficiencyModal() {
    const err = $("vi-edit-def-error");
    if (err) {
      err.classList.add("d-none");
      err.textContent = "";
    }
    setEditDeficiencySubmitting(false);
  }

  function setEditDeficiencySubmitting(isSubmitting) {
    $("vi-edit-def-submit").disabled = !!isSubmitting;
    $("vi-edit-def-spinner").classList.toggle("d-none", !isSubmitting);

    $("vi-edit-def-description").disabled = !!isSubmitting;
    $("vi-edit-def-severity").disabled = !!isSubmitting;
    $("vi-edit-def-status").disabled = !!isSubmitting;
    $("vi-edit-def-updated-by").disabled = !!isSubmitting;
  }

  function showEditDeficiencyError(msg) {
    const err = $("vi-edit-def-error");
    if (!err) return;
    err.textContent = msg || "Something went wrong.";
    err.classList.remove("d-none");
  }

  async function apiPatchDeficiency(deficiencyId, patch) {
    const res = await fetch(`/api/vehicle_deficiencies/${encodeURIComponent(String(deficiencyId))}`, {
      method: "PATCH",
      headers: { "Accept": "application/json", "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(patch),
    });

    let payload = null;
    try { payload = await res.json(); } catch (_) {}

    if (!res.ok) {
      const msg = payload?.error || payload?.message || `Failed to update deficiency (HTTP ${res.status})`;
      throw new Error(msg);
    }
    return payload || { status: "ok" };
  }

  function openEditDeficiencyModal(defRaw) {
    const modalEl = $("viEditDefModal");
    if (!modalEl || !window.bootstrap?.Modal) return;

    const def = normalizeDefRow(defRaw);
    if (!def.id) return;

    modalEl.dataset.deficiencyId = String(def.id);

    // seed fields
    $("vi-edit-def-description").value = def.description || "";
    $("vi-edit-def-severity").value = def.severity || "DEFICIENT";
    $("vi-edit-def-status").value = def.status || "OPEN";

    // default Updated By: inspector name
    const inspector = ($("vi-inspector-name")?.value || "").trim();
    $("vi-edit-def-updated-by").value = inspector || def.updated_by || "";

    clearEditDeficiencyModal();

    if (!__viEditDefModalBound) {
      __viEditDefModalBound = true;

      $("vi-edit-def-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        await submitEditDeficiency();
      });

      modalEl.addEventListener("hidden.bs.modal", () => clearEditDeficiencyModal());
    }

    const modal = window.bootstrap.Modal.getOrCreateInstance(modalEl, {
      backdrop: "static",
      keyboard: true,
      focus: true,
    });
    modal.show();

    window.setTimeout(() => $("vi-edit-def-description")?.focus(), 150);
  }

  async function submitEditDeficiency() {
    const modalEl = $("viEditDefModal");
    if (!modalEl) return;

    const deficiencyId = Number(modalEl.dataset.deficiencyId || 0);
    if (!deficiencyId) return;

    const vehicleId = state.selectedVehicleId;
    if (!vehicleId) return;

    const description = ($("vi-edit-def-description")?.value || "").trim();
    const severity = ($("vi-edit-def-severity")?.value || "").trim().toUpperCase();
    const status = ($("vi-edit-def-status")?.value || "").trim().toUpperCase();
    const updatedBy = ($("vi-edit-def-updated-by")?.value || "").trim()
      || ($("vi-inspector-name")?.value || "").trim();

    if (!description) {
      showEditDeficiencyError("Description is required.");
      $("vi-edit-def-description")?.focus();
      return;
    }
    if (!severity) {
      showEditDeficiencyError("Severity is required.");
      $("vi-edit-def-severity")?.focus();
      return;
    }
    if (!updatedBy) {
      showEditDeficiencyError("Updated By is required.");
      $("vi-edit-def-updated-by")?.focus();
      return;
    }

    setEditDeficiencySubmitting(true);

    try {
      await apiPatchDeficiency(deficiencyId, {
        description,
        severity,
        status,
        updated_by: updatedBy,
      });

      // close modal
      const modal = window.bootstrap.Modal.getInstance(modalEl);
      try { modal?.hide(); } catch (_) {}

      // refresh deficiency table
      await loadVehicleDeficiencies(vehicleId);
    } catch (e) {
      showEditDeficiencyError(e?.message || "Failed to update deficiency.");
      setEditDeficiencySubmitting(false);
    }
  }



  // Deficiency modal (new system)
  let __viCreateDefModalBound = false;

  function openCreateDeficiencyModal(vehicleId) {
    const modalEl = $("viCreateDefModal");
    if (!modalEl || !window.bootstrap?.Modal) return;

    modalEl.dataset.vehicleId = String(vehicleId);

    // Prefill created_by from inspector name
    const inspector = ($("vi-inspector-name")?.value || "").trim();
    $("vi-create-def-created-by").value = inspector;

    clearCreateDeficiencyModal();

    if (!__viCreateDefModalBound) {
      __viCreateDefModalBound = true;

      $("vi-create-def-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        await submitCreateDeficiency();
      });

      modalEl.addEventListener("hidden.bs.modal", () => clearCreateDeficiencyModal());
    }

    const modal = window.bootstrap.Modal.getOrCreateInstance(modalEl, {
      backdrop: "static",
      keyboard: true,
      focus: true,
    });
    modal.show();

    window.setTimeout(() => $("vi-create-def-description")?.focus(), 150);
  }

  function clearCreateDeficiencyModal() {
    const err = $("vi-create-def-error");
    if (err) {
      err.classList.add("d-none");
      err.textContent = "";
    }

    $("vi-create-def-description").value = "";
    $("vi-create-def-severity").value = "";
    setCreateDeficiencySubmitting(false);
  }

  function setCreateDeficiencySubmitting(isSubmitting) {
    $("vi-create-def-submit").disabled = !!isSubmitting;
    $("vi-create-def-spinner").classList.toggle("d-none", !isSubmitting);

    $("vi-create-def-description").disabled = !!isSubmitting;
    $("vi-create-def-severity").disabled = !!isSubmitting;
    $("vi-create-def-created-by").disabled = !!isSubmitting;
  }

  function showCreateDeficiencyError(msg) {
    const err = $("vi-create-def-error");
    if (!err) return;
    err.textContent = msg || "Something went wrong.";
    err.classList.remove("d-none");
  }

  async function submitCreateDeficiency() {
    const modalEl = $("viCreateDefModal");
    if (!modalEl) return;

    const vehicleId = Number(modalEl.dataset.vehicleId || 0);
    if (!vehicleId) return;

    const description = ($("vi-create-def-description")?.value || "").trim();
    const severity = ($("vi-create-def-severity")?.value || "").trim();
    const createdBy = ($("vi-create-def-created-by")?.value || "").trim()
      || ($("vi-inspector-name")?.value || "").trim();

    if (!description) {
      showCreateDeficiencyError("Description is required.");
      $("vi-create-def-description")?.focus();
      return;
    }
    if (!severity) {
      showCreateDeficiencyError("Severity is required.");
      $("vi-create-def-severity")?.focus();
      return;
    }
    if (!createdBy) {
      showCreateDeficiencyError("Created By is required.");
      $("vi-create-def-created-by")?.focus();
      return;
    }

    setCreateDeficiencySubmitting(true);

    try {
      const res = await fetch(`/api/vehicles/${vehicleId}/deficiencies`, {
        method: "POST",
        headers: { "Accept": "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          description,
          severity,
          created_by: createdBy,   // NEW
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showCreateDeficiencyError(err?.error || `Failed to create deficiency (HTTP ${res.status})`);
        setCreateDeficiencySubmitting(false);
        return;
      }

      // Close modal
      const modal = window.bootstrap.Modal.getInstance(modalEl);
      try { modal?.hide(); } catch (_) {}

      // Refresh table
      await loadVehicleDeficiencies(vehicleId);
    } catch (e) {
      console.error(e);
      showCreateDeficiencyError("Failed to create deficiency. Please try again.");
      setCreateDeficiencySubmitting(false);
    }
  }



  document.addEventListener("DOMContentLoaded", () => {
    init().catch((e) => setAlert("danger", e?.message || "Failed to initialize page."));
  });

})();
