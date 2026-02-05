// static/js/vehicle_details.js

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const root = document.getElementById("vehicleDetailsRoot");
  const vehicleId = Number(root?.dataset?.vehicleId || 0);

  const state = {
    vehicle: null,
    latest: null,          // latest submission snapshot
    serviceEvents: [],
    deficiencies: [],
    submissions: [],
    showAllDefs: false,
    activeDef: null,
    activeService: null,
  };

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function linkedDefIdsForService(serviceId) {
    const sid = serviceId != null ? String(serviceId) : null;
    if (!sid) return [];
    return (state.deficiencies || [])
      .filter((d) => {
        const linked = d.linked_service_id ?? d.linkedServiceId ?? null;
        return linked != null && String(linked) === sid;
      })
      .map((d) => Number(defId(d)))
      .filter(Boolean);
  }


  function fmtDateTime(v) {
    if (!v) return "—";
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toLocaleString();
  }

  function badgeServiceStatus(status) {
    const s = (status || "").toUpperCase();

    switch (s) {
      case "BOOKED":
        return `<span class="badge text-bg-warning">BOOKED</span>`;

      case "COMPLETE":
        return `<span class="badge text-bg-success">COMPLETE</span>`;

      case "CANCELED":
        return `<span class="badge text-bg-secondary">CANCELED</span>`;

      default:
        return `<span class="badge text-bg-light text-dark">UNKNOWN</span>`;
    }
  }



  function fmtDate(v) {
    if (!v) return "—";
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString();
  }

  function getAllDeficienciesForPicker() {
    const all = state.deficiencies || [];
    const activeServiceId = state.activeService?.id
      ? String(state.activeService.id)
      : null;

    return all.filter((d) => {
      const status = String(d.status || "").toUpperCase();
      const linkedServiceId = d.linked_service_id != null
        ? String(d.linked_service_id)
        : null;

      // Always allow deficiencies already linked to THIS service
      if (activeServiceId && linkedServiceId === activeServiceId) {
        return true;
      }

      // Exclude deficiencies linked to some OTHER service
      if (linkedServiceId && linkedServiceId !== activeServiceId) {
        return false;
      }

      // Otherwise, only show OPEN deficiencies
      return status === "OPEN";
    });
  }


  function deficiencyLabel(d) {
    const sev = (d?.severity || "").toUpperCase();
    const st = (d?.status || "").toUpperCase();
    const desc = (d?.description || "").trim();
    const left = sev ? `[${sev}]` : "[DEF]";
    const mid = st ? `(${st})` : "";
    const short = desc.length > 90 ? desc.slice(0, 90) + "…" : desc;
    return `${left} ${mid} ${short}`.replace(/\s+/g, " ").trim();
  }

  // --- Deficiency picker (single-click toggle) -------------------------------

  function wireToggleSelect(selectEl) {
    if (!selectEl || selectEl.dataset.toggleWired === "1") return;
    selectEl.dataset.toggleWired = "1";

    const handler = (e) => {
      const opt = e.target.closest("option");
      if (!opt) return;

      e.preventDefault();
      e.stopPropagation();

      opt.selected = !opt.selected; // toggle on/off

      // fire change so your code can read selectedOptions
      selectEl.dispatchEvent(new Event("change", { bubbles: true }));
    };

    selectEl.addEventListener("pointerdown", handler);
  }



  function getToggleSelectedIds(selectEl) {
    if (!selectEl) return [];
    return Array.from(selectEl.selectedOptions)
      .map((o) => Number(o.value))
      .filter(Boolean);
  }

  function defId(d) {
    // Support multiple payload shapes
    return d?.id ?? d?.deficiency_id ?? null;
  }


  function fillDefSelect(selectEl, selectedIds) {
    if (!selectEl) return;
    wireToggleSelect(selectEl);

    const selected = new Set((selectedIds || []).map((x) => String(x)));
    const defs = getAllDeficienciesForPicker();

    const sorted = [...defs].sort((a, b) => {
      const aOpen = String(a?.status || "").toUpperCase() !== "FIXED";
      const bOpen = String(b?.status || "").toUpperCase() !== "FIXED";
      if (aOpen !== bOpen) return aOpen ? -1 : 1;

      const ad = a?.updated_at ? Date.parse(a.updated_at) : 0;
      const bd = b?.updated_at ? Date.parse(b.updated_at) : 0;
      return bd - ad;
    });

    selectEl.innerHTML = "";
    for (const d of sorted) {
      const id = defId(d);
      if (!id) continue;

      const opt = document.createElement("option");
      opt.value = String(id);
      opt.textContent = deficiencyLabel(d);
      opt.selected = selected.has(String(id)); // ✅ FIX
      selectEl.appendChild(opt);
    }
  }




  function titleCase(s) {
    const x = String(s ?? "").trim();
    if (!x) return "—";
    return x
      .toLowerCase()
      .split(/[_\s]+/)
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ""))
      .join(" ");
  }


  function toDateInputValue(isoOrDate) {
    if (!isoOrDate) return "";
    // If backend returns "YYYY-MM-DD", keep it
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(isoOrDate))) return String(isoOrDate);

    const d = new Date(isoOrDate);
    if (Number.isNaN(d.getTime())) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }


  function badgeDefStatus(st) {
    const s = String(st || "").toUpperCase();
    if (s === "OPEN") return `<span class="badge text-bg-danger">OPEN</span>`;
    if (s === "BOOKED") return `<span class="badge text-bg-primary">BOOKED</span>`;
    if (s === "FIXED") return `<span class="badge text-bg-success">FIXED</span>`;
    if (s === "INVALID") return `<span class="badge text-bg-secondary">INVALID</span>`;
    return `<span class="badge text-bg-secondary">${escapeHtml(s || "—")}</span>`;
  }

  function pillForVehicleStatus(status) {
    const s = String(status || "").toUpperCase();
    if (s === "OK") return { cls: "vd-pill vd-pill--ok", label: "OK" };
    if (s === "DUE") return { cls: "vd-pill vd-pill--due", label: "DUE" };
    if (s === "DEFICIENT") return { cls: "vd-pill vd-pill--def", label: "DEFICIENT" };
    if (s === "BOOKED") return { cls: "vd-pill vd-pill--booked", label: "BOOKED" };
    if (s === "IN_SHOP") return { cls: "vd-pill vd-pill--shop", label: "IN SHOP" };
    return { cls: "vd-pill", label: s || "—" };
  }


  function safeVehicleStatus(s) {
    const up = String(s || "OK").toUpperCase();
    const allowed = new Set(["OK", "DUE", "DEFICIENT", "BOOKED", "IN_SHOP"]);
    return allowed.has(up) ? up : "OK";
  }


  function getActorName() {
    // prefer cached name
    const cached = localStorage.getItem("vd_actor_name");
    if (cached && cached.trim()) return cached.trim();
    return "";
  }

  function setActorName(v) {
    const name = String(v || "").trim();
    if (name) localStorage.setItem("vd_actor_name", name);
  }

  async function apiCreateServiceEvent(body) {
    const resp = await fetch(`/api/vehicle_service_events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      throw new Error(`Failed to create service event: ${resp.status} ${txt}`);
    }

    // Expect JSON; if your backend returns empty, change this to .catch(() => ({}))
    return await resp.json();
  }

  async function apiPatchServiceEvent(serviceEventId, patch) {
    const resp = await fetch(`/api/vehicle_service_events/${serviceEventId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(patch),
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      throw new Error(`Failed to update service event: ${resp.status} ${txt}`);
    }
    return await resp.json().catch(() => ({}));
  }



  async function apiGetVehicleDetails() {
    const resp = await fetch(`/api/vehicles/${vehicleId}`, {
      headers: { "Accept": "application/json" },
      credentials: "same-origin",
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      throw new Error(`Failed to load vehicle: ${resp.status} ${txt}`);
    }
    return await resp.json();
  }

  async function apiCreateDeficiency(vehicleId, body) {
    const resp = await fetch(`/api/vehicles/${vehicleId}/deficiencies`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      throw new Error(`Failed to create deficiency: ${resp.status} ${txt}`);
    }
    return await resp.json();
  }


  async function apiPatchDeficiency(defId, patch) {
    const resp = await fetch(`/api/vehicle_deficiencies/${defId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(patch),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      throw new Error(`Failed to update deficiency: ${resp.status} ${txt}`);
    }
    return await resp.json().catch(() => ({}));
  }

  function normalizePayload(payload) {
    // This is intentionally defensive because your exact JSON shape may evolve.
    // Expected-ish:
    // payload.vehicle { make_model, license_plate, year, color, current_status?, latest_submission? ... }
    // payload.service_events []
    // payload.open_deficiencies [] or payload.deficiencies []
    // payload.recent_subs [] or payload.submissions []
    const v = payload?.vehicle || {};
    const latest = payload?.latest_submission || payload?.vehicle?.latest_submission || payload?.latest || null;

    const serviceEvents =
      payload?.service_events ||
      payload?.vehicle_service_events ||
      payload?.serviceEvents ||
      [];

    const deficiencies =
      payload?.deficiencies ||
      payload?.open_deficiencies ||
      payload?.vehicle_deficiencies ||
      [];

    const submissions =
      payload?.recent_submissions ||          
      payload?.submissions ||
      payload?.recent_subs ||
      payload?.vehicle_submissions ||
      [];

    return { v, latest, serviceEvents, deficiencies, submissions };
  }


  function renderHeader() {
    const v = state.vehicle || {};
    const latest = state.latest || {};

    const makeModel = v.make_model || v.name || v.label || "Vehicle";
    const plate = v.license_plate ? `Plate: ${v.license_plate}` : "";
    const year = v.year ? `Year: ${v.year}` : "";
    const color = v.color ? `Colour: ${v.color}` : "";
    const tech = v.current_driver_name ? `${v.current_driver_name}` : "";
    const bits = [plate, year, color, tech].filter(Boolean).join(" • ");
    

    $("vd-title").textContent = makeModel;

    const subtitleLeft = bits || "—";
    const subtitleRight = latest?.submitted_at ? `Last inspection: ${fmtDateTime(latest.submitted_at)}` : "";
    $("vd-subtitle").textContent = subtitleRight ? `${subtitleLeft} — ${subtitleRight}` : subtitleLeft;

    const notes = (v.notes || "").toString().trim();
    const notesEl = $("vd-notes");
    if (notesEl && !notesEl.querySelector("textarea")) {
      notesEl.textContent = notes || "—";
      notesEl.classList.toggle("text-muted", !notes);
    }

    // metrics
    $("vd-odo").textContent = latest?.current_km ?? "—";
    $("vd-km-due").textContent = latest?.service_due_km ?? "—";
    $("vd-oil").textContent = latest?.oil_level || "—";
    $("vd-coolant").textContent = latest?.coolant_level || "—";
    $("vd-trans").textContent = latest?.transmission_level || v?.transmission_level || "—"; // if you add it later

    // status pill
    const pillEl = $("vd-status-pill");
    const st = v.current_status || v.status || v.vehicle_status || "";
    const pill = pillForVehicleStatus(st);
    pillEl.className = pill.cls;
    pillEl.textContent = pill.label;
    pillEl.classList.remove("d-none");
  }

  function renderService() {
    const tbody = $("vd-service-tbody");
    const empty = $("vd-service-empty");
    tbody.innerHTML = "";

    const rows = [...(state.serviceEvents || [])]
      .sort((a, b) => new Date(b.service_date || 0) - new Date(a.service_date || 0));

    $("vd-service-count").textContent = `(${rows.length})`;

    if (!rows.length) {
      empty.classList.remove("d-none");
      return;
    }
    empty.classList.add("d-none");

    for (const ev of rows) {
      const tr = document.createElement("tr");
      tr.className = "vd-row";
      tr.innerHTML = `
        <td>${escapeHtml(titleCase(ev.service_type))}</td>
        <td>${escapeHtml(fmtDate(ev.service_date))}</td>
        <td class="text-end">${badgeServiceStatus(ev.service_status)}</td>
      `;
      tr.addEventListener("click", () => openServiceModal(ev));
      tbody.appendChild(tr);
    }


  }

  function renderDeficiencies() {
    const tbody = $("vd-def-tbody");
    const empty = $("vd-def-empty");
    tbody.innerHTML = "";

    const all = [...(state.deficiencies || [])];

    // Sort chronological by updated_at (new -> old) as requested
    all.sort((b, a) => new Date(a.updated_at || 0) - new Date(b.updated_at || 0));

    const filtered = state.showAllDefs
      ? all
      : all.filter((d) => {
          const s = String(d.status || "").toUpperCase();
          return s === "OPEN" || s === "BOOKED";
        });

    $("vd-def-count").textContent = state.showAllDefs
      ? `(${filtered.length} shown / ${all.length} total)`
      : `(${filtered.length} open/booked)`;

    if (!filtered.length) {
      empty.classList.remove("d-none");
      return;
    }
    empty.classList.add("d-none");

    for (const d of filtered) {
      const tr = document.createElement("tr");
      tr.className = "vd-row";
      tr.innerHTML = `
        <td>${escapeHtml(d.description || "—")}</td>
        <td>${escapeHtml(d.severity || "—")}</td>
        <td>${badgeDefStatus(d.status)}</td>
        <td class="text-end">${escapeHtml(fmtDateTime(d.updated_at))}</td>
      `;
      tr.addEventListener("click", () => openDefModal(d));
      tbody.appendChild(tr);
    }
  }

  function renderInspections() {
    const tbody = $("vd-insp-tbody");
    const empty = $("vd-insp-empty");
    tbody.innerHTML = "";

    const rows = [...(state.submissions || [])]
      .sort((a, b) => new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0));

    $("vd-insp-count").textContent = `(${rows.length})`;

    $("vd-new-inspection-btn").href = `/fleet/inspection?vehicle_id=${encodeURIComponent(String(vehicleId))}`;

    if (!rows.length) {
      empty.classList.remove("d-none");
      return;
    }
    empty.classList.add("d-none");

    for (const sub of rows) {
      const tr = document.createElement("tr");
      tr.className = "vd-row";
      tr.innerHTML = `
        <td>${escapeHtml(fmtDateTime(sub.submitted_at))}</td>
        <td>${escapeHtml(sub.submitted_by || "—")}</td>
        <td class="text-end">${escapeHtml(sub.current_km ?? "—")}</td>
      `;
      tr.addEventListener("click", () => openInspectionModal(sub));
      tbody.appendChild(tr);
    }
  }

  function setServiceEditMode(on) {
    const view = document.getElementById("vd-service-view");
    const form = document.getElementById("vd-service-edit");
    const editBtn = document.getElementById("vd-service-edit-btn");

    if (!view || !form || !editBtn) {
      console.error("[vehicle_details] Missing service modal elements:", {
        view: !!view,
        form: !!form,
        editBtn: !!editBtn,
      });
      return;
    }

    if (on) {
      view.classList.add("d-none");
      form.classList.remove("d-none");
      editBtn.classList.add("d-none");
    } else {
      view.classList.remove("d-none");
      form.classList.add("d-none");
      editBtn.classList.remove("d-none");

      const st = document.getElementById("vd-service-save-status");
      if (st) st.textContent = "";
    }
  }

  function renderServiceView(ev) {
    const view = document.getElementById("vd-service-view");
    if (!view) return;

    // linked deficiencies derived from deficiencies table
    const serviceId = ev?.id != null ? String(ev.id) : null;
    const allDefs = state.deficiencies || [];
    const linkedDefs = serviceId
      ? allDefs.filter((d) => {
          const linked = d.linked_service_id ?? d.linkedServiceId ?? null;
          return linked != null && String(linked) === serviceId;
        })
      : [];

    const status = String(ev.service_status || "—").toUpperCase();
    const statusBadge = badgeServiceStatus(status);
    const dateText = ev.service_date ? fmtDateTime(ev.service_date) : "—";

    const notesText = (ev.service_notes || "").trim();

    const linkedItemsHtml = linkedDefs.length
    ? linkedDefs
        .map((d) => `
          <li>
            <div>${escapeHtml((d.description || "—").trim())}</div>
            <div class="text-muted small">
              Created by ${escapeHtml(d.created_by || "—")}
            </div>
          </li>
        `)
        .join("")
    : "";



    view.innerHTML = `
      <div class="vd-service-head">
        <div class="vd-service-title">
          ${escapeHtml(titleCase(ev.service_type || "—"))}
        </div>

        <div class="vd-service-subrow">
          <div class="vd-chip">
            <i class="bi bi-calendar-event me-1"></i>
            <span>${escapeHtml(dateText)}</span>
          </div>

          <div class="vd-chip">
            <i class="bi bi-flag me-1"></i>
            <span class="me-2">Status</span>
            ${statusBadge}
          </div>
        </div>

        <!-- Notes as plain text (high priority) -->
        <div class="vd-notes mt-3">
          <div class="vd-notes__label">
            <i class="bi bi-journal-text me-1"></i> Notes
          </div>
          <div class="vd-notes__text ${notesText ? "" : "text-muted"}">
            ${escapeHtml(notesText || "—")}
          </div>
        </div>
      </div>

      ${linkedDefs.length ? `
        <div class="vd-panel mt-3">
          <div class="vd-panel__head">
            <div class="vd-panel__title">
              <i class="bi bi-link-45deg me-1"></i> Linked Deficiencies
            </div>
            <span class="badge text-bg-light text-dark">${linkedDefs.length}</span>
          </div>

          <div class="vd-panel__body">
            <ul class="vd-list mb-0">
              ${linkedItemsHtml}
            </ul>
          </div>
        </div>
      ` : ""}


      <!-- Compact details -->
      <div class="vd-details-compact mt-3">
        <div class="vd-details-compact__title">Details</div>

        <div class="vd-details-compact__grid">
          <div class="vd-details-compact__item">
            <span class="vd-details-compact__k">Created</span>
            <span class="vd-details-compact__v">${escapeHtml(ev.created_by || "—")}</span>
            <span class="vd-details-compact__sep">•</span>
            <span class="vd-details-compact__v">${escapeHtml(ev.created_at ? fmtDateTime(ev.created_at) : "—")}</span>
          </div>

          <div class="vd-details-compact__item">
            <span class="vd-details-compact__k">Updated</span>
            <span class="vd-details-compact__v">${escapeHtml(ev.updated_by || "—")}</span>
            <span class="vd-details-compact__sep">•</span>
            <span class="vd-details-compact__v">${escapeHtml(ev.updated_at ? fmtDateTime(ev.updated_at) : "—")}</span>
          </div>
        </div>
      </div>
    `;
  }



  function openServiceModal(ev) {
    state.activeService = ev;

    renderServiceView(ev);

    $("vd-service-edit-type").value = ev.service_type || "";
    $("vd-service-edit-date").value = toDateInputValue(ev.service_date);
    $("vd-service-edit-notes").value = ev.service_notes || "";

    // created_by is read-only
    $("vd-service-edit-created-by").value = ev.created_by || "";

    // updated_by is editable; default to cached actor name
    $("vd-service-edit-updated-by").value = getActorName() || ev.updated_by || "";

    // status dropdown (ensure CANCELED spelling)
    const st = (ev.service_status || "BOOKED").toUpperCase();
    $("vd-service-edit-status").value = ["BOOKED", "CANCELED", "COMPLETE"].includes(st) ? st : "BOOKED";

    setServiceEditMode(false);

    const el = document.getElementById("vdServiceModal");
    const m = window.bootstrap?.Modal?.getOrCreateInstance(el, { backdrop: true, keyboard: true, focus: true });
    m?.show();
  }

  async function apiPatchVehicleStatus(vehicleId, patch) {
    const res = await fetch(`/api/vehicles/${encodeURIComponent(String(vehicleId))}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(patch),
    });

    let payload = null;
    try { payload = await res.json(); } catch (_) {}

    if (!res.ok) {
      const msg = payload?.error || `Failed (HTTP ${res.status})`;
      throw new Error(msg);
    }
    return payload;
  }

  function openVehicleStatusModal() {
    const v = state.vehicle; // assuming you store current vehicle details here
    if (!v) return;

    $("vd-status-modal-vehicle-label").textContent =
      `${v.make_model || "Vehicle"} (${v.license_plate || "—"})`;

    const cur = String(v.status || "OK").toUpperCase();
    $("vd-status-modal-status").value = ["OK","DUE","DEFICIENT","BOOKED","IN_SHOP"].includes(cur) ? cur : "OK";

    $("vd-status-modal-updated-by").value = getActorName() || "";
    $("vd-status-modal-meta").textContent = `Current: ${cur}`;
    $("vd-status-modal-error").classList.add("d-none");
    $("vd-status-modal-error").textContent = "";

    const el = $("vdVehicleStatusModal");
    const m = window.bootstrap?.Modal?.getOrCreateInstance(el, { backdrop: true, keyboard: true, focus: true });
    m?.show();
  }

  function setStatusModalSubmitting(on) {
    $("vd-status-modal-save").disabled = !!on;
    $("vd-status-modal-spinner").classList.toggle("d-none", !on);
  }

  async function saveVehicleStatusFromModal() {
    const v = state.vehicle;
    if (!v) return;

    const vehicleId = v.vehicle_id || v.id;
    const status = $("vd-status-modal-status").value;
    const updatedBy = ($("vd-status-modal-updated-by").value || "").trim();

    const errEl = $("vd-status-modal-error");
    errEl.classList.add("d-none");
    errEl.textContent = "";

    if (!updatedBy) {
      errEl.textContent = "Updated By is required.";
      errEl.classList.remove("d-none");
      return;
    }

    setActorName(updatedBy);
    setStatusModalSubmitting(true);

    try {
      await apiPatchVehicleStatus(vehicleId, { status, updated_by: updatedBy });

      // Reload page data so pill + lanes + everything stays consistent
      await loadAndRender();

      const modalEl = $("vdVehicleStatusModal");
      const modal = window.bootstrap?.Modal?.getInstance(modalEl);
      try { modal?.hide(); } catch (_) {}
    } catch (e) {
      errEl.textContent = e?.message || "Save failed.";
      errEl.classList.remove("d-none");
    } finally {
      setStatusModalSubmitting(false);
    }
  }

  function wireVehicleStatusEditor() {
    $("vd-edit-status-btn")?.addEventListener("click", openVehicleStatusModal);
    $("vd-status-modal-save")?.addEventListener("click", saveVehicleStatusFromModal);
  }

  function wireHeaderNotesInlineEdit() {
    const notesEl = $("vd-notes");
    if (!notesEl) return;
    if (notesEl.dataset.wired === "1") return;
    notesEl.dataset.wired = "1";

    let editing = false;

    function renderDisplay() {
      const v = state.vehicle || {};
      const raw = (v.notes || "").toString();
      const txt = raw.trim();
      notesEl.classList.remove("vd-notes--editing");


      notesEl.classList.toggle("text-muted", !txt);
      notesEl.textContent = txt || "—";
      notesEl.title = "Click to edit notes";
      notesEl.style.cursor = "pointer";
    }

    function startEdit() {
      if (editing) return;
      editing = true;

      const v = state.vehicle || {};
      const curNotes = (v.notes || "").toString();
      const curStatus = safeVehicleStatus(v.status || v.current_status || v.vehicle_status || "OK");
      const actor = getActorName() || "";

      // Build inline editor UI inside the notes container
      notesEl.style.cursor = "default";
      notesEl.title = "";
     
      notesEl.classList.add("vd-notes--editing");
      notesEl.classList.remove("text-muted");

      notesEl.innerHTML = `
        <textarea
          id="vd-notes-edit"
          class="form-control form-control-sm"
          rows="2"
          placeholder="Add notes… (blank clears)"
        >${escapeHtml(curNotes)}</textarea>

        <div class="d-flex flex-wrap gap-2 align-items-center mt-1">
          <div class="d-flex align-items-center gap-2">
            <span class="text-muted small">Updated by</span>
            <input
              id="vd-notes-updated-by"
              class="form-control form-control-sm"
              style="max-width: 200px"
              value="${escapeHtml(actor)}"
              placeholder="Your name"
            />
          </div>

          <div class="ms-auto d-flex gap-2">
            <button id="vd-notes-cancel" type="button" class="btn btn-sm btn-outline-secondary">Cancel</button>
            <button id="vd-notes-save" type="button" class="btn btn-sm btn-primary">Save</button>
          </div>
        </div>

        <div class="text-muted small mt-1 d-none" id="vd-notes-saving">Saving…</div>
        <div class="text-danger small mt-1 d-none" id="vd-notes-error"></div>
      `.trim();


      const ta = document.getElementById("vd-notes-edit");
      const by = document.getElementById("vd-notes-updated-by");
      const btnSave = document.getElementById("vd-notes-save");
      const btnCancel = document.getElementById("vd-notes-cancel");
      const savingEl = document.getElementById("vd-notes-saving");
      const errEl = document.getElementById("vd-notes-error");

      // Focus textarea and put cursor at end
      if (ta) {
        ta.focus();
        ta.selectionStart = ta.selectionEnd = ta.value.length;
      }

      async function doSave() {
        const newNotesRaw = (ta?.value || "").toString();
        const newNotesTrim = newNotesRaw.trim();
        const updatedBy = (by?.value || "").trim();

        if (!updatedBy) {
          if (errEl) {
            errEl.textContent = "Updated by is required.";
            errEl.classList.remove("d-none");
          }
          return;
        }

        // cache actor name
        setActorName(updatedBy);

        // UI state
        if (errEl) errEl.classList.add("d-none");
        if (savingEl) savingEl.classList.remove("d-none");
        if (btnSave) btnSave.disabled = true;
        if (btnCancel) btnCancel.disabled = true;

        try {
          // IMPORTANT: endpoint requires status every time
          await apiPatchVehicleStatus(vehicleId, {
            updated_by: updatedBy,
            status: curStatus,
            notes: newNotesTrim ? newNotesRaw : null, // blank clears
          });

          // Update local state + rerender header
          state.vehicle = { ...(state.vehicle || {}), notes: newNotesTrim ? newNotesRaw : null };

          editing = false;
          renderDisplay();
        } catch (e) {
          if (errEl) {
            errEl.textContent = e?.message || "Failed to save notes.";
            errEl.classList.remove("d-none");
          }
        } finally {
          if (savingEl) savingEl.classList.add("d-none");
          if (btnSave) btnSave.disabled = false;
          if (btnCancel) btnCancel.disabled = false;
        }
      }

      function doCancel() {
        editing = false;
        renderDisplay();
      }

      btnSave?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        doSave();
      });

      btnCancel?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        doCancel();
      });


      // Optional: Ctrl/Cmd+Enter to save, Esc to cancel
      ta?.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          doSave();
        } else if (e.key === "Escape") {
          e.preventDefault();
          doCancel();
        }
      });
    }

    // Clicking notes starts edit
    notesEl.addEventListener("click", (e) => {
      // If user clicked inside the editor controls, do nothing
      if (e.target.closest("button, textarea, input, label, select")) return;

      if (!editing) startEdit();
    });


    // initial render
    renderDisplay();

    // expose for rerender after loadAndRender
    notesEl._renderDisplay = renderDisplay;
  }




  function openInspectionModal(sub) {
    const body = $("vd-insp-modal-body");
    if (!body) return;

    const submittedAt = sub?.submitted_at ?? sub?.submittedAt ?? null;
    const submittedBy = sub?.submitted_by ?? sub?.submittedBy ?? "—";

    const currentKm = sub?.current_km ?? sub?.currentKm ?? null;
    const serviceDueKm = sub?.service_due_km ?? sub?.serviceDueKm ?? null;

    const oil = sub?.oil_level ?? sub?.oilLevel ?? null;
    const coolant = sub?.coolant_level ?? sub?.coolantLevel ?? null;
    const trans = sub?.transmission_level ?? sub?.transmissionLevel ?? null;

    console.log("sub:", sub);
    const warningLights = sub?.warning_lights ?? sub?.warningLights ?? null;      // bool | null
    const safeToOperate = sub?.safe_to_operate ?? sub?.safeToOperate ?? null;     // bool | null

    const notes = sub?.notes ?? sub?.deficiency_notes ?? sub?.deficiencyNotes ?? null;

    const yn = (v) => {
      if (v === true) return "Yes";
      if (v === false) return "No";
      return "—";
    };

    body.innerHTML = `
      <div class="vd-kv">
        <div class="vd-kv__k">Submitted At</div>
        <div class="vd-kv__v">${escapeHtml(submittedAt ? fmtDateTime(submittedAt) : "—")}</div>

        <div class="vd-kv__k">Submitted By</div>
        <div class="vd-kv__v">${escapeHtml(submittedBy || "—")}</div>

        <div class="vd-kv__k">Current KM</div>
        <div class="vd-kv__v">${escapeHtml(currentKm ?? "—")}</div>

        <div class="vd-kv__k">KM Due For Service</div>
        <div class="vd-kv__v">${escapeHtml(serviceDueKm ?? "—")}</div>

        <div class="vd-kv__k">Oil Level</div>
        <div class="vd-kv__v">${escapeHtml(oil || "Not checked")}</div>

        <div class="vd-kv__k">Coolant Level</div>
        <div class="vd-kv__v">${escapeHtml(coolant || "Not checked")}</div>

        <div class="vd-kv__k">Transmission Level</div>
        <div class="vd-kv__v">${escapeHtml(trans || "Not checked")}</div>

        <div class="vd-kv__k">Warning Lights On?</div>
        <div class="vd-kv__v">${escapeHtml(yn(warningLights))}</div>

        <div class="vd-kv__k">Safe To Drive?</div>
        <div class="vd-kv__v">${escapeHtml(yn(safeToOperate))}</div>

        <div class="vd-kv__k">Inspection Notes</div>
        <div class="vd-kv__v">
          <div class="vd-pre">${escapeHtml((notes || "—"))}</div>
        </div>
      </div>
    `;

    const el = $("vdInspModal");
    const m = window.bootstrap?.Modal?.getOrCreateInstance(el, {
      backdrop: true,
      keyboard: true,
      focus: true,
    });
    m?.show();
  }


  function setDefEditMode(on) {
    const view = $("vd-def-view");
    const form = $("vd-def-edit");
    const editBtn = $("vd-def-edit-btn");

    if (on) {
      view.classList.add("d-none");
      form.classList.remove("d-none");
      editBtn.classList.add("d-none");
    } else {
      view.classList.remove("d-none");
      form.classList.add("d-none");
      editBtn.classList.remove("d-none");
      $("vd-def-save-status").textContent = "";
    }
  }

  function renderDefView(def) {
    const view = $("vd-def-view");

    const linked = def.linked_service_id != null;

    view.innerHTML = `
      <div class="vd-kv">
        <div class="vd-kv__k">Description</div>
        <div class="vd-kv__v"><div class="vd-pre">${escapeHtml(def.description || "—")}</div></div>

        <div class="vd-kv__k">Severity</div>
        <div class="vd-kv__v">${escapeHtml(def.severity || "—")}</div>

        <div class="vd-kv__k">Status</div>
        <div class="vd-kv__v">${escapeHtml(String(def.status || "—").toUpperCase())}</div>

        <div class="vd-kv__k">Linked To Service</div>
        <div class="vd-kv__v">
          ${linked
            ? `<span class="text-success fw-semibold">✔ Yes</span>`
            : `<span class="text-muted">✖ No</span>`}
        </div>

        <div class="vd-kv__k">Created By</div>
        <div class="vd-kv__v">${escapeHtml(def.created_by || "—")}</div>

        <div class="vd-kv__k">Created At</div>
        <div class="vd-kv__v">${escapeHtml(def.created_at || "—")}</div>

        <div class="vd-kv__k">Updated By</div>
        <div class="vd-kv__v">${escapeHtml(def.updated_by || "—")}</div>

        <div class="vd-kv__k">Updated At</div>
        <div class="vd-kv__v">${escapeHtml(fmtDateTime(def.updated_at))}</div>
      </div>
    `;
  }


  function openDefModal(def) {
    state.activeDef = def;

    renderDefView(def);

    // seed edit form
    $("vd-def-edit-description").value = def.description || "";
    $("vd-def-edit-severity").value = def.severity || "";
    $("vd-def-edit-status").value = String(def.status || "OPEN").toUpperCase();
    $("vd-def-edit-updated-by").value = def.updated_by || getActorName() || "";

    setDefEditMode(false);

    const el = $("vdDefModal");
    const m = window.bootstrap?.Modal?.getOrCreateInstance(el, { backdrop: true, keyboard: true, focus: true });
    m?.show();
  }

  function openCreateDefModal() {
    // Seed updated_by from localStorage if present
    $("vd-create-def-updated-by").value = getActorName() || "";
    $("vd-create-def-description").value = "";
    $("vd-create-def-severity").value = "";
    $("vd-create-def-status").textContent = "";

    const el = $("vdCreateDefModal");
    const m = window.bootstrap?.Modal?.getOrCreateInstance(el, {
      backdrop: true,
      keyboard: true,
      focus: true,
    });
    m?.show();
  }

  function closeCreateDefModal() {
    const el = $("vdCreateDefModal");
    const m = window.bootstrap?.Modal?.getInstance(el);
    try { m?.hide(); } catch (_) {}
  }

  function todayYMD() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }


  function openCreateServiceModal() {
    const required = [
      "vdCreateServiceModal",
      "vd-create-service-type",
      "vd-create-service-date",
      "vd-create-service-notes",
      "vd-create-service-created-by",
      "vd-create-service-status-select",
      "vd-create-service-status",
    ];

    fillDefSelect($("vd-create-service-deficiencies"), []);

    for (const id of required) {
      if (!document.getElementById(id)) {
        console.error(`[vehicle_details] Missing required create-service element #${id}`);
      }
    }

    document.getElementById("vd-create-service-type").value = "";
    document.getElementById("vd-create-service-date").value = "";
    document.getElementById("vd-create-service-notes").value = "";
    document.getElementById("vd-create-service-created-by").value = getActorName() || "";
    document.getElementById("vd-create-service-status-select").value = "BOOKED";
    document.getElementById("vd-create-service-status").textContent = "";

    const el = document.getElementById("vdCreateServiceModal");
    const m = window.bootstrap?.Modal?.getOrCreateInstance(el, {
      backdrop: true,
      keyboard: true,
      focus: true,
    });
    m?.show();
  }




  function closeCreateServiceModal() {
    const el = $("vdCreateServiceModal");
    const m = window.bootstrap?.Modal?.getInstance(el);
    try { m?.hide(); } catch (_) {}
  }

  function wireServiceEditModal() {
    const editBtn = $("vd-service-edit-btn");
    const form = $("vd-service-edit");
    const cancelBtn = $("vd-service-cancel-btn");

    if (editBtn) {
      editBtn.addEventListener("click", () => {
        if (!state.activeService) return;

        const ev = state.activeService;
        const linkedIds = linkedDefIdsForService(ev.id);
        fillDefSelect($("vd-service-edit-deficiencies"), linkedIds);

        setServiceEditMode(true);

      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener("click", () => {
        if (!state.activeService) return;

        const ev = state.activeService;
        $("vd-service-edit-type").value = ev.service_type || "";
        $("vd-service-edit-date").value = toDateInputValue(ev.service_date);
        $("vd-service-edit-notes").value = ev.service_notes || "";

        $("vd-service-edit-created-by").value = ev.created_by || "";
        $("vd-service-edit-updated-by").value = getActorName() || ev.updated_by || "";

        const st = (ev.service_status || "BOOKED").toUpperCase();
        $("vd-service-edit-status").value = ["BOOKED", "CANCELED", "COMPLETE"].includes(st) ? st : "BOOKED";

        fillDefSelect($("vd-service-edit-deficiencies"), linkedDefIdsForService(ev.id));

        setServiceEditMode(false);
      });
    }


    if (!form) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!state.activeService) return;

      const serviceEventId = state.activeService.id;

      const serviceType = $("vd-service-edit-type").value.trim();
      const serviceDate = $("vd-service-edit-date").value; // YYYY-MM-DD
      const notes = $("vd-service-edit-notes").value.trim();
      const serviceStatus = $("vd-service-edit-status").value;

      // updated_by comes from the field, but default to getActorName()
      const updatedBy = ($("vd-service-edit-updated-by").value || "").trim() || (getActorName() || "");

      if (!serviceType) return;
      if (serviceType.length > 64) {
        $("vd-service-save-status").textContent = "Service Type must be 64 characters or less.";
        return;
      }
      if (!serviceDate) {
        $("vd-service-save-status").textContent = "Service Date is required.";
        return;
      }
      if (!updatedBy) {
        $("vd-service-save-status").textContent = "Updated By is required.";
        return;
      }

      const deficiencyIds = getToggleSelectedIds($("vd-service-edit-deficiencies"));
      console.log("selected deficiencies: ", deficiencyIds);
      // Cache actor name
      setActorName(updatedBy);
      $("vd-service-save-status").textContent = "Saving…";

  

      try {
        const patch = {
          service_type: serviceType,
          service_date: serviceDate,
          service_notes: notes || null,
          service_status: serviceStatus,
          updated_by: updatedBy,
          deficiency_ids: deficiencyIds,
        };


        await apiPatchServiceEvent(serviceEventId, patch);

        await loadAndRender();

        const updated = (state.serviceEvents || []).find((x) => String(x.id) === String(serviceEventId));
        if (updated) {
          state.activeService = updated;
          renderServiceView(updated);
        }

        setServiceEditMode(false);
        $("vd-service-save-status").textContent = "Saved.";

        // ✅ CLOSE MODAL AFTER SUCCESS
        const modalEl = document.getElementById("vdServiceModal");
        const modal = window.bootstrap?.Modal?.getInstance(modalEl);
        try { modal?.hide(); } catch (_) {}

      } catch (err) {
        console.error(err);
        $("vd-service-save-status").textContent = "Save failed. See console.";
      }
    });

  }


  function wireCreateServiceModal() {
    const btn = $("vd-new-service-btn");
    if (btn) btn.addEventListener("click", openCreateServiceModal);

    const form = $("vd-create-service-form");
    if (!form) return;

    const quickBtn = $("vd-service-quick-oil-btn");
    if (quickBtn) {
      quickBtn.addEventListener("click", () => {
        $("vd-create-service-date").value = todayYMD();
        $("vd-create-service-notes").value = "Oil Change";

        if (!$("vd-create-service-type").value.trim()) {
          $("vd-create-service-type").value = "OIL_CHANGE";
        }

        // NEW: set status to COMPLETE
        $("vd-create-service-status-select").value = "COMPLETE";

        // If blank, default created_by
        const cur = $("vd-create-service-created-by").value.trim();
        if (!cur) $("vd-create-service-created-by").value = getActorName() || "TECH";
      });
    }



    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const serviceType = $("vd-create-service-type").value.trim();
      const bookedFor = $("vd-create-service-date").value; // YYYY-MM-DD
      const notes = $("vd-create-service-notes").value.trim();
      const createdBy = $("vd-create-service-created-by").value.trim();
      const serviceStatus = $("vd-create-service-status-select").value;

      if (!serviceType) return;
      if (serviceType.length > 64) {
        $("vd-create-service-status").textContent = "Service Type must be 64 characters or less.";
        return;
      }
      if (!bookedFor) {
        $("vd-create-service-status").textContent = "Booked For date is required.";
        return;
      }
      if (!createdBy) {
        $("vd-create-service-status").textContent = "Created By is required.";
        return;
      }
      if (!serviceStatus) {
        $("vd-create-service-status").textContent = "Status is required.";
        return;
      }

      // Cache for future modals (actor name)
      setActorName(createdBy);

      const deficiencyIds = getToggleSelectedIds($("vd-create-service-deficiencies"));
      console.log("selected deficiencies: ", deficiencyIds);

      const payload = {
        vehicle_id: vehicleId,
        service_type: serviceType,
        service_date: bookedFor,
        service_notes: notes || null,
        created_by: createdBy,
        service_status: serviceStatus,
        deficiency_ids: deficiencyIds,
      };


      $("vd-create-service-status").textContent = "Saving…";

      try {
        await apiCreateServiceEvent(payload);
        await loadAndRender();
        closeCreateServiceModal();

        const collapseEl = document.getElementById("vdServiceCollapse");
        if (collapseEl && window.bootstrap?.Collapse) {
          const c = window.bootstrap.Collapse.getOrCreateInstance(collapseEl, { toggle: false });
          c.show();
        }
      } catch (err) {
        console.error(err);
        $("vd-create-service-status").textContent = "Save failed. See console.";
      }
    });


  }


  function wireCreateDefModal() {
    const btn = $("vd-new-def-btn");
    if (btn) {
      btn.addEventListener("click", openCreateDefModal);
    }

    const form = $("vd-create-def-form");
    if (!form) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const description = $("vd-create-def-description").value.trim();
      const severity = $("vd-create-def-severity").value.trim();
      const updatedBy = $("vd-create-def-updated-by").value.trim();

      if (!description) return;
      if (!updatedBy) {
        $("vd-create-def-status").textContent = "Updated By is required.";
        return;
      }
      if (!severity) {
        $("vd-create-def-status").textContent = "Severity is required.";
        return;
      }

      $("vd-create-def-status").textContent = "Creating…";

      try {
        setActorName(updatedBy);

        const payload = {
          created_by: updatedBy,
          description,
          severity,
        };

        await apiCreateDeficiency(vehicleId, payload);

        // refresh list + header status pill
        await loadAndRender();

        $("vd-create-def-status").textContent = "Created.";
        closeCreateDefModal();

        // Optional: expand deficiencies section after creation
        const collapseEl = document.getElementById("vdDefCollapse");
        if (collapseEl && window.bootstrap?.Collapse) {
          const c = window.bootstrap.Collapse.getOrCreateInstance(collapseEl, { toggle: false });
          c.show();
        }

      } catch (err) {
        console.error(err);
        $("vd-create-def-status").textContent = "Create failed. See console.";
      }
    });
  }


  function wireDefModal() {
    $("vd-def-edit-btn").addEventListener("click", () => setDefEditMode(true));

    $("vd-def-cancel-btn").addEventListener("click", () => {
      if (!state.activeDef) return;
      // reset fields to current
      $("vd-def-edit-description").value = state.activeDef.description || "";
      $("vd-def-edit-severity").value = state.activeDef.severity || "";
      $("vd-def-edit-status").value = String(state.activeDef.status || "OPEN").toUpperCase();
      $("vd-def-edit-updated-by").value = state.activeDef.updated_by || getActorName() || "";
      setDefEditMode(false);
    });

    $("vd-def-edit").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!state.activeDef) return;

      const defId = state.activeDef.deficiency_id;
      const description = $("vd-def-edit-description").value.trim();
      const severity = $("vd-def-edit-severity").value.trim();
      const status = $("vd-def-edit-status").value.trim().toUpperCase();
      const updatedBy = $("vd-def-edit-updated-by").value.trim();

      if (!description) return;
      if (!updatedBy) {
        $("vd-def-save-status").textContent = "Updated By is required.";
        return;
      }

      $("vd-def-save-status").textContent = "Saving…";

      try {
        setActorName(updatedBy);

        const patch = {
          description,
          severity: severity,
          status,
          updated_by: updatedBy,
        };

        await apiPatchDeficiency(defId, patch);

        // Reload entire page data so header/status/escalations stay accurate.
        await loadAndRender();

        // Re-open the modal with the updated deficiency (find it again)
        const updated = (state.deficiencies || []).find((d) => Number(d.id) === Number(defId));
        if (updated) {
          state.activeDef = updated;
          renderDefView(updated);
          setDefEditMode(false);
          $("vd-def-save-status").textContent = "Saved.";
        } else {
          // If it disappeared due to filtering, still show "Saved"
          setDefEditMode(false);
          $("vd-def-save-status").textContent = "Saved.";
        }
        // ✅ CLOSE MODAL AFTER SUCCESS
        const modalEl = document.getElementById("vdDefModal");
        const modal = window.bootstrap?.Modal?.getInstance(modalEl);
        try { modal?.hide(); } catch (_) {}
      } catch (err) {
        console.error(err);
        $("vd-def-save-status").textContent = "Save failed. See console.";
      }
    });
  }

  function wireDefToggle() {
    const btn = $("vd-toggle-all-defs");
    btn.addEventListener("click", () => {
      state.showAllDefs = !state.showAllDefs;
      btn.textContent = state.showAllDefs ? "Hide fixed/invalid" : "Show fixed/invalid";
      renderDeficiencies();
    });
  }

  async function loadAndRender() {
    if (!vehicleId) throw new Error("Missing vehicle_id on page.");

    const payload = await apiGetVehicleDetails();
    const { v, latest, serviceEvents, deficiencies, submissions } = normalizePayload(payload);

    state.vehicle = v;
    state.latest = latest || (submissions?.[0] ?? null); // fallback: newest submission is latest
    state.serviceEvents = serviceEvents || [];
    state.deficiencies = deficiencies || [];
    state.submissions = submissions || [];

    renderHeader();
    renderService();
    renderDeficiencies();
    renderInspections();
  }

  async function init() {
    wireDefModal();
    wireDefToggle();
    wireCreateDefModal();
    wireCreateServiceModal();
    wireServiceEditModal();
    wireVehicleStatusEditor();
    wireHeaderNotesInlineEdit();


    try {
      await loadAndRender();
    } catch (err) {
      console.error(err);
      $("vd-subtitle").textContent = "Failed to load vehicle details.";
    }
  }

  init();
})();
