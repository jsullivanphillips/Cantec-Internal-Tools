(() => {
  const ENDPOINT = "/limbo_job_tracker/job_list"; // you currently POST here

  const elList = document.getElementById("limbo-list");
  const elEmpty = document.getElementById("limbo-empty");
  const elError = document.getElementById("limbo-error");
  const elSummary = document.getElementById("limbo-summary");
  const elPagination = document.getElementById("limbo-pagination");

  const elSearch = document.getElementById("limbo-search");
  const elSort = document.getElementById("limbo-sort");
  const elPageSize = document.getElementById("limbo-page-size");
  const elUnscheduledFirst = document.getElementById("limbo-unscheduled-first");
  const elRefresh = document.getElementById("limbo-refresh");

  let allJobs = [];
  let filtered = [];
  let page = 1;

  function normalizePayload(payload) {
    // backend might return:
    // 1) {data: {...}} or {data: [...]}
    // 2) {...} dict keyed by job_id
    // 3) [...] list
    const raw = (payload && payload.data !== undefined) ? payload.data : payload;

    if (Array.isArray(raw)) return raw;

    if (raw && typeof raw === "object") {
      // dict keyed by job_id -> convert to list, preserve job_id
      return Object.entries(raw).map(([jobId, v]) => ({
        job_id: Number(jobId) || v?.job_id || jobId,
        ...v
      }));
    }

    return [];
  }

  function isUnscheduled(job) {
    return !job?.most_recent_appt || job.most_recent_appt === "Not Scheduled";
  }

  function apptTime(job) {
    // Unscheduled -> 0
    if (isUnscheduled(job)) return 0;
    const t = new Date(job.most_recent_appt).getTime();
    return Number.isNaN(t) ? 0 : t;
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatAppt(job) {
    if (isUnscheduled(job)) return "Not scheduled";
    const d = new Date(job.most_recent_appt);
    if (Number.isNaN(d.getTime())) return "Unknown date";
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function titleCaseType(t) {
    return String(t || "Unknown")
      .replaceAll("_", " ")
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  function showSkeleton(count = 10) {
    elError.style.display = "none";
    elEmpty.style.display = "none";
    elList.innerHTML = "";

    for (let i = 0; i < count; i++) {
      const sk = document.createElement("div");
      sk.className = "limbo-skel";
      sk.innerHTML = `
        <div class="skel-line skel-w-70"></div>
        <div class="skel-line skel-w-45"></div>
      `;
      elList.appendChild(sk);
    }

    elSummary.textContent = "Loading…";
    elPagination.innerHTML = "";
  }

  function applyFiltersAndSort() {
    const q = (elSearch.value || "").trim().toLowerCase();
    const sort = elSort.value || "oldest";
    const unscheduledFirst = !!elUnscheduledFirst.checked;

    filtered = allJobs.filter(j => {
      const addr = String(j.address || "").toLowerCase();
      const typ = String(j.type || "").toLowerCase();
      return !q || addr.includes(q) || typ.includes(q);
    });

    filtered.sort((a, b) => {
      const au = isUnscheduled(a);
      const bu = isUnscheduled(b);

      if (unscheduledFirst && au !== bu) {
        return au ? -1 : 1;
      }

      const ta = apptTime(a);
      const tb = apptTime(b);

      // oldest: lower first, newest: higher first
      return sort === "newest" ? (tb - ta) : (ta - tb);
    });

    page = 1;
  }

  function paginate(items) {
    const pageSize = Number(elPageSize.value || 25);
    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const clamped = Math.min(Math.max(1, page), totalPages);
    page = clamped;

    const start = (clamped - 1) * pageSize;
    const end = start + pageSize;
    return { slice: items.slice(start, end), total, totalPages, start, end };
  }

  function renderPagination(totalPages) {
    elPagination.innerHTML = "";
    if (totalPages <= 1) return;

    const makeBtn = (label, targetPage, disabled = false, active = false) => {
      const li = document.createElement("li");
      li.className = `page-item ${disabled ? "disabled" : ""} ${active ? "active" : ""}`;
      const a = document.createElement("a");
      a.className = "page-link";
      a.href = "#";
      a.textContent = label;
      a.addEventListener("click", (e) => {
        e.preventDefault();
        if (disabled) return;
        page = targetPage;
        render();
      });
      li.appendChild(a);
      return li;
    };

    elPagination.appendChild(makeBtn("‹", page - 1, page <= 1));

    // compact page display: show up to 7 buttons around current
    const windowSize = 7;
    let start = Math.max(1, page - Math.floor(windowSize / 2));
    let end = Math.min(totalPages, start + windowSize - 1);
    start = Math.max(1, end - windowSize + 1);

    for (let p = start; p <= end; p++) {
      elPagination.appendChild(makeBtn(String(p), p, false, p === page));
    }

    elPagination.appendChild(makeBtn("›", page + 1, page >= totalPages));
  }

  function renderRow(job) {
    const addr = escapeHtml(job.address || "Unknown address");
    const typ = escapeHtml(titleCaseType(job.type));
    const appt = escapeHtml(formatAppt(job));
    const link = escapeHtml(job.job_link || "#");

    const a = document.createElement("a");
    a.className = "limbo-row";
    a.href = link;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.innerHTML = `
      <div class="limbo-left">
        <div class="limbo-title">${addr}</div>
        <div class="limbo-meta">
          <span><i class="bi bi-wrench-adjustable-circle"></i> ${typ}</span>
          <span><i class="bi bi-calendar3"></i> ${appt}</span>
        </div>
      </div>

      <div class="limbo-right">
        <span class="text-muted small d-none d-md-inline">Open</span>
        <span class="btn btn-sm btn-outline-secondary limbo-btn">
          <i class="bi bi-box-arrow-up-right"></i>
        </span>
      </div>
    `;
    return a;
  }


  function render() {
    elError.style.display = "none";

    const { slice, total, totalPages, start, end } = paginate(filtered);

    elList.innerHTML = "";
    if (total === 0) {
      elEmpty.style.display = "";
      elSummary.textContent = "0 jobs";
      renderPagination(1);
      return;
    }

    elEmpty.style.display = "none";

    for (const job of slice) {
      elList.appendChild(renderRow(job));
    }

    const shownFrom = total === 0 ? 0 : start + 1;
    const shownTo = Math.min(end, total);

    elSummary.textContent = `Showing ${shownFrom}–${shownTo} of ${total}`;
    renderPagination(totalPages);
  }

  async function load() {
    const pageSize = Number(elPageSize.value || 10);
    showSkeleton(pageSize);

    try {
      const r = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Accept": "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({}) // keep POST shape stable
      });

      if (!r.ok) throw new Error(`HTTP ${r.status}`);

      const payload = await r.json();
      allJobs = normalizePayload(payload);

      applyFiltersAndSort();
      render();
    } catch (err) {
      console.error("Failed to load limbo jobs", err);
      elList.innerHTML = "";
      elEmpty.style.display = "none";
      elError.style.display = "";
      elSummary.textContent = "—";
      elPagination.innerHTML = "";
    }
  }

  function wire() {
    elSearch?.addEventListener("input", () => {
      applyFiltersAndSort();
      render();
    });

    elSort?.addEventListener("change", () => {
      applyFiltersAndSort();
      render();
    });

    elUnscheduledFirst?.addEventListener("change", () => {
      applyFiltersAndSort();
      render();
    });

    elPageSize?.addEventListener("change", () => {
      // keep current filters/sort, just re-render and re-skeleton on reload
      page = 1;
      render();
    });

    elRefresh?.addEventListener("click", () => load());
  }

  document.addEventListener("DOMContentLoaded", () => {
    wire();
    load();
  });
})();
