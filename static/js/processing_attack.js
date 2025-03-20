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
    
// Load the complete jobs data (only on page load)
function loadCompleteJobs(selectedMonday) {
  // Set loading messages for complete jobs section.
  document.getElementById("jobsToBeMarkedComplete").textContent = "Loading...";
  document.getElementById("oldestJobToBeMarkedCompleteDate").textContent = "Loading...";
  document.getElementById("oldestJobToBeMarkedCompleteAddress").textContent = "Loading...";
  document.getElementById("oldestJobToBeMarkedCompleteType").textContent = "Loading...";
  
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
    document.getElementById("oldestJobToBeMarkedCompleteDate").textContent = data.oldest_job_date;
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
  })
  .catch(error => {
    console.error("Error loading complete jobs:", error);
  });
}
    
// Load the processed data (total jobs processed and tech hours processed)
function loadProcessedData(selectedMonday) {
  // Set loading messages for processed data.
  document.getElementById("totalJobsProcessed").textContent = "Loading...";
  document.getElementById("totalTechHoursProcessed").textContent = "Loading...";
  
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
    loadProcessedData(selectedMonday);
  }
  
  // 3) Listen for the Submit button click to load only processed data.
  const submitWeekBtn = document.getElementById("submitWeekBtn");
  submitWeekBtn.addEventListener("click", function () {
    const selectedMonday = weekSelect.value;
    console.log("Selected Monday:", selectedMonday);
    loadProcessedData(selectedMonday);
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
