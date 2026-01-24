// static/js/fleet_overview.js

(() => {
  // ---------------------------------------------------------------------------
  // Config + state
  // ---------------------------------------------------------------------------
  const state = {
    thresholds: {
      dueSoonKm: 1000,
      inspectionOverdueDays: 7,
    },
    // shape we expect from backend later
    // vehicles: [{ vehicle_id, name, assigned_tech, current_km, next_service_km, last_inspection_at, fluids: {oil, coolant}, notes }]
    vehicles: [],
    generatedAt: null,
  };

  // TODO: replace with real backend route later
  const API_URL = "/api/fleet_overview"; // scaffold only

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

  function daysSince(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  function kmRemaining(v) {
    const cur = typeof v.current_km === "number" ? v.current_km : null;
    const due = typeof v.next_service_km === "number" ? v.next_service_km : null;
    if (cur == null || due == null) return null;
    return due - cur;
  }

  function bucketFor(v) {
    const remaining = kmRemaining(v);
    if (remaining == null) return "ok"; // unknown km -> treat ok for now (or create a "needs data" later)
    if (remaining <= 0) return "due_now";
    if (remaining <= state.thresholds.dueSoonKm) return "due_soon";
    return "ok";
  }

  function fluidFlags(v) {
    // Keep flexible: techs may enter strings like "OK", "LOW", "EMPTY"
    const oil = (v?.fluids?.oil || "").toString().trim().toLowerCase();
    const coolant = (v?.fluids?.coolant || "").toString().trim().toLowerCase();

    const flags = [];
    const isLow = (s) => ["low", "very low", "empty", "needs", "bad"].includes(s);

    if (oil && isLow(oil)) flags.push({ label: "Oil Low", tone: "warning" });
    if (coolant && isLow(coolant)) flags.push({ label: "Coolant Low", tone: "warning" });

    return flags;
  }

  function inspectionOverdue(v) {
    const d = daysSince(v.last_inspection_at);
    if (d == null) return true; // missing date => overdue
    return d > state.thresholds.inspectionOverdueDays;
  }

  function setUpdated(ts) {
    const el = $("fleet-updated");
    if (!el) return;
    const dt = ts ? new Date(ts) : new Date();
    el.textContent = `Updated ${dt.toLocaleString()}`;
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function renderKpis({ total, dueNow, dueSoon, ok, missingInspections }) {
    const wrap = $("fleet-kpis");
    if (!wrap) return;

    wrap.innerHTML = `
      <div class="col-6 col-lg-3">
        <div class="kpi-card">
          <div class="kpi-label"><i class="bi bi-truck"></i> Total Vehicles</div>
          <div class="kpi-value">${fmtInt(total)}</div>
        </div>
      </div>
      <div class="col-6 col-lg-3">
        <div class="kpi-card">
          <div class="kpi-label"><i class="bi bi-exclamation-octagon"></i> Due Now</div>
          <div class="kpi-value">${fmtInt(dueNow)}</div>
        </div>
      </div>
      <div class="col-6 col-lg-3">
        <div class="kpi-card">
          <div class="kpi-label"><i class="bi bi-exclamation-triangle"></i> Due Soon</div>
          <div class="kpi-value">${fmtInt(dueSoon)}</div>
        </div>
      </div>
      <div class="col-6 col-lg-3">
        <div class="kpi-card">
          <div class="kpi-label"><i class="bi bi-clipboard-x"></i> Missing Inspections</div>
          <div class="kpi-value">${fmtInt(missingInspections)}</div>
        </div>
      </div>
    `;
  }

  function vehicleCard(v) {
    const name = escapeHtml(v.name || v.vehicle_id || "Unknown vehicle");
    const tech = escapeHtml(v.assigned_tech || "Unassigned");
    const remaining = kmRemaining(v);
    const remainingText =
      remaining == null ? "KM remaining: —" : `KM remaining: ${fmtInt(remaining)}`;

    const currentKm = (typeof v.current_km === "number") ? fmtInt(v.current_km) : "—";
    const nextKm = (typeof v.next_service_km === "number") ? fmtInt(v.next_service_km) : "—";

    const flags = fluidFlags(v);
    const overdue = inspectionOverdue(v);

    const badgeBits = [];
    if (overdue) badgeBits.push(`<span class="badge-soft badge-soft--danger"><i class="bi bi-clipboard-x me-1"></i>Inspection Missing</span>`);
    for (const f of flags) {
      const toneClass = f.tone === "warning" ? "badge-soft--warning" : "badge-soft";
      badgeBits.push(`<span class="badge-soft ${toneClass}"><i class="bi bi-droplet-half me-1"></i>${escapeHtml(f.label)}</span>`);
    }

    const lastIns = v.last_inspection_at ? new Date(v.last_inspection_at).toLocaleDateString() : "—";
    const note = (v.notes || "").toString().trim();
    const noteLine = note ? `<div class="vehicle-reason"><i class="bi bi-card-text me-1"></i>${escapeHtml(note)}</div>` : "";

    return `
      <div class="vehicle-item">
        <div class="vehicle-top">
          <div>
            <div class="vehicle-name">${name}</div>
            <div class="vehicle-meta">
              <span><i class="bi bi-person-badge me-1"></i>${tech}</span>
              <span><i class="bi bi-speedometer me-1"></i>${remainingText}</span>
            </div>
            <div class="vehicle-meta">
              <span>Current: <strong>${currentKm}</strong></span>
              <span>Due: <strong>${nextKm}</strong></span>
              <span>Last inspection: <strong>${escapeHtml(lastIns)}</strong></span>
            </div>
            ${noteLine}
          </div>
          <div class="vehicle-badges">
            ${badgeBits.join("")}
          </div>
        </div>
      </div>
    `;
  }

  function renderBuckets(vehicles) {
    const dueNow = $("bucket-due-now");
    const dueSoon = $("bucket-due-soon");
    const ok = $("bucket-ok");

    if (!dueNow || !dueSoon || !ok) return;

    const dueNowList = [];
    const dueSoonList = [];
    const okList = [];

    for (const v of vehicles) {
      const b = bucketFor(v);
      if (b === "due_now") dueNowList.push(v);
      else if (b === "due_soon") dueSoonList.push(v);
      else okList.push(v);
    }

    // Sort by remaining km (ascending) so the most urgent is on top
    const byRemaining = (a, b) => {
      const ra = kmRemaining(a);
      const rb = kmRemaining(b);
      if (ra == null && rb == null) return 0;
      if (ra == null) return 1;
      if (rb == null) return -1;
      return ra - rb;
    };

    dueNowList.sort(byRemaining);
    dueSoonList.sort(byRemaining);
    okList.sort(byRemaining);

    $("bucket-due-now-count").textContent = String(dueNowList.length);
    $("bucket-due-soon-count").textContent = String(dueSoonList.length);
    $("bucket-ok-count").textContent = String(okList.length);

    dueNow.innerHTML = dueNowList.length ? dueNowList.map(vehicleCard).join("") : `<div class="text-muted small">No vehicles overdue.</div>`;
    dueSoon.innerHTML = dueSoonList.length ? dueSoonList.map(vehicleCard).join("") : `<div class="text-muted small">No vehicles due soon.</div>`;
    ok.innerHTML = okList.length ? okList.map(vehicleCard).join("") : `<div class="text-muted small">No vehicles in OK bucket.</div>`;
  }

  function renderMissingInspectionsTable(vehicles) {
    const tbody = $("missing-inspections-tbody");
    if (!tbody) return;

    const missing = vehicles
      .filter(inspectionOverdue)
      .map(v => {
        const name = escapeHtml(v.name || v.vehicle_id || "Unknown vehicle");
        const tech = escapeHtml(v.assigned_tech || "Unassigned");
        const last = v.last_inspection_at ? new Date(v.last_inspection_at).toLocaleDateString() : "—";
        const overdueDays = daysSince(v.last_inspection_at);
        const overdueText = overdueDays == null ? "—" : String(overdueDays - state.thresholds.inspectionOverdueDays);
        return { name, tech, last, overdueText };
      })
      // most overdue first
      .sort((a, b) => {
        const ia = parseInt(a.overdueText, 10);
        const ib = parseInt(b.overdueText, 10);
        if (Number.isNaN(ia) && Number.isNaN(ib)) return 0;
        if (Number.isNaN(ia)) return 1;
        if (Number.isNaN(ib)) return -1;
        return ib - ia;
      });

    $("missing-inspections-panel-count").textContent = String(missing.length);

    const banner = $("missing-inspections-banner");
    const bannerCount = $("missing-inspections-count");
    if (banner && bannerCount) {
      bannerCount.textContent = String(missing.length);
      banner.classList.toggle("d-none", missing.length === 0);
    }

    if (!missing.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="4" class="text-muted small">No missing inspections 🎉</td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = missing.map(r => `
      <tr>
        <td class="fw-semibold">${r.name}</td>
        <td>${r.tech}</td>
        <td>${r.last}</td>
        <td class="text-end fw-semibold">${escapeHtml(r.overdueText)}</td>
      </tr>
    `).join("");
  }

  function renderAll(payload) {
    const vehicles = Array.isArray(payload?.vehicles) ? payload.vehicles : [];
    state.vehicles = vehicles;
    state.generatedAt = payload?.generated_at || new Date().toISOString();

    const dueNow = vehicles.filter(v => bucketFor(v) === "due_now").length;
    const dueSoon = vehicles.filter(v => bucketFor(v) === "due_soon").length;
    const okCount = vehicles.length - dueNow - dueSoon;
    const missingInspections = vehicles.filter(inspectionOverdue).length;

    setUpdated(state.generatedAt);

    renderKpis({
      total: vehicles.length,
      dueNow,
      dueSoon,
      ok: okCount,
      missingInspections,
    });

    renderBuckets(vehicles);
    renderMissingInspectionsTable(vehicles);
  }

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------
  async function fetchFleetOverview() {
    // Scaffold: attempt backend, otherwise fallback mock
    try {
      const res = await fetch(API_URL, { headers: { "Accept": "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      // Mock sample so the UI scaffolding is visible immediately
      return {
        generated_at: new Date().toISOString(),
        vehicles: [
          {
            vehicle_id: "VAN-12",
            name: "VAN-12",
            assigned_tech: "Jamie",
            current_km: 124500,
            next_service_km: 124000,
            last_inspection_at: null,
            fluids: { oil: "low", coolant: "ok" },
            notes: "Oil looks low, please top up soon."
          },
          {
            vehicle_id: "VAN-07",
            name: "VAN-07",
            assigned_tech: "Chris",
            current_km: 88200,
            next_service_km: 89000,
            last_inspection_at: new Date(Date.now() - 9 * 86400000).toISOString(),
            fluids: { oil: "ok", coolant: "low" },
            notes: ""
          },
          {
            vehicle_id: "VAN-03",
            name: "VAN-03",
            assigned_tech: "Taylor",
            current_km: 45120,
            next_service_km: 50000,
            last_inspection_at: new Date(Date.now() - 2 * 86400000).toISOString(),
            fluids: { oil: "ok", coolant: "ok" },
            notes: ""
          }
        ]
      };
    }
  }

  async function load() {
    const payload = await fetchFleetOverview();
    renderAll(payload);
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------
  function applyThresholdsFromUI() {
    const dueSoon = parseInt($("threshold-due-soon")?.value ?? "1000", 10);
    const overdueDays = parseInt($("threshold-inspection-days")?.value ?? "7", 10);

    state.thresholds.dueSoonKm = Number.isFinite(dueSoon) ? dueSoon : 1000;
    state.thresholds.inspectionOverdueDays = Number.isFinite(overdueDays) ? overdueDays : 7;

    // re-render with current cached data
    renderAll({ generated_at: state.generatedAt, vehicles: state.vehicles });
  }

  function init() {
    $("fleet-refresh")?.addEventListener("click", load);
    $("threshold-apply")?.addEventListener("click", applyThresholdsFromUI);

    $("missing-inspections-jump")?.addEventListener("click", () => {
      $("missing-inspections-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    // initial values
    $("threshold-due-soon").value = String(state.thresholds.dueSoonKm);
    $("threshold-inspection-days").value = String(state.thresholds.inspectionOverdueDays);

    load();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
