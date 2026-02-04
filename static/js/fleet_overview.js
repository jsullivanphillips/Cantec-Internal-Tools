// static/js/fleet_overview.js
(() => {
  const API_URL = "/api/fleet_overview/triage";

  const VALID_VEHICLE_STATUSES = new Set(["OK", "DUE", "DEFICIENT", "BOOKED", "IN_SHOP"]);

  // Sort Option A: status priority (higher first)
  const STATUS_PRIORITY = {
    IN_SHOP: 50,
    DEFICIENT: 40,
    BOOKED: 30,
    DUE: 20,
    OK: 10,
  };

  const state = {
    thresholds: { inspectionOverdueDays: 7 },
    payload: null,
    vehicles: [],
    expanded: new Set(), // vehicle_id
  };

  const $ = (id) => document.getElementById(id);

  // ----------------------------
  // Helpers
  // ----------------------------
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

  function setUpdated(ts) {
    const el = $("fleet-updated");
    if (!el) return;
    const dt = ts ? new Date(ts) : new Date();
    el.textContent = `Updated ${dt.toLocaleString()}`;
  }

  function vehicleHref(vehicleId) {
    return `/fleet/vehicles/${encodeURIComponent(String(vehicleId))}`;
  }

  function safeStatus(s) {
    const up = String(s || "OK").toUpperCase();
    return VALID_VEHICLE_STATUSES.has(up) ? up : "OK";
  }

  function statusBadge(status) {
    const s = safeStatus(status);
    if (s === "DEFICIENT") return `<span class="badge text-bg-danger">DEFICIENT</span>`;
    if (s === "DUE") return `<span class="badge text-bg-warning">DUE</span>`;
    if (s === "BOOKED") return `<span class="badge text-bg-primary">BOOKED</span>`;
    if (s === "IN_SHOP") return `<span class="badge text-bg-secondary">IN SHOP</span>`;
    return `<span class="badge text-bg-success">OK</span>`;
  }

  function label(v) {
    return v.search_label || `${v.make_model || "Vehicle"} (${v.license_plate || "—"})`;
  }

  function searchKey(v) {
    return [
      v.current_driver_name || "",
      v.make_model || "",
      v.license_plate || "",
      v.search_label || "",
    ].join(" ").toLowerCase();
  }

  function kmOverdue(v) {
    // Preferred: km_remaining <= 0
    if (typeof v.km_remaining === "number" && Number.isFinite(v.km_remaining)) {
      return v.km_remaining <= 0;
    }
    // Fallback: current >= due
    const cur = (typeof v.latest_current_km === "number" ? v.latest_current_km : null);
    const due = (typeof v.latest_service_due_km === "number" ? v.latest_service_due_km : null);
    if (cur == null || due == null) return false;
    return cur >= due;
  }

  function inspectionOverdue(v) {
    if (typeof v.inspection_is_overdue === "boolean") return v.inspection_is_overdue;

    // fallback compute using last_submission_at + threshold
    if (!v.last_submission_at) return true;
    const d = new Date(v.last_submission_at);
    if (Number.isNaN(d.getTime())) return true;

    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
    return diffDays > Number(state.thresholds.inspectionOverdueDays || 7);
  }

  function openDeficiencies(v) {
    const n = Number(v.open_deficiency_count || 0);
    const deficient = (v.status == "DEFICIENT")
    return n > 0 || deficient;
  }

  function deriveIssueTags(v) {
    const tags = [];
    if (openDeficiencies(v)) tags.push("OPEN_DEFS");
    if (inspectionOverdue(v)) tags.push("INSP_OVERDUE");
    if (kmOverdue(v)) tags.push("KM_OVERDUE");
    return tags;
  }

  function issueChips(v) {
    const tags = deriveIssueTags(v);
    const parts = [];

    if (tags.includes("OPEN_DEFS")) {
      parts.push(`<span class="badge text-bg-danger-subtle border border-danger-subtle text-danger-emphasis">
        <i class="bi bi-exclamation-octagon me-1"></i>${escapeHtml(fmtInt(Number(v.open_deficiency_count || 0)))} open def(s)
      </span>`);
    }

    if (tags.includes("INSP_OVERDUE")) {
      const od = v.inspection_overdue_days;
      const label = (typeof od === "number" && Number.isFinite(od))
        ? `${fmtInt(od)}d overdue`
        : (!v.last_submission_at ? "never inspected" : "overdue");
      parts.push(`<span class="badge text-bg-warning-subtle border border-warning-subtle text-warning-emphasis">
        <i class="bi bi-clipboard-x me-1"></i>${escapeHtml(label)}
      </span>`);
    }

    if (tags.includes("KM_OVERDUE")) {
      const rem = v.km_remaining;
      const label = (typeof rem === "number" && Number.isFinite(rem))
        ? `${fmtInt(rem)} km remaining`
        : "KM overdue";
      parts.push(`<span class="badge text-bg-primary-subtle border border-primary-subtle text-primary-emphasis">
        <i class="bi bi-speedometer2 me-1"></i>${escapeHtml(label)}
      </span>`);
    }

    if (!parts.length) {
      parts.push(`<span class="badge text-bg-light border text-muted">
        <i class="bi bi-check2-circle me-1"></i>No issues flagged
      </span>`);
    }

    return parts.join(" ");
  }

  function kmSnapshotLine(v) {
    const cur = v.latest_current_km ?? v.current_km ?? null;
    const due = v.latest_service_due_km ?? v.service_due_km ?? null;
    const rem = v.km_remaining ?? null;
    return `Current: <strong>${escapeHtml(fmtInt(cur))}</strong> · Due: <strong>${escapeHtml(fmtInt(due))}</strong> · Remaining: <strong>${escapeHtml(fmtInt(rem))}</strong>`;
  }

  function inspectionLine(v) {
    const last = fmtDateTime(v.last_submission_at);
    const by = escapeHtml(v.last_submission_by || "—");
    const overdue = inspectionOverdue(v);
    const badge = overdue
      ? `<span class="badge text-bg-warning ms-2">Overdue</span>`
      : `<span class="badge text-bg-success ms-2">OK</span>`;
    return `Last: <strong>${escapeHtml(last)}</strong> · By: <strong>${by}</strong> ${badge}`;
  }

  function notesLine(v) {
    const notes = (v.notes || "").toString().trim();
    return notes ? escapeHtml(notes) : `<span class="text-muted">—</span>`;
  }

  // ----------------------------
  // Filters + Sorting
  // ----------------------------
  function getActiveFilters() {
    const f = {
      OPEN_DEFS: !!$("flt-open-defs")?.checked,
      INSP_OVERDUE: !!$("flt-inspection-overdue")?.checked,
      KM_OVERDUE: !!$("flt-km-overdue")?.checked,
    };
    return f;
  }

  // Multi-select filters use OR semantics:
  // If none selected => show all
  // If some selected => show vehicles matching ANY selected issue tag
  function matchesFilters(v, filters) {
    const anySelected = Object.values(filters).some(Boolean);
    if (!anySelected) return true;

    const tags = new Set(deriveIssueTags(v));
    if (filters.OPEN_DEFS && tags.has("OPEN_DEFS")) return true;
    if (filters.INSP_OVERDUE && tags.has("INSP_OVERDUE")) return true;
    if (filters.KM_OVERDUE && tags.has("KM_OVERDUE")) return true;
    return false;
  }

  function sortVehicles(vehicles) {
    // Option A: status priority desc, then label asc
    vehicles.sort((a, b) => {
      const pa = STATUS_PRIORITY[safeStatus(a.status)] || 0;
      const pb = STATUS_PRIORITY[safeStatus(b.status)] || 0;
      if (pa !== pb) return pb - pa;
      return label(a).toLowerCase().localeCompare(label(b).toLowerCase());
    });
    return vehicles;
  }

  // ----------------------------
  // Rendering
  // ----------------------------
  function collapseAllExpanded() {
    state.expanded.clear();
  }

  function renderList() {
    const wrap = $("fleet-list");
    const countEl = $("fleet-count");
    const hintEl = $("fleet-hint");
    if (!wrap || !countEl) return;

    const q = ($("fleet-search")?.value || "").trim().toLowerCase();
    const filters = getActiveFilters();

    let items = Array.isArray(state.vehicles) ? [...state.vehicles] : [];
    if (q) items = items.filter(v => searchKey(v).includes(q));
    items = items.filter(v => matchesFilters(v, filters));
    sortVehicles(items);

    countEl.textContent = String(items.length);

    const anySelected = Object.values(filters).some(Boolean);
    if (hintEl) {
      const parts = [];
      if (q) parts.push(`Search: “${escapeHtml(q)}”`);
      if (anySelected) {
        const on = [];
        if (filters.OPEN_DEFS) on.push("Open Deficiencies");
        if (filters.INSP_OVERDUE) on.push("Inspection Overdue");
        if (filters.KM_OVERDUE) on.push("KM Overdue");
        parts.push(`Filters: ${on.join(", ")}`);
      } else {
        parts.push("Filters: none");
      }
      hintEl.innerHTML = parts.join(" · ");
    }

    if (!state.vehicles.length) {
      wrap.innerHTML = `<div class="list-group-item py-4 text-muted small">No vehicles found.</div>`;
      return;
    }

    if (!items.length) {
      wrap.innerHTML = `<div class="list-group-item py-4 text-muted small">No matches.</div>`;
      return;
    }

    wrap.innerHTML = items.map(v => renderRow(v)).join("");
  }

  function renderRow(v) {
    const id = String(v.vehicle_id);
    const isOpen = state.expanded.has(id);

    const vehName = escapeHtml(label(v));
    const tech = escapeHtml(v.current_driver_name || "Unassigned");
    const last = escapeHtml(fmtDate(v.last_submission_at));

    const chips = issueChips(v);
    const href = vehicleHref(v.vehicle_id);

    // We’ll store a per-row "show all deficiencies" state in a data attribute on expand body.
    // Default: false.
    const openDefs = Array.isArray(v.open_deficiencies) ? v.open_deficiencies : [];
    const openCount = Number(v.open_deficiency_count || 0);

    const defRowsTop3 = openDefs.slice(0, 3).map(d => {
      const sev = escapeHtml((d.severity || "—").toString());
      const desc = escapeHtml((d.description || "—").toString());
      const up = escapeHtml(fmtDateTime(d.updated_at));
      return `
        <div class="d-flex flex-column flex-md-row gap-1 align-items-md-center">
          <div class="me-auto">
            <span class="badge text-bg-danger me-2">${sev}</span>
            <span>${desc}</span>
          </div>
          <div class="text-muted small">${up}</div>
        </div>
      `;
    }).join("");

    const defRowsAll = openDefs.map(d => {
      const sev = escapeHtml((d.severity || "—").toString());
      const desc = escapeHtml((d.description || "—").toString());
      const st = escapeHtml((d.status || "OPEN").toString());
      const up = escapeHtml(fmtDateTime(d.updated_at));
      return `
        <div class="d-flex flex-column flex-md-row gap-1 align-items-md-center">
          <div class="me-auto">
            <span class="badge text-bg-danger me-2">${sev}</span>
            <span>${desc}</span>
            <span class="badge text-bg-light border ms-2 text-muted">${st}</span>
          </div>
          <div class="text-muted small">${up}</div>
        </div>
      `;
    }).join("");

    const showDefsToggle = openCount > 3
      ? `<button class="btn btn-sm btn-outline-secondary mt-2"
                 type="button"
                 data-action="toggle-defs"
                 data-vehicle-id="${escapeHtml(id)}"
                 data-showing="top">
            Show all ${escapeHtml(fmtInt(openCount))} deficiencies
         </button>`
      : "";

    // Row header (click to expand)
    return `
      <div class="list-group-item">
        <button
          type="button"
          class="btn w-100 text-start p-0 border-0 bg-transparent"
          data-action="toggle-row"
          data-vehicle-id="${escapeHtml(id)}"
          aria-expanded="${isOpen ? "true" : "false"}"
        >
          <div class="d-flex gap-3 align-items-start py-2">
            <div class="flex-grow-1">
              <div class="d-flex flex-wrap align-items-center gap-2">
                <div class="fw-semibold">${tech}</div>
                <div class="text-muted">•</div>
                <div class="fw-semibold">${vehName}</div>
                <div class="ms-auto d-flex align-items-center gap-2">
                  <span class="text-muted small d-none d-md-inline">
                    <i class="bi bi-clock-history me-1"></i>${last}
                  </span>
                  ${statusBadge(v.status)}
                  <i class="bi ${isOpen ? "bi-chevron-up" : "bi-chevron-down"} text-muted"></i>
                </div>
              </div>
              <div class="mt-2 d-flex flex-wrap gap-2">
                ${chips}
              </div>
            </div>
          </div>
        </button>

        <div class="${isOpen ? "" : "d-none"} pt-2 pb-3 border-top" data-expand-body="${escapeHtml(id)}">
          <div class="row g-3">
            <div class="col-12 col-lg-7 d-flex flex-column">
              <div class="small text-muted mb-1">Open deficiencies</div>

              <div class="d-flex flex-column gap-2" data-defs-list="${escapeHtml(id)}">
                ${openCount ? defRowsTop3 : `<div class="text-muted">None</div>`}
              </div>

              <div data-defs-toggle-wrap="${escapeHtml(id)}">
                ${openCount ? showDefsToggle : ""}
              </div>

              <!-- Bottom-left navigation -->
              <div class="mt-auto pt-3">
                <a class="btn btn-sm btn-outline-secondary"
                  href="${href}"
                  target="_blank"
                  rel="noopener noreferrer">
                  <i class="bi bi-box-arrow-up-right me-1"></i> Open vehicle details
                </a>
              </div>
            </div>


            <div class="col-12 col-lg-5">
              <div class="small text-muted mb-1">KM</div>
              <div>${kmSnapshotLine(v)}</div>

              <div class="small text-muted mb-1 mt-3">Inspection</div>
              <div>${inspectionLine(v)}</div>

              <div class="small text-muted mb-1 mt-3">Office notes</div>
              <div>${notesLine(v)}</div>

              <div class="d-flex flex-wrap gap-2 mt-3">
                <button class="btn btn-sm btn-outline-primary"
                        type="button"
                        data-action="copy-inspection-nudge"
                        data-vehicle-tech="${escapeHtml(v.current_driver_name || "there")}">
                  <i class="bi bi-clipboard me-1"></i> Copy inspection nudge
                </button>

                <button class="btn btn-sm btn-primary"
                        type="button"
                        data-action="open-status-modal"
                        data-vehicle-id="${escapeHtml(id)}">
                  <i class="bi bi-pencil-square me-1"></i> Change status
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ----------------------------
  // Data load
  // ----------------------------
  async function fetchTriage() {
    const params = new URLSearchParams();
    params.set("inspection_overdue_days", String(state.thresholds.inspectionOverdueDays));

    const url = `${API_URL}?${params.toString()}`;
    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }

  function normalizeVehicles(payload) {
    const vehicles = Array.isArray(payload?.vehicles) ? payload.vehicles : [];
    // Ensure required computed flags exist if backend didn’t provide them
    return vehicles.map(v => ({
      ...v,
      status: safeStatus(v.status),
    }));
  }

  async function load() {
    const wrap = $("fleet-list");
    try {
      const payload = await fetchTriage();
      state.payload = payload;
      state.vehicles = normalizeVehicles(payload);
      setUpdated(payload?.generated_at || new Date().toISOString());

      collapseAllExpanded();
      renderList();
    } catch (e) {
      console.error("Failed to load fleet overview:", e);
      if (wrap) {
        wrap.innerHTML = `
          <div class="list-group-item py-4">
            <div class="alert alert-danger mb-0">
              Failed to load fleet overview. Check server logs.
            </div>
          </div>
        `;
      }
      $("fleet-count") && ($("fleet-count").textContent = "0");
    }
  }

  // ----------------------------
  // Actions
  // ----------------------------
  function copyInspectionNudge(btn) {
    const tech = btn.getAttribute("data-vehicle-tech") || "there";
    const msg =
      `Hey ${tech}. Please submit your weekly vehicle inspection when you get a chance. Thanks! ` +
      `${window.location.origin}/fleet/inspection`;

    navigator.clipboard?.writeText(msg).then(() => {
      const old = btn.innerHTML;
      btn.innerHTML = `<i class="bi bi-check2 me-1"></i>Copied`;
      setTimeout(() => (btn.innerHTML = old), 900);
    }).catch(() => {
      prompt("Copy this message:", msg);
    });
  }

  function toggleRow(vehicleId) {
    const id = String(vehicleId);
    if (state.expanded.has(id)) state.expanded.delete(id);
    else state.expanded.add(id);
    renderList(); // simple and robust; list is still small enough
  }

  function toggleDefs(vehicleId) {
    const id = String(vehicleId);
    const v = state.vehicles.find(x => String(x.vehicle_id) === id);
    if (!v) return;

    const body = document.querySelector(`[data-expand-body="${CSS.escape(id)}"]`);
    const list = document.querySelector(`[data-defs-list="${CSS.escape(id)}"]`);
    const toggleWrap = document.querySelector(`[data-defs-toggle-wrap="${CSS.escape(id)}"]`);
    if (!body || !list || !toggleWrap) return;

    const btn = toggleWrap.querySelector(`button[data-action="toggle-defs"]`);
    if (!btn) return;

    const openDefs = Array.isArray(v.open_deficiencies) ? v.open_deficiencies : [];
    const openCount = Number(v.open_deficiency_count || 0);

    const showing = btn.getAttribute("data-showing") || "top";
    const next = showing === "top" ? "all" : "top";
    btn.setAttribute("data-showing", next);
    btn.textContent = next === "all"
      ? "Show top 3"
      : `Show all ${openCount} deficiencies`;

    const rowsTop3 = openDefs.slice(0, 3).map(d => {
      const sev = escapeHtml((d.severity || "—").toString());
      const desc = escapeHtml((d.description || "—").toString());
      const up = escapeHtml(fmtDateTime(d.updated_at));
      return `
        <div class="d-flex flex-column flex-md-row gap-1 align-items-md-center">
          <div class="me-auto">
            <span class="badge text-bg-danger me-2">${sev}</span>
            <span>${desc}</span>
          </div>
          <div class="text-muted small">${up}</div>
        </div>
      `;
    }).join("");

    const rowsAll = openDefs.map(d => {
      const sev = escapeHtml((d.severity || "—").toString());
      const desc = escapeHtml((d.description || "—").toString());
      const st = escapeHtml((d.status || "OPEN").toString());
      const up = escapeHtml(fmtDateTime(d.updated_at));
      return `
        <div class="d-flex flex-column flex-md-row gap-1 align-items-md-center">
          <div class="me-auto">
            <span class="badge text-bg-danger me-2">${sev}</span>
            <span>${desc}</span>
            <span class="badge text-bg-light border ms-2 text-muted">${st}</span>
          </div>
          <div class="text-muted small">${up}</div>
        </div>
      `;
    }).join("");

    list.innerHTML = openCount ? (next === "all" ? rowsAll : rowsTop3) : `<div class="text-muted">None</div>`;
  }

  // ----------------------------
  // Change Status Modal (API call)
  // ----------------------------
  let modalVehicleId = null;

  function openStatusModal(vehicleId) {
    const v = state.vehicles.find(x => String(x.vehicle_id) === String(vehicleId));
    if (!v) return;

    modalVehicleId = String(v.vehicle_id);

    $("serviceModalVehicleLabel").textContent = label(v);
    $("serviceModalUpdatedBy").value = ""; // user must enter

    // Backend now uses DEFICIENT (no DEFICIENCIES mapping needed)
    $("serviceModalStatus").value = safeStatus(v.status);

    $("serviceModalNotes").value = (v.notes || "").toString();
    $("serviceModalMeta").textContent = `Vehicle ID: ${v.vehicle_id}`;
    $("serviceModalError").classList.add("d-none");
    $("serviceModalError").textContent = "";

    const el = document.getElementById("serviceModal");
    if (!el || !window.bootstrap?.Modal) return;

    const modal = window.bootstrap.Modal.getOrCreateInstance(el, {
      backdrop: true,
      keyboard: true,
      focus: true,
    });

    modal.show();
  }

  async function saveStatusModal() {
    const err = $("serviceModalError");

    if (!modalVehicleId) return;

    const updatedBy = ($("serviceModalUpdatedBy")?.value || "").trim();
    if (!updatedBy) {
      if (err) {
        err.textContent = "Updated by is required.";
        err.classList.remove("d-none");
      }
      return;
    }

    const status = safeStatus($("serviceModalStatus").value);
    const notesRaw = ($("serviceModalNotes").value || "").trim();
    

    const url = `/api/vehicles/${encodeURIComponent(String(modalVehicleId))}/status`;

    const body = {
      updated_by: updatedBy,
      status,
      notes: notesRaw ? notesRaw : null,
    };

    try {
      const res = await fetch(url, {
        method: "PATCH",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status} — ${text}`);
      }

      // Close modal
      const el = document.getElementById("serviceModal");
      const modal = el && window.bootstrap?.Modal ? window.bootstrap.Modal.getInstance(el) : null;
      try { modal?.hide(); } catch (_) {}

      await load();
    } catch (e) {
      console.error("Failed to save vehicle status:", e);
      if (err) {
        err.textContent = "Failed to save. Check server logs for details.";
        err.classList.remove("d-none");
      }
    }
  }


  // ----------------------------
  // Wiring
  // ----------------------------
  function applyThresholdsFromUI() {
    const overdueDays = parseInt($("threshold-inspection-days")?.value ?? "7", 10);
    state.thresholds.inspectionOverdueDays = Number.isFinite(overdueDays) ? overdueDays : 7;
    collapseAllExpanded();
    load();
  }

  function clearFiltersAndSearch() {
    $("flt-open-defs").checked = false;
    $("flt-inspection-overdue").checked = false;
    $("flt-km-overdue").checked = false;
    $("fleet-search").value = "";
    collapseAllExpanded();
    renderList();
  }

  function onControlsChanged() {
    collapseAllExpanded();
    renderList();
  }

  function wireGlobalClickHandlers() {
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;

      const action = btn.getAttribute("data-action");
      const vid = btn.getAttribute("data-vehicle-id");

      if (action === "toggle-row" && vid) {
        toggleRow(vid);
        return;
      }

      if (action === "toggle-defs" && vid) {
        toggleDefs(vid);
        return;
      }

      if (action === "copy-inspection-nudge") {
        copyInspectionNudge(btn);
        return;
      }

      if (action === "open-status-modal" && vid) {
        openStatusModal(vid);
        return;
      }
    });
  }

  function init() {
    $("fleet-refresh")?.addEventListener("click", () => {
      collapseAllExpanded();
      load();
    });

    $("threshold-apply")?.addEventListener("click", applyThresholdsFromUI);

    const threshEl = $("threshold-inspection-days");
    if (threshEl) threshEl.value = String(state.thresholds.inspectionOverdueDays);

    $("fleet-search")?.addEventListener("input", onControlsChanged);
    $("fleet-search-clear")?.addEventListener("click", () => {
      $("fleet-search").value = "";
      onControlsChanged();
      $("fleet-search")?.focus();
    });

    $("flt-open-defs")?.addEventListener("change", onControlsChanged);
    $("flt-inspection-overdue")?.addEventListener("change", onControlsChanged);
    $("flt-km-overdue")?.addEventListener("change", onControlsChanged);

    $("fleet-filters-clear")?.addEventListener("click", clearFiltersAndSearch);

    $("serviceModalSave")?.addEventListener("click", saveStatusModal);

    wireGlobalClickHandlers();
    load();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
