// static/js/scheduling_attack.js
const SchedulingAttack = (() => {
  let chartLocations;
  let chartHours;

  function init() {
    loadMetrics();
  }

  function loadMetrics() {
    fetch("/scheduling_attack/metrics", { method: "GET", headers: { "Accept": "application/json" } })
      .then(r => r.json())
      .then(render)
      .catch(err => console.error("Failed to load metrics", err));
  }

  function render(data) {
    // KPIs (unchanged)
    document.getElementById("kpi-total").textContent = (data.total || 0).toLocaleString();
    document.getElementById("kpi-hours").textContent = (data.total_hours || 0).toLocaleString(undefined, { maximumFractionDigits: 1 });
    document.getElementById("kpi-updated").textContent = data.generated_at || "—";
    console.log(data.monthly_available_hours);
    // Chart: Locations per month (unchanged)
    const ctx1 = document.getElementById("srChart").getContext("2d");
    if (chartLocations) chartLocations.destroy();
    chartLocations = new Chart(ctx1, {
      type: "bar",
      data: {
        labels: data.labels,
        datasets: [{
          label: "Locations",
          data: data.counts,
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { mode: "index", intersect: false } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
      }
    });
    document.getElementById("srChart").parentElement.style.minHeight = "360px";

    // ---- Build capacity line from backend dict (robust month matching) ----
    function normalizeToFullMonth(label) {
      if (label == null) return null;
      const s = String(label).trim();

      // Try ISO YYYY-MM or YYYY/MM
      let m = s.match(/^(\d{4})[-/](\d{1,2})$/);
      if (m) {
        const n = Number(m[2]);
        return ["January","February","March","April","May","June","July","August","September","October","November","December"][n-1] || null;
      }

      // Try "Jan", "JAN", "Jan-2025", "January 2025", etc.
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

      // If label is numeric 1..12
      if (/^\d{1,2}$/.test(lower)) {
        const n = Number(lower);
        if (n >= 1 && n <= 12) return monthNames[n-1][0].charAt(0).toUpperCase() + monthNames[n-1][0].slice(1);
      }

      // Find by presence of a month token anywhere in the string
      for (let i = 0; i < monthNames.length; i++) {
        const [full, ...abbrevs] = monthNames[i];
        const tokens = [full, ...abbrevs];
        if (tokens.some(tok => lower.includes(tok))) {
          const fullCap = full.charAt(0).toUpperCase() + full.slice(1);
          return fullCap; // "january" -> "January"
        }
      }

      return null;
    }

    function buildCapacitySeries(labels, monthlyAvailableDict) {
      const out = [];
      labels.forEach((lbl, i) => {
        const monthFull = normalizeToFullMonth(lbl);
        const val = monthFull ? monthlyAvailableDict?.[monthFull] : null;
        out.push(val ?? null);
        // Debug: see what we matched
        // console.debug(`[capacity-map] label="${lbl}" -> "${monthFull}" ->`, val);
      });
      return out;
    }

    const capacityByMonth = buildCapacitySeries(data.labels, data.monthly_available_hours);

    // Chart: Tech hours per month (incl. travel) + dotted red capacity line
    const ctx2 = document.getElementById("srHoursChart").getContext("2d");
    if (chartHours) chartHours.destroy();
    chartHours = new Chart(ctx2, {
      type: "bar",
      data: {
        labels: data.labels,
        datasets: [
          {
            label: "Tech Hours (incl. travel)",
            data: data.hours_total,
            borderWidth: 1,
            order: 1
          },
          {
            type: "line",
            label: "Available Tech Hours",
            data: capacityByMonth,
            borderWidth: 2,
            borderColor: "rgba(220,53,69,1)",   // red
            backgroundColor: "rgba(220,53,69,0.1)",
            borderDash: [6, 4],
            pointRadius: 0,
            tension: 0.3,
            fill: false,
            yAxisID: "y",
            order: 0,
            spanGaps: true                      // renders line across any isolated null gaps
          }
        ]
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
                  const used = Number(data.hours_total?.[i] ?? 0);
                  const cap = Number(capacityByMonth?.[i] ?? 0);
                  if (!cap) return "";
                  const pct = (used / cap) * 100;
                  return `Utilization: ${pct.toFixed(1)}%`;
                } catch {
                  return "";
                }
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: (val) => Number(val).toLocaleString(undefined, { maximumFractionDigits: 1 })
            }
          }
        }
      }
    });
    document.getElementById("srHoursChart").parentElement.style.minHeight = "360px";

    // Table (unchanged)
    const tbody = document.getElementById("srTableBody");
    tbody.innerHTML = "";
    (data.table || []).forEach(row => {
      const tr = document.createElement("tr");
      const tdMonth = document.createElement("td");
      const tdCount = document.createElement("td");
      const tdHours = document.createElement("td");
      tdMonth.textContent = row.name;
      tdCount.textContent = row.count.toLocaleString();
      tdHours.textContent = (row.hours_total || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
      tr.appendChild(tdMonth);
      tr.appendChild(tdCount);
      tr.appendChild(tdHours);
      tbody.appendChild(tr);
    });
  }


  return { init };
})();

document.addEventListener("DOMContentLoaded", SchedulingAttack.init);
