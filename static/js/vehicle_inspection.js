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


    const emptyEl = document.getElementById("vi-deficiencies-empty");
    const tableWrap = document.getElementById("vi-deficiencies-table-wrap");
    const tbody = document.getElementById("vi-deficiencies-tbody");
    if (!emptyEl || !tableWrap || !tbody) return;

    // Reset
    tbody.innerHTML = "";

    // Helpers
    function appendCreateRow() {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 4;
      td.className = "text-end";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-sm btn-outline-primary";
      btn.textContent = "Create deficiency";

      btn.addEventListener("click", () => {
        openCreateDeficiencyModal(vehicldeId);
      });

      td.appendChild(btn);
      tr.appendChild(td);
      tbody.appendChild(tr);
      console.log("appended create row");
    }

    if (openish.length === 0) {
      emptyEl.style.display = "";
      tableWrap.style.display = "";
      appendCreateRow(); // still show the button as the last row
      return;
    }

    emptyEl.style.display = "none";
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
      dueEl.value = null;
      setAssignedTech("—");
      setLastSubmission("—");
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
    loadVehicleDeficiencies(vehicleId)

    // Optional: don’t auto-fill KM fields (prevents accidental stale submissions)
    // If you DO want to help them, uncomment these:
    // if (v.current_km != null) $("vi-current-km").value = v.current_km;
    // if (v.next_service_km != null) $("vi-service-due-km").value = v.next_service_km;
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

  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------
  async function init() {
    // wire reset
    $("vi-reset")?.addEventListener("click", () => resetForm(true));

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

  async function loadVehicles({ preserveSelection }) {
    const sel = $("vi-vehicle");
    const prev = preserveSelection ? (sel?.value || "") : "";

    // show loading state in dropdown
    if (sel) {
      sel.innerHTML = `<option value="">Loading vehicles…</option>`;
      sel.disabled = true;
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
      }

      applyVehicleSelection(sel?.value || prev || null);
    } catch (e) {
      if (sel) {
        sel.disabled = false;
        sel.innerHTML = `<option value="">(Failed to load vehicles)</option>`;
      }
      setAlert("danger", e?.message || "Failed to load vehicles.");
      applyVehicleSelection(null);
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
