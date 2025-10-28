// processing_attack.js

Chart.defaults.datasets.bar.categoryPercentage = 0.7;
Chart.defaults.datasets.bar.barPercentage = 0.8;
let isPinkFolderDataLoaded = false;
let isOldestJobsDataLoaded = false;

/****************************************
 * 1) Dummy data for Pink Folder Jobs
 ****************************************/
const pinkfolderDetailedData = [
  {
    technicianName: "John Doe",
    pinkFolderJobCount: 2,
    jobs: [
      { name: "Job #123", url: "/jobs/123" },
      { name: "Job #124", url: "/jobs/124" }
    ]
  },
  {
    technicianName: "Jane Smith",
    pinkFolderJobCount: 3,
    jobs: [
      { name: "Job #234", url: "/jobs/234" },
      { name: "Job #235", url: "/jobs/235" },
      { name: "Job #236", url: "/jobs/236" }
    ]
  },
  {
    technicianName: "Alex Johnson",
    pinkFolderJobCount: 1,
    jobs: [
      { name: "Job #567", url: "/jobs/567" }
    ]
  }
];

const ProcessingAttack = (() => {
  // Chart variables
  let jobsChart,
      jobsProcessedChart,
      jobsProcessedByProcessorChart,
      jobHoursProcessedByTypeChart,
      jobHoursProcessedByProcessorChart;

  /* =======================================================
     HELPER FUNCTIONS
  ========================================================== */

  // Interpolate between two hex colors based on a value.
  function interpolateColor(minColor, maxColor, minValue, maxValue, value) {
    const hexToRgb = hex => hex.match(/\w\w/g).map(x => parseInt(x, 16));
    const rgbToHex = rgb => `#${rgb.map(x => x.toString(16).padStart(2, "0")).join("")}`;

    const minRgb = hexToRgb(minColor);
    const maxRgb = hexToRgb(maxColor);
    const ratio = Math.min(1, Math.max(0, (value - minValue) / (maxValue - minValue))); // Normalize between 0 and 1
    const interpolatedRgb = minRgb.map((min, i) => Math.round(min + ratio * (maxRgb[i] - min)));
    return rgbToHex(interpolatedRgb);
  }

  // Format strings: replace underscores with spaces and capitalize words.
  function properFormat(s) {
    return s
      .replace(/_/g, " ")
      .replace(/\b\w/g, char => char.toUpperCase());
  }

  // Display the work week options in the week select element.
  function generateWorkWeekOptions() {
    const weekSelect = document.getElementById("week-select");
    weekSelect.innerHTML = "";
    const options = [];
    const now = new Date();

    // Determine the current week's Monday.
    const day = now.getDay();
    let mondayThisWeek = new Date(now);
    mondayThisWeek.setDate(now.getDate() - ((day + 6) % 7));
    let fridayThisWeek = new Date(mondayThisWeek);
    fridayThisWeek.setDate(mondayThisWeek.getDate() + 4);

    // Check if the current week is "complete" (after Friday 5:00pm).
    const friday5pm = new Date(fridayThisWeek);
    friday5pm.setHours(17, 0, 0, 0);
    let lastCompletedMonday;
    if (now > friday5pm) {
      lastCompletedMonday = mondayThisWeek;
    } else {
      lastCompletedMonday = new Date(mondayThisWeek);
      lastCompletedMonday.setDate(mondayThisWeek.getDate() - 7);
    }

    // Generate weeks from lastCompletedMonday back to one year ago.
    const oneYearAgo = new Date(now);
    oneYearAgo.setFullYear(now.getFullYear() - 1);
    let currentMonday = new Date(lastCompletedMonday);
    while (currentMonday >= oneYearAgo) {
      const currentFriday = new Date(currentMonday);
      currentFriday.setDate(currentMonday.getDate() + 4);
      const optionsFormat = { month: 'short', day: 'numeric' };
      const mondayStr = currentMonday.toLocaleDateString('en-US', optionsFormat);
      const fridayStr = currentFriday.toLocaleDateString('en-US', optionsFormat);
      const year = currentMonday.getFullYear();
      const displayText = `${mondayStr} - ${fridayStr}, ${year}`;
      const value = currentMonday.toISOString().slice(0, 10);
      options.push({ value, text: displayText });
      currentMonday.setDate(currentMonday.getDate() - 7);
    }

    options.forEach(opt => {
      const optionEl = document.createElement("option");
      optionEl.value = opt.value;
      optionEl.textContent = opt.text;
      weekSelect.appendChild(optionEl);
    });
  }

  /* =======================================================
     CHART INITIALIZATION
  ========================================================== */

  function initCharts() {
    // Initialize jobsChart (Jobs To Be Marked Complete)
    const ctx = document.getElementById("jobsBarGraph").getContext("2d");
    jobsChart = new Chart(ctx, {
      type: "bar",
      data: {
        labels: [],
        datasets: [{
          label: "Jobs To Be Marked Complete",
          data: [],
          backgroundColor: "rgba(54, 162, 235, 0.6)",
          borderColor: "rgba(54, 162, 235, 1)",
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { grid: { color: '#eee' }, ticks: { font: { size: 12 } } },
          y: { grid: { color: '#eee' }, ticks: { font: { size: 12 } } }
        }
      }
    });

    // Initialize jobsProcessedChart (Jobs Processed by Type)
    const ctx2 = document.getElementById("jobsProcessedBarGraph").getContext("2d");
    jobsProcessedChart = new Chart(ctx2, {
      type: "bar",
      data: {
        labels: [],
        datasets: [{
          label: "Jobs Processed",
          data: [],
          backgroundColor: "rgba(54, 162, 235, 0.6)",
          borderColor: "rgba(54, 162, 235, 1)",
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { grid: { color: '#eee' }, ticks: { font: { size: 12 } } },
          y: { grid: { color: '#eee' }, ticks: { font: { size: 12 } } }
        }
      }
    });

    // Initialize jobsProcessedByProcessorChart (Horizontal bar chart)
    const ctx3 = document.getElementById("jobsProcessedByProcessorBarGraph").getContext("2d");
    jobsProcessedByProcessorChart = new Chart(ctx3, {
      type: "bar",
      data: {
        labels: [],
        datasets: [{
          label: "Jobs Processed",
          data: [],
          backgroundColor: "rgba(54, 162, 235, 0.6)",
          borderColor: "rgba(54, 162, 235, 1)",
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: {
          legend: { display: true, position: 'top' },
          datalabels: {
            anchor: 'end',
            align: 'right',
            color: '#000',
            font: { weight: 'bold' }
          }
        },
        scales: {
          x: { grid: { color: '#eee' }, ticks: { font: { size: 12 } } },
          y: { grid: { color: '#eee' }, ticks: { font: { size: 12 } } }
        }
      }
    });

    // Initialize jobHoursProcessedByTypeChart
    const ctx4 = document.getElementById("jobHoursProcessedBarGraph").getContext("2d");
    jobHoursProcessedByTypeChart = new Chart(ctx4, {
      type: "bar",
      data: {
        labels: [],
        datasets: [{
          label: "Hours Processed",
          data: [],
          backgroundColor: "rgba(54, 162, 235, 0.6)",
          borderColor: "rgba(54, 162, 235, 1)",
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: {
          legend: { display: true, position: 'top' },
          datalabels: {
            anchor: 'end',
            align: 'right',
            color: '#000',
            font: { weight: 'bold' }
          }
        },
        scales: {
          x: { grid: { color: '#eee' }, ticks: { font: { size: 12 } } },
          y: { grid: { color: '#eee' }, ticks: { font: { size: 12 } } }
        }
      }
    });

    // Initialize jobHoursProcessedByProcessorChart
    const ctx5 = document.getElementById("hoursProcessedByProcessorBarGraph").getContext("2d");
    jobHoursProcessedByProcessorChart = new Chart(ctx5, {
      type: "bar",
      data: {
        labels: [],
        datasets: [{
          label: "Job Hours Processed",
          data: [],
          backgroundColor: "rgba(54, 162, 235, 0.6)",
          borderColor: "rgba(54, 162, 235, 1)",
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: {
          legend: { display: true, position: 'top' },
          datalabels: {
            anchor: 'end',
            align: 'right',
            color: '#000',
            font: { weight: 'bold' }
          }
        },
        scales: {
          x: { grid: { color: '#eee' }, ticks: { font: { size: 12 } } },
          y: { grid: { color: '#eee' }, ticks: { font: { size: 12 } } }
        }
      }
    });
  }

  /* =======================================================
     DATA LOADING FUNCTIONS
  ========================================================== */

  // Load complete jobs data.
  function loadCompleteJobs(selectedMonday) {
    // Show loading indicators.
    document.getElementById("jobsToBeMarkedComplete").innerHTML = `
      <div class="spinner-border text-primary" role="status">
        <span class="visually-hidden">Loading...</span>
      </div>
      Fetching jobs to be marked complete...
    `;

    document.getElementById("oldestJobToBeMarkedCompleteAddress").textContent = "";
    document.getElementById("oldestJobToBeMarkedCompleteType").textContent = "";
    document.getElementById("oldestJobToBeMarkedCompleteDate").innerHTML = `
      <div class="spinner-border text-primary" role="status">
        <span class="visually-hidden">Loading...</span>
      </div>
      Fetching oldest job...
    `;

    document.getElementById("jobsToBeInvoiced").innerHTML = `
      <div class="spinner-border text-primary" role="status">
        <span class="visually-hidden">Loading...</span>
      </div>
      Fetching Jobs to be invoiced...
    `;

    document.getElementById("jobsProcessedMinusIncomingJobs").innerHTML = `
      <div class="spinner-border text-primary" role="status">
        <span class="visually-hidden">Loading...</span>
      </div>
      Fetching Processed Vs. Incoming jobs...
    `;
    document.getElementById("incomingJobs").innerHTML = "";
    document.getElementById("jobsProcessed").innerHTML = "";
    
    document.getElementById("timeInPinkFolder").innerHTML = "";
    document.getElementById("moneyInPinkFolder").innerHTML = "";
    document.getElementById("numberOfPinkFolderJobs").innerHTML = `
      <div class="spinner-border text-primary" role="status">
        <span class="visually-hidden">Loading...</span>
      </div>
      Fetching pink folder...
    `;

    fetch("/processing_attack/complete_jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selectedMonday })
    })
      .then(response => response.json())
      .then(data => {
        console.log("Complete jobs data:", data);
        document.getElementById("jobsToBeMarkedComplete").textContent = data.jobs_to_be_marked_complete;

        const oldestJobs = data.oldest_jobs_to_be_marked_complete;

        if (oldestJobs.length > 0) {
          const firstJob = oldestJobs[0];
          const oldestDate = new Date(firstJob.oldest_job_date);

          document.getElementById("oldestJobToBeMarkedCompleteDate").textContent =
            oldestDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
          document.getElementById("oldestJobToBeMarkedCompleteAddress").textContent = firstJob.oldest_job_address;
          document.getElementById("oldestJobToBeMarkedCompleteType").textContent = firstJob.oldest_job_type;

          const oldestJobsList = document.getElementById("oldestJobsListModal");
          oldestJobsList.innerHTML = "";

          for (const job of oldestJobs) {
            const jobDate = new Date(job.oldest_job_date).toLocaleDateString("en-US", {
              year: "numeric", month: "short", day: "numeric"
            });

            const jobItem = document.createElement("div");
            jobItem.className = "list-group-item mb-2";

            jobItem.innerHTML = `
              <div class="d-flex justify-content-between align-items-center">
                <div>
                  <h6 class="mb-1">${job.oldest_job_address}</h6>
                  <small>${jobDate} — ${job.oldest_job_type}</small>
                </div>
                <a href="https://app.servicetrade.com/jobs/${job.job_id}" 
                  class="btn btn-sm" 
                  style="background-color: #0C62A6; color: white;" 
                  target="_blank">View Job</a>
              </div>
            `;

            oldestJobsList.appendChild(jobItem);
          }
        }



        const jobsDelta = data.incoming_jobs_today - data.jobs_processed_today;

        document.getElementById("jobsProcessedMinusIncomingJobs").textContent = `Δ Jobs: ${jobsDelta}`;
        document.getElementById("incomingJobs").textContent = `Incoming jobs: ${data.incoming_jobs_today}`;
        document.getElementById("jobsProcessed").textContent = `Jobs processed: ${data.jobs_processed_today}`;
        document.getElementById("jobsToBeInvoiced").textContent = `Jobs to be invoiced: ${data.jobs_to_be_invoiced}`;

        document.getElementById("numberOfPinkFolderJobs").textContent = data.number_of_pink_folder_jobs + " jobs";
        document.getElementById("timeInPinkFolder").textContent = `${data.time_in_pink_folder} tech hours  |`;
        const revenue = data.time_in_pink_folder * 110;
        document.getElementById("moneyInPinkFolder").textContent = 
        `${new Intl.NumberFormat("en-US", { 
            style: "currency", 
            currency: "CAD", 
            minimumFractionDigits: 0, 
            maximumFractionDigits: 0 
        }).format(revenue)}`;
        // Update jobsChart with job type counts.
        if (data.job_type_count) {
          const labels = Object.keys(data.job_type_count);
          const counts = Object.values(data.job_type_count);
          jobsChart.data.labels = labels;
          jobsChart.data.datasets[0].data = counts;
          jobsChart.data.datasets[0].backgroundColor = "rgba(12, 98, 166, 0.7)";
          jobsChart.data.datasets[0].borderColor = "rgba(12, 98, 166, 1)";
          jobsChart.data.datasets[0].borderWidth = 2;
          jobsChart.data.datasets[0].borderRadius = 8;
          jobsChart.update();
        }

        // Load pink folder data from backend
        if (data.pink_folder_detailed_info) {
          pinkfolderDetailedData.length = 0;
        
          for (const [techName, jobs] of Object.entries(data.pink_folder_detailed_info)) {
            pinkfolderDetailedData.push({
              technicianName: techName,
              pinkFolderJobCount: jobs.length,
              jobs: jobs.map(job => ({
                address: job.job_address,
                url: job.job_url
              }))
            });
          }
        }


        // Update KPIs.
        updateKPIs(data);
        
        isOldestJobsDataLoaded = true;
        const oldestJobsCard = document.getElementById("oldestJobsCard");
        oldestJobsCard.classList.remove("disabled");
        oldestJobsCard.classList.add("clickable");

        isPinkFolderDataLoaded = true;
        const pinkFolderCard = document.getElementById("numberOfPinkFolderJobsCard");
        pinkFolderCard.classList.remove("disabled");
        pinkFolderCard.classList.add("clickable");
      })
      .catch(error => console.error("Error loading complete jobs:", error));
  }

  // Load processed data (jobs processed and tech hours processed).
  function loadProcessedData(selectedMonday) {
    // Set loading indicators.
    document.getElementById("totalJobsProcessed").innerHTML = `
      <div class="spinner-border text-primary" role="status">
        <span class="visually-hidden">Loading...</span>
      </div>
      Fetching jobs processed...
    `;
    document.getElementById("totalTechHoursProcessed").innerHTML = `
      <div class="spinner-border text-primary" role="status">
        <span class="visually-hidden">Loading...</span>
      </div>
      Fetching tech hours processed...
    `;
    document.getElementById("jobsProcessedTrend").textContent = "";
    document.getElementById("techHoursTrend").textContent = "";

    // Clear previous chart data.
    if (jobsProcessedChart) {
      jobsProcessedChart.data.labels = [];
      jobsProcessedChart.data.datasets.forEach(dataset => dataset.data = []);
      jobsProcessedChart.update();
    }
    if (jobHoursProcessedByTypeChart) {
      jobHoursProcessedByTypeChart.data.labels = [];
      jobHoursProcessedByTypeChart.data.datasets.forEach(dataset => dataset.data = []);
      jobHoursProcessedByTypeChart.update();
    }

    fetch("/processing_attack/processed_data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selectedMonday })
    })
      .then(response => response.json())
      .then(data => {
        console.log("Processed data:", data);
        // Update KPI numbers.
        const thisWeekJobs = data.total_jobs_processed;
        const lastWeekJobs = data.total_jobs_processed_previous_week;
        const thisWeekHours = data.total_tech_hours_processed;
        const lastWeekHours = data.total_tech_hours_processed_previous_week;

        document.getElementById("totalJobsProcessed").textContent = thisWeekJobs;
        document.getElementById("totalTechHoursProcessed").textContent = thisWeekHours;

        // Update trends.
        const jobsTrend = document.getElementById("jobsProcessedTrend");
        const jobChange = thisWeekJobs - lastWeekJobs;
        const jobPercent = ((jobChange / lastWeekJobs) * 100).toFixed(1);
        if (jobChange > 0) {
          jobsTrend.textContent = `↑ ${jobPercent}% from previous week`;
          jobsTrend.className = "summary-trend up";
        } else if (jobChange < 0) {
          jobsTrend.textContent = `↓ ${Math.abs(jobPercent)}% from previous week`;
          jobsTrend.className = "summary-trend down";
        } else {
          jobsTrend.textContent = `No change from previous week`;
          jobsTrend.className = "summary-trend";
        }

        const techTrend = document.getElementById("techHoursTrend");
        const change = thisWeekHours - lastWeekHours;
        const percentChange = ((change / lastWeekHours) * 100).toFixed(1);
        if (change > 0) {
          techTrend.textContent = `↑ ${percentChange}% from previous week`;
          techTrend.className = "summary-trend up";
        } else if (change < 0) {
          techTrend.textContent = `↓ ${Math.abs(percentChange)}% from previous week`;
          techTrend.className = "summary-trend down";
        } else {
          techTrend.textContent = `No change from previous week`;
          techTrend.className = "summary-trend";
        }

        // Update jobsProcessedChart (jobs by type).
        if (data.jobs_by_type) {
          const labels = Object.keys(data.jobs_by_type);
          const counts = Object.values(data.jobs_by_type);
          jobsProcessedChart.data.labels = labels.map(properFormat);
          jobsProcessedChart.data.datasets[0].data = counts;
          jobsProcessedChart.data.datasets[0].backgroundColor = "rgba(12, 98, 166, 0.7)";
          jobsProcessedChart.data.datasets[0].borderColor = "rgba(12, 98, 166, 1)";
          jobsProcessedChart.data.datasets[0].borderWidth = 2;
          jobsProcessedChart.data.datasets[0].borderRadius = 8;
          jobsProcessedChart.update();
        }

        // Update jobHoursProcessedByTypeChart (hours by type).
        if (data.hours_by_type) {
          const labels = Object.keys(data.hours_by_type);
          const counts = Object.values(data.hours_by_type);
          jobHoursProcessedByTypeChart.data.labels = labels.map(properFormat);
          jobHoursProcessedByTypeChart.data.datasets[0].data = counts;
          jobHoursProcessedByTypeChart.data.datasets[0].backgroundColor = "rgba(12, 98, 166, 0.7)";
          jobHoursProcessedByTypeChart.data.datasets[0].borderColor = "rgba(12, 98, 166, 1)";
          jobHoursProcessedByTypeChart.data.datasets[0].borderWidth = 2;
          jobHoursProcessedByTypeChart.data.datasets[0].borderRadius = 8;
          jobHoursProcessedByTypeChart.update();
        }
      })
      .catch(error => console.error("Error loading processed data:", error));
  }

  // Load processed data by processor (jobs and tech hours by processor).
  function loadProcessedDataByProcessor(selectedMonday) {
    // Show loading indicators.
    const loadingJobsEl = document.getElementById("jobsProcessedByProcessorLoading");
    loadingJobsEl.style.display = "block";
    const loadingHoursEl = document.getElementById("hoursProcessedByProcessorLoading");
    loadingHoursEl.style.display = "block";

    // Clear previous chart data.
    if (jobsProcessedByProcessorChart) {
      jobsProcessedByProcessorChart.data.labels = [];
      jobsProcessedByProcessorChart.data.datasets.forEach(dataset => dataset.data = []);
      jobsProcessedByProcessorChart.update();
    }
    if (jobHoursProcessedByProcessorChart) {
      jobHoursProcessedByProcessorChart.data.labels = [];
      jobHoursProcessedByProcessorChart.data.datasets.forEach(dataset => dataset.data = []);
      jobHoursProcessedByProcessorChart.update();
    }

    fetch("/processing_attack/processed_data_by_processor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selectedMonday })
    })
      .then(response => response.json())
      .then(data => {
        console.log("Processed data:", data);
        // Update jobsProcessedByProcessorChart.
        if (data.jobs_processed_by_processor) {
          loadingJobsEl.style.display = "none";
          const currentWeek = data.jobs_processed_by_processor;
          const previousWeek = data.jobs_processed_by_processor_previous_week || {};
          const labels = Object.keys(currentWeek);
          const counts = Object.values(currentWeek);


          const previousCounts = labels.map(label => previousWeek[label] || 0);
          jobsProcessedByProcessorChart.data.labels = labels.map(properFormat);
          jobsProcessedByProcessorChart.data.datasets = [
            {
              label: "Selected Week",
              data: counts,
              backgroundColor: "rgba(12, 98, 166, 0.7)",
              borderColor: "rgba(12, 98, 166, 1)",
              borderWidth: 2,
              borderRadius: 8
            },
            {
              label: "Previous Week",
              data: previousCounts,
              backgroundColor: "rgba(230, 230, 230, 0.8)",
              borderColor: "rgba(180, 180, 180, 1)",
              borderWidth: 1,
              borderRadius: 8
            }
          ];
          jobsProcessedByProcessorChart.update();
        }
        // Update jobHoursProcessedByProcessorChart.
        if (data.hours_processed_by_processor) {
          loadingHoursEl.style.display = "none";
          const currentWeek = data.hours_processed_by_processor;
          const previousWeek = data.hours_processed_by_processor_previous_week || {};
          const labels = Object.keys(currentWeek);
          const counts = Object.values(currentWeek);
          const previousCounts = labels.map(label => previousWeek[label] || 0);
          jobHoursProcessedByProcessorChart.data.labels = labels.map(properFormat);
          jobHoursProcessedByProcessorChart.data.datasets = [
            {
              label: "Selected Week",
              data: counts,
              backgroundColor: "rgba(12, 98, 166, 0.7)",
              borderColor: "rgba(12, 98, 166, 1)",
              borderWidth: 2,
              borderRadius: 8
            },
            {
              label: "Previous Week",
              data: previousCounts,
              backgroundColor: "rgba(230, 230, 230, 0.8)",
              borderColor: "rgba(180, 180, 180, 1)",
              borderWidth: 1,
              borderRadius: 8
            }
          ];
          jobHoursProcessedByProcessorChart.update();
        }
      })
      .catch(error => console.error("Error loading processed data by processor:", error));
  }

  /* =======================================================
     UI UPDATE & EVENT LISTENERS
  ========================================================== */

  // Update KPI card styles based on thresholds.
  function updateKPIs(data) {
    // Jobs to be marked complete.
    const jobsElem = document.getElementById("jobsToBeMarkedCompleteCard");
    const jobsElemText = document.getElementById("jobsToBeMarkedComplete");
    if (parseInt(data.jobs_to_be_marked_complete) < 50) {
      jobsElemText.style.color = "#27a532";
      jobsElem.style.backgroundImage = "linear-gradient(to top,rgb(250, 246, 246),rgb(229, 248, 225))";
      jobsElem.style.borderTop = "5px solid #27a532";
    } else {
      jobsElemText.style.color = "#b92525";
      jobsElem.style.backgroundImage = "linear-gradient(to top,rgb(250, 246, 246),rgb(248, 225, 227))";
      jobsElem.style.borderTop = "5px solid #b92525";
    }
    jobsElem.style.padding = "10px";
    jobsElem.style.borderRadius = "8px";
    jobsElem.style.boxShadow = "2px 4px 10px rgba(0, 0, 0, 0.1)";
    jobsElem.style.textAlign = "center";
    jobsElemText.style.fontWeight = "bold";

    // Pink Folder jobs.
    const pinkElem = document.getElementById("numberOfPinkFolderJobs");
    const pinkElemCard = document.getElementById("numberOfPinkFolderJobsCard");
    const timeInPinkFolderElem = document.getElementById("timeInPinkFolder");
    const moneyInPinkFolderElem = document.getElementById("moneyInPinkFolder");
    if (parseInt(data.number_of_pink_folder_jobs) < 11) {
      pinkElem.style.color = "#27a532";
      timeInPinkFolderElem.style.color = "#27a532";
      moneyInPinkFolderElem.style.color = "#27a532";
      pinkElemCard.style.backgroundImage = "linear-gradient(to top,rgb(250, 246, 246),rgb(229, 248, 225))";
      pinkElemCard.style.borderTop = "5px solid #27a532";
    } else {
      pinkElem.style.color = "#b92525";
      timeInPinkFolderElem.style.color = "#b92525";
      moneyInPinkFolderElem.style.color = "#b92525";
      pinkElemCard.style.backgroundImage = "linear-gradient(to top,rgb(250, 246, 246),rgb(248, 225, 227))";
      pinkElemCard.style.borderTop = "5px solid #b92525";
    }
    pinkElemCard.style.padding = "10px";
    pinkElemCard.style.borderRadius = "8px";
    pinkElemCard.style.boxShadow = "2px 4px 10px rgba(0, 0, 0, 0.1)";
    pinkElemCard.style.textAlign = "center";

    // Oldest Job to be marked complete.
    const oldestElem = document.getElementById("oldestJobToBeMarkedCompleteDate");
    const oldestElem1 = document.getElementById("oldestJobToBeMarkedCompleteAddress");
    const oldestElem2 = document.getElementById("oldestJobToBeMarkedCompleteType");
    const oldestElemCard = document.getElementById("oldestJobsCard");
    const oldestJobs = data.oldest_jobs_to_be_marked_complete;
    const firstJobId = Object.keys(oldestJobs)[0]
    console.log("Raw date string:", oldestJobs[firstJobId].oldest_job_date);
    const oldestDate = new Date(oldestJobs[firstJobId].oldest_job_date);
    const currentDate = new Date();
    const diffDays = (currentDate - oldestDate) / (1000 * 60 * 60 * 24);

    if (diffDays <= 42) {
      oldestElem.style.color = "#27a532";
      oldestElem1.style.color = "#27a532";
      oldestElem2.style.color = "#27a532";
      oldestElemCard.style.backgroundImage = "linear-gradient(to top,rgb(250, 246, 246),rgb(229, 248, 225))";
      oldestElemCard.style.borderTop = "5px solid #27a532";
    } else {
      oldestElem.style.color = "#b92525";
      oldestElem1.style.color = "#b92525";
      oldestElem2.style.color = "#b92525";
      oldestElemCard.style.backgroundImage = "linear-gradient(to top,rgb(250, 246, 246),rgb(248, 225, 227))";
      oldestElemCard.style.borderTop = "5px solid #b92525";
    }

    oldestElemCard.style.padding = "10px";
    oldestElemCard.style.borderRadius = "8px";
    oldestElemCard.style.boxShadow = "2px 4px 10px rgba(0, 0, 0, 0.1)";
    oldestElemCard.style.textAlign = "center";

    // Jobs to be Invoiced
    const jobsToBeInvoicedText = document.getElementById("jobsToBeInvoiced");
    const jobsToBeInvoicedCard = document.getElementById("jobsToBeInvoicedCard");
    if (parseInt(data.jobs_to_be_invoiced) < 50) {
      jobsToBeInvoicedText.style.color = "#27a532";
      jobsToBeInvoicedCard.style.backgroundImage = "linear-gradient(to top,rgb(250, 246, 246),rgb(229, 248, 225))";
      jobsToBeInvoicedCard.style.borderTop = "5px solid #27a532";
    } else {
      jobsToBeInvoicedText.style.color = "#b92525";
      jobsToBeInvoicedCard.style.backgroundImage = "linear-gradient(to top,rgb(250, 246, 246),rgb(248, 225, 227))";
      jobsToBeInvoicedCard.style.borderTop = "5px solid #b92525";
    }

    // Change in jobs to be processed (today)
    const jobsToBeProcessedText = document.getElementById("jobsProcessedMinusIncomingJobs");
    const jobsToBeProcessedCard = document.getElementById("jobsProcessedMinusIncomingJobsCard");
    const incomingJobsText = document.getElementById("incomingJobs")
    const jobsProcessedText = document.getElementById("jobsProcessed")
    const change_in_jobs = data.jobs_processed_today - data.incoming_jobs_today 
    if (change_in_jobs >= 0) {
      jobsToBeProcessedText.style.color = "#27a532";
      jobsToBeProcessedCard.style.backgroundImage = "linear-gradient(to top,rgb(250, 246, 246),rgb(229, 248, 225))";
      jobsToBeProcessedCard.style.borderTop = "5px solid #27a532";
    } else {
      jobsToBeProcessedText.style.color = "#b92525";
      jobsToBeProcessedCard.style.backgroundImage = "linear-gradient(to top,rgb(250, 246, 246),rgb(248, 225, 227))";
      jobsToBeProcessedCard.style.borderTop = "5px solid #b92525";
    }
    jobsToBeProcessedCard.style.padding = "10px";
    jobsToBeProcessedCard.style.borderRadius = "8px";
    jobsToBeProcessedCard.style.boxShadow = "2px 4px 10px rgba(0, 0, 0, 0.1)";
    jobsToBeProcessedCard.style.textAlign = "center";
    
    if (data.jobs_processed_today > 0){
      jobsProcessedText.style.color = "#27a532";
    }
    else{
      jobsProcessedText.style.color = "#b92525";
    }
    incomingJobsText.style.color = "#b92525";

  }

  // Update the week display (e.g., "Week of March 24 - 28").
  function updateWeekDisplay(selectedMondayStr) {
    const display = document.getElementById("selected-week-display");
    const [year, month, day] = selectedMondayStr.split("-").map(Number);
    const selectedMondayDate = new Date(year, month - 1, day);
    const selectedFridayDate = new Date(selectedMondayDate);
    selectedFridayDate.setDate(selectedFridayDate.getDate() + 4);
    const optionsMonthDay = { month: "long", day: "numeric" };
    const optionsDayOnly = { day: "numeric" };
    const mondayStr = selectedMondayDate.toLocaleDateString("en-US", optionsMonthDay);
    const fridayStr = selectedFridayDate.toLocaleDateString("en-US", optionsDayOnly);
    display.textContent = `Week of ${mondayStr} - ${fridayStr}`;
  }

  



  /* =======================================================
     EVENT LISTENERS & INITIALIZATION
  ========================================================== */
  /****************************************
   * 2) Function to render Pink Folder data
   ****************************************/
  function renderPinkFolderData() {
    const techniciansList = document.getElementById("pinkFolderTechniciansListModal");
    techniciansList.innerHTML = "";
  
    pinkfolderDetailedData.forEach((tech, index) => {
      const techId = `tech-${index}`;
      const wrapper = document.createElement("div");
      wrapper.classList.add("mb-2", "border", "rounded", "p-2");
  
      wrapper.innerHTML = `
        <div class="d-flex justify-content-between align-items-center">
          <button class="btn btn-link text-start w-100 d-flex justify-content-between align-items-center tech-toggle"
                  type="button"
                  aria-expanded="false"
                  aria-controls="collapse-${techId}"
                  id="button-${techId}">
            <span><strong>${tech.technicianName}</strong></span>
            <span class="d-flex align-items-center gap-2">
              <span class="text-muted">(${tech.pinkFolderJobCount} jobs)</span>
              <i class="chevron-icon bi bi-chevron-right transition-rotate"></i>
            </span>
          </button>
        </div>
        <div id="collapse-${techId}" class="collapse-custom mt-2">
          <ul class="list-unstyled mb-0 ps-3">
            ${tech.jobs.map(job => `
              <li class="mb-1">
                <a href="${job.url}" target="_blank" class="link-primary text-decoration-none">${job.address}</a>
              </li>
            `).join("")}
          </ul>
        </div>
      `;
  
      techniciansList.appendChild(wrapper);
  
      const toggleBtn = wrapper.querySelector(`#button-${techId}`);
      const collapseEl = wrapper.querySelector(`#collapse-${techId}`);
  
      toggleBtn.addEventListener("click", () => {
        collapseEl.classList.toggle("show");
        const isExpanded = collapseEl.classList.contains("show");
        toggleBtn.setAttribute("aria-expanded", isExpanded);
      });
    });
  }

  document.getElementById("expandAllBtn").addEventListener("click", () => {
    document.querySelectorAll(".collapse-custom").forEach(collapseEl => {
      collapseEl.classList.add("show");
      const btn = collapseEl.previousElementSibling.querySelector(".tech-toggle");
      if (btn) btn.setAttribute("aria-expanded", "true");
    });
  });
  
  document.getElementById("collapseAllBtn").addEventListener("click", () => {
    document.querySelectorAll(".collapse-custom").forEach(collapseEl => {
      collapseEl.classList.remove("show");
      const btn = collapseEl.previousElementSibling.querySelector(".tech-toggle");
      if (btn) btn.setAttribute("aria-expanded", "false");
    });
  });
  
  
  
  
  
  
  
  

  /****************************************
 * 3) Event listener to expand/hide Pink Folder Jobs
 ****************************************/
  function setupPinkFolderCardToggle() {
    const pinkFolderCard = document.getElementById("numberOfPinkFolderJobsCard");
  
    // Start in loading state
    pinkFolderCard.classList.add("disabled");
    pinkFolderCard.classList.remove("clickable");
  
    pinkFolderCard.addEventListener("click", () => {
      if (!isPinkFolderDataLoaded) {
        console.warn("Pink Folder data not yet loaded.");
        return;
      }
  
      renderPinkFolderData();
      const pinkModal = new bootstrap.Modal(document.getElementById("pinkFolderModal"));
      pinkModal.show();
    });
  }
  
  
  function setupOldestJobsCardToggle() {
    const oldestJobsCard = document.getElementById("oldestJobsCard");
  
    // Start in loading state
    oldestJobsCard.classList.add("disabled");
    oldestJobsCard.classList.remove("clickable");
  
    oldestJobsCard.addEventListener("click", () => {
      if (!isOldestJobsDataLoaded) {
        console.warn("Oldest Jobs data not yet loaded.");
        return;
      }
  
      // If you want to re-render before each show, call a function like renderOldestJobsData()
      const oldestJobsModal = new bootstrap.Modal(document.getElementById("oldestJobsModal"));
      oldestJobsModal.show();
    });
  }
  


  

  function initEventListeners() {
    // Submit week button.
    const weekSelect = document.getElementById("week-select");
    document.getElementById("submitWeekBtn").addEventListener("click", function () {
      const selectedMonday = weekSelect.value;
      console.log("Selected Monday:", selectedMonday);
      loadProcessedData(selectedMonday);
      loadProcessedDataByProcessor(selectedMonday);
      updateWeekDisplay(selectedMonday);
    });

  }

  // Main initialization function.
  function init() {
    generateWorkWeekOptions();
    initEventListeners();
    initCharts();
    setupPinkFolderCardToggle();
    setupOldestJobsCardToggle();
    const weekSelect = document.getElementById("week-select");
    if (weekSelect.value) {
      const selectedMonday = weekSelect.value;
      loadCompleteJobs(selectedMonday);
      loadProcessedData(selectedMonday);
      loadProcessedDataByProcessor(selectedMonday);
      updateWeekDisplay(selectedMonday);
    }
  }

  // Expose public API.
  return {
    init,
    interpolateColor,
    properFormat
  };
})();



// Initialize the module on DOMContentLoaded.
document.addEventListener("DOMContentLoaded", () => {
  ProcessingAttack.init();
});
