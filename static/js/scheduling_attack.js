document.addEventListener("DOMContentLoaded", function() {
    const monthSelect = document.getElementById("month-select");
    const now = new Date();
    const defaultMonth = now.toISOString().slice(0, 7); // YYYY-MM format
    monthSelect.value = defaultMonth;
    document.getElementById("selected-month").textContent = defaultMonth;
  
    // Load the metrics for the default month
    loadMetrics(defaultMonth);
  
    // When user clicks "Submit", reload metrics for the new month
    document.getElementById("submitMonthBtn").addEventListener("click", function() {
      const selectedMonth = monthSelect.value;
      document.getElementById("selected-month").textContent = selectedMonth;
      loadMetrics(selectedMonth);
    });
  
    // Toggle show/hide for the "Jobs To Be Scheduled" section
    const toggleBtn = document.getElementById("toggleJobsBtn");
    const jobsSection = document.getElementById("jobsToBeScheduledSection");
    if (toggleBtn && jobsSection) {
      toggleBtn.addEventListener("click", () => {
        if (jobsSection.style.display === "none") {
          jobsSection.style.display = "block";
          toggleBtn.textContent = "Hide";
        } else {
          jobsSection.style.display = "none";
          toggleBtn.textContent = "Show";
        }
      });
    }

    const toggleInvBtn = document.getElementById("toggleInvestigateJobsBtn");
    const jobsNotCountedSection = document.getElementById("notCountedFaLocations");

    if (toggleInvBtn && jobsNotCountedSection) {
    toggleInvBtn.addEventListener("click", () => {
        if (jobsNotCountedSection.style.display === "none") {
        jobsNotCountedSection.style.display = "block";
        toggleInvBtn.textContent = "Hide";
        } else {
        jobsNotCountedSection.style.display = "none";
        toggleInvBtn.textContent = "Show";
        }
    });
    }
  });
  
  function loadMetrics(selectedMonth) {
    // Mapping of backend keys to element IDs for pre-existing cards
    const mapping = {
      "released_fa_jobs": "releasedFAJobs",
      "released_fa_tech_hours": "releasedFATechHours",
      "released_sprinkler_jobs": "releasedSprJobs",
      "released_sprinkler_tech_hours": "releasedSprTechHours",
      "scheduled_fa_jobs": "scheduledFAJobs",
      "scheduled_fa_tech_hours": "scheduledFATechHours",
      "scheduled_sprinkler_jobs": "scheduledSprJobs",
      "scheduled_sprinkler_tech_hours": "scheduledSprTechHours",
      "to_be_scheduled_fa_jobs": "toBeScheduledFAJobs",
      "to_be_scheduled_fa_tech_hours": "toBeScheduledFATechHours",
      "to_be_scheduled_sprinkler_jobs": "toBeScheduledSprJobs",
      "to_be_scheduled_sprinkler_tech_hours": "toBeScheduledSprTechHours",
      // "jobs_to_be_scheduled": "jobsToBeScheduled"  // We'll handle this separately
    };
  
    // Show spinners on known elements
    const spinner = spinnerMarkup();
    Object.values(mapping).forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.innerHTML = spinner;
      }
    });
  
    // Set KPI text & progress bar to loading state
    const kpiTextEl = document.getElementById("inspectionsKPIText");
    if (kpiTextEl) { kpiTextEl.textContent = "Loading..."; }
    const kpiBarEl = document.getElementById("inspectionsKPIBar");
    if (kpiBarEl) {
      kpiBarEl.style.width = "0%";
      kpiBarEl.setAttribute("aria-valuenow", "0");
    }
  
    // Clear the "Jobs To Be Scheduled" container
    const container = document.getElementById("jobsToBeScheduledLocationsContainer");
    if (container) {
      container.innerHTML = spinner; // Show spinner while loading
    }

    const container2 = document.getElementById("notCountedFaLocationsContainer");
    if (container2) {
      container2.innerHTML = spinner; // Show spinner while loading
    }
  
    // Fetch data from the backend
    fetch("/scheduling_attack/metrics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month: selectedMonth })
    })
      .then(response => response.json())
      .then(data => {
        // 1) Update known metric cards
        for (const key in mapping) {
          const elemId = mapping[key];
          const el = document.getElementById(elemId);
          if (el && data[key] !== undefined) {
            el.textContent = data[key];
          }
        }
  
        // 2) Handle "jobs_to_be_scheduled"
        if (data.jobs_to_be_scheduled) {
          if (container) {
            container.innerHTML = ""; // Clear spinner
            const locData = data.jobs_to_be_scheduled;
            // For each location, create a small card
            for (const locId in locData) {
              if (locData.hasOwnProperty(locId)) {
                const { address, url } = locData[locId];
  
                // Each card in a responsive .col
                const colDiv = document.createElement("div");
                colDiv.classList.add("col");
  
                // The card
                const card = document.createElement("div");
                card.classList.add("small-card", "h-100");
  
                // Card header
                const cardHeader = document.createElement("div");
                cardHeader.classList.add("card-header");
                cardHeader.textContent = address || "No Address";
                card.appendChild(cardHeader);
  
                // Card body
                const cardBody = document.createElement("div");
                cardBody.classList.add("card-body");
                if (url) {
                  const anchor = document.createElement("a");
                  anchor.href = url;
                  anchor.textContent = url;
                  anchor.target = "_blank";
                  cardBody.appendChild(anchor);
                } else {
                  cardBody.textContent = "No URL";
                }
                card.appendChild(cardBody);
  
                colDiv.appendChild(card);
                container.appendChild(colDiv);
              }
            }
          }
        } else {
          // If no jobs_to_be_scheduled data
          if (container) container.innerHTML = "No jobs to display.";
        }

        // jobs to investigate
        if (data.not_counted_fa_locations) {
            if (container2) {
              container2.innerHTML = ""; // Clear spinner
              const locData = data.not_counted_fa_locations;
              // For each location, create a small card
              for (const locId in locData) {
                if (locData.hasOwnProperty(locId)) {
                  const { address, url } = locData[locId];
    
                  // Each card in a responsive .col
                  const colDiv = document.createElement("div");
                  colDiv.classList.add("col");
    
                  // The card
                  const card = document.createElement("div");
                  card.classList.add("small-card", "h-100");
    
                  // Card header
                  const cardHeader = document.createElement("div");
                  cardHeader.classList.add("card-header");
                  cardHeader.textContent = address || "No Address";
                  card.appendChild(cardHeader);
    
                  // Card body
                  const cardBody = document.createElement("div");
                  cardBody.classList.add("card-body");
                  if (url) {
                    const anchor = document.createElement("a");
                    anchor.href = url;
                    anchor.textContent = url;
                    anchor.target = "_blank";
                    cardBody.appendChild(anchor);
                  } else {
                    cardBody.textContent = "No URL";
                  }
                  card.appendChild(cardBody);
    
                  colDiv.appendChild(card);
                  container2.appendChild(colDiv);
                }
              }
            }
          } else {
            // If no jobs_to_be_scheduled data
            if (container2) container2.innerHTML = "No jobs to display.";
        }
  
        // 3) Calculate overall inspections KPI
        const releasedFA = parseInt(data.released_fa_jobs) || 0;
        const scheduledFA = parseInt(data.scheduled_fa_jobs) || 0;
        const toBeScheduledFA = parseInt(data.to_be_scheduled_fa_jobs) || 0;
  
        const releasedSpr = parseInt(data.released_sprinkler_jobs) || 0;
        const scheduledSpr = parseInt(data.scheduled_sprinkler_jobs) || 0;
        const toBeScheduledSpr = parseInt(data.to_be_scheduled_sprinkler_jobs) || 0;
  
        const totalInspections = releasedFA + scheduledFA + toBeScheduledFA +
                                 releasedSpr + scheduledSpr + toBeScheduledSpr;
        const scheduledInspections = releasedFA + scheduledFA + releasedSpr + scheduledSpr;
        const percentScheduled = totalInspections > 0
          ? Math.round((scheduledInspections / totalInspections) * 100)
          : 0;
  
        // Update KPI text & bar
        if (kpiTextEl) {
          kpiTextEl.textContent = `${scheduledInspections} of ${totalInspections} Inspections Scheduled (${percentScheduled}% Complete)`;
        }
        if (kpiBarEl) {
          kpiBarEl.style.width = `${percentScheduled}%`;
          kpiBarEl.setAttribute("aria-valuenow", percentScheduled);
        }
  
        // 4) Dynamically add new cards for any extra keys not in mapping
        const mainContainer = document.querySelector(".cards-container.scheduling-attack");
        for (const key in data) {
          if (!mapping.hasOwnProperty(key) && key !== "jobs_to_be_scheduled" && key !== "not_counted_fa_locations") {
            let extraCard = document.getElementById(key);
            if (!extraCard) {
              extraCard = document.createElement("div");
              extraCard.classList.add("card", "half", "mt-3");
              extraCard.id = key;
  
              const header = document.createElement("div");
              header.classList.add("card-header");
              header.textContent = key.replace(/_/g, " ").toUpperCase();
  
              const body = document.createElement("div");
              body.classList.add("card-body");
  
              extraCard.appendChild(header);
              extraCard.appendChild(body);
              mainContainer.appendChild(extraCard);
            }
            const body = extraCard.querySelector(".card-body");
            if (body) {
              body.textContent = data[key];
            }
          }
        }
      })
      .catch(error => console.error("Error loading metrics:", error));
  }
  
  function spinnerMarkup() {
    return `
      <div class="spinner-border text-primary" role="status">
        <span class="visually-hidden">Loading...</span>
      </div>`;
  }
  