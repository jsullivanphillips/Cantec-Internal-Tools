// static/js/scheduling_attack.js
const SchedulingAttack = (() => {
  let chartHours;
  let chartJobs;
  let includeTravel = true;  // default matches current behavior (incl. travel)

  function init() {
    // Toggle handling
    const travelToggle = document.getElementById("sa-include-travel");
    if (travelToggle) {
      includeTravel = !!travelToggle.checked;
      travelToggle.addEventListener("change", () => {
        includeTravel = !!travelToggle.checked;
        loadMetrics();
      });
    }

    loadMetrics();
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

  return { init };
})();

document.addEventListener("DOMContentLoaded", SchedulingAttack.init);
