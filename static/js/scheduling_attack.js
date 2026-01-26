// static/js/scheduling_attack.js
const SchedulingAttack = (() => {
  let chartHours;
  let chartJobs;
  let includeTravel = true;  // default matches current behavior (incl. travel)
  // --- Scheduling Attack charts ---
  let saV2ResizeBound = false;
  let saWeeklyVolumeChart = null;
  let saForwardUtilChart = null;



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

      // Scheduling Attack V2 (DB-backed)
      initSchedulingAttackV2UI();

      // If status tab is default active, load immediately
      const v2Month = document.getElementById("sa-v2-month");
      if (v2Month?.value) loadSchedulingAttackV2ForMonth(v2Month.value);

      loadSchedulingAttackV2Metrics();
      loadScheduledThisWeekMetric();
      loadForwardScheduleCoverage();
      loadWeeklySchedulingVolume();
    }

    function debounce(fn, ms) {
      let t;
      return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), ms);
      };
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

  async function postV2Notes(id, notes) {
    const r = await fetch("/scheduling_attack/v2/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ id, notes }),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new Error(`Failed to update notes (HTTP ${r.status}): ${txt}`);
    }
    return r.json();
  }


  async function postV2ReachedOut(id, reachedOut) {
    const r = await fetch("/scheduling_attack/v2/reached_out", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ id, reached_out: reachedOut }),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new Error(`Failed to update reached_out (HTTP ${r.status}): ${txt}`);
    }
    return r.json();
  }

  function renderV2JobsRequiringAction(rows, monthStr) {
    const card = document.getElementById("sa-v2-action-card");
    const subtitleEl = document.getElementById("sa-v2-action-subtitle");

    const tbodyUnscheduled = document.getElementById("sa-v2-action-unscheduled-tbody");
    const tbodyOutreach = document.getElementById("sa-v2-action-outreach-tbody");
    const tbodyCanceled = document.getElementById("sa-v2-action-canceled-tbody");

    const elUnscheduledCount = document.getElementById("sa-v2-action-unscheduled-count");
    const elOutreachCount = document.getElementById("sa-v2-action-outreach-count");
    const elCanceledCount = document.getElementById("sa-v2-action-canceled-count");

    if (!card || !tbodyUnscheduled || !tbodyOutreach || !tbodyCanceled) return;

    // Mirror your funnel logic
    const isCanceled = (r) => !!r?.canceled;
    const isScheduledLike = (r) => !!r?.scheduled || !!r?.completed; // completed counts as scheduled
    const isConfirmed = (r) => !!r?.confirmed;
    const isReachedOut = (r) => !!r?.reached_out;

    // Unscheduled = not canceled and not scheduled-like
    const unscheduled = rows.filter((r) => !isCanceled(r) && !isScheduledLike(r));
    const canceled = rows.filter((r) => isCanceled(r))

    // Needs outreach = scheduled-like, unconfirmed, and NOT reached out (also not canceled)
    const needsOutreach = rows.filter((r) => {
      if (isCanceled(r)) return false;
      if (!isScheduledLike(r)) return false;
      if (isConfirmed(r)) return false;
      if (isReachedOut(r)) return false;
      return true;
    });

    // Counts + subtitle
    if (elUnscheduledCount) elUnscheduledCount.textContent = String(unscheduled.length);
    if (elOutreachCount) elOutreachCount.textContent = String(needsOutreach.length);
    if (subtitleEl) subtitleEl.textContent = `${unscheduled.length} unscheduled • ${canceled.length} canceled • ${needsOutreach.length} need outreach`;
    if (elCanceledCount) elCanceledCount.textContent = String(canceled.length);

    // Render tables
    tbodyUnscheduled.innerHTML = "";
    if (!unscheduled.length) {
      tbodyUnscheduled.innerHTML = `<tr><td colspan="2" class="text-muted">No unscheduled jobs 🎉</td></tr>`;
    } else {
      unscheduled.forEach((r) => {
        const tr = document.createElement("tr");

        const tdAddr = document.createElement("td");

        if (r?.location_id) {
          const a = document.createElement("a");
          a.href = `https://app.servicetrade.com/locations/${encodeURIComponent(r.location_id)}`;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.textContent = r.address || "—";
          tdAddr.appendChild(a);
        } else {
          tdAddr.textContent = r?.address || "—";
        }


        const tdNotes = document.createElement("td");
        tdNotes.className = "text-end";

        const curNotes = (r?.notes || "").trim();
        const tdAction = document.createElement("td");
        tdAction.className = "text-end";
        tdAction.innerHTML = `<button
              class="btn btn-sm btn-outline-secondary"
              data-action="v2_save_notes"
              data-id="${escapeAttr(r?.id)}"
              data-month="${escapeAttr(monthStr)}"
              ${r?.id == null ? "disabled" : ""}>
              Save
            </button>`

        tdNotes.innerHTML = `
            <textarea
              class="form-control form-control-sm sa-v2-notes"
              rows="2"
              placeholder="Add notes…"
              data-notes-input="1"
              data-id="${escapeAttr(r?.id)}"
            >${escapeAttr(curNotes)}</textarea>
        `;

        tr.appendChild(tdAddr);
        tr.appendChild(tdNotes);
        tr.appendChild(tdAction);
        tbodyUnscheduled.appendChild(tr);
      });
    }

    tbodyOutreach.innerHTML = "";
    if (!needsOutreach.length) {
      tbodyOutreach.innerHTML = `<tr><td colspan="3" class="text-muted">No outreach needed 🎉</td></tr>`;
    } else {
      needsOutreach.forEach((r) => {
        const tr = document.createElement("tr");

        const tdAddr = document.createElement("td");

        if (r?.location_id) {
          const a = document.createElement("a");
          a.href = `https://app.servicetrade.com/locations/${encodeURIComponent(r.location_id)}`;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.textContent = r.address || "—";
          tdAddr.appendChild(a);
        } else {
          tdAddr.textContent = r?.address || "—";
        }


        const tdSched = document.createElement("td");
        tdSched.textContent = formatDateTime(r?.scheduled_date);

        const tdAction = document.createElement("td");
        tdAction.className = "text-end";
        tdAction.innerHTML = `
          <button
            class="btn btn-sm btn-outline-primary"
            data-action="v2_reached_out_on"
            data-id="${escapeAttr(r?.id)}"
            data-month="${escapeAttr(monthStr)}"
            ${r?.id == null ? "disabled" : ""}>
            Mark Reached Out
          </button>
        `;

        tr.appendChild(tdAddr);
        tr.appendChild(tdSched);
        tr.appendChild(tdAction);
        tbodyOutreach.appendChild(tr);
      });
    }

    tbodyCanceled.innerHTML = "";
    if (!canceled.length) {
      tbodyCanceled.innerHTML = `<tr><td colspan="2" class="text-muted">No canceled jobs 🎉</td></tr>`;
    } else {
      canceled.forEach((r) => {
        const tr = document.createElement("tr");

        const tdAddr = document.createElement("td");

        if (r?.location_id) {
          const a = document.createElement("a");
          a.href = `https://app.servicetrade.com/locations/${encodeURIComponent(r.location_id)}`;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.textContent = r.address || "—";
          tdAddr.appendChild(a);
        } else {
          tdAddr.textContent = r?.address || "—";
        }


        const tdNotes = document.createElement("td");
        tdNotes.className = "text-end";

        const curNotes = (r?.notes || "").trim();
        const tdAction = document.createElement("td");
        tdAction.className = "text-end";
        tdAction.innerHTML = `<button
            class="btn btn-sm btn-outline-secondary"
            data-action="v2_save_notes"
            data-id="${escapeAttr(r?.id)}"
            data-month="${escapeAttr(monthStr)}"
            ${r?.id == null ? "disabled" : ""}>
            Save
          </button>`
          
        tdNotes.innerHTML = `
            <textarea
              class="form-control form-control-sm sa-v2-notes"
              rows="2"
              placeholder="Add notes…"
              data-notes-input="1"
              data-id="${escapeAttr(r?.id)}"
            >${escapeAttr(curNotes)}</textarea>

        `;

        tr.appendChild(tdAddr);
        tr.appendChild(tdNotes);
        tr.appendChild(tdAction);
        tbodyCanceled.appendChild(tr);
      });
    }

    // Show/hide card
    card.hidden = (unscheduled.length + needsOutreach.length) === 0;
  }


  function initSchedulingAttackV2UI() {
    const input = document.getElementById("sa-v2-month");
    const btnPrev = document.getElementById("sa-v2-prev");
    const btnNext = document.getElementById("sa-v2-next");
    const btnThis = document.getElementById("sa-v2-this");
    const btnLoad = document.getElementById("sa-v2-load");

    function setMonth(d) {
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, "0");
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

    btnThis?.addEventListener("click", () => setMonth(new Date()));

    btnLoad?.addEventListener("click", () => {
      if (!input?.value) return;
      loadSchedulingAttackV2ForMonth(input.value);
    });

    // default month
    if (input && !input.value) setMonth(new Date());
  }

  async function loadSchedulingAttackV2Metrics() {
    const url = `/scheduling_attack/v2/kpis`;
    document.getElementById("sa-v2-kpi-confirmed-pct").innerHTML = `
      <div class="spinner-border text-primary" role="status">
        <span class="visually-hidden">Loading...</span>
      </div>
    `;
    try {
      const r = await fetch(url, { headers: { "Accept": "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      renderSchedulingAttackV2Metrics(data);
    } catch (err) {
      console.error("Failed to load SchedulingAttackV2Kpis", err);
      const percentConfirmedEl = document.getElementById("sa-v2-kpi-confirmed-pct");
      if (percentConfirmedEl) percentConfirmedEl.textContent = "Failed to load metrics";
      const kpiCard = document.getElementById("sa-v2-scheduling-kpis-card");
      if (kpiCard) kpiCard.hidden = true;
    }
  }

  async function loadWeeklySchedulingVolume() {
    const url = `/scheduling_attack/v2/weekly_scheduling_volume`;

    const card = document.getElementById("scheduling-volume-chart");
    const emptyEl = document.getElementById("sa-vol-empty");
    const updatedEl = document.getElementById("sa-vol-updated");
    const canvas = document.getElementById("sa-vol-canvas");

    if (!card || !canvas) return;

    // Minimal loading state (don’t destroy DOM)
    card.classList.add("opacity-75");
    if (updatedEl) updatedEl.textContent = "";
    if (emptyEl) emptyEl.style.display = "none";

    try {
      const r = await fetch(url, { headers: { "Accept": "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      renderWeeklySchedulingVolume(data);
    } catch (err) {
      console.error("Failed to load weekly scheduling volume", err);
      if (updatedEl) updatedEl.textContent = "Failed to load";
      if (emptyEl) {
        emptyEl.textContent = "Failed to load metrics";
        emptyEl.style.display = "block";
      }
      if (saWeeklyVolumeChart) {
        saWeeklyVolumeChart.destroy();
        saWeeklyVolumeChart = null;
      }
    } finally {
      card.classList.remove("opacity-75");
    }
  }

  // sa-v2-kpi-forward-schedule-coverage
  async function loadForwardScheduleCoverage() {
    const url = `/scheduling_attack/v2/forward_schedule_coverage`;

    // KPI loading spinner (keep your existing behavior)
    const kpiEl = document.getElementById("sa-v2-kpi-forward-schedule-coverage");
    if (kpiEl) {
      kpiEl.innerHTML = `
        <div class="spinner-border text-primary" role="status">
          <span class="visually-hidden">Loading...</span>
        </div>
      `;
    }

    // Minimal loading state for chart card (don’t destroy DOM)
    const chartCard = document.getElementById("schedule-utilization-chart");
    const emptyEl = document.getElementById("sa-util-empty");
    if (chartCard) chartCard.classList.add("opacity-75");
    if (emptyEl) emptyEl.style.display = "none";

    try {
      const r = await fetch(url, { headers: { "Accept": "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();

      renderForwardScheduleCoverage(data);
      renderForwardScheduleUtilizationChart(data); // <-- NEW
    } catch (err) {
      console.error("Failed to load forward schedule coverage", err);

      if (kpiEl) kpiEl.textContent = "Failed to load metric";

      const updatedEl = document.getElementById("sa-util-updated");
      if (updatedEl) updatedEl.textContent = "Failed to load";

      if (emptyEl) {
        emptyEl.textContent = "Failed to load utilization";
        emptyEl.style.display = "block";
      }

      if (saForwardUtilChart) {
        saForwardUtilChart.destroy();
        saForwardUtilChart = null;
      }
    } finally {
      if (chartCard) chartCard.classList.remove("opacity-75");
    }
  }


  async function loadScheduledThisWeekMetric() {
    const url = `/scheduling_attack/v2/scheduled_this_week`;
    document.getElementById("sa-v2-kpi-scheduled-this-week").innerHTML = `
      <div class="spinner-border text-primary" role="status">
        <span class="visually-hidden">Loading...</span>
      </div>
    `;
    try {
      const r = await fetch(url, { headers: { "Accept": "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      renderJobsScheduledThisWeek(data);
    } catch (err) {
      console.error("Failed to load SchedulingAttackV2Kpis", err);
      const scheduledThisWeekEl = document.getElementById("sa-v2-kpi-scheduled-this-week");
      if (scheduledThisWeekEl) scheduledThisWeekEl.textContent = "Failed to load metrics"
    }
  }

  async function loadSchedulingAttackV2ForMonth(monthStr) {
    if (!monthStr) return;
    const url = `/scheduling_attack/v2?month=${encodeURIComponent(monthStr)}`;

    try {
      const r = await fetch(url, { headers: { "Accept": "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      renderSchedulingAttackV2(data);
    } catch (err) {
      console.error("Failed to load SchedulingAttackV2", err);
      const titleEl = document.getElementById("sa-v2-title");
      const updatedEl = document.getElementById("sa-v2-updated");
      const funnelCard = document.getElementById("sa-v2-funnel-card");
      if (titleEl) titleEl.textContent = "Scheduling Attack (failed to load)";
      if (updatedEl) updatedEl.textContent = new Date().toISOString();
      if (funnelCard) funnelCard.hidden = true;
    }
  }

  

  function renderWeeklySchedulingVolume(data) {
    const weeks = Array.isArray(data?.weeks) ? data.weeks : [];

    const emptyEl = document.getElementById("sa-vol-empty");
    const updatedEl = document.getElementById("sa-vol-updated");
    const canvas = document.getElementById("sa-vol-canvas");
    if (!canvas) return;

    // Format: "Jan 19"
    const fmtLabel = (isoStart) => {
      const d = new Date(isoStart);
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    };

    const labels = weeks.map(w => fmtLabel(w.period_start));
    const scheduled = weeks.map(w => (typeof w.scheduled === "number" ? w.scheduled : 0));
    const rescheduled = weeks.map(w => (typeof w.rescheduled === "number" ? w.rescheduled : 0));

    const hasAnyData = scheduled.some(v => v > 0) || rescheduled.some(v => v > 0);

    if (updatedEl) {
      // “Updated 1:23 PM” style
      try {
        const d = new Date(data.generated_at);
        updatedEl.textContent = `Updated ${d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
      } catch {
        updatedEl.textContent = "";
      }
    }

    // If first weeks are all 0, show a clean empty-state message
    if (!hasAnyData) {
      if (emptyEl) emptyEl.style.display = "block";
    } else {
      if (emptyEl) emptyEl.style.display = "none";
    }

    const ctx = canvas.getContext("2d");

    if (saWeeklyVolumeChart) {
      saWeeklyVolumeChart.destroy();
      saWeeklyVolumeChart = null;
    }

    saWeeklyVolumeChart = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Scheduled",
            data: scheduled,
            borderWidth: 0,
            borderRadius: 6,
            barPercentage: 0.7,
            categoryPercentage: 0.7,
          },
          {
            // Optional, but looks great and stays minimalist
            type: "line",
            label: "Rescheduled",
            data: rescheduled,
            tension: 0.35,
            pointRadius: 0,
            borderWidth: 2,
          }
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false, // critical for short card height
        layout: {
          padding: {
            bottom: 24   // ← increase to 20–24 if needed
          }
        },
        animation: false,
        plugins: {
          legend: { display: false }, // minimalist
          tooltip: {
            displayColors: false,
            callbacks: {
              title: (items) => items?.[0]?.label || "",
              label: (item) => {
                const name = item.dataset?.label || "Value";
                const val = typeof item.raw === "number" ? item.raw : 0;
                return `${name}: ${val}`;
              }
            }
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              maxRotation: 0,
              autoSkip: true,
              font: { size: 11 },
            },
            border: { display: false },
          },
          y: {
            beginAtZero: true,
            suggestedMax: Math.max(5, ...scheduled, ...rescheduled),
            ticks: {
              precision: 0,
              font: { size: 11 },
              // Keep it minimal: only show a few ticks
              maxTicksLimit: 4,
            },
            grid: {
              drawBorder: false,
            },
            border: { display: false },
          },
        },
      },
    });
  }


  function renderForwardScheduleCoverage(data) {
    const numberOfWeeksCovered = Number(data?.coverage_weeks_60pct || 0);
    console.log("coverage_weeks_60pct: ", data.coverage_weeks_60pct);

    const el = document.getElementById("sa-v2-kpi-forward-schedule-coverage");
    const card = document.getElementById("forward-schedule-coverage-card");

    if (el) el.textContent = `${numberOfWeeksCovered} Weeks`;

    // color rules (you can tweak threshold)
    if (card && el) {
      if (numberOfWeeksCovered >= 6) {
        el.style.color = "#27a532";
        card.style.backgroundImage = "linear-gradient(to top,rgb(250, 246, 246),rgb(229, 248, 225))";
        card.style.borderTop = "5px solid #27a532";
      } else {
        el.style.color = "#b92525";
        card.style.backgroundImage = "linear-gradient(to top,rgb(250, 246, 246),rgb(248, 225, 227))";
        card.style.borderTop = "5px solid #b92525";
      }
    }
  }


  function renderForwardScheduleUtilizationChart(data) {
    const weeks = Array.isArray(data?.weeks) ? data.weeks.slice(1, 12) : [];

    const canvas = document.getElementById("sa-util-canvas");
    const emptyEl = document.getElementById("sa-util-empty");
    const updatedEl = document.getElementById("sa-util-updated");

    if (!canvas) return;

    // Label: "Jan 19"
    const fmtLabel = (isoStart) => {
      const d = new Date(isoStart);
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    };

    const labels = weeks.map(w => fmtLabel(w.week_start_local));
    const utilization = weeks.map(w => (typeof w.utilization_pct === "number" ? w.utilization_pct : 0));

    const hasAnyData = utilization.some(v => v > 0);

    // updated text
    if (updatedEl) {
      try {
        const d = new Date(data.generated_at);
        updatedEl.textContent = `Updated ${d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
      } catch {
        updatedEl.textContent = "";
      }
    }

    if (emptyEl) {
      emptyEl.style.display = hasAnyData ? "none" : "block";
    }

    const ctx = canvas.getContext("2d");

    if (saForwardUtilChart) {
      saForwardUtilChart.destroy();
      saForwardUtilChart = null;
    }

    const threshold = typeof data?.threshold_pct === "number" ? data.threshold_pct : 60;
    const thresholdLine = new Array(labels.length).fill(threshold);

    saForwardUtilChart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Utilization",
            data: utilization,
            tension: 0.35,
            pointRadius: 0,
            borderWidth: 2,
          },
          {
            label: `${threshold}% target`,
            data: thresholdLine,
            tension: 0,
            pointRadius: 0,
            borderWidth: 1.5,
            borderDash: [6, 6],
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        layout: {
          padding: { bottom: 24 } // helps keep any elements inside the canvas area
        },
        plugins: {
          legend: { display: false }, // minimalist
          tooltip: {
            displayColors: false,
            callbacks: {
              label: (item) => {
                const val = typeof item.raw === "number" ? item.raw : 0;
                if (item.datasetIndex === 1) return `Target: ${threshold}%`;
                return `Utilization: ${val.toFixed(1)}%`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { maxRotation: 0, autoSkip: true, font: { size: 11 } },
            border: { display: false }
          },
          y: {
            beginAtZero: true,
            min: 0,
            max: 100,
            ticks: {
              callback: (v) => `${v}%`,
              maxTicksLimit: 4,
              font: { size: 11 }
            },
            grid: { drawBorder: false },
            border: { display: false }
          }
        }
      }
    });
  }



  function renderJobsScheduledThisWeek(data) {
    const scheduled_this_week = data.scheduled_this_week;

    const scheduledThisWeekEl = document.getElementById("sa-v2-kpi-scheduled-this-week");
    const scheduledThisWeekCard = document.getElementById("scheduled-this-week-card");
    
    if (scheduledThisWeekEl) scheduledThisWeekEl.textContent = `${scheduled_this_week}`;

    // Scheduled this week KPI colouring
    if (parseInt(data.scheduled_this_week) >= 30) {
      scheduledThisWeekEl.style.color = "#27a532";
      scheduledThisWeekCard.style.backgroundImage = "linear-gradient(to top,rgb(250, 246, 246),rgb(229, 248, 225))";
      scheduledThisWeekCard.style.borderTop = "5px solid #27a532";
    }

  }

  function renderSchedulingAttackV2Metrics(data) {
    const confirmed_pct = data.confirmed_pct;
    
    const percentConfirmedEl = document.getElementById("sa-v2-kpi-confirmed-pct");
    const percentConfirmedCard = document.getElementById("next-2-weeks-confirmation-card");

    if (percentConfirmedEl) percentConfirmedEl.textContent = `${confirmed_pct} %`;
    
    // Confirmation KPI colouring
    if (parseInt(data.confirmed_pct) >= 90) {
      percentConfirmedEl.style.color = "#27a532";
      percentConfirmedCard.style.backgroundImage = "linear-gradient(to top,rgb(250, 246, 246),rgb(229, 248, 225))";
      percentConfirmedCard.style.borderTop = "5px solid #27a532";
    } else {
      percentConfirmedEl.style.color = "#b92525";
      percentConfirmedCard.style.backgroundImage = "linear-gradient(to top,rgb(250, 246, 246),rgb(248, 225, 227))";
      percentConfirmedCard.style.borderTop = "5px solid #b92525";
    }

  }

  function renderSchedulingAttackV2(data) {
    const monthStr = data?.month || "";
    const rows = Array.isArray(data?.rows) ? data.rows : [];

    const titleEl = document.getElementById("sa-v2-title");
    const updatedEl = document.getElementById("sa-v2-updated");
    const subtitleEl = document.getElementById("sa-v2-funnel-subtitle");
    const funnelCard = document.getElementById("sa-v2-funnel-card");
    const scheudlingKpiCard = document.getElementById("sa-v2-scheduling-kpis-card");

    if (titleEl) titleEl.textContent = monthStr ? `Scheduling Attack — ${monthStr}` : "Scheduling Attack";
    if (updatedEl) updatedEl.textContent = data?.generated_at || "";

    // --- buckets (mutually exclusive at the top split) ---
    const total = rows.length;

    const isCanceled = (r) => !!r?.canceled;
    const isScheduledLike = (r) => !!r?.scheduled || !!r?.completed; // completed counts as scheduled
    const isConfirmed = (r) => !!r?.confirmed;
    const isReachedOut = (r) => !!r?.reached_out;

    const canceledRows = rows.filter(isCanceled);

    const scheduledRows = rows.filter((r) => !isCanceled(r) && isScheduledLike(r));
    const unscheduledRows = rows.filter((r) => !isCanceled(r) && !isScheduledLike(r));

    // --- scheduled breakdown ---
    const confirmedRows = scheduledRows.filter(isConfirmed);
    const unconfirmedRows = scheduledRows.filter((r) => !isConfirmed(r));

    // --- unconfirmed breakdown ---
    const reachedOutRows = unconfirmedRows.filter(isReachedOut);
    const toBeReachedOutRows = unconfirmedRows.filter((r) => !isReachedOut(r));

    // --- render counts ---
    setText("sa-v2-total", total);
    setText("sa-v2-scheduled", scheduledRows.length);
    
    setText("sa-v2-unscheduled", unscheduledRows.length);
    
    setText("sa-v2-canceled", canceledRows.length);

    setText("sa-v2-confirmed", confirmedRows.length);
    
    setText("sa-v2-unconfirmed", unconfirmedRows.length);
    
    setText("sa-v2-reached-out", reachedOutRows.length);
    
    setText("sa-v2-to-be-reached-out", toBeReachedOutRows.length);
   

    // --- render bar widths (percent of their parent stage) ---
    // Top split bars as % of TOTAL
    setBarPct("sa-v2-bar-scheduled", pctOf(scheduledRows.length, total));
    setBarPct("sa-v2-bar-unscheduled", pctOf(unscheduledRows.length, total));
    setBarPct("sa-v2-bar-canceled", pctOf(canceledRows.length, total));

    // Confirmed/Unconfirmed as % of Scheduled
    setBarPct("sa-v2-bar-confirmed", pctOf(confirmedRows.length, scheduledRows.length));
    setBarPct("sa-v2-bar-unconfirmed", pctOf(unconfirmedRows.length, scheduledRows.length));

    // RO / To-Be-RO as % of Unconfirmed
    setBarPct("sa-v2-bar-reached-out", pctOf(reachedOutRows.length, unconfirmedRows.length));
    setBarPct("sa-v2-bar-to-be-reached-out", pctOf(toBeReachedOutRows.length, unconfirmedRows.length));

    // optional subtitle
    if (subtitleEl) {
      subtitleEl.textContent = total
        ? `Scheduled ${(pctOf(scheduledRows.length, total)).toFixed(0)}% • Unscheduled ${(pctOf(unscheduledRows.length, total)).toFixed(0)}% • Canceled ${(pctOf(canceledRows.length, total)).toFixed(0)}%`
        : "";
    }

    if (funnelCard) funnelCard.hidden = false;
    if (scheudlingKpiCard) scheudlingKpiCard.hidden = false;

    renderV2JobsRequiringAction(rows, monthStr);

    function pctOf(n, d) {
      if (!d) return 0;
      return (n / d) * 100;
    }

    function setText(id, v) {
      const el = document.getElementById(id);
      if (el) el.textContent = (typeof v === "number" ? v.toLocaleString() : String(v ?? ""));
    }

    function setSuccess(id, value, total, goal, greater_than) {
      const el = document.getElementById(id);
      const pct_of_total = (value / total) * 100;

      if (greater_than){
        if (parseInt(pct_of_total) >= goal) {
          el.style.backgroundImage = "linear-gradient(to top,rgb(250, 246, 246),rgb(229, 248, 225))";
        } else {
          el.style.backgroundImage = "linear-gradient(to top,rgb(250, 246, 246),rgb(248, 225, 227))";
        }
      } 
      else 
      {
        if (parseInt(pct_of_total) <= goal) {
          el.style.backgroundImage = "linear-gradient(to top,rgb(250, 246, 246),rgb(229, 248, 225))";
        } else {
          el.style.backgroundImage = "linear-gradient(to top,rgb(250, 246, 246),rgb(248, 225, 227))";
        }
      }
    }

    function setBarPct(id, pct) {
      const el = document.getElementById(id);
      if (!el) return;
      const p = Math.max(0, Math.min(100, Number(pct) || 0));
      el.style.width = `${p.toFixed(1)}%`;
    }

    drawSchedulingAttackV2Arrows();
    if (!saV2ResizeBound) {
      saV2ResizeBound = true;
      window.addEventListener("resize", debounce(() => drawSchedulingAttackV2Arrows(), 120));
    }
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

  function drawSchedulingAttackV2Arrows() {
    const root = document.getElementById("sa-v2-funnel");
    const svg = document.getElementById("sa-v2-arrows");
    if (!root || !svg) return;

    const ids = {
      total: "sa-v2-box-total",
      scheduled: "sa-v2-box-scheduled",
      unscheduled: "sa-v2-box-unscheduled",
      canceled: "sa-v2-box-canceled",
      confirmed: "sa-v2-box-confirmed",
      unconfirmed: "sa-v2-box-unconfirmed",
      reached: "sa-v2-box-reached-out",
      toReach: "sa-v2-box-to-be-reached-out",
    };

    const el = (id) => document.getElementById(id);
    const a = {
      total: el(ids.total),
      scheduled: el(ids.scheduled),
      unscheduled: el(ids.unscheduled),
      canceled: el(ids.canceled),
      confirmed: el(ids.confirmed),
      unconfirmed: el(ids.unconfirmed),
      reached: el(ids.reached),
      toReach: el(ids.toReach),
    };

    // If any missing, bail
    if (Object.values(a).some(x => !x)) return;

    // Size SVG to container
    const rootRect = root.getBoundingClientRect();
    svg.setAttribute("viewBox", `0 0 ${rootRect.width} ${rootRect.height}`);
    svg.innerHTML = "";

    // Define arrow marker
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
    marker.setAttribute("id", "sa-v2-arrowhead");
    marker.setAttribute("markerWidth", "10");
    marker.setAttribute("markerHeight", "8");
    marker.setAttribute("refX", "9");
    marker.setAttribute("refY", "4");
    marker.setAttribute("orient", "auto");

    const head = document.createElementNS("http://www.w3.org/2000/svg", "path");
    head.setAttribute("d", "M0,0 L10,4 L0,8 Z");
    head.setAttribute("class", "sa-v2-arrow-head");

    marker.appendChild(head);
    defs.appendChild(marker);
    svg.appendChild(defs);

    const pt = (fromEl, toEl) => {
      const fr = fromEl.getBoundingClientRect();
      const tr = toEl.getBoundingClientRect();

      // start at bottom center of from
      const x1 = (fr.left + fr.right) / 2 - rootRect.left;
      const y1 = fr.bottom - rootRect.top;

      // end at top center of to
      const x2 = (tr.left + tr.right) / 2 - rootRect.left;
      const y2 = tr.top - rootRect.top;

      return { x1, y1, x2, y2 };
    };

    const curved = ({ x1, y1, x2, y2 }) => {
      // simple smooth curve
      const midY = (y1 + y2) / 2;
      return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
    };

    const addArrow = (fromEl, toEl) => {
      const p = pt(fromEl, toEl);
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", curved(p));
      path.setAttribute("class", "sa-v2-arrow-line");
      path.setAttribute("marker-end", "url(#sa-v2-arrowhead)");
      svg.appendChild(path);
    };

    // Total -> (Scheduled, Unscheduled, Canceled)
    addArrow(a.total, a.scheduled);
    addArrow(a.total, a.unscheduled);
    addArrow(a.total, a.canceled);

    // Scheduled -> (Confirmed, Unconfirmed)
    addArrow(a.scheduled, a.confirmed);
    addArrow(a.scheduled, a.unconfirmed);

    // Unconfirmed -> (Reached Out, To Be Reached Out)
    addArrow(a.unconfirmed, a.reached);
    addArrow(a.unconfirmed, a.toReach);
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
      const v2Month = document.getElementById("sa-v2-month");
      if (v2Month?.value) loadSchedulingAttackV2ForMonth(v2Month.value);
      loadSchedulingAttackV2Metrics();
      loadScheduledThisWeekMetric();
      loadWeeklySchedulingVolume();
      loadForwardScheduleCoverage();
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

    // Button delegation for V2 action card
    const actionCard = document.getElementById("sa-v2-action-card");
    actionCard?.addEventListener("click", async (e) => {
      const btn = e.target?.closest?.("[data-action]");
      if (!btn) return;

      const action = btn.getAttribute("data-action");
      const id = Number(btn.getAttribute("data-id"));
      const month = btn.getAttribute("data-month") || document.getElementById("sa-v2-month")?.value;

      if (!id || !month) return;

      // Disable while working
      btn.disabled = true;

      try {
        if (action === "v2_reached_out_on") {
          await postV2ReachedOut(id, true);
          await loadSchedulingAttackV2ForMonth(month);
          return;
        }

        if (action === "v2_save_notes") {
          // Find the sibling input in the same row/cell
          const rowEl = btn.closest("tr") || btn.parentElement;

          // Support textarea OR input (in case you switch again)
          const notesEl = rowEl?.querySelector?.('[data-notes-input="1"][data-id]');

          const notes = notesEl ? String(notesEl.value || "") : "";

          await postV2Notes(id, notes);
          await loadSchedulingAttackV2ForMonth(month);
          return;
        }

      } catch (err) {
        console.error(err);
        alert("Action failed. See console for details.");
      } finally {
        // If we didn't reload for some reason, re-enable
        btn.disabled = false;
      }
    });

    actionCard?.addEventListener("keydown", (e) => {
      const notesEl = e.target?.closest?.('[data-notes-input="1"]');
      if (!notesEl) return;

      // Only save on Enter for INPUTs. For TEXTAREA, Enter should create a newline.
      const isTextarea = notesEl.tagName === "TEXTAREA";
      if (isTextarea) return;

      if (e.key !== "Enter") return;

      e.preventDefault();
      const tr = notesEl.closest("tr");
      const saveBtn = tr?.querySelector?.('[data-action="v2_save_notes"]');
      saveBtn?.click();
    });



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


  function formatDateTimeNoHours(v) {
    if (v == null) return "—";

    let d;
    if (typeof v === "number") {
      d = new Date(v * 1000); // unix seconds
    } else if (typeof v === "string") {
      d = new Date(v); // ISO string
    } else {
      return "—";
    }

    if (isNaN(d)) return "—";

    return d.toLocaleDateString("en-CA", {
      timeZone: "America/Vancouver",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }



  function formatDateTime(v) {
    if (v == null) return "—";

    let d;
    if (typeof v === "number") {
      d = new Date(v * 1000); // unix seconds
    } else if (typeof v === "string") {
      d = new Date(v); // ISO string
    } else {
      return "—";
    }

    if (isNaN(d)) return "—";

    return d.toLocaleString("en-CA", {
      timeZone: "America/Vancouver",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
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
