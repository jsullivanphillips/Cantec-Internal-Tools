const DeficiencyTracker = (() => {
    const perPage = 10;
    let allData = [], filteredData = [], currentPage = 1, totalPages = 1;
    let quotingChartInstance = null;
    let quotingOverTimeChartInstance = null;
  
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
      filterReportedBefore: document.getElementById("filter-reported-before"),
      filterSort: document.getElementById("filter-sort")
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
      const sortVal = el.filterSort.value;
  
      filteredData = allData.filter(d => {
        if (mVal === "true" && !d.monthly_access) return false;
        if (mVal === "false" && d.monthly_access) return false;
      
        // Quote status filters
        const today = new Date();
        today.setHours(0, 0, 0, 0);
      
        if (qVal) {
          if (qVal === "sent" && !d.is_quote_sent) return false;
          if (qVal === "approved" && !d.is_quote_approved) return false;
          if (qVal === "draft" && !d.is_quote_in_draft) return false;
          if (qVal === "expired") {
            if (!d.is_quote_sent || !d.quote_expiry) return false;
      
            const expiryDate = new Date(d.quote_expiry);
            expiryDate.setHours(0, 0, 0, 0);
      
            if (expiryDate >= today) return false; // Not expired
          }
        }
      
        // Company filter
        if (cVal && d.company.toLowerCase() !== cVal) return false;
      
        // Service Line filter
        if (sVal) {
          const full = (d.service_line || "").toLowerCase();
          if (full !== sVal && !full.includes(sVal)) return false;
        }
      
        // Reporter filter
        if (rVal && d.reported_by.toLowerCase() !== rVal) return false;
      
        // Reported After
        if (afterVal) {
          const afterDate = new Date(afterVal);
          const reportedDate = new Date(d.reported_on);
          if (reportedDate < afterDate) return false;
        }
      
        // Reported Before
        if (beforeVal) {
          const beforeDate = new Date(beforeVal);
          const reportedDate = new Date(d.reported_on);
          if (reportedDate > beforeDate) return false;
        }
      
        return true;
      });
      

      if (sortVal === "oldest") {
        filteredData.sort((a, b) => new Date(a.reported_on) - new Date(b.reported_on));
      } else {
        filteredData.sort((a, b) => new Date(b.reported_on) - new Date(a.reported_on));
      }
  
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
      
        // TITLE SECTION
        const title = document.createElement("h5");
        title.className = "card-title d-flex align-items-center justify-content-between";
      
        const titleLeft = document.createElement("div");
        const link = document.createElement("a");
        link.href = d.job_link;
        link.target = "_blank";
        link.textContent = d.address || d.location_name || "—";
        link.className = "me-2";
        titleLeft.append(link);

        if (d.is_quote_approved) {
            titleLeft.append(createBadge("Quote Approved", "success"));
          }
          
          if (d.is_quote_sent) {
            titleLeft.append(createBadge("Quote Sent", "info"));
          
            if (d.quote_expiry) {
              const expiryDate = new Date(d.quote_expiry);
              const today = new Date();
          
              // Normalize both dates to remove time for comparison
              today.setHours(0, 0, 0, 0);
              expiryDate.setHours(0, 0, 0, 0);
          
              if (expiryDate < today) {
                // Quote is expired
                titleLeft.append(createBadge("Quote Expired", "danger"));
              } else {
                // Show regular expiry date if not expired
                const expiryText = document.createElement("span");
                expiryText.className = "text-muted small ms-2"; 
                expiryText.textContent = "Quote Expires: " + expiryDate.toLocaleDateString();
                titleLeft.append(expiryText);
              }
            }
          }
          
          if (d.is_quote_in_draft) {
            titleLeft.append(createBadge("Quote in Draft", "warning"));
          }
          

        title.append(titleLeft);
      
        // ACTIONS RIGHT SIDE
        const actions = document.createElement("div");
        actions.className = "d-flex align-items-center gap-2";

        // Hide checkbox
        const hideLabel = document.createElement("label");
        hideLabel.className = "form-check-label small me-2";
        const hideCheckbox = document.createElement("input");
        hideCheckbox.type = "checkbox";
        hideCheckbox.className = "form-check-input me-1";
        hideCheckbox.checked = d.hidden || false;
        hideLabel.append(hideCheckbox);
        hideLabel.append("Hide");
        actions.append(hideLabel);
      
      
        // Caret button
        const caretBtn = document.createElement("button");
        caretBtn.className = "btn btn-sm btn-light";
        caretBtn.innerHTML = "&#9660;";
        actions.append(caretBtn);
      
        title.append(actions);
        body.append(title);
      
        // BODY SECTION
        const cardBodySection = document.createElement("div");
        cardBodySection.style.transition = "max-height 0.3s ease";
        if (d.hidden) cardBodySection.style.display = "none";  // Hide if hidden initially
      
        // Rest of card details
        if (d.deficiency_id) {
          const sub = document.createElement("p");
          sub.className = "text-muted small mb-1";
          sub.textContent = d.deficiency_id;
          cardBodySection.append(sub);
        }
        if (d.reported_on) {
          const dt = new Date(d.reported_on);
          const repLine = document.createElement("p");
          repLine.className = "text-muted small mb-3";
          repLine.textContent = `Reported on: ${dt.toISOString().split('T')[0]}`;
          cardBodySection.append(repLine);
        }
        const desc = document.createElement("p");
        desc.className = "mb-1";
        desc.innerHTML = `<strong>Description:</strong> ${d.description}`;
        cardBodySection.append(desc);
      
        const sol = document.createElement("p");
        sol.className = "mb-2";
        sol.innerHTML = `<strong>Proposed:</strong> ${d.proposed_solution}`;
        cardBodySection.append(sol);
      
        const meta = document.createElement("div");
        meta.className = "mb-3";
      
        meta.append(createBadge(d.company, "primary"));
        meta.append(createBadge(`Severity: ${d.severity}`, "secondary"));
        if (d.monthly_access) meta.append(createBadge("Monthly Access", "info"));
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
        if (d.service_line_icon_link) {
          const icon = document.createElement("img");
          icon.src = d.service_line_icon_link;
          icon.width = 32; icon.height = 32;
          icon.className = "me-1";
          footer.append(icon);
        }
        const sl = document.createElement("span");
        sl.textContent = d.service_line;
        footer.append(sl);
      
        cardBodySection.append(footer);
        body.append(cardBodySection);
      
        // Event Listeners
        hideCheckbox.addEventListener("change", () => {
          d.hidden = hideCheckbox.checked;
          cardBodySection.style.display = d.hidden ? "none" : "block";
          fetch("/deficiency_tracker/hide_toggle", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              deficiency_id: d.deficiency_id,
              hidden: d.hidden
            })
          }).catch(console.error);
        });
      
        caretBtn.addEventListener("click", () => {
          if (cardBodySection.style.display === "none") {
            cardBodySection.style.display = "block";
          } else {
            cardBodySection.style.display = "none";
          }
        });
      
        card.append(body);
        el.list.append(card);
      });
      
  
      // Update pagination
      el.pageInfo.textContent =
        `Page ${currentPage} of ${totalPages} — ${filteredData.length} deficiencies`;
      el.prevBtn.disabled = currentPage <= 1;
      el.nextBtn.disabled = currentPage >= totalPages;
    }

    function renderQuotingMetrics() {
        const quotingContainer = document.getElementById("quoting-metrics");
        quotingContainer.classList.remove("opacity-100");
        quotingContainer.classList.add("opacity-0");
        quotingContainer.innerHTML = "";
      
        const afterInput = document.getElementById("quote-filter-after");
        const beforeInput = document.getElementById("quote-filter-before");
      
        const afterDate = afterInput.value ? new Date(afterInput.value) : null;
        const beforeDate = beforeInput.value ? new Date(beforeInput.value) : null;
      
        if (afterDate) afterDate.setHours(0, 0, 0, 0);
        if (beforeDate) beforeDate.setHours(23, 59, 59, 999);
      
        let sent = 0, approved = 0, draft = 0, expired = 0, notQuoted = 0;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
      
        allData.forEach(d => {
          if (!d.reported_on) return;
          const reportedDate = new Date(d.reported_on);
          reportedDate.setHours(0, 0, 0, 0);
      
          if (afterDate && reportedDate < afterDate) return;
          if (beforeDate && reportedDate > beforeDate) return;
      
          const isAnyQuote = d.is_quote_sent || d.is_quote_approved || d.is_quote_in_draft;
      
          if (d.is_quote_sent || d.is_quote_approved || d.is_quote_in_draft) {
            if (d.is_quote_sent || d.is_quote_approved) sent++;
            if (d.is_quote_approved) approved++;
            if (d.is_quote_in_draft) draft++;
      
            if (d.is_quote_sent && d.quote_expiry) {
              const expiryDate = new Date(d.quote_expiry);
              expiryDate.setHours(0, 0, 0, 0);
              if (expiryDate < today) expired++;
            }
          }
      
          if (!isAnyQuote) {
            notQuoted++;
          }
        });
      
        const stats = [
          { label: "Quotes Sent", value: sent, color: "info" },
          { label: "Quotes Approved", value: approved, color: "success" },
          { label: "Quotes In Draft", value: draft, color: "warning" },
          { label: "Quotes Expired", value: expired, color: "danger" },
          { label: "Deficiencies Not Quoted", value: notQuoted, color: "secondary" }
        ];
      
        stats.forEach(stat => {
          const col = document.createElement("div");
          col.className = "col-md-3 mb-3";
      
          const card = document.createElement("div");
          card.className = `card text-center border-${stat.color}`;
      
          const cardBody = document.createElement("div");
          cardBody.className = `card-body`;
      
          const title = document.createElement("h5");
          title.className = `card-title text-${stat.color}`;
          title.textContent = stat.label;
      
          const value = document.createElement("p");
          value.className = "display-6";
          value.textContent = stat.value;
      
          cardBody.append(title);
          cardBody.append(value);
          card.append(cardBody);
          col.append(card);
          quotingContainer.append(col);
        });
      
        // Fade in
        setTimeout(() => {
          quotingContainer.classList.remove("opacity-0");
          quotingContainer.classList.add("opacity-100");
        }, 50);
      
        // Draw Chart
        drawQuotingChart(sent, approved, draft, expired, notQuoted);
        drawQuotingOverTimeChart(afterDate, beforeDate);
      }
      

 

    function drawQuotingChart(sent, approved, draft, expired, notQuoted) {
        const ctx = document.getElementById("quoting-chart").getContext("2d");

        if (quotingChartInstance) {
            quotingChartInstance.destroy();
        }

        quotingChartInstance = new Chart(ctx, {
            type: "bar",
            data: {
            labels: ["Sent", "Approved", "In Draft", "Expired", "Not Quoted"],
            datasets: [{
                label: "Quotes",
                data: [sent, approved, draft, expired, notQuoted],
                backgroundColor: [
                "#0dcaf0", // info
                "#198754", // success
                "#ffc107", // warning
                "#dc3545", // danger
                "#6c757d"  // secondary
                ]
            }]
            },
            options: {
            responsive: true,
            plugins: {
                legend: {
                display: false
                }
            },
            scales: {
                y: {
                beginAtZero: true,
                ticks: {
                    stepSize: 1
                }
                }
            }
            }
        });
    }


    function drawQuotingOverTimeChart(afterDate, beforeDate) {
        const ctx = document.getElementById("quoting-over-time-chart").getContext("2d");

        if (quotingOverTimeChartInstance) {
            quotingOverTimeChartInstance.destroy();
        }

        const weekCountsSent = {};     // { "2025-04-01": 5, "2025-04-08": 7, ... }
        const weekCountsApproved = {}; // { "2025-04-01": 2, "2025-04-08": 5, ... }

        allData.forEach(d => {
            if (!d.reported_on) return;
            const reportedDate = new Date(d.reported_on);
            reportedDate.setHours(0, 0, 0, 0);

            if (afterDate && reportedDate < afterDate) return;
            if (beforeDate && reportedDate > beforeDate) return;

            // Calculate week start (Monday)
            const weekStart = new Date(reportedDate);
            const day = weekStart.getDay(); // 0 = Sun, 1 = Mon, etc.
            const diffToMonday = (day === 0 ? -6 : 1) - day;
            weekStart.setDate(weekStart.getDate() + diffToMonday);

            const weekKey = weekStart.toISOString().split('T')[0];

            if (d.is_quote_sent || d.is_quote_approved) {
            weekCountsSent[weekKey] = (weekCountsSent[weekKey] || 0) + 1;
            }
            if (d.is_quote_approved) {
            weekCountsApproved[weekKey] = (weekCountsApproved[weekKey] || 0) + 1;
            }
        });

        // Merge and sort weeks chronologically
        const allWeeks = new Set([...Object.keys(weekCountsSent), ...Object.keys(weekCountsApproved)]);
        const sortedWeeks = Array.from(allWeeks).sort();

        const sentDataPoints = sortedWeeks.map(week => weekCountsSent[week] || 0);
        const approvedDataPoints = sortedWeeks.map(week => weekCountsApproved[week] || 0);

        quotingOverTimeChartInstance = new Chart(ctx, {
            type: "line",
            data: {
            labels: sortedWeeks,
            datasets: [
                {
                label: "Quotes Sent",
                data: sentDataPoints,
                borderColor: "#0dcaf0",
                backgroundColor: "rgba(13, 202, 240, 0.2)",
                tension: 0.3,
                fill: true,
                pointRadius: 4
                },
                {
                label: "Quotes Approved",
                data: approvedDataPoints,
                borderColor: "#198754",
                backgroundColor: "rgba(25, 135, 84, 0.2)",
                tension: 0.3,
                fill: true,
                pointRadius: 4
                }
            ]
            },
            options: {
            responsive: true,
            plugins: {
                legend: {
                display: true,
                position: "top"
                },
                tooltip: {
                mode: "index",
                intersect: false
                }
            },
            interaction: {
                mode: "index",
                intersect: false
            },
            scales: {
                x: {
                ticks: {
                    autoSkip: true,
                    maxTicksLimit: 12
                }
                },
                y: {
                beginAtZero: true,
                ticks: {
                    stepSize: 1
                }
                }
            }
            }
        });
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
          
            const afterInput = document.getElementById("quote-filter-after");
            const beforeInput = document.getElementById("quote-filter-before");
          
            if (afterInput && beforeInput) {
              const today = new Date();
              const lastMonth = new Date();
              lastMonth.setDate(today.getDate() - 30);
          
              afterInput.value = lastMonth.toISOString().split('T')[0];
              beforeInput.value = today.toISOString().split('T')[0];
            }
          
            renderQuotingMetrics(); 
          })          
        .catch(console.error);
      }
      
  
    function bindEvents() {
        [
        el.filterMonthly,
        el.filterQuoted,
        el.filterCompany,
        el.filterService,
        el.filterReporter,
        el.filterReportedAfter,
        el.filterReportedBefore,
        el.filterSort // ✅ New
        ].forEach(inp => {
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
      const applyQuoteBtn = document.getElementById("apply-quote-filters");
        if (applyQuoteBtn) {
        applyQuoteBtn.addEventListener("click", () => {
            renderQuotingMetrics();
        });
        }
    }
  
    function init() {
        document.addEventListener("DOMContentLoaded", () => {
          bindEvents();
          loadDeficiencyList();
      
          // 🛠️ NEW: Start polling for new data every 60 seconds
          setInterval(() => {
            console.log("🔄 Auto-refreshing deficiency list...");
            loadDeficiencyList();
          }, 60000); // 60,000 ms = 60 seconds
        });
      }
      
  
    return { init };
  })();
  
  DeficiencyTracker.init();
  