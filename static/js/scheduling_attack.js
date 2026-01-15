// static/js/scheduling_attack.js
const SchedulingAttack = (() => {
  let chartHours;
  let chartJobs;
  let includeTravel = true;  // default matches current behavior (incl. travel)
  // --- Scheduling Attack charts ---
  let chartVolume;


    function init() {
      // Toggle handling (Forecast tab)
      const travelToggle = document.getElementById("sa-include-travel");
      if (travelToggle) {
        includeTravel = !!travelToggle.checked;
        travelToggle.addEventListener("change", () => {
          includeTravel = !!travelToggle.checked;
          loadMetrics();
        });
      }

      // Init Scheduling Attack UI wiring (status tab)
      initSchedulingAttackUI();

      // Load Forecast metrics (existing)
      loadMetrics();

      // If status tab is default active (it is in your HTML), load all 3 panes immediately:
      loadAttackSummary();

      const monthInput = document.getElementById("sa-outstanding-month");
      if (monthInput?.value) loadOutstandingForMonth(monthInput.value);

      loadVolumePast6Weeks();
    }


  function loadMetrics() {
    const params = new URLSearchParams();
    params.set("include_travel", includeTravel ? "true" : "false");

    fetch(`/scheduling_attack/metrics?${params.toString()}`, {
      method: "GET",
      headers: { "Accept": "application/json" },
    })
      .then(r => r.json())
      .then(render)
      .catch(err => console.error("Failed to load metrics", err));
  }

  // --- Scheduling Efficiency (week-scoped) ---

  let chartEff;

  function loadEfficiency(weekStartISO) {
    if (!weekStartISO) return;

    // Backend route later. For now this will 404 until we add it.
    const url = `/scheduling_attack/efficiency?week_start=${encodeURIComponent(weekStartISO)}`;

    fetch(url, { headers: { "Accept": "application/json" } })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(renderEfficiencyForWeek)
      .catch(err => {
        console.error("Failed to load scheduling efficiency", err);
        const titleEl = document.getElementById("sa-eff-title");
        const updatedEl = document.getElementById("sa-eff-updated");
        const tbody = document.getElementById("saEffTableBody");
        const kpisWrap = document.getElementById("sa-eff-kpis");

        if (titleEl) titleEl.textContent = "Scheduling Efficiency (failed to load)";
        if (updatedEl) updatedEl.textContent = new Date().toISOString();
        if (tbody) tbody.innerHTML = "";
        if (kpisWrap) kpisWrap.hidden = true;

        if (chartEff) {
          chartEff.destroy();
          chartEff = null;
        }
      });
  }

  function renderEfficiencyForWeek(data) {


    const titleEl = document.getElementById("sa-eff-title");
    const updatedEl = document.getElementById("sa-eff-updated");
    const kpisWrap = document.getElementById("sa-eff-kpis");

    const totals = data?.totals || {};
    const fmt = (x, digits=1) =>
      (typeof x === "number" ? x : 0).toLocaleString(undefined, { maximumFractionDigits: digits });

    const pct = (typeof totals.efficiency_pct === "number")
      ? totals.efficiency_pct
      : (totals.available_hours ? (totals.clocked_hours / totals.available_hours) * 100 : 0);

    if (titleEl) titleEl.textContent = `Scheduling Efficiency — ${data?.week_label || data?.week_start || ""}`;
    if (updatedEl) updatedEl.textContent = data?.generated_at || "";

    const elPct = document.getElementById("sa-eff-percent");
    const elClocked = document.getElementById("sa-eff-clocked");
    const elAvail = document.getElementById("sa-eff-available");

    // NEW:
    const elTechs = document.getElementById("sa-eff-techs");


    if (elPct) elPct.textContent = `${fmt(pct, 1)}%`;
    if (elClocked) elClocked.textContent = fmt(totals.clocked_hours || 0, 1);
    if (elAvail) elAvail.textContent = fmt(totals.available_hours || 0, 1);

    const fmtInt = (x) => (typeof x === "number" ? x : 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

    if (elTechs) elTechs.textContent = fmtInt(totals.active_tech_count || 0);

    if (kpisWrap) kpisWrap.hidden = false;

      

    // Table
    const tbody = document.getElementById("saEffTableBody");
    if (tbody) {
      tbody.innerHTML = "";
      (data?.days || []).forEach(d => {
        const tr = document.createElement("tr");

        const tdDay = document.createElement("td");
        const dt = d?.date ? new Date(d.date) : null;
        tdDay.textContent = (dt && !isNaN(dt)) ? dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : (d?.date || "—");

        const tdC = document.createElement("td");
        tdC.textContent = fmt(d?.clocked_hours || 0, 2);

        const tdA = document.createElement("td");
        tdA.textContent = fmt(d?.available_hours || 0, 2);

        const tdP = document.createElement("td");
        const dpct = (typeof d?.efficiency_pct === "number")
          ? d.efficiency_pct
          : (d?.available_hours ? (d.clocked_hours / d.available_hours) * 100 : 0);
        tdP.textContent = `${fmt(dpct, 1)}%`;

        tr.appendChild(tdDay);
        tr.appendChild(tdC);
        tr.appendChild(tdA);
        tr.appendChild(tdP);
        tbody.appendChild(tr);
      });
    }

    // Chart (optional): daily clocked vs available
    const labels = (data?.days || []).map(d => d?.date || "");
    const clocked = (data?.days || []).map(d => (typeof d?.clocked_hours === "number" ? d.clocked_hours : 0));
    const available = (data?.days || []).map(d => (typeof d?.available_hours === "number" ? d.available_hours : 0));

    const ctx = document.getElementById("saEffChart")?.getContext("2d");
    if (ctx) {
      if (chartEff) chartEff.destroy();
      chartEff = new Chart(ctx, {
        type: "bar",
        data: {
          labels,
          datasets: [
            { label: "Clocked Hours", data: clocked },
            { label: "Available Hours", data: available }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: true },
            tooltip: { mode: "index", intersect: false }
          },
          scales: {
            x: { stacked: false },
            y: { beginAtZero: true }
          }
        }
      });
      document.getElementById("saEffChart").parentElement.style.minHeight = "320px";
    }
  }


  // --- Scheduling Status (month-scoped) ---
  function loadStatus(monthStr) {
    if (!monthStr) return;
    const url = `/scheduling_attack/status?month=${encodeURIComponent(monthStr)}`;
    fetch(url, { headers: { "Accept": "application/json" } })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(renderStatusForMonth)
      .catch(err => {
        console.error("Failed to load scheduling status", err);
        // Optional: simple UI hint
        document.getElementById("sa-status-title").textContent = "Scheduling Status (failed to load)";
        document.getElementById("sa-status-updated").textContent = new Date().toISOString();
        // Clear table
        const tbody = document.getElementById("saStatusTableBody");
        if (tbody) tbody.innerHTML = "";
      });
  }

  function renderStatusForMonth(data) {
    // Expecting shape like:
    // {
    //   month: "2025-10",
    //   generated_at: "...",
    //   totals: { total_jobs, scheduled_jobs, unscheduled_jobs, hours_total },
    //   jobs: [
    //     { job_id, location_name, job_type, scheduled_for, hours_total, status }
    //   ]
    // }
    const titleEl   = document.getElementById("sa-status-title");
    const updatedEl = document.getElementById("sa-status-updated");
    const kpisWrap  = document.getElementById("sa-status-kpis");

    const monthStr = data?.month || "";
    const niceMonth = (() => {
      if (!monthStr) return "(unknown month)";
      const [y, m] = monthStr.split("-").map(Number);
      const dt = new Date(Date.UTC(y || 1970, (m || 1) - 1, 1));
      return dt.toLocaleString(undefined, { month: "long", year: "numeric" });
    })();

    if (titleEl)   titleEl.textContent = `Scheduling Status — ${niceMonth}`;
    if (updatedEl) updatedEl.textContent = data?.generated_at || "";

    // KPIs
    const totals = data?.totals || {};
    const v = (x, d=0) => (typeof x === "number" ? x : d);
    const fmt = (x, digits=0) => v(x).toLocaleString(undefined, { maximumFractionDigits: digits });

    const elTotalJobs = document.getElementById("sa-status-total-jobs");
    const elScheduled = document.getElementById("sa-status-scheduled");
    const elUnscheduled = document.getElementById("sa-status-unscheduled");
    const elHours = document.getElementById("sa-status-hours");

    if (elTotalJobs)  elTotalJobs.textContent  = fmt(totals.total_jobs || totals.jobs_total || 0);
    if (elScheduled)  elScheduled.textContent  = fmt(totals.scheduled_jobs || totals.scheduled || 0);
    if (elUnscheduled)elUnscheduled.textContent= fmt(totals.unscheduled_jobs || totals.unscheduled || 0);
    if (elHours)      elHours.textContent      = fmt(totals.hours_total || 0, 1);

    if (kpisWrap) kpisWrap.hidden = false;

    // Table
    const tbody = document.getElementById("saStatusTableBody");
    if (tbody) {
      tbody.innerHTML = "";
      (data?.jobs || []).forEach(job => {
        const tr = document.createElement("tr");

        const tdJob = document.createElement("td");
        tdJob.textContent = String(job?.job_id ?? "—");

        const tdLoc = document.createElement("td");
        tdLoc.textContent = String(job?.location_name ?? "—");

        const tdType = document.createElement("td");
        tdType.textContent = String(job?.job_type ?? "—");

        const tdSched = document.createElement("td");
        // Accepts unix seconds or ISO
        let schedTxt = "—";
        const sched = job?.scheduled_for;
        if (sched != null) {
          if (typeof sched === "number") {
            schedTxt = new Date(sched * 1000).toLocaleString();
          } else if (typeof sched === "string") {
            const d = new Date(sched);
            schedTxt = isNaN(d) ? sched : d.toLocaleString();
          }
        }
        tdSched.textContent = schedTxt;

        const tdHours = document.createElement("td");
        tdHours.textContent = fmt(job?.hours_total ?? job?.hours_incl_travel ?? 0, 2);

        const tdStatus = document.createElement("td");
        tdStatus.textContent = String(job?.status ?? "—");

        tr.appendChild(tdJob);
        tr.appendChild(tdLoc);
        tr.appendChild(tdType);
        tr.appendChild(tdSched);
        tr.appendChild(tdHours);
        tr.appendChild(tdStatus);
        tbody.appendChild(tr);
      });
    }
  }

  // Listen for the custom event from the month selector controls in the HTML
  window.addEventListener("sa:load-status", (e) => {
    const month = e?.detail?.month;
    loadStatus(month);
  });

  window.addEventListener("sa:load-efficiency", (e) => {
    const weekStart = e?.detail?.week_start; // "YYYY-MM-DD" (Monday)
    loadEfficiency(weekStart);
  });

  // Optional: auto-load on tab show if a value exists
  document.addEventListener("shown.bs.tab", (ev) => {
    if (ev.target?.id === "status-tab") {
      loadAttackSummary();

      const monthInput = document.getElementById("sa-outstanding-month");
      if (monthInput?.value) loadOutstandingForMonth(monthInput.value);

      loadVolumePast6Weeks();
    }

    if (ev.target?.id === "efficiency-tab") {
      const wk = document.getElementById("sa-eff-week");
      if (wk?.value) document.getElementById("sa-eff-load")?.click();
    }
  });


  // Optional: fire once on page load if the status tab is the default
  (() => {
    const statusTab = document.getElementById("scheduling-status");
    const input = document.getElementById("sa-status-month");
    if (statusTab?.classList.contains("show") && input?.value) {
      loadStatus(input.value);
    }
  })();




  function render(data) {

    const hoursHeader = document.querySelector('.sa-card .card-header');
    if (hoursHeader) {
      hoursHeader.textContent = includeTravel
        ? "Tech Hours per Month (incl. travel)"
        : "Tech Hours per Month (onsite only)";
    }
    // ---- Helpers: capacity mapping (unchanged logic) ----
    function normalizeToFullMonth(label) {
      if (label == null) return null;
      const s = String(label).trim();

      // ISO YYYY-MM or YYYY/MM
      let m = s.match(/^(\d{4})[-/](\d{1,2})$/);
      if (m) {
        const n = Number(m[2]);
        return [
          "January","February","March","April","May","June",
          "July","August","September","October","November","December"
        ][n-1] || null;
      }

      const monthNames = [
        ["january","jan"],
        ["february","feb"],
        ["march","mar"],
        ["april","apr"],
        ["may","may"],
        ["june","jun"],
        ["july","jul"],
        ["august","aug"],
        ["september","sep","sept"],
        ["october","oct"],
        ["november","nov"],
        ["december","dec"]
      ];
      const lower = s.toLowerCase();

      if (/^\d{1,2}$/.test(lower)) {
        const n = Number(lower);
        if (n >= 1 && n <= 12) {
          const full = monthNames[n-1][0];
          return full.charAt(0).toUpperCase() + full.slice(1);
        }
      }
      for (let i = 0; i < monthNames.length; i++) {
        const [full, ...abbrevs] = monthNames[i];
        const tokens = [full, ...abbrevs];
        if (tokens.some(tok => lower.includes(tok))) {
          const fullCap = full.charAt(0).toUpperCase() + full.slice(1);
          return fullCap;
        }
      }
      return null;
    }

    function buildCapacitySeries(labels, monthlyAvailableDict) {
      const out = [];
      labels.forEach((lbl) => {
        const monthFull = normalizeToFullMonth(lbl);
        const val = monthFull ? monthlyAvailableDict?.[monthFull] : null;
        out.push(val ?? null);
      });
      return out;
    }

    const labels = data.labels || [
      "January","February","March","April","May","June",
      "July","August","September","October","November","December"
    ];

    const cur  = data.cur  || {};
    const prev = data.prev || {};

    // Month selection rule (your spec):
    //  - Past months: show current year only
    //  - Future months: show previous year only
    //  - Current month: show both (two stacks)
    const currentMonth = (new Date()).getMonth() + 1; // 1..12

    const maskByRule = (srcArr, which) => {
      // which: "prev" or "curr"
      return (srcArr || []).map((val, i) => {
        const monthNum = i + 1;
        if (monthNum < currentMonth) {
          return which === "curr" ? (val ?? 0) : null;
        } else if (monthNum > currentMonth) {
          return which === "prev" ? (val ?? 0) : null;
        } else {
          // current month -> show both
          return (val ?? 0);
        }
      });
    };

    // ---- Colors: distinct hues; prev-year = lighter alpha, current-year = stronger alpha ----
    const COLORS = {
      recFA:   "0,123,255",   // blue
      recSPR:  "40,167,69",   // green
      nonFA:   "255,159,64",  // orange
      nonSPR:  "111,66,193",  // purple
      prevA: 0.35,
      currA: 0.80
    };
    const fill = (rgb, a) => `rgba(${rgb},${a})`;
    const stroke = (rgb) => `rgba(${rgb},1)`;

    // =========================
    // Stacked HOURS (with capacity line)
    // =========================
    const hoursDatasets = [
      // Prev year stack
      {
        label: `Prev Year Rec FA (hrs)`,
        data: maskByRule(prev.recurring_fa_hours, "prev"),
        stack: "prev",
        backgroundColor: fill(COLORS.recFA, COLORS.prevA),
        borderColor: stroke(COLORS.recFA),
        borderWidth: 1
      },
      {
        label: `Prev Year Rec SPR (hrs)`,
        data: maskByRule(prev.recurring_spr_hours, "prev"),
        stack: "prev",
        backgroundColor: fill(COLORS.recSPR, COLORS.prevA),
        borderColor: stroke(COLORS.recSPR),
        borderWidth: 1
      },
      {
        label: `Prev Year Nonrec FA (hrs)`,
        data: maskByRule(prev.nonrecurring_fa_hours, "prev"),
        stack: "prev",
        backgroundColor: fill(COLORS.nonFA, COLORS.prevA),
        borderColor: stroke(COLORS.nonFA),
        borderWidth: 1
      },
      {
        label: `Prev Year Nonrec SPR (hrs)`,
        data: maskByRule(prev.nonrecurring_spr_hours, "prev"),
        stack: "prev",
        backgroundColor: fill(COLORS.nonSPR, COLORS.prevA),
        borderColor: stroke(COLORS.nonSPR),
        borderWidth: 1
      },

      // Current year stack
      {
        label: `Current Year Rec FA (hrs)`,
        data: maskByRule(cur.recurring_fa_hours, "curr"),
        stack: "curr",
        backgroundColor: fill(COLORS.recFA, COLORS.currA),
        borderColor: stroke(COLORS.recFA),
        borderWidth: 1
      },
      {
        label: `Current Year Rec SPR (hrs)`,
        data: maskByRule(cur.recurring_spr_hours, "curr"),
        stack: "curr",
        backgroundColor: fill(COLORS.recSPR, COLORS.currA),
        borderColor: stroke(COLORS.recSPR),
        borderWidth: 1
      },
      {
        label: `Current Year Nonrec FA (hrs)`,
        data: maskByRule(cur.nonrecurring_fa_hours, "curr"),
        stack: "curr",
        backgroundColor: fill(COLORS.nonFA, COLORS.currA),
        borderColor: stroke(COLORS.nonFA),
        borderWidth: 1
      },
      {
        label: `Current Year Nonrec SPR (hrs)`,
        data: maskByRule(cur.nonrecurring_spr_hours, "curr"),
        stack: "curr",
        backgroundColor: fill(COLORS.nonSPR, COLORS.currA),
        borderColor: stroke(COLORS.nonSPR),
        borderWidth: 1
      }
    ];

    const capacityByMonth = buildCapacitySeries(labels, data.monthly_available_hours);
    const capacityDataset = {
      type: "line",
      label: "Available Tech Hours",
      data: capacityByMonth,
      borderWidth: 2,
      borderColor: "rgba(220,53,69,1)",        // red
      backgroundColor: "rgba(220,53,69,0.1)",
      borderDash: [6, 4],
      pointRadius: 0,
      tension: 0.3,
      fill: false,
      yAxisID: "y",
      order: 0,
      spanGaps: true
    };

    const ctxHours = document.getElementById("srHoursChart")?.getContext("2d");
    if (ctxHours) {
      if (chartHours) chartHours.destroy();
      chartHours = new Chart(ctxHours, {
        type: "bar",
        data: {
          labels,
          datasets: [...hoursDatasets, capacityDataset]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: true },
            tooltip: {
              mode: "index",
              intersect: false,
              callbacks: {
                afterBody: (items) => {
                  try {
                    const i = items[0].dataIndex;
                    const cap = Number(capacityByMonth?.[i] ?? 0);
                    if (!cap) return "";
                    // Sum visible bar stacks at this index
                    const used = hoursDatasets.reduce((sum, ds) => {
                      const v = ds.data?.[i];
                      return sum + (typeof v === "number" ? v : 0);
                    }, 0);
                    const pct = used ? (used / cap) * 100 : 0;
                    return `Utilization: ${pct.toFixed(1)}%`;
                  } catch {
                    return "";
                  }
                }
              }
            }
          },
          scales: {
            x: { stacked: true },
            y: {
              stacked: true,
              beginAtZero: true,
              ticks: {
                callback: (val) => Number(val).toLocaleString(undefined, { maximumFractionDigits: 1 })
              }
            }
          }
        }
      });
      document.getElementById("srHoursChart").parentElement.style.minHeight = "360px";
    }

    // =========================
    // Stacked JOB COUNTS
    // =========================
    // Build datasets using the same rule; counts are integers, but we display as bars.
    const jobsDatasets = [
      // Prev year stack
      {
        label: `Prev Year Rec FA (jobs)`,
        data: maskByRule(prev.recurring_fa_jobs, "prev"),
        stack: "prev",
        backgroundColor: fill(COLORS.recFA, COLORS.prevA),
        borderColor: stroke(COLORS.recFA),
        borderWidth: 1
      },
      {
        label: `Prev Year Rec SPR (jobs)`,
        data: maskByRule(prev.recurring_spr_jobs, "prev"),
        stack: "prev",
        backgroundColor: fill(COLORS.recSPR, COLORS.prevA),
        borderColor: stroke(COLORS.recSPR),
        borderWidth: 1
      },
      {
        label: `Prev Year Nonrec FA (jobs)`,
        data: maskByRule(prev.nonrecurring_fa_jobs, "prev"),
        stack: "prev",
        backgroundColor: fill(COLORS.nonFA, COLORS.prevA),
        borderColor: stroke(COLORS.nonFA),
        borderWidth: 1
      },
      {
        label: `Prev Year Nonrec SPR (jobs)`,
        data: maskByRule(prev.nonrecurring_spr_jobs, "prev"),
        stack: "prev",
        backgroundColor: fill(COLORS.nonSPR, COLORS.prevA),
        borderColor: stroke(COLORS.nonSPR),
        borderWidth: 1
      },

      // Current year stack
      {
        label: `Current Year Rec FA (jobs)`,
        data: maskByRule(cur.recurring_fa_jobs, "curr"),
        stack: "curr",
        backgroundColor: fill(COLORS.recFA, COLORS.currA),
        borderColor: stroke(COLORS.recFA),
        borderWidth: 1
      },
      {
        label: `Current Year Rec SPR (jobs)`,
        data: maskByRule(cur.recurring_spr_jobs, "curr"),
        stack: "curr",
        backgroundColor: fill(COLORS.recSPR, COLORS.currA),
        borderColor: stroke(COLORS.recSPR),
        borderWidth: 1
      },
      {
        label: `Current Year Nonrec FA (jobs)`,
        data: maskByRule(cur.nonrecurring_fa_jobs, "curr"),
        stack: "curr",
        backgroundColor: fill(COLORS.nonFA, COLORS.currA),
        borderColor: stroke(COLORS.nonFA),
        borderWidth: 1
      },
      {
        label: `Current Year Nonrec SPR (jobs)`,
        data: maskByRule(cur.nonrecurring_spr_jobs, "curr"),
        stack: "curr",
        backgroundColor: fill(COLORS.nonSPR, COLORS.currA),
        borderColor: stroke(COLORS.nonSPR),
        borderWidth: 1
      }
    ];

    const ctxJobs = document.getElementById("srJobsChart")?.getContext("2d");
    if (ctxJobs) {
      if (chartJobs) chartJobs.destroy();
      chartJobs = new Chart(ctxJobs, {
        type: "bar",
        data: {
          labels,
          datasets: jobsDatasets
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: true },
            tooltip: {
              mode: "index",
              intersect: false
            }
          },
          scales: {
            x: { stacked: true },
            y: {
              stacked: true,
              beginAtZero: true,
              ticks: {
                callback: (val) => Number(val).toLocaleString(undefined, { maximumFractionDigits: 0 })
              }
            }
          }
        }
      });
      document.getElementById("srJobsChart").parentElement.style.minHeight = "360px";
    }
  }

  // =========================================================
  // Scheduling Attack (Status Tab)
  // =========================================================

  function initSchedulingAttackUI() {
    // Month selector wiring for Outstanding pane (inside status tab)
    const input = document.getElementById("sa-outstanding-month");
    const btnPrev = document.getElementById("sa-outstanding-prev");
    const btnNext = document.getElementById("sa-outstanding-next");
    const btnToday = document.getElementById("sa-outstanding-today");
    const btnLoad = document.getElementById("sa-outstanding-load");

    function setMonth(date) {
      const y = date.getUTCFullYear();
      const m = String(date.getUTCMonth() + 1).padStart(2, "0");
      input.value = `${y}-${m}`;
    }

    function getMonthDate() {
      if (!input.value) return new Date();
      const [y, m] = input.value.split("-").map(Number);
      return new Date(Date.UTC(y, m - 1, 1));
    }

    btnPrev?.addEventListener("click", () => {
      const d = getMonthDate();
      d.setUTCMonth(d.getUTCMonth() - 1);
      setMonth(d);
    });

    btnNext?.addEventListener("click", () => {
      const d = getMonthDate();
      d.setUTCMonth(d.getUTCMonth() + 1);
      setMonth(d);
    });

    btnToday?.addEventListener("click", () => setMonth(new Date()));

    btnLoad?.addEventListener("click", () => {
      loadOutstandingForMonth(input.value);
    });

    // Default month
    if (input && !input.value) setMonth(new Date());

    // Button delegation for "Reached Out" + "Cancelled"
    const unconfirmedTbody = document.getElementById("sa-out-unconfirmed-tbody");
    unconfirmedTbody?.addEventListener("click", async (e) => {
      const btn = e.target?.closest?.("[data-action]");
      if (!btn) return;

      const action = btn.getAttribute("data-action");
      const month = btn.getAttribute("data-month") || input?.value;
      const address = btn.getAttribute("data-address");

      if (!month || !address) return;

      if (action === "reached_out_on" || action === "reached_out_off") {
        const reachedOut = action === "reached_out_on";
        await postReachedOut(month, address, reachedOut);
        await loadOutstandingForMonth(month);
      }
    });

    const unscheduledTbody = document.getElementById("sa-out-unscheduled-tbody");
    unscheduledTbody?.addEventListener("click", async (e) => {
      const btn = e.target?.closest?.("[data-action]");
      if (!btn) return;

      const action = btn.getAttribute("data-action");
      const month = btn.getAttribute("data-month") || input?.value;
      const address = btn.getAttribute("data-address");

      if (!month || !address) return;

      if (action === "cancel_on" || action === "cancel_off") {
        const cancelled = action === "cancel_on";
        await postCancelled(month, address, cancelled);
        await loadOutstandingForMonth(month);
      }
    });
  }

  async function loadAttackSummary() {
    // Proposed backend:
    // GET /scheduling_attack/attack_summary
    // -> { generated_at, forward_coverage_pct, confirmations: { pct, confirmed, total } }
    const url = `/scheduling_attack/attack_summary`;

    try {
      const r = await fetch(url, { headers: { "Accept": "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      renderAttackSummary(data);
    } catch (err) {
      console.error("Failed to load attack summary", err);
      const updatedEl = document.getElementById("sa-attack-updated");
      const kpisWrap = document.getElementById("sa-attack-kpis");
      const hint = document.getElementById("sa-attack-hint");
      if (updatedEl) updatedEl.textContent = new Date().toISOString();
      if (kpisWrap) kpisWrap.hidden = true;
      if (hint) hint.textContent = "Failed to load summary metrics.";
    }
  }

  function renderAttackSummary(data) {
    const kpisWrap = document.getElementById("sa-attack-kpis");
    const updatedEl = document.getElementById("sa-attack-updated");
    const hint = document.getElementById("sa-attack-hint");

    const fmtPct = (x) => `${(typeof x === "number" ? x : 0).toFixed(1)}%`;

    const elCoverage = document.getElementById("sa-kpi-forward-coverage");
    const elConfirmedPct = document.getElementById("sa-kpi-confirmed-pct");
    const elConfirmedCounts = document.getElementById("sa-kpi-confirmed-counts");

    const conf = data?.confirmations || {};
    const total = typeof conf.total === "number" ? conf.total : 0;
    const confirmed = typeof conf.confirmed === "number" ? conf.confirmed : 0;
    const pct = (typeof conf.pct === "number")
      ? conf.pct
      : (total ? (confirmed / total) * 100 : 0);

    if (elCoverage) elCoverage.textContent = fmtPct(data?.forward_coverage_pct);
    if (elConfirmedPct) elConfirmedPct.textContent = fmtPct(pct);
    if (elConfirmedCounts) elConfirmedCounts.textContent = `${confirmed.toLocaleString()} / ${total.toLocaleString()}`;

    if (updatedEl) updatedEl.textContent = data?.generated_at || "";
    if (kpisWrap) kpisWrap.hidden = false;
    if (hint) hint.textContent = "";
  }

  async function loadOutstandingForMonth(monthStr) {
    if (!monthStr) return;

    // Proposed backend:
    // GET /scheduling_attack/outstanding?month=YYYY-MM
    // -> {
    //   month, generated_at,
    //   totals: { total_needed, scheduled, unscheduled, cancelled, confirmed, unconfirmed },
    //   unconfirmed_scheduled: [ { address, scheduled_for, reached_out } ],
    //   unscheduled: [ { address, cancelled } ]
    // }
    const url = `/scheduling_attack/outstanding?month=${encodeURIComponent(monthStr)}`;

    try {
      const r = await fetch(url, { headers: { "Accept": "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      renderOutstandingForMonth(data);
    } catch (err) {
      console.error("Failed to load outstanding jobs", err);
      const titleEl = document.getElementById("sa-outstanding-title");
      const updatedEl = document.getElementById("sa-outstanding-updated");
      const kpisWrap = document.getElementById("sa-outstanding-kpis");
      const t1 = document.getElementById("sa-out-unconfirmed-tbody");
      const t2 = document.getElementById("sa-out-unscheduled-tbody");

      if (titleEl) titleEl.textContent = "Outstanding Jobs (failed to load)";
      if (updatedEl) updatedEl.textContent = new Date().toISOString();
      if (kpisWrap) kpisWrap.hidden = true;
      if (t1) t1.innerHTML = "";
      if (t2) t2.innerHTML = "";
    }
  }

  function renderOutstandingForMonth(data) {
    const monthStr = data?.month || "";
    const niceMonth = (() => {
      if (!monthStr) return "(unknown month)";
      const [y, m] = monthStr.split("-").map(Number);
      const dt = new Date(Date.UTC(y || 1970, (m || 1) - 1, 1));
      return dt.toLocaleString(undefined, { month: "long", year: "numeric" });
    })();

    const titleEl = document.getElementById("sa-outstanding-title");
    const updatedEl = document.getElementById("sa-outstanding-updated");
    const kpisWrap = document.getElementById("sa-outstanding-kpis");

    if (titleEl) titleEl.textContent = `Outstanding Jobs — ${niceMonth}`;
    if (updatedEl) updatedEl.textContent = data?.generated_at || "";

    const totals = data?.totals || {};
    const n = (x) => (typeof x === "number" ? x : 0).toLocaleString();

    const elTotal = document.getElementById("sa-out-total");
    const elScheduled = document.getElementById("sa-out-scheduled");
    const elUnscheduled = document.getElementById("sa-out-unscheduled");
    const elCancelled = document.getElementById("sa-out-cancelled");
    const elConfirmed = document.getElementById("sa-out-confirmed");
    const elUnconfirmed = document.getElementById("sa-out-unconfirmed");

    if (elTotal) elTotal.textContent = n(totals.total_needed);
    if (elScheduled) elScheduled.textContent = n(totals.scheduled);
    if (elUnscheduled) elUnscheduled.textContent = n(totals.unscheduled);
    if (elCancelled) elCancelled.textContent = n(totals.cancelled);
    if (elConfirmed) elConfirmed.textContent = n(totals.confirmed);
    if (elUnconfirmed) elUnconfirmed.textContent = n(totals.unconfirmed);

    if (kpisWrap) kpisWrap.hidden = false;

    // Unconfirmed scheduled table
    const tbody1 = document.getElementById("sa-out-unconfirmed-tbody");
    if (tbody1) {
      tbody1.innerHTML = "";
      (data?.unconfirmed_scheduled || []).forEach((row) => {
        const tr = document.createElement("tr");

        const tdAddr = document.createElement("td");
        tdAddr.textContent = row?.address || "—";

        const tdSched = document.createElement("td");
        tdSched.textContent = formatDateTime(row?.scheduled_for);

        const tdRO = document.createElement("td");
        tdRO.textContent = row?.reached_out ? "Yes" : "No";

        const tdAction = document.createElement("td");
        tdAction.innerHTML = `
          <div class="btn-group btn-group-sm" role="group">
            <button class="btn btn-outline-primary"
              data-action="reached_out_on"
              data-month="${escapeAttr(monthStr)}"
              data-address="${escapeAttr(row?.address || "")}"
              ${row?.reached_out ? "disabled" : ""}>
              Mark Reached Out
            </button>
            <button class="btn btn-outline-secondary"
              data-action="reached_out_off"
              data-month="${escapeAttr(monthStr)}"
              data-address="${escapeAttr(row?.address || "")}"
              ${row?.reached_out ? "" : "disabled"}>
              Undo
            </button>
          </div>
        `;

        tr.appendChild(tdAddr);
        tr.appendChild(tdSched);
        tr.appendChild(tdRO);
        tr.appendChild(tdAction);
        tbody1.appendChild(tr);
      });
    }

    // Unscheduled table (manual cancelled)
    const tbody2 = document.getElementById("sa-out-unscheduled-tbody");
    if (tbody2) {
      tbody2.innerHTML = "";
      (data?.unscheduled || []).forEach((row) => {
        const tr = document.createElement("tr");

        const tdAddr = document.createElement("td");
        tdAddr.textContent = row?.address || "—";

        const tdCancelled = document.createElement("td");
        tdCancelled.textContent = row?.cancelled ? "Yes" : "No";

        const tdAction = document.createElement("td");
        tdAction.innerHTML = `
          <div class="btn-group btn-group-sm" role="group">
            <button class="btn btn-outline-danger"
              data-action="cancel_on"
              data-month="${escapeAttr(monthStr)}"
              data-address="${escapeAttr(row?.address || "")}"
              ${row?.cancelled ? "disabled" : ""}>
              Mark Cancelled
            </button>
            <button class="btn btn-outline-secondary"
              data-action="cancel_off"
              data-month="${escapeAttr(monthStr)}"
              data-address="${escapeAttr(row?.address || "")}"
              ${row?.cancelled ? "" : "disabled"}>
              Undo
            </button>
          </div>
        `;

        tr.appendChild(tdAddr);
        tr.appendChild(tdCancelled);
        tr.appendChild(tdAction);
        tbody2.appendChild(tr);
      });
    }
  }

  async function postReachedOut(monthStr, address, reachedOut) {
    // Proposed backend:
    // POST /scheduling_attack/reached_out
    // body: { month: "YYYY-MM", address: "...", reached_out: true/false }
    const url = `/scheduling_attack/reached_out`;

    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ month: monthStr, address, reached_out: !!reachedOut }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (err) {
      console.error("Failed to set reached_out", err);
    }
  }

  async function postCancelled(monthStr, address, cancelled) {
    // Proposed backend:
    // POST /scheduling_attack/cancelled
    // body: { month: "YYYY-MM", address: "...", cancelled: true/false }
    const url = `/scheduling_attack/cancelled`;

    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ month: monthStr, address, cancelled: !!cancelled }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (err) {
      console.error("Failed to set cancelled", err);
    }
  }

  async function loadVolumePast6Weeks() {
    // Proposed backend:
    // GET /scheduling_attack/weekly_volume?weeks=6
    // -> {
    //   generated_at,
    //   days: [ { date: "YYYY-MM-DD", scheduled: 0, released: 0 } ]
    // }
    const url = `/scheduling_attack/weekly_volume?weeks=6`;

    try {
      const r = await fetch(url, { headers: { "Accept": "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      renderVolumePast6Weeks(data);
    } catch (err) {
      console.error("Failed to load scheduling volume", err);
      const updatedEl = document.getElementById("sa-volume-updated");
      const tbody = document.getElementById("sa-volume-tbody");
      if (updatedEl) updatedEl.textContent = new Date().toISOString();
      if (tbody) tbody.innerHTML = "";
      if (chartVolume) { chartVolume.destroy(); chartVolume = null; }
    }
  }

  function renderVolumePast6Weeks(data) {
    const updatedEl = document.getElementById("sa-volume-updated");
    if (updatedEl) updatedEl.textContent = data?.generated_at || "";

    const days = data?.days || [];
    const labels = days.map(d => d?.date || "");
    const scheduled = days.map(d => (typeof d?.scheduled === "number" ? d.scheduled : 0));
    const released = days.map(d => (typeof d?.released === "number" ? d.released : 0));

    // Table
    const tbody = document.getElementById("sa-volume-tbody");
    if (tbody) {
      tbody.innerHTML = "";
      days.forEach(d => {
        const tr = document.createElement("tr");

        const tdDate = document.createElement("td");
        tdDate.textContent = formatDate(d?.date);

        const tdS = document.createElement("td");
        tdS.textContent = (typeof d?.scheduled === "number" ? d.scheduled : 0).toLocaleString();

        const tdR = document.createElement("td");
        tdR.textContent = (typeof d?.released === "number" ? d.released : 0).toLocaleString();

        tr.appendChild(tdDate);
        tr.appendChild(tdS);
        tr.appendChild(tdR);
        tbody.appendChild(tr);
      });
    }

    // Chart
    const ctx = document.getElementById("saVolumeChart")?.getContext("2d");
    if (ctx) {
      if (chartVolume) chartVolume.destroy();
      chartVolume = new Chart(ctx, {
        type: "line",
        data: {
          labels,
          datasets: [
            { label: "Scheduled", data: scheduled, tension: 0.25, pointRadius: 0 },
            { label: "Released", data: released, tension: 0.25, pointRadius: 0 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: true },
            tooltip: { mode: "index", intersect: false }
          },
          scales: {
            x: {
              ticks: {
                maxRotation: 0,
                callback: function(value) {
                  // Show fewer labels (about weekly)
                  const i = Number(value);
                  if (!Number.isFinite(i)) return "";
                  return (i % 7 === 0) ? this.getLabelForValue(value) : "";
                }
              }
            },
            y: { beginAtZero: true }
          }
        }
      });
      document.getElementById("saVolumeChart").parentElement.style.minHeight = "320px";
    }
  }

  // Helpers
  function formatDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    return isNaN(d) ? String(iso) : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  }

  function formatDateTime(v) {
    if (v == null) return "—";
    if (typeof v === "number") {
      const d = new Date(v * 1000);
      return isNaN(d) ? "—" : d.toLocaleString();
    }
    if (typeof v === "string") {
      const d = new Date(v);
      return isNaN(d) ? v : d.toLocaleString();
    }
    return "—";
  }

  function escapeAttr(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }


  return { init };
})();

document.addEventListener("DOMContentLoaded", SchedulingAttack.init);
