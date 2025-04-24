const DeficiencyTracker = (() => {
    const perPage = 10;
    let allData = [], filteredData = [], currentPage = 1, totalPages = 1;
  
    // Cache DOM elements
    const el = {
      list:        document.getElementById("deficiency-list"),
      prevBtn:     document.getElementById("prev-page"),
      nextBtn:     document.getElementById("next-page"),
      pageInfo:    document.getElementById("page-info"),
      filterMonthly:  document.getElementById("filter-monthly"),
      filterQuoted:   document.getElementById("filter-quoted"),
      filterCompany:  document.getElementById("filter-company"),
      filterService:  document.getElementById("filter-service"),
      filterReporter: document.getElementById("filter-reporter"),
      datalistCompany:  document.getElementById("company-list"),
      datalistService:  document.getElementById("service-list"),
      datalistReporter: document.getElementById("reporter-list"),
      filterReportedAfter: document.getElementById("filter-reported-after"),
      filterReportedBefore: document.getElementById("filter-reported-before")
    };
  
    function createBadge(text, variant="secondary") {
      const b = document.createElement("span");
      b.className = `badge bg-${variant} me-1`;
      b.textContent = text;
      return b;
    }
  
    function populateDatalists() {
      const companies = new Set(),
            services  = new Set(),
            reporters = new Set();
  
      allData.forEach(d => {
        if (d.company)      companies.add(d.company);
        if (d.service_line) services.add(d.service_line);
        if (d.reported_by)  reporters.add(d.reported_by);
      });
  
      function fill(set, datalist) {
        datalist.innerHTML = "";
        [...set].sort().forEach(val => {
          const opt = document.createElement("option");
          opt.value = val;
          datalist.append(opt);
        });
      }
  
      fill(companies, el.datalistCompany);
      fill(services, el.datalistService);
      fill(reporters, el.datalistReporter);
    }
  
    function applyFilters() {
      const mVal = el.filterMonthly.value;
      const qVal = el.filterQuoted.value;
      const cVal = el.filterCompany.value.trim().toLowerCase();
      const sVal = el.filterService.value.trim().toLowerCase();
      const rVal = el.filterReporter.value.trim().toLowerCase();
      const afterVal = el.filterReportedAfter.value;
      const beforeVal = el.filterReportedBefore.value;
  
      filteredData = allData.filter(d => {
        if (mVal === "true"  && !d.monthly_access) return false;
        if (mVal === "false" &&  d.monthly_access) return false;
        if (qVal === "sent" &&  !d.is_quote_sent) return false;
        if (qVal === "approved" && !d.is_quote_approved) return false;
        if (qVal === "draft" && !d.is_quote_in_draft) return false;
        if (cVal && d.company.toLowerCase() !== cVal) return false;
        if (sVal) {
          const full = (d.service_line || "").toLowerCase();
          if (full !== sVal && !full.includes(sVal)) return false;
        }
        if (rVal && d.reported_by.toLowerCase() !== rVal) return false;
      
        // Date filters
        if (afterVal && new Date(d.reported_on) < new Date(afterVal)) return false;
        if (beforeVal && new Date(d.reported_on) > new Date(beforeVal)) return false;
      
        return true;
      });
  
      totalPages = Math.max(1, Math.ceil(filteredData.length / perPage));
      currentPage = 1;
    }
  
    function renderPage() {
      el.list.innerHTML = "";
      const start = (currentPage - 1) * perPage;
      const slice = filteredData.slice(start, start + perPage);
  
      slice.forEach(d => {
        const card = document.createElement("div");
        card.className = "card mb-3 shadow-sm";
        const body = document.createElement("div");
        body.className = "card-body";
  
        // Title = address link
        const title = document.createElement("h5");
        title.className = "card-title d-flex align-items-center";
  
        const link = document.createElement("a");
        link.href = d.job_link;
        link.target = "_blank";
        link.textContent = d.address || d.location_name || "—";
        link.className = "me-2";
        title.append(link);
  
        body.append(title);
  
        // Subtitle = ID
        if (d.deficiency_id) {
          const sub = document.createElement("p");
          sub.className = "text-muted small mb-1";
          sub.textContent = d.deficiency_id;
          body.append(sub);
        }
  
        // — NEW: Reported On line —
        if (d.reported_on) {
          const dt = new Date(d.reported_on);
          const repLine = document.createElement("p");
          repLine.className = "text-muted small mb-3";
          repLine.textContent = `Reported on: ${dt.toLocaleString()}`;
          body.append(repLine);
        }
  
        // Description
        const desc = document.createElement("p");
        desc.className = "mb-1";
        desc.innerHTML = `<strong>Description:</strong> ${d.description}`;
        body.append(desc);
  
        // Proposed
        const sol = document.createElement("p");
        sol.className = "mb-2";
        sol.innerHTML = `<strong>Proposed:</strong> ${d.proposed_solution}`;
        body.append(sol);
  
        // Meta badges
        const meta = document.createElement("div");
        meta.className = "mb-3";

        // company badge
        meta.append(createBadge(d.company, "primary"));

        meta.append(createBadge(`Severity: ${d.severity}`, "secondary"));

        // monthly‐access badge
        if (d.monthly_access) meta.append(createBadge("Monthly Access", "info"));

        if (d.is_quote_sent) title.append(createBadge("Quote Sent", "success"));
        
        if (d.is_quote_approved) title.append(createBadge("Quote Approved", "success"));

        if (d.is_quote_in_draft) title.append(CreateBadge("Quote in Draft", "warning"))

        body.append(meta);
  
        // Footer
        const footer = document.createElement("div");
        footer.className = "d-flex align-items-center";
  
        if (d.reporter_image_link) {
          const img = document.createElement("img");
          img.src = d.reporter_image_link;
          img.width = 32; img.height = 32;
          img.className = "rounded-circle me-2";
          footer.append(img);
        }
        const rep = document.createElement("span");
        rep.className = "me-auto";
        rep.textContent = d.reported_by;
        footer.append(rep);
  
        if (d.service_line_icon) {
          const icon = document.createElement("img");
          icon.src = d.service_line_icon;
          icon.width = 16; icon.height = 16;
          icon.className = "me-1";
          footer.append(icon);
        }
        const sl = document.createElement("span");
        sl.textContent = d.service_line;
        footer.append(sl);
  
        body.append(footer);
        card.append(body);
        el.list.append(card);
      });
  
      // Update pagination
      el.pageInfo.textContent =
        `Page ${currentPage} of ${totalPages} — ${filteredData.length} deficiencies`;
      el.prevBtn.disabled = currentPage <= 1;
      el.nextBtn.disabled = currentPage >= totalPages;
    }
  
    function loadDeficiencyList() {
      const payload = JSON.stringify({
        start_date: "2025-04-01T00:00:00",
        end_date:   "2025-04-24T23:59:59"
      });
  
      fetch("/deficiency_tracker/deficiency_list", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    payload
      })
      .then(r => r.json())
      .then(data => {
        allData = data;
        populateDatalists();
        applyFilters();
        renderPage();
      })
      .catch(console.error);
    }
  
    function bindEvents() {
      [el.filterMonthly, el.filterQuoted, el.filterCompany, el.filterService, el.filterReporter, el.filterReportedAfter, el.filterReportedBefore]
        .forEach(inp => {
          inp.addEventListener("input", () => {
            applyFilters();
            renderPage();
          });
        });
          
      el.prevBtn.addEventListener("click", () => {
        if (currentPage > 1) {
          currentPage--;
          renderPage();
        }
      });
      el.nextBtn.addEventListener("click", () => {
        if (currentPage < totalPages) {
          currentPage++;
          renderPage();
        }
      });
    }
  
    function init() {
      document.addEventListener("DOMContentLoaded", () => {
        bindEvents();
        loadDeficiencyList();
      });
    }
  
    return { init };
  })();
  
  DeficiencyTracker.init();
  