// static/js/fleet_overview.js
(() => {
  // ---------------------------------------------------------------------------
  // Config + state
  // ---------------------------------------------------------------------------
  const state = {
    thresholds: {
      inspectionOverdueDays: 7,
    },
    generatedAt: null,
    payload: null,

    // modal
    modalVehicleId: null,
    modal: null,
  };

  const API_URL = "/api/fleet_overview/triage";

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
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
    const x = typeof n === "number" && Number.isFinite(n) ? n : 0;
    return x.toLocaleString();
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

  function setUpdated(ts) {
    const el = $("fleet-updated");
    if (!el) return;
    const dt = ts ? new Date(ts) : new Date();
    el.textContent = `Updated ${dt.toLocaleString()}`;
  }

  function todayISODate() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  function statusBadge(status) {
    const s = (status || "").toUpperCase();
    if (s === "BOOKED") return `<span class="badge text-bg-primary">BOOKED</span>`;
    if (s === "DUE") return `<span class="badge text-bg-danger">DUE</span>`;
    return `<span class="badge text-bg-success">OK</span>`;
  }

  function kmLine(item) {
    const cur = item.current_km;
    const due = item.service_due_km;
    const rem = item.km_remaining;

    const curTxt = (typeof cur === "number") ? fmtInt(cur) : "—";
    const dueTxt = (typeof due === "number") ? fmtInt(due) : "—";
    const remTxt = (typeof rem === "number") ? fmtInt(rem) : "—";

    return `KM: <strong>${curTxt}</strong> · Due: <strong>${dueTxt}</strong> · Remaining: <strong>${remTxt}</strong>`;
  }

  // ---------------------------------------------------------------------------
  // All Vehicles (search + list)
  // ---------------------------------------------------------------------------
  function triageStatusForVehicleId(vehicleId) {
    const id = String(vehicleId);

    const inNeedsService = (state.payload?.needs_service || []).some(v => String(v.vehicle_id) === id);
    if (inNeedsService) {
      const v = (state.payload?.needs_service || []).find(x => String(x.vehicle_id) === id);
      const s = (v?.service_status || "DUE").toUpperCase();
      return s === "BOOKED" ? "BOOKED" : "DUE";
    }

    const inOverdue = (state.payload?.overdue_inspections || []).some(v => String(v.vehicle_id) === id);
    if (inOverdue) return "INSPECTION_OVERDUE";

    return "OK";
  }

  function statusBadgeForAllList(status) {
    const s = (status || "").toUpperCase();
    if (s === "DUE") return `<span class="badge text-bg-danger">SERVICE DUE</span>`;
    if (s === "BOOKED") return `<span class="badge text-bg-primary">BOOKED</span>`;
    if (s === "INSPECTION_OVERDUE") return `<span class="badge text-bg-warning">INSPECTION</span>`;
    return `<span class="badge text-bg-success">OK</span>`;
  }

  function allListSearchKey(v) {
    return [
      v.current_driver_name || "",
      v.make_model || "",
      v.license_plate || "",
    ].join(" ").toLowerCase();
  }

  function vehicleLabel(v) {
    return `${v.make_model || "Vehicle"} (${v.license_plate || "—"})`;
  }

  function renderAllVehiclesList(payload) {
    const wrap = $("fleet-all-list");
    const countEl = $("all-vehicles-count");
    if (!wrap || !countEl) return;

    const all = Array.isArray(payload?.all_vehicles) ? payload.all_vehicles : [];
    const query = ($("fleet-all-search")?.value || "").trim().toLowerCase();

    // filter
    const filtered = query
      ? all.filter(v => allListSearchKey(v).includes(query))
      : all;

    countEl.textContent = String(filtered.length);

    if (!all.length) {
      wrap.innerHTML = `<div class="text-muted small">No vehicles found.</div>`;
      return;
    }

    if (!filtered.length) {
      wrap.innerHTML = `<div class="text-muted small">No matches.</div>`;
      return;
    }

    // Sort so actionable show first, then alphabetical
    const priority = (v) => {
      const status = triageStatusForVehicleId(v.vehicle_id);
      if (status === "DUE") return 0;
      if (status === "BOOKED") return 1;
      if (status === "INSPECTION_OVERDUE") return 2;
      return 3;
    };

    filtered.sort((a, b) => {
      const pa = priority(a);
      const pb = priority(b);
      if (pa !== pb) return pa - pb;

      const la = vehicleLabel(a).toLowerCase();
      const lb = vehicleLabel(b).toLowerCase();
      return la.localeCompare(lb);
    });

    wrap.innerHTML = filtered.map(v => {
      const label = escapeHtml(vehicleLabel(v));
      const tech = escapeHtml(v.current_driver_name || "Unassigned");
      const status = triageStatusForVehicleId(v.vehicle_id);

      // placeholder URL for vehicle detail page — adjust route later
      const href = `/fleet/vehicles/${encodeURIComponent(String(v.vehicle_id))}`;

      return `
        <a class="vehicle-item text-decoration-none d-block"
           href="${href}"
           data-vehicle-link="1"
           style="color: inherit;">
          <div class="vehicle-top">
            <div class="w-100">
              <div class="d-flex align-items-center gap-2">
                <div class="vehicle-name">${label}</div>
                <div class="ms-auto">${statusBadgeForAllList(status)}</div>
              </div>

              <div class="vehicle-meta mt-1">
                <span><i class="bi bi-person-badge me-1"></i>${tech}</span>
              </div>
            </div>
          </div>
        </a>
      `;
    }).join("");
  }


  // ---------------------------------------------------------------------------
  // Rendering (KPIs + lanes)
  // ---------------------------------------------------------------------------
  function renderKpis(payload) {
    const wrap = $("triage-kpis");
    if (!wrap) return;

    const needsService = Array.isArray(payload?.needs_service) ? payload.needs_service.length : 0;
    const overdue = Array.isArray(payload?.overdue_inspections) ? payload.overdue_inspections.length : 0;

    // KPI 1: Needs service
    // KPI 2: Overdue inspections
    // KPI 3: Booked subset
    // KPI 4: Never submitted subset
    const booked = (payload?.needs_service || []).filter(v => (v.service_status || "").toUpperCase() === "BOOKED").length;
    const neverSubmitted = (payload?.overdue_inspections || []).filter(v => !v.last_submission_at).length;

    wrap.innerHTML = `
      <div class="col-6 col-lg-3">
        <div class="kpi-card">
          <div class="kpi-label"><i class="bi bi-tools"></i> Needs Service</div>
          <div class="kpi-value">${fmtInt(needsService)}</div>
        </div>
      </div>

      <div class="col-6 col-lg-3">
        <div class="kpi-card">
          <div class="kpi-label"><i class="bi bi-clipboard-x"></i> Overdue Inspections</div>
          <div class="kpi-value">${fmtInt(overdue)}</div>
        </div>
      </div>

      <div class="col-6 col-lg-3">
        <div class="kpi-card">
          <div class="kpi-label"><i class="bi bi-calendar-check"></i> Booked Service</div>
          <div class="kpi-value">${fmtInt(booked)}</div>
        </div>
      </div>

      <div class="col-6 col-lg-3">
        <div class="kpi-card">
          <div class="kpi-label"><i class="bi bi-question-circle"></i> Never Inspected</div>
          <div class="kpi-value">${fmtInt(neverSubmitted)}</div>
        </div>
      </div>
    `;
  }

  function renderNeedsService(payload) {
    const wrap = $("needs-service-list");
    const countEl = $("needs-service-count");
    if (!wrap || !countEl) return;

    const items = Array.isArray(payload?.needs_service) ? payload.needs_service : [];
    countEl.textContent = String(items.length);

    if (!items.length) {
      wrap.innerHTML = `<div class="text-muted small">No vehicles currently marked as DUE/BOOKED. 🎉</div>`;
      return;
    }

    wrap.innerHTML = items.map(v => {
      const label = escapeHtml(v.label || `${v.make_model || ""} (${v.license_plate || ""})`.trim() || "Vehicle");
      const tech = escapeHtml(v.assigned_tech || "Unassigned");

      const officeNotes = (v.service_notes || "").toString().trim();
      const latestNotes = (v.latest_deficiency_notes || "").toString().trim();

      const flaggedAt = v.service_flagged_at ? fmtDateTime(v.service_flagged_at) : "—";
      const bookedAt = v.service_booked_at ? fmtDateTime(v.service_booked_at) : "—";
      const lastSvc = v.last_service_date ? escapeHtml(v.last_service_date) : "—";

      const noteBlock = officeNotes
        ? `<div class="vehicle-reason"><i class="bi bi-card-text me-1"></i>${escapeHtml(officeNotes)}</div>`
        : `<div class="text-muted small">No office notes yet.</div>`;

      const latestBlock = latestNotes && latestNotes !== officeNotes
        ? `<div class="text-muted small mt-1"><i class="bi bi-clipboard-data me-1"></i>Latest inspection note: ${escapeHtml(latestNotes)}</div>`
        : "";

      return `
        <div class="vehicle-item" data-service-status="${escapeHtml((v.service_status || "").toUpperCase())}">
          <div class="vehicle-top">
            <div class="w-100">
              <div class="d-flex align-items-center gap-2">
                <div class="vehicle-name">${label}</div>
                <div class="ms-auto">${statusBadge(v.service_status)}</div>
              </div>

              <div class="vehicle-meta mt-1">
                <span><i class="bi bi-person-badge me-1"></i>${tech}</span>
                <span><i class="bi bi-speedometer me-1"></i>${kmLine(v)}</span>
              </div>

              <div class="vehicle-meta mt-1">
                <span><i class="bi bi-flag me-1"></i>Flagged: <strong>${escapeHtml(flaggedAt)}</strong></span>
                <span><i class="bi bi-calendar-check me-1"></i>Booked: <strong>${escapeHtml(bookedAt)}</strong></span>
                <span><i class="bi bi-wrench me-1"></i>Last service: <strong>${lastSvc}</strong></span>
              </div>

              <div class="mt-2">
                ${noteBlock}
                ${latestBlock}
              </div>

              <div class="d-flex flex-wrap gap-2 mt-2">
                <button class="btn btn-sm btn-outline-primary"
                        data-action="edit-service"
                        data-vehicle-id="${escapeHtml(v.vehicle_id)}">
                  <i class="bi bi-pencil-square me-1"></i>Edit
                </button>

                <button class="btn btn-sm btn-outline-success"
                        data-action="mark-booked"
                        data-vehicle-id="${escapeHtml(v.vehicle_id)}">
                  <i class="bi bi-calendar-check me-1"></i>Mark Booked
                </button>

                <button class="btn btn-sm btn-outline-secondary"
                        data-action="mark-ok"
                        data-vehicle-id="${escapeHtml(v.vehicle_id)}">
                  <i class="bi bi-check2-circle me-1"></i>Mark OK
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join("");
  }

  function renderOverdueInspections(payload) {
    const wrap = $("overdue-inspections-list");
    const countEl = $("overdue-inspections-count");
    if (!wrap || !countEl) return;

    const items = Array.isArray(payload?.overdue_inspections) ? payload.overdue_inspections : [];
    countEl.textContent = String(items.length);

    if (!items.length) {
      wrap.innerHTML = `<div class="text-muted small">No overdue inspections. 🎉</div>`;
      return;
    }

    wrap.innerHTML = items.map(v => {
      const label = escapeHtml(v.label || `${v.make_model || ""} (${v.license_plate || ""})`.trim() || "Vehicle");
      const tech = escapeHtml(v.assigned_tech || "Unassigned");

      const last = fmtDate(v.last_submission_at);
      const by = escapeHtml(v.last_submission_by || "—");

      const overdue = v.inspection_overdue_days;
      const overdueText = (typeof overdue === "number")
        ? `${fmtInt(overdue)} day(s) overdue`
        : "No inspections yet";

      const inspectUrl = `/fleet/inspection?vehicle_id=${encodeURIComponent(String(v.vehicle_id))}`;

      return `
        <div class="vehicle-item" data-never-inspected="${v.last_submission_at ? "0" : "1"}">
          <div class="vehicle-top">
            <div class="w-100">
              <div class="d-flex align-items-center gap-2">
                <div class="vehicle-name">${label}</div>
                <div class="ms-auto">
                  <span class="badge text-bg-warning">${escapeHtml(overdueText)}</span>
                </div>
              </div>

              <div class="vehicle-meta mt-1">
                <span><i class="bi bi-person-badge me-1"></i>${tech}</span>
                <span><i class="bi bi-clock-history me-1"></i>Last: <strong>${escapeHtml(last)}</strong></span>
                <span><i class="bi bi-person-check me-1"></i>By: <strong>${by}</strong></span>
              </div>

              <div class="d-flex flex-wrap gap-2 mt-2">
                <a class="btn btn-sm btn-primary"
                   href="${inspectUrl}">
                  <i class="bi bi-clipboard-check me-1"></i>Start Inspection
                </a>

                <button class="btn btn-sm btn-outline-secondary"
                        data-action="copy-inspection-nudge"
                        data-vehicle-label="${escapeHtml(label)}"
                        data-vehicle-tech="${escapeHtml(tech)}"
                        data-overdue="${escapeHtml(overdueText)}">
                  <i class="bi bi-clipboard me-1"></i>Copy Nudge
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join("");
  }

  function renderAll(payload) {
    state.payload = payload;
    state.generatedAt = payload?.generated_at || new Date().toISOString();

    setUpdated(state.generatedAt);

    renderKpis(payload);
    renderNeedsService(payload);
    renderOverdueInspections(payload);

    renderAllVehiclesList(payload);
  }


  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------
  async function fetchTriage() {
    const params = new URLSearchParams();
    params.set("inspection_overdue_days", String(state.thresholds.inspectionOverdueDays));

    const url = `${API_URL}?${params.toString()}`;
    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }

  async function load() {
    // show shimmer quickly by resetting key containers (optional)
    // (If you want, we can add dedicated shimmer HTML; your CSS already supports shimmer class)
    try {
      const payload = await fetchTriage();
      renderAll(payload);
    } catch (e) {
      console.error("Failed to load triage:", e);

      // Basic fallback message
      $("needs-service-list").innerHTML = `<div class="text-danger small">Failed to load triage data.</div>`;
      $("overdue-inspections-list").innerHTML = `<div class="text-danger small">Failed to load triage data.</div>`;
      $("triage-kpis").innerHTML = `
        <div class="col-12">
          <div class="alert alert-danger mb-0">
            Failed to load fleet triage. Check server logs.
          </div>
        </div>
      `;
    }
  }

  // ---------------------------------------------------------------------------
  // Office actions (PATCH service route)
  // ---------------------------------------------------------------------------
  async function patchService(vehicleId, patch) {
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

  // ---------------------------------------------------------------------------
  // Modal helpers
  // ---------------------------------------------------------------------------
  function ensureModal() {
    const modalEl = $("serviceModal");
    if (!modalEl) return null;
    if (!window.bootstrap?.Modal) return null;

    if (!state.modal) state.modal = new window.bootstrap.Modal(modalEl);
    return state.modal;
  }

  function findNeedsServiceItem(vehicleId) {
    const list = state.payload?.needs_service || [];
    return list.find(x => String(x.vehicle_id) === String(vehicleId)) || null;
  }

  function openServiceModal(vehicleId) {
    const item = findNeedsServiceItem(vehicleId);
    if (!item) return;

    state.modalVehicleId = vehicleId;

    $("serviceModalVehicleLabel").textContent = item.label || "Vehicle";
    $("serviceModalStatus").value = (item.service_status || "DUE").toUpperCase();
    $("serviceModalNotes").value = (item.service_notes || "").toString();

    // last_service_date comes as YYYY-MM-DD
    $("serviceModalLastServiceDate").value = item.last_service_date || "";

    const meta = [
      `Flagged: ${fmtDateTime(item.service_flagged_at)}`,
      `Booked: ${fmtDateTime(item.service_booked_at)}`,
      `Last inspection: ${fmtDateTime(item.last_submission_at)}`
    ].join(" · ");
    $("serviceModalMeta").textContent = meta;

    ensureModal()?.show();
  }

  async function saveServiceModal() {
    const vehicleId = state.modalVehicleId;
    if (!vehicleId) return;

    const status = $("serviceModalStatus").value;
    const notes = $("serviceModalNotes").value;
    const lastServiceDate = $("serviceModalLastServiceDate").value;

    const patch = {
      service_status: status,
      service_notes: notes, // empty string clears server-side per your endpoint
      last_service_date: lastServiceDate ? lastServiceDate : null,
    };

    $("serviceModalSave").disabled = true;
    try {
      await patchService(vehicleId, patch);
      ensureModal()?.hide();
      await load();
    } catch (e) {
      console.error(e);
      alert("Failed to save service changes.");
    } finally {
      $("serviceModalSave").disabled = false;
    }
  }

  async function quickMarkBooked(vehicleId) {
    try {
      await patchService(vehicleId, { service_status: "BOOKED" });
      await load();
    } catch (e) {
      console.error(e);
      alert("Failed to mark booked.");
    }
  }

  async function quickMarkOk(vehicleId) {
    try {
      await patchService(vehicleId, { service_status: "OK" });
      await load();
    } catch (e) {
      console.error(e);
      alert("Failed to mark OK.");
    }
  }

  async function markDoneTodayFromModal() {
    const vehicleId = state.modalVehicleId;
    if (!vehicleId) return;

    const patch = {
      service_status: "OK",
      last_service_date: todayISODate(),
    };

    $("serviceModalMarkDone").disabled = true;
    try {
      await patchService(vehicleId, patch);
      ensureModal()?.hide();
      await load();
    } catch (e) {
      console.error(e);
      alert("Failed to mark OK.");
    } finally {
      $("serviceModalMarkDone").disabled = false;
    }
  }

  function copyInspectionNudge(btn) {
    const label = btn.getAttribute("data-vehicle-label") || "Vehicle";
    const tech = btn.getAttribute("data-vehicle-tech") || "Unassigned";
    const overdue = btn.getAttribute("data-overdue") || "Overdue";

    const msg = `Hey ${tech}. Please submit your weekly vehicle inspection when you get a chance. Thanks!`;

    navigator.clipboard?.writeText(msg).then(() => {
      btn.innerHTML = `<i class="bi bi-check2 me-1"></i>Copied`;
      setTimeout(() => {
        btn.innerHTML = `<i class="bi bi-clipboard me-1"></i>Copy Nudge`;
      }, 900);
    }).catch(() => {
      // fallback
      prompt("Copy this message:", msg);
    });
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------
  function applyThresholdsFromUI() {
    const overdueDays = parseInt($("threshold-inspection-days")?.value ?? "7", 10);
    state.thresholds.inspectionOverdueDays = Number.isFinite(overdueDays) ? overdueDays : 7;
    load();
  }

  function wireGlobalClickHandlers() {
    document.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;

      const action = btn.getAttribute("data-action");
      if (action === "edit-service") {
        const vehicleId = btn.getAttribute("data-vehicle-id");
        openServiceModal(vehicleId);
      }

      if (action === "mark-booked") {
        const vehicleId = btn.getAttribute("data-vehicle-id");
        btn.disabled = true;
        await quickMarkBooked(vehicleId);
        btn.disabled = false;
      }

      if (action === "mark-ok") {
        const vehicleId = btn.getAttribute("data-vehicle-id");
        btn.disabled = true;
        await quickMarkOk(vehicleId);
        btn.disabled = false;
      }

      if (action === "copy-inspection-nudge") {
        copyInspectionNudge(btn);
      }
    });
  }

  function init() {
    $("fleet-refresh")?.addEventListener("click", load);
    $("threshold-apply")?.addEventListener("click", applyThresholdsFromUI);

    $("threshold-inspection-days").value = String(state.thresholds.inspectionOverdueDays);

    $("fleet-all-search")?.addEventListener("input", () => {
      // Re-render list only (no fetch) using cached payload
      renderAllVehiclesList(state.payload || {});
    });

    // Modal buttons
    $("serviceModalSave")?.addEventListener("click", saveServiceModal);
    $("serviceModalMarkDone")?.addEventListener("click", markDoneTodayFromModal);

    wireGlobalClickHandlers();

    load();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
