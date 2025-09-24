(() => {
  const tbody = document.getElementById("pinkFolderTbody");
  const techFilterInput = document.getElementById("techFilter");
  const sortSelect = document.getElementById("sortSelect");
  const clearBtn = document.getElementById("clearBtn");
  const emptyState = document.getElementById("emptyState");

  // State
  let raw = [];        // original array
  let view = [];       // filtered + sorted array
  let sortState = { key: "job_date", dir: "desc" }; // default

  // Fetch & init
  fetch("/pink_folder/data")
    .then(r => r.json())
    .then(json => {
        raw = normalize(json);
        applyControlsFromUI();
        render();
        wireHeaderSorting();
    })
    .catch(err => {
        console.error("Failed to load pink folder data:", err);
        tbody.innerHTML = `<tr><td colspan="5" class="text-danger">Error loading data.</td></tr>`;
    })
    .finally(() => {
        const loadingRow = document.getElementById("loadingRow");
        if (loadingRow) loadingRow.classList.add("d-none");
    });

  // Normalize backend dict -> array and parse dates
  function normalize(dict) {
    const out = [];
    for (const [jobId, v] of Object.entries(dict || {})) {
        out.push({
        job_id: Number(jobId),
        assigned_techs: Array.isArray(v.assigned_techs) ? v.assigned_techs : [],
        job_date: parseDate(v.job_date),
        address: v.address ?? "",
        hyperlink: v.hyperlink ?? "#",
        is_paperwork_uploaded: Boolean(v.is_paperwork_uploaded),
        tech_hours: typeof v.tech_hours === "number" ? v.tech_hours : 0
        });
    }
    return out;
    }


  // Robust date parse; prefer ISO. Adjust to Vancouver for display.
  function parseDate(val) {
    if (!val) return null;
    // Accept ISO strings or epoch numbers
    try {
      if (typeof val === "number") return new Date(val);
      if (typeof val === "string") {
        const d = new Date(val);
        return isNaN(d) ? null : d;
      }
      // If Flask sent something else (e.g., object), last resort:
      const d = new Date(String(val));
      return isNaN(d) ? null : d;
    } catch {
      return null;
    }
  }

  function formatDate(d) {
    if (!d) return "—";
    return d.toLocaleString("en-CA", {
      year: "numeric", month: "short", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
      hour12: false,
      timeZone: "America/Vancouver"
    });
  }

  // Controls
  techFilterInput.addEventListener("input", () => {
    applyControlsFromUI();
    render();
  });

  sortSelect.addEventListener("change", () => {
    applyControlsFromUI();
    render();
    updateHeaderIndicators();
  });

  clearBtn.addEventListener("click", () => {
    techFilterInput.value = "";
    sortSelect.value = "date_desc";
    applyControlsFromUI();
    render();
    updateHeaderIndicators();
  });

  
    function applyControlsFromUI() {
        const val = sortSelect.value;
        if (val.startsWith("date")) {
            sortState.key = "job_date";
            sortState.dir = val.endsWith("asc") ? "asc" : "desc";
        } else {
            sortState.key = "tech_hours";
            sortState.dir = val.endsWith("asc") ? "asc" : "desc";
        }
        const term = techFilterInput.value.trim().toLowerCase();
        view = raw
            .filter(r => {
            if (!term) return true;
            return r.assigned_techs.some(t => String(t).toLowerCase().includes(term));
            })
            .sort(makeSorter(sortState.key, sortState.dir));
    }

  function makeSorter(key, dir) {
    const m = dir === "asc" ? 1 : -1;
    return (a, b) => {
      let va = a[key], vb = b[key];
      if (key === "job_date") {
        va = va ? va.getTime() : -Infinity;
        vb = vb ? vb.getTime() : -Infinity;
      }
      if (va < vb) return -1 * m;
      if (va > vb) return  1 * m;
      return 0;
    };
  }

  // Header click sorting
  function wireHeaderSorting() {
    document.querySelectorAll("th.sortable").forEach(th => {
      th.style.cursor = "pointer";
      th.addEventListener("click", () => {
        const key = th.dataset.key;
        if (sortState.key === key) {
          sortState.dir = sortState.dir === "asc" ? "desc" : "asc";
        } else {
          sortState.key = key;
          sortState.dir = key === "job_date" ? "desc" : "desc";
        }
        // sync dropdown
        if (sortState.key === "job_date") {
          sortSelect.value = sortState.dir === "asc" ? "date_asc" : "date_desc";
        } else {
          sortSelect.value = sortState.dir === "asc" ? "hours_asc" : "hours_desc";
        }
        view = [...view].sort(makeSorter(sortState.key, sortState.dir));
        render();
        updateHeaderIndicators();
      });
    });
    updateHeaderIndicators();
  }

  function updateHeaderIndicators() {
    document.querySelectorAll("th.sortable .sort-indicator").forEach(el => el.textContent = "—");
    const active = document.querySelector(`th.sortable[data-key="${sortState.key}"] .sort-indicator`);
    if (active) active.textContent = sortState.dir === "asc" ? "▲" : "▼";
  }

  // Rendering
  function render() {
    if (!view.length) {
        tbody.innerHTML = "";
        emptyState.classList.remove("d-none");
        return;
    }
    emptyState.classList.add("d-none");

    const rows = view.map(row => {
        const techBadges = row.assigned_techs.length
        ? row.assigned_techs.map(t =>
            `<span class="badge text-bg-primary me-1 mb-1">${escapeHtml(t)}</span>`
            ).join("")
        : `<span class="text-muted">None</span>`;

        const uploadedBadge = row.is_paperwork_uploaded
        ? `<span class="badge text-bg-success">Yes</span>`
        : `<span class="badge text-bg-danger">No</span>`;

        return `
        <tr class="pf-row">
            <!-- removed Job ID cell -->
            <td>${formatDate(row.job_date)}</td>
            <td><a href="${escapeAttr(row.hyperlink)}" target="_blank" rel="noopener">${escapeHtml(row.address || "Open job")}</a></td>
            <td style="white-space: normal;">${techBadges}</td>
            <td>${uploadedBadge}</td>
            <td class="text-end">${Number(row.tech_hours ?? 0).toFixed(1)}</td>
        </tr>
        `;
    }).join("");

    tbody.innerHTML = rows;
    }

  // Utilities
  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
  function escapeAttr(s) {
    return escapeHtml(s).replaceAll("`", "&#096;");
  }
})();
