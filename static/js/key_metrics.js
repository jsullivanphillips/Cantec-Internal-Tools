(function () {
  function $(id) { return document.getElementById(id); }

  function toISODate(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  function fmtPct(v) {
    if (v === null || v === undefined) return "—";
    return `${Math.round(v * 100)}%`;
  }

  function fmtDuration(seconds) {
    if (seconds === null || seconds === undefined) return "—";
    const s = Math.max(0, Math.round(seconds));
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    if (hrs <= 0) return `${mins}m`;
    return `${hrs}h ${mins}m`;
  }

  function renderTable(tbody, rows, cols) {
    tbody.innerHTML = "";
    if (!rows || !rows.length) {
      tbody.innerHTML = `<tr><td colspan="${cols.length}" class="km-empty">No data</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(r => {
      const tds = cols.map(c => `<td>${String(r[c] ?? "")}</td>`).join("");
      return `<tr>${tds}</tr>`;
    }).join("");
  }

  async function loadMetrics() {
    const start = $("kmStart").value;
    const end = $("kmEnd").value;

    const qs = new URLSearchParams();
    if (start) qs.set("start", start);
    if (end) qs.set("end", end);

    const resp = await fetch(`/api/keys/metrics?${qs.toString()}`, {
      headers: { "Accept": "application/json" },
    });

    if (!resp.ok) throw new Error("Failed to load metrics");
    return await resp.json();
  }

  function render(json) {
    const range = json?.range || {};
    const k = json?.kpis || {};
    const s = json?.series || {};

    $("kpiTotalSignouts").textContent = String(k.total_signouts ?? "—");
    $("kpiDoubleSignouts").textContent = String(k.double_signouts_total ?? "—");
    $("kpiReturnedByRate").textContent = fmtPct(k.returned_by_rate);
    $("kpiAirTagRate").textContent = fmtPct(k.airtag_rate);
    $("kpiAvgOut").textContent = fmtDuration(k.avg_out_duration_seconds);

    $("kpiReturnedByCounts").textContent =
        (k.total_returns != null)
        ? `${k.returns_with_returned_by}/${k.total_returns} returns`
        : "—";

    $("kpiAirTagCounts").textContent =
        (k.total_signouts != null)
        ? `${k.signouts_with_airtag}/${k.total_signouts} sign-outs`
        : "—";

    $("kpiRange").textContent =
        (range.start && range.end) ? `Range: ${range.start} → ${range.end}` : "—";

    renderTable($("tblSignoutsByDay"), s.signouts_by_day || [], ["day", "count"]);
    renderTable($("tblUniqueUsersByWeek"), s.unique_users_by_week || [], ["week", "count"]);
    renderTable($("tblDoubleByDay"), s.double_signouts_by_day || [], ["day", "count"]);

    // -----------------------------
    // Color signaling
    // -----------------------------
    function setCardState(cardId, state) {
        const el = $(cardId);
        if (!el) return;
        el.classList.remove("km-card--good", "km-card--warn", "km-card--bad");
        if (state) el.classList.add(state);
    }

    // Returned-by rate: higher is better
    const rb = k.returned_by_rate;
    if (rb == null) {
        setCardState("cardReturnedBy", null);
    } else if (rb >= 0.9) {
        setCardState("cardReturnedBy", "km-card--good");
    } else if (rb >= 0.75) {
        setCardState("cardReturnedBy", "km-card--warn");
    } else {
        setCardState("cardReturnedBy", "km-card--bad");
    }

    // AirTag rate: higher is better (tweak thresholds anytime)
    const at = k.airtag_rate;
    if (at == null) {
        setCardState("cardAirTag", null);
    } else if (at >= 0.7) {
        setCardState("cardAirTag", "km-card--good");
    } else if (at >= 0.4) {
        setCardState("cardAirTag", "km-card--warn");
    } else {
        setCardState("cardAirTag", "km-card--bad");
    }

    // Avg time out: lower is better
    const dur = k.avg_out_duration_seconds;
    if (dur == null) {
        setCardState("cardAvgOut", null);
    } else if (dur <= 24 * 3600) {
        setCardState("cardAvgOut", "km-card--good");
    } else if (dur <= 72 * 3600) {
        setCardState("cardAvgOut", "km-card--warn");
    } else {
        setCardState("cardAvgOut", "km-card--bad");
    }

    // Double sign-outs: lower is better
    const ds = k.double_signouts_total;
    if (ds == null) {
        setCardState("cardDoubleSignouts", null);
    } else if (ds <= 5) {
        setCardState("cardDoubleSignouts", "km-card--good");
    } else if (ds <= 10) {
        setCardState("cardDoubleSignouts", "km-card--warn");
    } else {
        setCardState("cardDoubleSignouts", "km-card--bad");
    }

    // Total signouts: no "good/bad" inherently, so leave neutral
    setCardState("cardTotalSignouts", null);
    }


  function initDefaults() {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 30);

    $("kmStart").value = toISODate(start);
    $("kmEnd").value = toISODate(end);
  }

  async function init() {
    initDefaults();

    $("kmApplyBtn").addEventListener("click", async () => {
      $("kmApplyBtn").disabled = true;
      try {
        const json = await loadMetrics();
        render(json);
      } catch (e) {
        console.warn(e);
        alert("Could not load key metrics.");
      } finally {
        $("kmApplyBtn").disabled = false;
      }
    });

    // initial load
    $("kmApplyBtn").click();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
