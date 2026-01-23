// static/js/home.js

(function () {
  const refreshBtn = document.getElementById("home-refresh");

  // ---------------
  // LOADING FUNCTIONS 
  // ---------------
  async function loadTodaysDate() {
    const el = document.getElementById("home-subtitle-date");
    if (!el) return;

    const today = new Date();

    el.textContent = today.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }



  async function loadJobsToBeProcessed() {
    const url = `/home/kpi/jobs_to_process`;

    const skel = document.getElementById("kpi-to-be-processed-skel");
    const real = document.getElementById("kpi-to-be-processed-real");

    // Start state (show skeleton, hide real)
    if (skel) skel.style.display = "";
    if (real) real.classList.add("d-none");
    
    try {
      const r = await fetch(url, { headers: { "Accept": "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();

      renderJobsToBeProcessed(data);

      // Swap skeleton -> real
      if (skel) skel.style.display = "none";
      if (real) real.classList.remove("d-none");
    } catch (err) {
      console.error("Failed to load jobs to be processed", err);

      // Fallback: show real with error-ish values (don’t hide the card)
      if (skel) skel.style.display = "none";
      if (real) real.classList.remove("d-none");

      const val = document.getElementById("kpi-to-be-processed");
      if (val) val.textContent = "—";

      const pill = document.getElementById("kpi-pill-to-be-processed");
      if (pill) {
        pill.classList.remove("good", "warn", "bad");
        pill.textContent = "Error";
        pill.classList.add("bad");
      }
    }
  }

  async function loadForwardScheduleCoverage() {
    const url = "/home/kpi/forward_schedule_coverage";

    const skel = document.getElementById("kpi-forward-skel");
    const real = document.getElementById("kpi-forward-real");

    // Start state (show skeleton, hide real)
    if (skel) skel.style.display = "";
    if (real) real.classList.add("d-none");

    try {
      const r = await fetch(url, { headers: { "Accept": "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();

      renderForwardScheduleCoverage(data);

      // Swap skeleton -> real
      if (skel) skel.style.display = "none";
      if (real) real.classList.remove("d-none");
    } catch (err) {
      console.error("Failed to load forward schedule coverage", err);

      // Fallback: show real with error-ish values (don’t hide the card)
      if (skel) skel.style.display = "none";
      if (real) real.classList.remove("d-none");

      const val = document.getElementById("kpi-forward-coverage");
      if (val) val.textContent = "—";

      const pill = document.getElementById("kpi-pill-forward");
      if (pill) {
        pill.classList.remove("good", "warn", "bad");
        pill.textContent = "Error";
        pill.classList.add("bad");
      }
    }
  }

  async function loadJobsCompleted() {
    const url = `/home/kpi/jobs_completed_today`;

    const skel = document.getElementById("kpi-completed-skel");
    const real = document.getElementById("kpi-completed-real");

    // Start state (show skeleton, hide real)
    if (skel) skel.style.display = "";
    if (real) real.classList.add("d-none");
    
    try {
      const r = await fetch(url, { headers: { "Accept": "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();

      renderJobsCompleted(data);

      // Swap skeleton -> real
      if (skel) skel.style.display = "none";
      if (real) real.classList.remove("d-none");
    } catch (err) {
      console.error("Failed to load jobs completed", err);

      // Fallback: show real with error-ish values (don’t hide the card)
      if (skel) skel.style.display = "none";
      if (real) real.classList.remove("d-none");

      const val = document.getElementById("kpi-completed");
      if (val) val.textContent = "—";

      const pill = document.getElementById("kpi-pill-completed");
      if (pill) {
        pill.classList.remove("good", "warn", "bad");
        pill.textContent = "Error";
        pill.classList.add("bad");
      }
    }
  }

  async function loadJobsToBeInvoiced() {
    const url = `/home/kpi/jobs_to_invoice`;

    const skel = document.getElementById("kpi-invoiced-skel");
    const real = document.getElementById("kpi-invoiced-real");

    // Start state (show skeleton, hide real)
    if (skel) skel.style.display = "";
    if (real) real.classList.add("d-none");
    
    try {
      const r = await fetch(url, { headers: { "Accept": "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();

      renderJobsToBeInvoiced(data);

      // Swap skeleton -> real
      if (skel) skel.style.display = "none";
      if (real) real.classList.remove("d-none");
    } catch (err) {
      console.error("Failed to load jobs invoiced", err);

      // Fallback: show real with error-ish values (don’t hide the card)
      if (skel) skel.style.display = "none";
      if (real) real.classList.remove("d-none");

      const val = document.getElementById("kpi-invoiced");
      if (val) val.textContent = "—";

      const pill = document.getElementById("kpi-pill-invoiced");
      if (pill) {
        pill.classList.remove("good", "warn", "bad");
        pill.textContent = "Error";
        pill.classList.add("bad");
      }
    }
  }


  // ---------------
  // RENDERING FUNCTIONS 
  // ---------------
  function renderJobsToBeProcessed(data){
    // Expecting: {jobs_to_process: 12}
    const jobs_to_process =
    typeof data.jobs_to_process === "number"
      ? data.jobs_to_process
      : (typeof data.jobs_to_process === "number" ? data.jobs_to_process : null);

    const el = document.getElementById("kpi-to-be-processed");
    console.log(jobs_to_process);
    if (el) el.textContent = (jobs_to_process == null ? "—" : jobs_to_process);

    // Pill label + status thresholds (tweak these anytime)
    const pill = document.getElementById("kpi-pill-to-be-processed");
    if (!pill) return;

    pill.classList.remove("good", "warn", "bad");

    if (jobs_to_process == null) {
      pill.textContent = "—";
      return;
    }

    if (jobs_to_process <= 40) {
      pill.textContent = "Good";
      pill.classList.add("good");
    } else if (jobs_to_process <= 50) {
      pill.textContent = "Watch";
      pill.classList.add("warn");
    } else {
      pill.textContent = "Too High";
      pill.classList.add("bad");
    }
  }


  function renderJobsToBeInvoiced(data){
    // Expecting: {jobs_to_be_invoiced: 12}
    const to_be_invoiced =
    typeof data.jobs_to_be_invoiced === "number"
      ? data.jobs_to_be_invoiced
      : (typeof data.jobs_to_be_invoiced === "number" ? data.jobs_to_be_invoiced : null);

    const el = document.getElementById("kpi-invoiced");
    if (el) el.textContent = (to_be_invoiced == null ? "—" : to_be_invoiced);

    // Pill label + status thresholds (tweak these anytime)
    const pill = document.getElementById("kpi-pill-invoiced");
    if (!pill) return;

    pill.classList.remove("good", "warn", "bad");

    if (to_be_invoiced == null) {
      pill.textContent = "—";
      return;
    }

    // Example thresholds: <50 bad, 50–59 warn, >=60 good
    if (to_be_invoiced <= 30) {
      pill.textContent = "Good";
      pill.classList.add("good");
    } else if (to_be_invoiced <= 50) {
      pill.textContent = "Watch";
      pill.classList.add("warn");
    } else {
      pill.textContent = "Low";
      pill.classList.add("bad");
    }
    
  }


  function renderJobsCompleted(data){
    // Expecting: {jobs_completed_today: 12}
    const completed =
    typeof data.jobs_completed_today === "number"
      ? data.jobs_completed_today
      : (typeof data.jobs_completed_today === "number" ? data.jobs_completed_today : null);

    const el = document.getElementById("kpi-completed");
    if (el) el.textContent = (completed == null ? "—" : completed);

    // Pill label + status thresholds (tweak these anytime)
    const pill = document.getElementById("kpi-pill-completed");
    if (!pill) return;

    pill.classList.remove("good", "warn", "bad");

    if (completed == null) {
      pill.textContent = "—";
      return;
    }

    // Example thresholds: <50 bad, 50–59 warn, >=60 good
    if (completed >= 15) {
      pill.textContent = "Good";
      pill.classList.add("good");
    } else if (completed >= 10) {
      pill.textContent = "Ok";
      pill.classList.add("warn");
    } else {
      pill.textContent = "Low";
      pill.classList.add("bad");
    }
    
  }


  function renderForwardScheduleCoverage(data) {
    // Expecting: { forward_schedule_coverage: 63.2 } OR { forward_schedule_coverage_pct: 63.2 }
    const pct =
      typeof data.forward_schedule_coverage_pct === "number"
        ? data.forward_schedule_coverage_pct
        : (typeof data.forward_schedule_coverage === "number" ? data.forward_schedule_coverage : null);

    const el = document.getElementById("kpi-forward-coverage");
    if (el) el.textContent = (pct == null ? "—" : pct.toFixed(0));

    // Pill label + status thresholds (tweak these anytime)
    const pill = document.getElementById("kpi-pill-forward");
    if (!pill) return;

    pill.classList.remove("good", "warn", "bad");

    if (pct == null) {
      pill.textContent = "—";
      return;
    }

    // Example thresholds: <50 bad, 50–59 warn, >=60 good
    if (pct >= 90) {
      pill.textContent = "Good";
      pill.classList.add("good");
    } else if (pct >= 85) {
      pill.textContent = "Watch";
      pill.classList.add("warn");
    } else {
      pill.textContent = "Low";
      pill.classList.add("bad");
    }
  }

  // ---------------
  //  NEEDS ATTENTION SECTION
  // ---------------
  async function loadNeedsAttention() {
    const url = "/home/needs_attention";
    const skel = document.getElementById("home-attn-skel");
    const empty = document.getElementById("home-attn-empty");
    const list = document.getElementById("home-attn-list");

    if (!list) return;

    // start loading state
    if (skel) skel.style.display = "";
    if (empty) empty.style.display = "none";
    list.querySelectorAll(".home-attn-item.real").forEach(n => n.remove());

    try {
      const r = await fetch(url, { headers: { "Accept": "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();

      const items = data.items || [];

      // stop loading state
      if (skel) skel.style.display = "none";

      if (items.length === 0) {
        if (empty) empty.style.display = "";
        return;
      }

      if (empty) empty.style.display = "none";

      for (const item of items) {
        const node = renderAttentionItem(item);
        node.classList.add("real"); // mark for easy cleanup next refresh
        list.appendChild(node);
      }
    } catch (err) {
      console.error("Failed to load needs attention", err);

      // stop loading state, show empty
      if (skel) skel.style.display = "none";
      if (empty) empty.style.display = "";
    }
  }

  function renderAttentionItem(item) {
    const severity = item?.severity || "warn"; // bad|warn|good
    const title = item?.title || "Needs attention";
    const subtitle = item?.subtitle || "";
    const href = item?.href || "#";
    const badge = item?.badge;

    const wrap = document.createElement("div");
    wrap.className = "home-attn-item";

    // Left side (icon + text)
    const left = document.createElement("div");
    left.className = "home-attn-left";

    const icon = document.createElement("div");
    icon.innerHTML = severityIcon(severity);

    const texts = document.createElement("div");
    texts.className = "home-attn-texts";

    const h = document.createElement("p");
    h.className = "home-attn-title";
    h.textContent = title;

    texts.appendChild(h);

    if (subtitle) {
      const sub = document.createElement("p");
      sub.className = "home-attn-sub";
      sub.textContent = subtitle;
      texts.appendChild(sub);
    }

    left.appendChild(icon);
    left.appendChild(texts);

    // Right side (badge + arrow link)
    const right = document.createElement("div");
    right.className = "d-flex align-items-center gap-2";

    if (badge !== undefined && badge !== null && String(badge).trim() !== "") {
      const b = document.createElement("span");
      b.className = "home-attn-badge";
      b.textContent = String(badge);
      right.appendChild(b);
    }

    const link = document.createElement("a");
    link.href = href;
    link.className = "btn btn-sm btn-outline-secondary";
    link.setAttribute("aria-label", `Open: ${title}`);
    link.innerHTML = '<i class="bi bi-arrow-right"></i>';

    right.appendChild(link);

    wrap.appendChild(left);
    wrap.appendChild(right);

    return wrap;
  }

  function severityIcon(sev) {
    if (sev === "good") return '<i class="bi bi-check-circle text-success"></i>';
    if (sev === "bad") return '<i class="bi bi-x-circle text-danger"></i>';
    return '<i class="bi bi-exclamation-triangle text-warning"></i>';
  }





  document.addEventListener("DOMContentLoaded", () => {
    loadTodaysDate();
    loadJobsToBeProcessed();
    loadJobsToBeInvoiced();
    loadForwardScheduleCoverage();
    loadJobsCompleted();
    loadNeedsAttention();
  });

  refreshBtn?.addEventListener("click", () => {
    loadJobsToBeProcessed();
    loadJobsToBeInvoiced();
    loadForwardScheduleCoverage();
    loadJobsCompleted();
    loadNeedsAttention();
  });
})();
