// static/js/vehicle_inspection.js
(() => {
  const API_VEHICLES = "/api/vehicles/active";
  const API_SUBMIT = "/api/vehicle_submissions";

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
    ["vi-vehicle", "vi-inspector-name", "vi-current-km", "vi-service-due-km", "vi-oil", "vi-coolant", "vi-notes", "vi-reset"]
      .forEach(id => {
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



  function applyVehicleSelection(vehicleId) {
    state.selectedVehicleId = vehicleId || null;

    if (!vehicleId) {
      setAssignedTech("—");
      setLastSubmission("—");
      return;
    }

    const v = state.vehiclesById.get(Number(vehicleId)) || state.vehiclesById.get(vehicleId);
    if (!v) {
      setAssignedTech("—");
      setLastSubmission("—");
      return;
    }

    setAssignedTech(v.assigned_tech || v.current_driver_name || "—");
    setLastSubmission(fmtDateTime(v.last_submission_at || v.last_inspection_at));

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

    return {
      vehicle_id: vehicleId ? Number(vehicleId) : null,
      submitted_by: inspectorName || null,
      current_km: currentKm,
      service_due_km: dueKm,
      oil_level: oil || null,
      coolant_level: coolant || null,
      deficiency_notes: notes || null,
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
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------
  async function init() {
    // wire reset
    $("vi-reset")?.addEventListener("click", () => resetForm(true));

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
        await postSubmission(data);
        setAlert("success", "Saved. Thanks!");
        resetForm(true);

        // Refresh the selected vehicle’s "recent submission" display
        // simplest: reload active vehicles list (small fleet, cheap)
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

  document.addEventListener("DOMContentLoaded", () => {
    init().catch((e) => setAlert("danger", e?.message || "Failed to initialize page."));
  });
})();
