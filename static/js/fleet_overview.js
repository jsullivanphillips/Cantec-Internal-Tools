// static/js/fleet_overview.js
(() => {
  const API_URL = "/api/fleet_overview/triage";

  const VALID_VEHICLE_STATUSES = new Set(["OK", "DUE", "DEFICIENT", "BOOKED", "IN_SHOP"]);

  // Bucket order (top to bottom)
  const BUCKET_ORDER = ["IN_SHOP", "BOOKED", "DEFICIENT", "DUE", "OK"];

  // Add this in the state object (around line 15)
  const state = {
    thresholds: { inspectionOverdueDays: 7 },
    payload: null,
    vehicles: [],
    expanded: new Set(), // vehicle_id
    searchQuery: "", 
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

  function bucketTitle(status) {
    const s = safeStatus(status);
    if (s === "IN_SHOP") return "IN SHOP";
    if (s === "BOOKED") return "BOOKED";
    if (s === "DEFICIENT") return "DEFICIENT";
    if (s === "DUE") return "DUE";
    return "OK";
  }

  function bucketIcon(status) {
    const s = safeStatus(status);
    if (s === "IN_SHOP") return "bi-tools";
    if (s === "BOOKED") return "bi-calendar-check";
    if (s === "DEFICIENT") return "bi-exclamation-octagon";
    if (s === "DUE") return "bi-speedometer2";
    return "bi-check2-circle";
  }

  function label(v) {
    return v.search_label || `${v.make_model || "Vehicle"} (${v.license_plate || "—"})`;
  }

  function kmOverdue(v) {
    if (typeof v.km_remaining === "number" && Number.isFinite(v.km_remaining)) {
      return v.km_remaining <= 0;
    }
    const cur = (typeof v.latest_current_km === "number" ? v.latest_current_km : null);
    const due = (typeof v.latest_service_due_km === "number" ? v.latest_service_due_km : null);
    if (cur == null || due == null) return false;
    return cur >= due;
  }

  function inspectionOverdue(v) {
    if (typeof v.inspection_is_overdue === "boolean") return v.inspection_is_overdue;

    if (!v.last_submission_at) return true;
    const d = new Date(v.last_submission_at);
    if (Number.isNaN(d.getTime())) return true;

    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
    return diffDays > Number(state.thresholds.inspectionOverdueDays || 7);
  }

  function openDeficiencies(v) {
    const n = Number(v.open_deficiency_count || 0);
    const deficient = (safeStatus(v.status) === "DEFICIENT");
    return n > 0 || deficient;
  }

  function oilOverdue(v) {
    return kmOverdue(v);
  }

  function renderKpis() {
    const vehicles = Array.isArray(state.vehicles) ? state.vehicles : [];

    const oil = vehicles.filter(oilOverdue).length;
    const defs = vehicles.filter(openDeficiencies).length;
    const insp = vehicles.filter(inspectionOverdue).length;

    const oilEl = $("kpi-oil-overdue");
    const defEl = $("kpi-deficient");
    const inspEl = $("kpi-inspection-overdue");

    if (oilEl) oilEl.textContent = String(oil);
    if (defEl) defEl.textContent = String(defs);
    if (inspEl) inspEl.textContent = String(insp);
  }

  function filterVehiclesBySearch(query) {
    if (!query || query.length < 2) return [];
    
    const q = query.toLowerCase().trim();
    const vehicles = Array.isArray(state.vehicles) ? state.vehicles : [];
    
    return vehicles.filter(v => {
      const tech = (v.current_driver_name || "").toLowerCase();
      const plate = (v.license_plate || "").toLowerCase();
      return tech.includes(q) || plate.includes(q);
    });
  }

  function renderSearchDropdown(results) {
    const dropdown = $("fleet-search-dropdown");
    if (!dropdown) return;
    
    if (!results || results.length === 0) {
      dropdown.classList.remove("show");
      return;
    }
    
    // Limit to 3 results
    const limited = results.slice(0, 3);
    
    const html = limited.map(v => {
      const vehName = escapeHtml(label(v));
      const tech = escapeHtml(v.current_driver_name || "Unassigned");
      const plate = escapeHtml(v.license_plate || "—");
      const id = String(v.vehicle_id);
      
      return `
        <button 
          type="button"
          class="dropdown-item d-flex flex-column py-2"
          data-action="search-select"
          data-vehicle-id="${escapeHtml(id)}"
        >
          <div class="d-flex align-items-center gap-2">
            <strong>${tech}</strong>
            <span class="text-muted">•</span>
            <span>${vehName}</span>
            ${statusBadge(v.status)}
          </div>
          <small class="text-muted">Plate: ${plate}</small>
        </button>
      `;
    }).join("");
    
    dropdown.innerHTML = html;
    dropdown.classList.add("show");
  }

  function handleSearchInput(e) {
    const query = e.target.value;
    state.searchQuery = query;
    
    if (!query || query.length < 2) {
      const dropdown = $("fleet-search-dropdown");
      if (dropdown) dropdown.classList.remove("show");
      return;
    }
    
    const results = filterVehiclesBySearch(query);
    renderSearchDropdown(results);
  }

  function handleSearchSelect(vehicleId) {
    const id = String(vehicleId);
    
    // Clear search
    const input = $("fleet-search-input");
    if (input) input.value = "";
    state.searchQuery = "";
    
    const dropdown = $("fleet-search-dropdown");
    if (dropdown) dropdown.classList.remove("show");
    
    // Expand the vehicle row
    state.expanded.add(id);
    renderBuckets();
    
    // Scroll to the vehicle
    setTimeout(() => {
      const body = document.querySelector(`[data-expand-body="${CSS.escape(id)}"]`);
      if (body) {
        body.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 100);
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
      const lbl = (typeof od === "number" && Number.isFinite(od))
        ? `${fmtInt(od)}d overdue`
        : (!v.last_submission_at ? "never inspected" : "overdue");
      parts.push(`<span class="badge text-bg-warning-subtle border border-warning-subtle text-warning-emphasis">
        <i class="bi bi-clipboard-x me-1"></i>${escapeHtml(lbl)}
      </span>`);
    }

    if (tags.includes("KM_OVERDUE")) {
      const rem = v.km_remaining;
      const lbl = (typeof rem === "number" && Number.isFinite(rem))
        ? `${fmtInt(rem)} km remaining`
        : "KM overdue";
      parts.push(`<span class="badge text-bg-primary-subtle border border-primary-subtle text-primary-emphasis">
        <i class="bi bi-speedometer2 me-1"></i>${escapeHtml(lbl)}
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

  function sortByLabelAsc(items) {
    items.sort((a, b) => label(a).toLowerCase().localeCompare(label(b).toLowerCase()));
    return items;
  }

  // ----------------------------
  // Rendering (Buckets)
  // ----------------------------
  function collapseAllExpanded() {
    state.expanded.clear();
  }

  function groupByStatus(vehicles) {
    const buckets = new Map();
    for (const st of BUCKET_ORDER) buckets.set(st, []);
    for (const v of vehicles) {
      const s = safeStatus(v.status);
      if (!buckets.has(s)) buckets.set(s, []);
      buckets.get(s).push(v);
    }
    // sort within each bucket
    for (const [k, arr] of buckets.entries()) sortByLabelAsc(arr);
    return buckets;
  }

  function renderBuckets() {
    const wrap = $("fleet-buckets");
    if (!wrap) return;

    const vehicles = Array.isArray(state.vehicles) ? [...state.vehicles] : [];
    if (!vehicles.length) {
      wrap.innerHTML = `<div class="col-12"><div class="text-muted small py-4">No vehicles found.</div></div>`;
      return;
    }

    const buckets = groupByStatus(vehicles);

    // Layout:
    // Row 1: IN_SHOP + BOOKED (half/half)
    // Row 2: DEFICIENT + DUE (half/half)
    // Row 3: OK (full width)
    const layout = [
      { status: "IN_SHOP", col: "col-12 col-lg-6" },
      { status: "BOOKED", col: "col-12 col-lg-6" },
      { status: "DEFICIENT", col: "col-12 col-lg-6" },
      { status: "DUE", col: "col-12 col-lg-6" },
      { status: "OK", col: "col-12" },
    ];

    wrap.innerHTML = layout.map(({ status, col }) => {
      const items = buckets.get(status) || [];
      return renderBucketCard(status, items, col);
    }).join("");
  }

  function renderBucketCard(status, items, colClass) {
    const s = safeStatus(status);
    const title = bucketTitle(s);
    const icon = bucketIcon(s);
    const count = items.length;

    const bodyHtml = count
      ? `<div class="list-group list-group-flush">${items.map(v => renderRow(v)).join("")}</div>`
      : `<div class="p-3 text-muted small">No vehicles.</div>`;

    return `
      <div class="${colClass}">
        <div class="card border-0 shadow-sm">
          <div class="card-header bg-white d-flex align-items-center gap-2">
            <i class="bi ${escapeHtml(icon)}"></i>
            <span class="fw-semibold">${escapeHtml(title)}</span>
            <span class="ms-auto badge text-bg-secondary">${escapeHtml(String(count))}</span>
          </div>
          ${bodyHtml}
        </div>
      </div>
    `;
  }


  function renderRow(v) {
    const id = String(v.vehicle_id);
    const isOpen = state.expanded.has(id);

    const vehName = escapeHtml(label(v));
    const tech = escapeHtml(v.current_driver_name || "Unassigned");
    const last = escapeHtml(fmtDate(v.last_submission_at));

    const chips = issueChips(v);
    const href = vehicleHref(v.vehicle_id);

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

    const showDefsToggle = openCount > 3
      ? `<button class="btn btn-sm btn-outline-secondary mt-2"
                 type="button"
                 data-action="toggle-defs"
                 data-vehicle-id="${escapeHtml(id)}"
                 data-showing="top">
            Show all ${escapeHtml(fmtInt(openCount))} deficiencies
         </button>`
      : "";

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
    return vehicles.map(v => ({
      ...v,
      status: safeStatus(v.status),
    }));
  }

  async function load() {
    const wrap = $("fleet-buckets");
    try {
      const payload = await fetchTriage();
      state.payload = payload;
      state.vehicles = normalizeVehicles(payload);
      setUpdated(payload?.generated_at || new Date().toISOString());

      collapseAllExpanded();
      renderBuckets();
      renderKpis();
    } catch (e) {
      console.error("Failed to load fleet overview:", e);
      if (wrap) {
        wrap.innerHTML = `
          <div class="col-12">
            <div class="alert alert-danger mb-0">
              Failed to load fleet overview. Check server logs.
            </div>
          </div>
        `;
      }
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
    renderBuckets(); // re-render buckets; preserves same behavior
  }

  function toggleDefs(vehicleId) {
    const id = String(vehicleId);
    const v = state.vehicles.find(x => String(x.vehicle_id) === id);
    if (!v) return;

    const list = document.querySelector(`[data-defs-list="${CSS.escape(id)}"]`);
    const toggleWrap = document.querySelector(`[data-defs-toggle-wrap="${CSS.escape(id)}"]`);
    if (!list || !toggleWrap) return;

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
    $("serviceModalUpdatedBy").value = "";

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

  function wireGlobalClickHandlers() {
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;

      const action = btn.getAttribute("data-action");
      const vid = btn.getAttribute("data-vehicle-id");

      // IMPORTANT: prevent Bootstrap accordion from reacting to clicks inside the body
      // and prevent any accidental navigation behavior.
      e.preventDefault();
      e.stopPropagation();

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
      
      // ADD THIS
      if (action === "search-select" && vid) {
        handleSearchSelect(vid);
        return;
      }
    });
    
    // ADD THIS - Close dropdown when clicking outside
    document.addEventListener("click", (e) => {
      const searchInput = $("fleet-search-input");
      const dropdown = $("fleet-search-dropdown");
      
      if (dropdown && searchInput && 
          !searchInput.contains(e.target) && 
          !dropdown.contains(e.target)) {
        dropdown.classList.remove("show");
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

    $("serviceModalSave")?.addEventListener("click", saveStatusModal);
    
    // ADD THIS
    const searchInput = $("fleet-search-input");
    if (searchInput) {
      searchInput.addEventListener("input", handleSearchInput);
    }

    wireGlobalClickHandlers();
    load();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
