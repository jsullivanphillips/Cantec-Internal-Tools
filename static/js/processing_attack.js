// processing_attack.js

// Global chart variable
let jobsChart;

// Generate work week options for the past year.
function generateWorkWeekOptions() {
  const weekSelect = document.getElementById("week-select");
  weekSelect.innerHTML = "";
  const options = [];
  const now = new Date();
  
  // Determine the current week's Monday.
  const day = now.getDay(); 
  let mondayThisWeek = new Date(now);
  mondayThisWeek.setDate(now.getDate() - ((day + 6) % 7)); 
  // Friday of this week:
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
    
    // Format display, e.g. "Mar 10 - Mar 14, 2025"
    const optionsFormat = { month: 'short', day: 'numeric' };
    const mondayStr = currentMonday.toLocaleDateString('en-US', optionsFormat);
    const fridayStr = currentFriday.toLocaleDateString('en-US', optionsFormat);
    const year = currentMonday.getFullYear();
    const displayText = `${mondayStr} - ${fridayStr}, ${year}`;
    
    // The value we send to the server is the Monday's YYYY-MM-DD.
    const value = currentMonday.toISOString().slice(0, 10);
    
    options.push({ value, text: displayText });
    
    // Move to the previous week.
    currentMonday.setDate(currentMonday.getDate() - 7);
  }
  
  // No reversing; options remain in descending order: most recent first.
  // Populate the select element.
  for (let opt of options) {
    const optionEl = document.createElement("option");
    optionEl.value = opt.value;
    optionEl.textContent = opt.text;
    weekSelect.appendChild(optionEl);
  }
}

// Function to update KPI colors based on performance thresholds.
function updateKPIs(data) {
  // Jobs to be marked complete (goal: under 50)
  const jobsElem = document.getElementById("jobsToBeMarkedComplete");
  if (parseInt(data.jobs_to_be_marked_complete) < 50) {
    jobsElem.style.color = "#27a532";
  } else {
    jobsElem.style.color = "#b92525";
  }
  
  // Number of Pink Folder jobs (goal: under 10)
  const pinkElem = document.getElementById("numberOfPinkFolderJobs");
  if (parseInt(data.number_of_pink_folder_jobs) < 10) {
    pinkElem.style.color = "#27a532";
  } else {
    pinkElem.style.color = "#b92525";
  }
  
  // Oldest Job to be marked complete: should not be older than 1 month.
  // We assume data.oldest_job_date is in a parseable format.
  const oldestElem = document.getElementById("oldestJobToBeMarkedCompleteDate");
  const oldestElem1 = document.getElementById("oldestJobToBeMarkedCompleteAddress");
  const oldestElem2 = document.getElementById("oldestJobToBeMarkedCompleteType");
  const oldestDate = new Date(data.oldest_job_date);
  const currentDate = new Date();
  const diffDays = (currentDate - oldestDate) / (1000 * 60 * 60 * 24);
  if (diffDays <= 30) { // Green
    oldestElem.style.color = "#27a532";
    oldestElem1.style.color = "#27a532";
    oldestElem2.style.color = "#27a532";
  } else { // Red
    oldestElem.style.color = "#b92525";
    oldestElem1.style.color = "#b92525";
    oldestElem2.style.color = "#b92525";
  }
}

// Load the complete jobs data (only on page load)
function loadCompleteJobs(selectedMonday) {
  // Set loading messages for complete jobs section.
  document.getElementById("jobsToBeMarkedComplete").innerHTML = `
            <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Loading...</span>
            </div>
            Fetching jobs to be marked complete...
        `;
  document.getElementById("oldestJobToBeMarkedCompleteDate").textContent = "";
  document.getElementById("oldestJobToBeMarkedCompleteAddress").innerHTML = `
        <div class="spinner-border text-primary" role="status">
            <span class="visually-hidden">Loading...</span>
        </div>
        Fetching oldest job...
        `;
  document.getElementById("oldestJobToBeMarkedCompleteType").textContent = "";
  document.getElementById("numberOfPinkFolderJobs").innerHTML = `
        <div class="spinner-border text-primary" role="status">
            <span class="visually-hidden">Loading...</span>
        </div>
        Fetching pink folder jobs...
        `;

  fetch("/processing_attack/complete_jobs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ selectedMonday })
  })
  .then(response => response.json())
  .then(data => {
    console.log("Complete jobs data:", data);
    document.getElementById("jobsToBeMarkedComplete").textContent = data.jobs_to_be_marked_complete;
    const oldestDate = new Date(data.oldest_job_date);
    document.getElementById("oldestJobToBeMarkedCompleteDate").textContent = oldestDate.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    document.getElementById("oldestJobToBeMarkedCompleteAddress").textContent = data.oldest_job_address;
    document.getElementById("oldestJobToBeMarkedCompleteType").textContent = data.oldest_job_type;
    document.getElementById("numberOfPinkFolderJobs").textContent = data.number_of_pink_folder_jobs;
    // Update the bar chart with the job type counts.
    if (data.job_type_count) {
        const labels = Object.keys(data.job_type_count);
        const counts = Object.values(data.job_type_count);
        jobsChart.data.labels = labels;
        jobsChart.data.datasets[0].data = counts;
        jobsChart.update();
    }
    // Update KPI colors based on performance thresholds.
    updateKPIs(data);
  })
  .catch(error => {
    console.error("Error loading complete jobs:", error);
  });
}
    
// Load the processed data (total jobs processed and tech hours processed)
function loadProcessedData(selectedMonday) {
    // Set loading messages for processed data.
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
    
    fetch("/processing_attack/processed_data", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ selectedMonday })
    })
    .then(response => response.json())
    .then(data => {
      console.log("Processed data:", data);
      document.getElementById("totalJobsProcessed").textContent = data.total_jobs_processed;
      document.getElementById("totalTechHoursProcessed").textContent = data.total_tech_hours_processed;
    })
    .catch(error => {
      console.error("Error loading processed data:", error);
    });
  }
  
document.addEventListener("DOMContentLoaded", function () {
  // 1) Generate the week options on page load.
  generateWorkWeekOptions();

  const weekSelect = document.getElementById("week-select");
  
  // 2) On page load, use the default selected week's value to load both complete jobs and processed data.
  if (weekSelect.value) {
    const selectedMonday = weekSelect.value;
    loadCompleteJobs(selectedMonday);
  }
  
  // 3) Listen for the Submit button click to load processed data (and update average life charts).
  const submitWeekBtn = document.getElementById("submitWeekBtn");
  submitWeekBtn.addEventListener("click", function () {
    const selectedMonday = weekSelect.value;
    console.log("Selected Monday:", selectedMonday);
    loadProcessedData(selectedMonday);
    renderAverageJobCards(selectedMonday);
  });
  
  // 4) Initialize the bar chart with default (dummy) data.
  const ctx = document.getElementById("jobsBarGraph").getContext("2d");
  const initialLabels = []; // Empty initial labels
  const initialData = [];   // Empty initial dataset
  const chartData = {
    labels: initialLabels,
    datasets: [{
      label: "Jobs To Be Marked Complete",
      data: initialData,
      backgroundColor: "rgba(54, 162, 235, 0.6)",
      borderColor: "rgba(54, 162, 235, 1)",
      borderWidth: 1
    }]
  };
  const chartOptions = {
    scales: {
      y: {
        beginAtZero: true
      }
    }
  };
  jobsChart = new Chart(ctx, {
    type: "bar",
    data: chartData,
    options: chartOptions
  });
});

const jobTypes = [
    "repair",
    "upgrade",
    "service_call",
    "emergency_service_call",
    "inspection",
    "reinspection",
    "planned_maintenance",
    "preventative_maintenance",
    "inspection_repair",
    "replacement"
  ];
  
/**
 * Creates and returns a card element for a given job type.
 */
function createAverageJobCard(jobType) {
  // Create a card container.
  const card = document.createElement("div");
  card.classList.add("card", "full");

  card.style.paddingTop = "10px";
  card.style.paddingBottom = "10px";
  
  // Create header.
  const header = document.createElement("div");
  header.classList.add("card-header");
  header.textContent = properFormat(jobType); 
  
  // Create body with a loading indicator.
  const body = document.createElement("div");
  body.classList.add("card-body");
  body.innerHTML = `
    <div class="spinner-border text-primary" role="status">
      <span class="visually-hidden">Loading...</span>
    </div>
    Fetching average life...
  `;
  
  // Append header and body to card.
  card.appendChild(header);
  card.appendChild(body);
  
  return card;
}

document.getElementById("averageLifeHeader").addEventListener("click", function () {
  const output = document.getElementById("averageJobOutput");
  // Toggle between block and none
  output.style.display = output.style.display === "none" ? "block" : "none";
});

/**
 * Renders the average life cards for all job types.
 */
function renderAverageJobCards(weekStart) {
  const container = document.querySelector(".cards-container.average-life-cards");
  container.innerHTML = ""; // clear existing cards
  jobTypes.forEach(jobType => {
    // Create card element.
    const card = createAverageJobCard(jobType);
    // Give the card body an ID so we can update it later.
    const cardBody = card.querySelector(".card-body");
    cardBody.id = `averageJob-${jobType}`;
    // Append the card to the container.
    container.appendChild(card);
    
    // Load the average job data for this job type.
    loadAverageJobForType(jobType, weekStart, card);
  });
}

/**
 * Helper function to clean and format strings.
 */
function properFormat(s) {
  return s.replace("_", " ").replace(/\b\w/g, char => char.toUpperCase());
}

function loadAverageJobForType(jobType, weekStart, card) {
  // Find the card for this job type.
  const cardBody = document.getElementById(`averageJob-${jobType}`);
  if (!cardBody) return;

  // Set loading content.
  cardBody.innerHTML = `
    <div class="spinner-border text-primary" role="status">
      <span class="visually-hidden">Loading...</span>
    </div>
    Fetching average life...
  `;
  
  fetch("/average-life-of-a-job", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobType: jobType, weekStart: weekStart })
  })
  .then(resp => resp.json())
  .then(data => {
    if (data.error) {
      cardBody.innerHTML = `<p>Error: ${data.error}</p>`;
    } else {
      if (!data.intervals || Object.keys(data.intervals).length === 0) {
        card.innerHTML = "";
        return;
      }
      // Pass jobType here to get a unique timeline container.
      const cardHeader = card.querySelector(".card-header");
      if (data.pink_folder_jobs) {
        cardHeader.textContent = properFormat(jobType) + ", Number of jobs: " + data.total_jobs + ", Number of PF jobs: " + data.pink_folder_jobs;
      } else {
        cardHeader.textContent = properFormat(jobType) + ", Number of jobs: " + data.total_jobs;
      }
      renderAverageTimeline(data.intervals, cardBody, jobType);
    }
  })
  .catch(error => {
    console.error(`Error fetching average life for ${jobType}:`, error);
    cardBody.innerHTML = `<p>Error loading data.</p>`;
  });
}

function renderAverageTimeline(averageIntervals, cardBody, jobType) {
  // Mapping from backend keys to display labels.
  const mapping = {
    "created_to_scheduled": "Time to Schedule",
    "scheduled_to_appointment": "How Far Out Booking Was",
    "tech_time": "Time between First and Last On-Site Clock Event",
    "completed_to_processed": "Time to Process",
    "processed_to_invoiced": "Time to Invoice",
    "pink_folder": "Time Spent in Pink Folder"
  };

  const eventColors = {
    "Time to Schedule": "rgba(54, 162, 235, 0.6)",    
    "How Far Out Booking Was": "rgba(75, 192, 192, 0.6)",
    "Time between First and Last On-Site Clock Event": "rgba(255, 205, 86, 0.6)",
    "Time to Process": "rgba(255, 159, 64, 0.6)",
    "Time to Invoice": "rgba(153, 102, 255, 0.6)",
    "Time Spent in Pink Folder": "rgba(255, 105, 180, 0.6)"
  };

  // Create groups and items for each event type.
  const groups = [];
  const items = [];
  let groupId = 1;
  
  // Use an arbitrary base date.
  const baseDate = new Date("1970-01-01T00:00:00Z");
  
  // Loop over each event type.
  for (const key in mapping) {
    if (averageIntervals.hasOwnProperty(key) && averageIntervals[key] != null) {
      const label = mapping[key];
      const durationDays = averageIntervals[key];
      // All items start at the same base date.
      const start = new Date(baseDate);
      const end = new Date(start.getTime() + durationDays * 24 * 60 * 60 * 1000);
      
      // Create a group for this event.
      groups.push({ id: groupId, content: label });
      // Create an item that displays the duration.
      items.push({
        id: groupId,
        group: groupId,
        start: start,
        end: end,
        content: durationDays === 1 ? "1 Day" : durationDays + " Days",
        style: `background-color: ${eventColors[label] || "rgba(100,100,100,0.6)"};`,
        title: `${label}: ${durationDays} days`
      });
      groupId++;
    }
  }
  
  // Fix the scale to 30 days from baseDate.
  const fixedEnd = new Date(baseDate.getTime() + 30 * 24 * 60 * 60 * 1000);
  
  const options = {
    stack: false,
    moveable: false,
    zoomable: false,
    start: baseDate,
    end: fixedEnd,
    showMajorLabels: false,
    showMinorLabels: false,
    format: {
      minorLabels: { day: 'D' },
      majorLabels: { day: 'MMM D, YYYY' }
    }
  };
  
  // Use a unique id for the timeline container by including the jobType.
  const timelineId = `averageTimeline-${jobType}`;
  cardBody.innerHTML = `<div id="${timelineId}" style="min-height:300px;"></div>`;
  cardBody.style.display = "block";
  
  // Create the timeline using vis.js.
  const avgTimeline = new vis.Timeline(
    document.getElementById(timelineId),
    new vis.DataSet(items),
    new vis.DataSet(groups),
    options
  );
}
