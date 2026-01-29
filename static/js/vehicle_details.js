// static/js/vehicle_details.js
(() => {
  const root = document.querySelector(".vehicle-details");
  if (!root) return;

  const vehicleId = root.getAttribute("data-vehicle-id");
  const API_URL = `/api/vehicles/${encodeURIComponent(String(vehicleId))}`;

  const state = {
    payload: null,
    dirty: false,
  };

  function $(id) {
    return document.getElementById(id);
  }

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

  function fmtDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString();
  }

  function fmtDateTime(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString();
  }

  function todayISODate() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  function inspectionBadge(vehicle) {
    // Matches your triage behavior: if last_submission_at missing => "Never"
    // We'll keep it simple: show "OK" if has a submission, else "Never"
    if (!vehicle?.last_submission_at) {
      return `<span class="badge text-bg-warning">NEVER INSPECTED</span>`;
    }
    return `<span class="badge text-bg-success">INSPECTED</span>`;
  }

  function serviceBadge(status) {
    const s = (status || "OK").toUpperCase();
    if (s === "DUE") return `<span class="badge text-bg-danger">SERVICE DUE</span>`;
    if (s === "BOOKED") return `<span class="badge text-bg-primary">BOOKED</span>`;
    return `<span class="badge text-bg-success">OK</span>`;
  }

  async function fetchDetails() {
    const res = await fetch(API_URL, { headers: { "Accept": "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }

  async function patchService(patch) {
    const res = await fetch(`/api/vehicles/${encodeURIComponent(String(vehicleId))}/service`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`PATCH failed: HTTP ${res.status} - ${text}`);
    }
    return await res.json();
  }

  function setSaveStatus(text, tone = "muted") {
    const el = $("vd-save-status");
    if (!el) return;
    el.className = `small text-${tone}`;
    el.textContent = text;
  }

  function setDirty(on) {
    state.dirty = !!on;
    const saveBtn = $("vd-save");
    if (saveBtn) saveBtn.disabled = !state.dirty;
  }

  function renderVehicle(vehicle) {
    // Title/subtitle
    $("vd-title").textContent = `${vehicle.make_model} (${vehicle.license_plate})`;
    $("vd-subtitle").textContent =
      `${vehicle.year || "—"} · ${vehicle.color || "—"} · Plate: ${vehicle.license_plate}`;

    $("vd-service-badge").innerHTML = serviceBadge(vehicle.service_status);
    $("vd-inspection-badge").innerHTML = inspectionBadge(vehicle);

    // Office meta
    const flagged = fmtDateTime(vehicle.service_flagged_at);
    const booked = fmtDateTime(vehicle.service_booked_at);
    $("vd-office-meta").textContent = `Flagged: ${flagged} · Booked: ${booked}`;

    // Controls
    $("vd-service-status").value = (vehicle.service_status || "OK").toUpperCase();
    $("vd-service-notes").value = (vehicle.service_notes || "").toString();
    $("vd-last-service-date").value = vehicle.last_service_date || "";

    // Snapshot
    $("vd-tech").textContent = vehicle.current_driver_name || "Unassigned";
    $("vd-km").textContent = fmtInt(vehicle.latest_current_km);
    $("vd-service-due").textContent = fmtInt(vehicle.latest_service_due_km);
    $("vd-km-remaining").textContent = fmtInt(vehicle.km_remaining);
    $("vd-oil").textContent = vehicle.latest_oil_level || "—";
    $("vd-coolant").textContent = vehicle.latest_coolant_level || "—";
    $("vd-last-inspection").textContent = fmtDateTime(vehicle.last_submission_at);
    $("vd-last-inspection-by").textContent = vehicle.last_submission_by || "—";

    const notes = (vehicle.latest_deficiency_notes || "").toString().trim();
    $("vd-latest-notes").textContent = notes ? notes : "—";

    $("vd-updated").textContent = `Last updated: ${fmtDateTime(vehicle.last_submission_at)}`;
  }

  function renderSubmissions(list) {
    const tbody = $("vd-sub-tbody");
    const countEl = $("vd-sub-count");
    if (!tbody || !countEl) return;

    const query = ($("vd-sub-search")?.value || "").trim().toLowerCase();

    const filtered = query
      ? list.filter(s => {
          const hay = [
            s.submitted_at,
            s.submitted_by,
            s.current_km,
            s.service_due_km,
            s.oil_level,
            s.coolant_level,
            s.deficiency_notes,
          ].join(" ").toLowerCase();
          return hay.includes(query);
        })
      : list;

    countEl.textContent = String(filtered.length);

    if (!filtered.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="text-muted small">No submissions found.</td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = filtered.map(s => {
      const notes = (s.deficiency_notes || "").toString().trim();
      const notesCell = notes ? escapeHtml(notes) : `<span class="text-muted">—</span>`;

      return `
        <tr>
          <td class="text-nowrap">${escapeHtml(fmtDateTime(s.submitted_at))}</td>
          <td class="text-nowrap">${escapeHtml(s.submitted_by || "—")}</td>
          <td class="text-end">${escapeHtml(fmtInt(s.current_km))}</td>
          <td class="text-end">${escapeHtml(fmtInt(s.service_due_km))}</td>
          <td class="text-nowrap">${escapeHtml(s.oil_level || "—")}</td>
          <td class="text-nowrap">${escapeHtml(s.coolant_level || "—")}</td>
          <td class="vd-notes-cell">${notesCell}</td>
        </tr>
      `;
    }).join("");
  }

  function resetControlsToPayload() {
    const v = state.payload?.vehicle;
    if (!v) return;

    $("vd-service-status").value = (v.service_status || "OK").toUpperCase();
    $("vd-service-notes").value = (v.service_notes || "").toString();
    $("vd-last-service-date").value = v.last_service_date || "";

    setDirty(false);
    setSaveStatus("");
  }

  async function load() {
    setSaveStatus("Loading…");
    try {
      const payload = await fetchDetails();
      state.payload = payload;

      renderVehicle(payload.vehicle);
      renderSubmissions(payload.recent_submissions || []);

      setDirty(false);
      setSaveStatus("");
    } catch (e) {
      console.error(e);
      setSaveStatus("Failed to load vehicle.", "danger");
      $("vd-sub-tbody").innerHTML = `
        <tr>
          <td colspan="7" class="text-danger small">Failed to load vehicle details.</td>
        </tr>
      `;
    }
  }

  async function save() {
    const v = state.payload?.vehicle;
    if (!v) return;

    const status = $("vd-service-status").value;
    const notes = $("vd-service-notes").value;
    const lastServiceDate = $("vd-last-service-date").value;

    const patch = {
      service_status: status,
      service_notes: notes, // empty clears per your route
      last_service_date: lastServiceDate ? lastServiceDate : null,
    };

    $("vd-save").disabled = true;
    setSaveStatus("Saving…");

    try {
      await patchService(patch);
      await load();
      setSaveStatus("Saved.", "success");
      setTimeout(() => setSaveStatus(""), 900);
    } catch (e) {
      console.error(e);
      setSaveStatus("Save failed.", "danger");
      setDirty(true);
    } finally {
      $("vd-save").disabled = !state.dirty;
    }
  }

  function wire() {
    $("vd-refresh")?.addEventListener("click", load);

    $("vd-sub-search")?.addEventListener("input", () => {
      renderSubmissions(state.payload?.recent_submissions || []);
    });

    const onChange = () => {
      setDirty(true);
      setSaveStatus("");
    };

    $("vd-service-status")?.addEventListener("change", onChange);
    $("vd-service-notes")?.addEventListener("input", onChange);
    $("vd-last-service-date")?.addEventListener("change", onChange);

    $("vd-reset")?.addEventListener("click", resetControlsToPayload);
    $("vd-save")?.addEventListener("click", save);

    $("vd-mark-booked")?.addEventListener("click", () => {
      $("vd-service-status").value = "BOOKED";
      setDirty(true);
    });

    $("vd-mark-ok-today")?.addEventListener("click", () => {
      $("vd-service-status").value = "OK";
      $("vd-last-service-date").value = todayISODate();
      setDirty(true);
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    // Save button disabled until a change is made
    $("vd-save").disabled = true;
    wire();
    load();
  });
})();
