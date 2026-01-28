// processing_attack.js

Chart.defaults.datasets.bar.categoryPercentage = 0.7;
Chart.defaults.datasets.bar.barPercentage = 0.8;
let isPinkFolderDataLoaded = false;
let isOldestJobsDataLoaded = false;
let overallWeeklyTrendChart;
let overallRecordIndexes = {
  jobs: null,
  hours: null
};

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

  function titleCaseFromSnake(str) {
    return (str || "")
      .split("_")
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
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
      const value = `${currentMonday.getFullYear()}-${
        String(currentMonday.getMonth() + 1).padStart(2, '0')
      }-${
        String(currentMonday.getDate()).padStart(2, '0')
      }`;
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
  function initOverallWeeklyTrendChart() {
    const ctx = document
      .getElementById("overallWeeklyTrendChart")
      .getContext("2d");

    overallWeeklyTrendChart = new Chart(ctx, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          {
            label: "Jobs Processed",
            data: [],
            tension: 0.3,
            borderWidth: 3,
            pointRadius: ctx => (
              ctx.dataIndex === overallRecordIndexes.jobs ? 7 : 3
            ),
            pointBackgroundColor: ctx => (
              ctx.dataIndex === overallRecordIndexes.jobs ? "#d63384" : undefined
            )
          },
          {
            label: "Tech Hours Processed",
            data: [],
            tension: 0.3,
            borderWidth: 3,
            pointRadius: ctx => (
              ctx.dataIndex === overallRecordIndexes.hours ? 7 : 3
            ),
            pointBackgroundColor: ctx => (
              ctx.dataIndex === overallRecordIndexes.hours ? "#fd7e14" : undefined
            ),
            yAxisID: "yHours"
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: "index",
          intersect: false
        },
        scales: {
          y: {
            beginAtZero: true,
            suggestedMax: 1.2, // will be scaled dynamically
            title: { display: true, text: "Jobs" }
          },
          yHours: {
            beginAtZero: true,
            suggestedMax: 1.2,
            position: "right",
            grid: { drawOnChartArea: false },
            title: { display: true, text: "Hours" }
          }
        }
      }
    });
  }


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

  async function LoadJobsToday() {
    document.getElementById("jobsProcessed").innerHTML = `
      <div class="spinner-border text-primary" role="status">
        <span class="visually-hidden">Loading...</span>
      </div>
    `;
    document.getElementById("incomingJobs").innerHTML = "";
    const url = `/processing_attack/jobs_today`;

    try {
      const r = await fetch(url, { headers: { "Accept": "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      document.getElementById("incomingJobs").textContent = `New: ${data.incoming_jobs_today}`;
      document.getElementById("jobsProcessed").textContent = `Processed: ${data.jobs_processed_today}`;

      // Jobs to be processed
      const jobsToBeProcessedCard = document.getElementById("jobsProcessedMinusIncomingJobsCard");
      const incomingJobsText = document.getElementById("incomingJobs");
      const jobsProcessedText = document.getElementById("jobsProcessed");

      const processed = Number(data.jobs_processed_today || 0);
      const incoming = Number(data.incoming_jobs_today || 0);

      // optional: keep a subtle base behind the split (looks nicer)
      jobsToBeProcessedCard.style.backgroundColor = "rgb(250, 246, 246)";
      jobsToBeProcessedCard.style.backgroundBlendMode = "multiply";


      // text colors
      jobsProcessedText.style.color = processed > 0 ? "#27a532" : "#b92525";
      incomingJobsText.style.color = "#b92525";

      // optional: borderTop based on net change like you had
      const change_in_jobs = processed - incoming;
      if (change_in_jobs >= 0){
        jobsToBeProcessedCard.style.borderTop = "5px solid #27a532";
        jobsToBeProcessedCard.style.backgroundColor = "rgb(248, 255, 249)";
        jobsToBeProcessedCard.style.backgroundBlendMode = "multiply";
      } else {
        jobsToBeProcessedCard.style.borderTop = "5px solid #b92525";
        jobsToBeProcessedCard.style.backgroundColor = "rgb(250, 243, 243)";
        jobsToBeProcessedCard.style.backgroundBlendMode = "multiply";
      }

    } catch (err) {
      console.error("Error loading jobs to be invoiced:", error)
    }
  }


  async function loadPinkFolderData() {
    document.getElementById("timeInPinkFolder").innerHTML = "";
    document.getElementById("numberOfPinkFolderJobs").innerHTML = `
      <div class="spinner-border text-primary" role="status">
        <span class="visually-hidden">Loading...</span>
      </div>
    `;
    const url = `/processing_attack/pink_folder_data`;

    try {
      const r = await fetch(url, { headers: { "Accept": "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      document.getElementById("numberOfPinkFolderJobs").textContent = data.number_of_pink_folder_jobs + " jobs";
      document.getElementById("timeInPinkFolder").textContent = `${data.time_in_pink_folder} tech hours`;

      isPinkFolderDataLoaded = true;
      const pinkFolderCard = document.getElementById("numberOfPinkFolderJobsCard");
      pinkFolderCard.classList.remove("disabled");
      pinkFolderCard.classList.add("clickable");

      // Pink Folder jobs.
      const pinkElem = document.getElementById("numberOfPinkFolderJobs");
      const pinkElemCard = document.getElementById("numberOfPinkFolderJobsCard");
      const timeInPinkFolderElem = document.getElementById("timeInPinkFolder");
      if (parseInt(data.number_of_pink_folder_jobs) < 11) {
        pinkElem.style.color = "#27a532";
        timeInPinkFolderElem.style.color = "#27a532";
        pinkElemCard.style.backgroundImage = "linear-gradient(to top,rgb(250, 246, 246),rgb(229, 248, 225))";
        pinkElemCard.style.borderTop = "5px solid #27a532";
      } else {
        pinkElem.style.color = "#b92525";
        timeInPinkFolderElem.style.color = "#b92525";
        pinkElemCard.style.backgroundImage = "linear-gradient(to top,rgb(250, 246, 246),rgb(248, 225, 227))";
        pinkElemCard.style.borderTop = "5px solid #b92525";
      }
      pinkElemCard.style.padding = "10px";
      pinkElemCard.style.borderRadius = "8px";
      pinkElemCard.style.boxShadow = "2px 4px 10px rgba(0, 0, 0, 0.1)";
      pinkElemCard.style.textAlign = "center";

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

    } catch (err) {
      console.error("Error loading pink folder: ", error)
    }
  }

  async function loadJobsToBeInvoiced() {
    document.getElementById("jobsToBeInvoiced").innerHTML = `
      <div class="spinner-border text-primary" role="status">
        <span class="visually-hidden">Loading...</span>
      </div>
    `;
    const url = `/processing_attack/jobs_to_be_invoiced`;

    try {
      const r = await fetch(url, { headers: { "Accept": "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      document.getElementById("jobsToBeInvoiced").textContent = `Jobs to be invoiced: ${data.jobs_to_be_invoiced}`;
      // Jobs to be Invoiced
      const jobsToBeInvoicedText = document.getElementById("jobsToBeInvoiced");
      const jobsToBeInvoicedCard = document.getElementById("jobsToBeInvoicedCard");
      if (parseInt(data.jobs_to_be_invoiced) <= 30) {
        jobsToBeInvoicedText.style.color = "#27a532";
        jobsToBeInvoicedCard.style.backgroundImage = "linear-gradient(to top,rgb(250, 246, 246),rgb(229, 248, 225))";
        jobsToBeInvoicedCard.style.borderTop = "5px solid rgb(39, 165, 50)";
      } else {
        jobsToBeInvoicedText.style.color = "rgb(185, 37, 37)";
        jobsToBeInvoicedCard.style.backgroundImage = "linear-gradient(to top,rgb(250, 246, 246),rgb(248, 225, 227))";
        jobsToBeInvoicedCard.style.borderTop = "5px solid #b92525";
      }

    } catch (err) {
      console.error("Error loading jobs to be invoiced:", error)
    }
  }

  async function loadJobsToBeMarkedComplete() {
    document.getElementById("jobsToBeMarkedComplete").innerHTML = `
      <div class="spinner-border text-primary" role="status">
        <span class="visually-hidden">Loading...</span>
      </div>
    `;
    const url = `/processing_attack/num_jobs_to_be_marked_complete`;

    try {
      const r = await fetch(url, { headers: { "Accept": "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      document.getElementById("jobsToBeMarkedComplete").textContent = data.jobs_to_be_marked_complete;

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

    } catch (err) {
      console.error("Error loading completed jobs:", error)
    }
  }

  // Load complete jobs data.
  function loadCompleteJobs(selectedMonday) {
    document.getElementById("numberOfJobsWithReportConversionTag").innerHTML = `
      <div class="spinner-border text-primary" role="status">
        <span class="visually-hidden">Loading...</span>
      </div>
    `;

    document.getElementById("earliestJobToBeConvertedAddress").innerHTML = `
      <div class="spinner-border text-primary" role="status">
        <span class="visually-hidden">Loading...</span>
      </div>
    `;
    document.getElementById("earliestJobToBeConvertedDate").textContent = "";

    document.getElementById("oldestJobToBeMarkedCompleteAddress").textContent = "";
    document.getElementById("oldestJobToBeMarkedCompleteDate").innerHTML = `
      <div class="spinner-border text-primary" role="status">
        <span class="visually-hidden">Loading...</span>
      </div>
    `;

    fetch("/processing_attack/complete_jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selectedMonday })
    })
      .then(response => response.json())
      .then(data => {
        


        // Jobs requiring report conversion
        document.getElementById("numberOfJobsWithReportConversionTag").textContent = data.jobs_to_be_converted.length;
        const oldestJobsList = document.getElementById("scheduledJobsRequiringReportConversionListModal");
          oldestJobsList.innerHTML = "";
        if (data.jobs_to_be_converted.length > 0){
          const earliest_job_to_be_converted = data.jobs_to_be_converted[0];
          for (const job of data.jobs_to_be_converted) {
            const jobDate = new Date(job.scheduledDate * 1000)
              .toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

            const jobItem = document.createElement("div");
            jobItem.className = "list-group-item mb-2";

            jobItem.innerHTML = `
              <div class="d-flex justify-content-between align-items-center">
                <div>
                  <h6 class="mb-1">${job.location.address.street}</h6>
                  <small>${jobDate}</small>
                </div>
                <a href="https://app.servicetrade.com/jobs/${job.id}" 
                  class="btn btn-sm" 
                  style="background-color: #0C62A6; color: white;" 
                  target="_blank">View Job</a>
              </div>
            `;

            oldestJobsList.appendChild(jobItem);
          }
          
          document.getElementById("earliestJobToBeConvertedAddress").textContent = earliest_job_to_be_converted.location.address.street;
          document.getElementById("earliestJobToBeConvertedDate").textContent =
            new Date(earliest_job_to_be_converted.scheduledDate * 1000)
                .toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
        } else {
          document.getElementById("earliestJobToBeConvertedAddress").textContent = "No Jobs to Convert";
        }
        
        

        const oldestJobs = data.oldest_jobs_to_be_marked_complete;

        if (oldestJobs.length > 0) {
          const firstJob = oldestJobs[0];
          const oldestDate = new Date(firstJob.oldest_job_date);

          const jobDate = new Date(oldestDate);
          const now = new Date();

          // difference in weeks (rounded down)
          const msPerWeek = 1000 * 60 * 60 * 24 * 7;
          const weeksOld = Math.floor((now - jobDate) / msPerWeek);

          const ageLabel =
            weeksOld === 0 ? "Less than 1 week old" :
            weeksOld === 1 ? "1 week old" :
            `${weeksOld} weeks old`;

          document.getElementById("oldestJobToBeMarkedCompleteDate").textContent = ageLabel;
          document.getElementById("oldestJobToBeMarkedCompleteAddress").textContent = firstJob.oldest_job_address;

          const oldestJobsList = document.getElementById("oldestJobsListModal");
          oldestJobsList.innerHTML = "";

          for (const job of oldestJobs) {
            const jobDate = new Date(job.oldest_job_date);
            const now = new Date();

            // difference in weeks (rounded down)
            const msPerWeek = 1000 * 60 * 60 * 24 * 7;
            const weeksOld = Math.floor((now - jobDate) / msPerWeek);

            const ageLabel =
              weeksOld === 0 ? "Less than 1 week old" :
              weeksOld === 1 ? "1 week old" :
              `${weeksOld} weeks old`;

            const jobItem = document.createElement("div");
            jobItem.className = "list-group-item mb-2";

            jobItem.innerHTML = `
              <div class="d-flex justify-content-between align-items-center">
                <div>
                  <h6 class="mb-1">${job.oldest_job_address}</h6>
                  <small>${ageLabel} — ${titleCaseFromSnake(job.oldest_job_type)}</small>
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

        


        // Update KPIs.
        updateKPIs(data);
        
        isOldestJobsDataLoaded = true;
        const oldestJobsCard = document.getElementById("oldestJobsCard");
        oldestJobsCard.classList.remove("disabled");
        oldestJobsCard.classList.add("clickable");

        

        const scheduledJobsRequiringConversionCard = document.getElementById("numberOfLocationsWithReportConversionTagCard");
        scheduledJobsRequiringConversionCard.classList.remove("disabled");
        scheduledJobsRequiringConversionCard.classList.add("clickable");
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
  
    // Oldest Job to be marked complete.
    const oldestElem = document.getElementById("oldestJobToBeMarkedCompleteDate");
    const oldestElem1 = document.getElementById("oldestJobToBeMarkedCompleteAddress");
    const oldestElemCard = document.getElementById("oldestJobsCard");
    const oldestJobs = data.oldest_jobs_to_be_marked_complete;
    const firstJobId = Object.keys(oldestJobs)[0]
    const oldestDate = new Date(oldestJobs[firstJobId].oldest_job_date);
    const currentDate = new Date();
    const diffDays = (currentDate - oldestDate) / (1000 * 60 * 60 * 24);

    if (diffDays <= 42) {
      oldestElem.style.color = "#27a532";
      oldestElem1.style.color = "#27a532";
      oldestElemCard.style.backgroundImage = "linear-gradient(to top,rgb(250, 246, 246),rgb(229, 248, 225))";
      oldestElemCard.style.borderTop = "5px solid #27a532";
    } else {
      oldestElem.style.color = "#b92525";
      oldestElem1.style.color = "#b92525";
      oldestElemCard.style.backgroundImage = "linear-gradient(to top,rgb(250, 246, 246),rgb(248, 225, 227))";
      oldestElemCard.style.borderTop = "5px solid #b92525";
    }

    oldestElemCard.style.padding = "10px";
    oldestElemCard.style.borderRadius = "8px";
    oldestElemCard.style.boxShadow = "2px 4px 10px rgba(0, 0, 0, 0.1)";
    oldestElemCard.style.textAlign = "center";



    // Number of Scheduled Jobs to be Converted
    const numberOfScheduledJobsToBeConvertedText = document.getElementById("numberOfJobsWithReportConversionTag");
    const numberOfScheduledJobsToBeConvertedCard = document.getElementById("numberOfLocationsWithReportConversionTagCard");
    const numberOfScheduledJobsToBeConverted = data.jobs_to_be_converted.length;
    if (numberOfScheduledJobsToBeConverted <= 10) {
      numberOfScheduledJobsToBeConvertedText.style.color = "#27a532";
      numberOfScheduledJobsToBeConvertedCard.style.backgroundImage = "linear-gradient(to top,rgb(250, 246, 246),rgb(229, 248, 225))";
      numberOfScheduledJobsToBeConvertedCard.style.borderTop = "5px solid #27a532";
    } else {
      numberOfScheduledJobsToBeConvertedText.style.color = "#b92525";
      numberOfScheduledJobsToBeConvertedCard.style.backgroundImage = "linear-gradient(to top,rgb(250, 246, 246),rgb(248, 225, 227))";
      numberOfScheduledJobsToBeConvertedCard.style.borderTop = "5px solid #b92525";
    }

    
    // Earliest Scheduled Job with Report Conversion
    const earliestScheduledJobToBeConvertedAddressText = document.getElementById("earliestJobToBeConvertedAddress");
    const earliestScheduledJobToBeConvertedDateText = document.getElementById("earliestJobToBeConvertedDate");
    const earliestScheduledJobToBeConvertedCard = document.getElementById("earliestJobToBeConvertedCard");
    const earliestScheduledJobDate = data.jobs_to_be_converted[0].scheduledDate
    const jobDate = new Date(earliestScheduledJobDate * 1000);

    // Get the current date and a date two weeks from now
    const now = new Date();
    const twoWeeksFromNow = new Date();
    twoWeeksFromNow.setDate(now.getDate() + 14);

    // Check if the job date is equal to or further than 2 weeks away
    if (jobDate >= twoWeeksFromNow) {
      earliestScheduledJobToBeConvertedAddressText.style.color = "#27a532";
      earliestScheduledJobToBeConvertedDateText.style.color = "#27a532";
      earliestScheduledJobToBeConvertedCard.style.backgroundImage = "linear-gradient(to top,rgb(250, 246, 246),rgb(229, 248, 225))";
      earliestScheduledJobToBeConvertedCard.style.borderTop = "5px solid #27a532";
    } else {
      earliestScheduledJobToBeConvertedAddressText.style.color = "#b92525";
      earliestScheduledJobToBeConvertedDateText.style.color = "#b92525";
      earliestScheduledJobToBeConvertedCard.style.backgroundImage = "linear-gradient(to top,rgb(250, 246, 246),rgb(248, 225, 227))";
      earliestScheduledJobToBeConvertedCard.style.borderTop = "5px solid #b92525";
    }


  }

  // Update the week display (e.g., "Week of March 24 - 28").
  function updateWeekDisplay(selectedMondayStr) {
      const display = document.getElementById("selected-week-display");
      const [year, month, day] = selectedMondayStr.split("-").map(Number);

      // Create dates in UTC to avoid timezone day-shifting
      const selectedMondayDate = new Date(Date.UTC(year, month - 1, day));
      const selectedFridayDate = new Date(Date.UTC(year, month - 1, day + 4));

      const optionsMonthDay = { month: "long", day: "numeric", timeZone: "UTC" };
      const optionsDayOnly = { day: "numeric", timeZone: "UTC" };

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

  function setupScheduledJobsRequiringConversionCardToggle() {
    const scheduledJobsRequiringReportConversionCard = document.getElementById("numberOfLocationsWithReportConversionTagCard");

    // Start in loading state
    scheduledJobsRequiringReportConversionCard.classList.add("disabled");
    scheduledJobsRequiringReportConversionCard.classList.remove("clickable");

    scheduledJobsRequiringReportConversionCard.addEventListener("click", () => {
      if (!isOldestJobsDataLoaded) {
        console.warn("data not loaded yet");
        return;
      }

      const scheduledJobsRequiringConversionModal = new bootstrap.Modal(document.getElementById("scheduledJobsRequiringReportConversionModal"));
      scheduledJobsRequiringConversionModal.show();
    })
  }

  
  

  

  function initEventListeners() {
    // Submit week button.
    const weekSelect = document.getElementById("week-select");
    document.getElementById("submitWeekBtn").addEventListener("click", function () {
      const selectedMonday = weekSelect.value;
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
    setupScheduledJobsRequiringConversionCardToggle();
    loadJobsToBeMarkedComplete();
    loadJobsToBeInvoiced();
    loadPinkFolderData();
    LoadJobsToday();
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
