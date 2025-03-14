// Global chart instances
let topCompaniesChartInstance = null;
let monthlyInvoiceChartInstance = null;
let scheduledJobsChartInstance = null;
let processingChartInstance = null;

// Helper to format YYYY-MM to Month Year
function formatMonthLabel(ymStr) {
    const parts = ymStr.split("-");
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const date = new Date(year, month);
    return date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

// Helper to format date to Month Day, Year
function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

// Helper to calculate date ranges based on toggle, ensuring full weeks
function getDateRange(range) {
    const today = new Date();
    const start = new Date(today);

    switch (range) {
        case '1week':
            // For 1 week, use the current week (Monday to Sunday)
            start.setDate(today.getDate() - today.getDay() + 1); // Start of the week (Monday)
            break;
        case '4weeks':
            // For 4 weeks, go back 4 full weeks (Monday to Sunday)
            start.setDate(today.getDate() - today.getDay() + 1 - (4 * 7)); // Start of the first week
            break;
        case '3months':
            // For 3 months, go back 3 full months and start from the first Monday
            start.setMonth(today.getMonth() - 3);
            start.setDate(1); // Start of the month
            while (start.getDay() !== 1) { // Find the first Monday
                start.setDate(start.getDate() + 1);
            }
            break;
        case '6months':
            // For 6 months, go back 6 full months and start from the first Monday
            start.setMonth(today.getMonth() - 6);
            start.setDate(1); // Start of the month
            while (start.getDay() !== 1) { // Find the first Monday
                start.setDate(start.getDate() + 1);
            }
            break;
        default:
            // Default to 6 weeks
            start.setDate(today.getDate() - today.getDay() + 1 - (6 * 7)); // Start of the first week
    }

    // End date is always the end of the current week (Sunday)
    const end = new Date(today);
    end.setDate(today.getDate() - today.getDay() + 7); // End of the week (Sunday)

    return {
        start: start.toISOString().slice(0, 10), // Format as YYYY-MM-DD
        end: end.toISOString().slice(0, 10)     // Format as YYYY-MM-DD
    };
}

// Fetch Metric 1: Top Companies by Invoice Amount
function fetchMetric1(range = '1month') {
    // Hide the bar graph and show "Loading data..."
    const chartCanvas = document.getElementById('chartCanvas');
    const companiesTableContainer = document.getElementById('companiesTableContainer');
    chartCanvas.style.display = "none";  // Hide the chart
    companiesTableContainer.style.display = "none";  // Hide the table
    document.getElementById("companyResults").innerHTML = "<p class='card-text'>Loading data...</p>";

    const { start, end } = getDateRange(range);
    fetch(`/data-analytics/metric1?dateAfter=${start}&dateBefore=${end}`)
        .then(res => res.json())
        .then(data => {
            const topCompanies = data.topCompanies || [];
            let totalInvoiceAmount = 0;

            // Clear the table body
            const tableBody = document.getElementById('companiesTableBody');
            tableBody.innerHTML = "";

            // Populate the table
            topCompanies.forEach(item => {
                const row = document.createElement('tr');
                const companyCell = document.createElement('td');
                companyCell.textContent = item[0];
                const amountCell = document.createElement('td');
                amountCell.textContent = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(item[1]);
                row.appendChild(companyCell);
                row.appendChild(amountCell);
                tableBody.appendChild(row);

                totalInvoiceAmount += item[1];
            });

            // Update the total invoice summary
            document.getElementById('totalInvoiceAmount').textContent = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totalInvoiceAmount);

            // Show the table and summary
            companiesTableContainer.style.display = "block";
            document.getElementById("companyResults").innerHTML = "";

            // Update the bar graph
            const ctx = document.getElementById('chartCanvas');
            if (topCompaniesChartInstance) {
                topCompaniesChartInstance.data.labels = topCompanies.map(item => item[0]);
                topCompaniesChartInstance.data.datasets[0].data = topCompanies.map(item => item[1]);
                topCompaniesChartInstance.update();
            } else {
                topCompaniesChartInstance = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: topCompanies.map(item => item[0]),
                        datasets: [{
                            label: 'Invoice Amount',
                            data: topCompanies.map(item => item[1]),
                            backgroundColor: 'rgba(12,98,166,0.5)',
                            borderColor: 'rgba(12,98,166,1)',
                            borderWidth: 1
                        }]
                    },
                    options: {
                        scales: {
                            y: {
                                beginAtZero: true,
                                ticks: {
                                    callback: value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
                                }
                            }
                        }
                    }
                });
            }

            // Show the bar graph after data is loaded
            chartCanvas.style.display = "block";
        })
        .catch(error => {
            console.error("Error fetching top companies:", error);
            document.getElementById("companyResults").innerHTML = "<p class='card-text'>Error loading data.</p>";
            chartCanvas.style.display = "none";  // Ensure the chart remains hidden on error
            companiesTableContainer.style.display = "none";  // Ensure the table remains hidden on error
        });
}

// Fetch Metric 2: Monthly Invoice Totals
function fetchMetric2() {
    // Hide the bar graph and show "Loading data..."
    const monthlyChartCanvas = document.getElementById('monthlyChartCanvas');
    const monthlyTableContainer = document.getElementById('monthlyTableContainer');
    monthlyChartCanvas.style.display = "none";  // Hide the chart
    monthlyTableContainer.style.display = "none";  // Hide the table
    document.getElementById("monthlyTotalsList").innerHTML = "<p class='card-text'>Loading data...</p>";

    fetch("/data-analytics/metric2")
        .then(res => res.json())
        .then(data => {
            const monthlyData = data.monthlyTotals || [];
            let totalInvoiceAmount = 0;

            // Clear the table body
            const tableBody = document.getElementById('monthlyTableBody');
            tableBody.innerHTML = "";

            // Populate the table
            monthlyData.forEach(item => {
                const row = document.createElement('tr');
                const monthCell = document.createElement('td');
                monthCell.textContent = formatMonthLabel(item.month);
                const amountCell = document.createElement('td');
                amountCell.textContent = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(item.total);
                row.appendChild(monthCell);
                row.appendChild(amountCell);
                tableBody.appendChild(row);

                totalInvoiceAmount += item.total;
            });

            // Update the total invoice summary
            document.getElementById('totalMonthlyAmount').textContent = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totalInvoiceAmount);

            // Show the table and summary
            monthlyTableContainer.style.display = "block";
            document.getElementById("monthlyTotalsList").innerHTML = "";

            // Update the bar graph
            const ctx = document.getElementById('monthlyChartCanvas');
            if (monthlyInvoiceChartInstance) {
                monthlyInvoiceChartInstance.data.labels = monthlyData.map(item => formatMonthLabel(item.month));
                monthlyInvoiceChartInstance.data.datasets[0].data = monthlyData.map(item => item.total);
                monthlyInvoiceChartInstance.update();
            } else {
                monthlyInvoiceChartInstance = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: monthlyData.map(item => formatMonthLabel(item.month)),
                        datasets: [{
                            label: 'Monthly Invoice Total',
                            data: monthlyData.map(item => item.total),
                            backgroundColor: 'rgba(0,123,255,0.5)',
                            borderColor: 'rgba(0,123,255,1)',
                            borderWidth: 1
                        }]
                    },
                    options: {
                        scales: {
                            y: {
                                beginAtZero: true,
                                ticks: {
                                    callback: value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
                                }
                            }
                        }
                    }
                });
            }

            // Show the bar graph after data is loaded
            monthlyChartCanvas.style.display = "block";
        })
        .catch(error => {
            console.error("Error fetching monthly invoice totals:", error);
            document.getElementById("monthlyTotalsList").innerHTML = "<p class='card-text'>Error loading data.</p>";
            monthlyChartCanvas.style.display = "none";  // Ensure the chart remains hidden on error
            monthlyTableContainer.style.display = "none";  // Ensure the table remains hidden on error
        });
}

// Helper to format interval with month names
function formatInterval(interval) {
    // Check if the interval is in the format "Week of YYYY-MM-DD"
    if (interval.startsWith("Week of ")) {
        const dateStr = interval.replace("Week of ", "");
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
            // Format as "Week of Month Day, Year"
            return `Week of ${date.toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;
        }
    }
    // If the interval is not in the expected format, return it as is
    return interval;
}

// Fetch Metric 3: Scheduled Jobs with Dynamic Range and Interval
function fetchMetric3(range = '6weeks') {
    // Hide the bar graph and show "Loading data..."
    const chartCanvas = document.getElementById('serviceChartCanvas');
    const jobsTableContainer = document.getElementById('jobsTableContainer');
    chartCanvas.style.display = "none";  // Hide the chart
    jobsTableContainer.style.display = "none";  // Hide the table
    document.getElementById("serviceMetricList").innerHTML = "<p class='card-text'>Loading data...</p>";

    const { start, end } = getDateRange(range);
    fetch(`/data-analytics/metric3?dateAfter=${start}&dateBefore=${end}&range=${range}`)
        .then(res => {
            console.log("Fetch response received. Status:", res.status);  // Debug: Check response status
            if (!res.ok) {
                throw new Error(`HTTP error! Status: ${res.status}`);
            }
            return res.json();
        })
        .then(data => {
            console.log("Data parsed successfully:", data);  // Debug: Check parsed data
            const jobData = data.scheduledJobs || [];  // Use the correct key: scheduledJobs
            console.log("Job data extracted:", jobData);  // Debug: Check extracted data

            let totalJobs = 0;

            // Clear the table body
            const tableBody = document.getElementById('jobsTableBody');
            tableBody.innerHTML = "";

            // Populate the table
            jobData.forEach(item => {
                const row = document.createElement('tr');
                const intervalCell = document.createElement('td');
                intervalCell.textContent = formatInterval(item.interval);  // Format the interval
                const jobsCell = document.createElement('td');
                jobsCell.textContent = item.job_count;  // Use the job_count field
                row.appendChild(intervalCell);
                row.appendChild(jobsCell);
                tableBody.appendChild(row);

                totalJobs += item.job_count;
            });

            // Update the total jobs summary
            document.getElementById('totalJobsCount').textContent = totalJobs;

            // Show the table and summary
            jobsTableContainer.style.display = "block";
            document.getElementById("serviceMetricList").innerHTML = "";

            // Update the bar graph
            const ctx = document.getElementById('serviceChartCanvas');
            if (scheduledJobsChartInstance) {
                scheduledJobsChartInstance.data.labels = jobData.map(item => formatInterval(item.interval));
                scheduledJobsChartInstance.data.datasets[0].data = jobData.map(item => item.job_count);
                scheduledJobsChartInstance.update();
            } else {
                scheduledJobsChartInstance = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: jobData.map(item => formatInterval(item.interval)),
                        datasets: [{
                            label: 'Scheduled Jobs',
                            data: jobData.map(item => item.job_count),
                            backgroundColor: 'rgba(40,167,69,0.5)',
                            borderColor: 'rgba(40,167,69,1)',
                            borderWidth: 1
                        }]
                    },
                    options: {
                        scales: {
                            y: { beginAtZero: true, precision: 0 }
                        }
                    }
                });
            }

            // Show the bar graph after data is loaded
            chartCanvas.style.display = "block";
        })
        .catch(error => {
            console.error("Error fetching scheduled jobs:", error);
            document.getElementById("serviceMetricList").innerHTML = "<p class='card-text'>Error loading data.</p>";
            chartCanvas.style.display = "none";  // Ensure the chart remains hidden on error
            jobsTableContainer.style.display = "none";  // Ensure the table remains hidden on error
        });
}

// Fetch Metric 4: Jobs Completed After Scheduling
const fetchMetric4 = (range) => {
    console.log("Starting fetchMetric4...");  // Debug: Function started
    const { start, end } = getDateRange(range);
    console.log("Date range:", { start, end });  // Debug: Check date range

    // Show loading indicator and hide the chart
    document.getElementById("processingMetricList").innerHTML = "<p class='card-text'>Loading data...</p>";
    document.getElementById("processingChartCanvas").style.display = "none";  // Hide chart during loading

    fetch(`/data-analytics/metric4?dateAfter=${start}&dateBefore=${end}&range=${range}`)
        .then(res => {
            console.log("Fetch response received. Status:", res.status);  // Debug: Check response status
            if (!res.ok) {
                throw new Error(`HTTP error! Status: ${res.status}`);
            }
            return res.json();
        })
        .then(data => {
            console.log("Data parsed successfully:", data);  // Debug: Check parsed data
            const processingData = data.jobsCompleted || [];  // Use the correct key: jobsCompleted
            console.log("Processing data extracted:", processingData);  // Debug: Check extracted data

            // Clear the table body
            const tableBody = document.getElementById('processingTableBody');
            tableBody.innerHTML = "";

            // Populate the table
            processingData.forEach(item => {
                const row = document.createElement('tr');
                const dateCell = document.createElement('td');
                dateCell.textContent = formatInterval(item.interval);  // Format the interval
                const jobsCell = document.createElement('td');
                jobsCell.textContent = item.jobs_completed;
                row.appendChild(dateCell);
                row.appendChild(jobsCell);
                tableBody.appendChild(row);
            });

            // Show the table
            document.getElementById("processingTableContainer").style.display = "block";
            document.getElementById("processingMetricList").innerHTML = "";

            // Update or create the chart
            const ctx = document.getElementById('processingChartCanvas');
            if (typeof processingChartInstance !== 'undefined' && processingChartInstance) {
                console.log("Updating existing chart...");  // Debug: Chart update
                processingChartInstance.data.labels = processingData.map(item => formatInterval(item.interval));
                processingChartInstance.data.datasets[0].data = processingData.map(item => item.jobs_completed);
                processingChartInstance.update();
            } else {
                console.log("Creating new chart...");  // Debug: Chart creation
                processingChartInstance = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: processingData.map(item => formatInterval(item.interval)),
                        datasets: [{
                            label: 'Jobs Completed After Scheduling',
                            data: processingData.map(item => item.jobs_completed),
                            backgroundColor: 'rgba(255, 99, 132, 0.5)',
                            borderColor: 'rgba(255, 99, 132, 1)',
                            borderWidth: 1
                        }]
                    },
                    options: {
                        scales: {
                            y: { beginAtZero: true, precision: 0 }
                        }
                    }
                });
            }

            // Show the bar graph after data is loaded
            console.log("Displaying chart...");  // Debug: Chart display
            document.getElementById("processingChartCanvas").style.display = "block";
        })
        .catch(error => {
            console.error("Error in fetchMetric4:", error);  // Debug: Detailed error logging
            document.getElementById("processingMetricList").innerHTML = "<p class='card-text'>Error loading data.</p>";
            document.getElementById("processingChartCanvas").style.display = "none";  // Ensure the chart remains hidden on error
            document.getElementById("processingTableContainer").style.display = "none";  // Ensure the table remains hidden on error
        });
};

// Add event listeners for the new metric's buttons
document.querySelectorAll("#metric4Range .btn").forEach(btn => {
    btn.addEventListener("click", function() {
        const metric = this.dataset.metric;
        const range = this.dataset.range;

        // Remove active class from siblings
        document.querySelectorAll(`[data-metric='${metric}']`).forEach(sibling => {
            sibling.classList.remove("active");
        });
        this.classList.add("active");

        // Fetch appropriate metric based on toggle selection
        if (metric === "metric4") fetchMetric4(range);
    });
});

// Preload data for all ranges
function preloadData() {
    const rangesMetric1And3 = ["1month", "6weeks", "3months", "6months"]; // Ranges for Metrics 1 and 3
    const rangesMetric4 = ["1week", "4weeks", "3months", "6months"]; // Ranges for Metric 4

    // Preload data for Metric 1 (Top Companies by Invoice Amount)
    rangesMetric1And3.forEach(range => {
        const { start, end } = getDateRange(range);
        fetch(`/data-analytics/metric1?dateAfter=${start}&dateBefore=${end}`)
            .then(res => res.json())
            .then(data => {
                console.log(`Preloaded Metric 1 data for range: ${range}`);
            })
            .catch(error => {
                console.error(`Error preloading Metric 1 data for range ${range}:`, error);
            });
    });

    // Preload data for Metric 3 (Scheduled Jobs)
    rangesMetric1And3.forEach(range => {
        const { start, end } = getDateRange(range);
        fetch(`/data-analytics/metric3?dateAfter=${start}&dateBefore=${end}`)
            .then(res => res.json())
            .then(data => {
                console.log(`Preloaded Metric 3 data for range: ${range}`);
            })
            .catch(error => {
                console.error(`Error preloading Metric 3 data for range ${range}:`, error);
            });
    });

    // Preload data for Metric 4 (Jobs Completed After Scheduling)
    rangesMetric4.forEach(range => {
        const { start, end } = getDateRange(range);
        fetch(`/data-analytics/metric4?dateAfter=${start}&dateBefore=${end}&range=${range}`)
            .then(res => res.json())
            .then(data => {
                console.log(`Preloaded Metric 4 data for range: ${range}`);
            })
            .catch(error => {
                console.error(`Error preloading Metric 4 data for range ${range}:`, error);
            });
    });
}

// Event listeners for toggle buttons
document.querySelectorAll(".btn-group .btn").forEach(btn => {
    btn.addEventListener("click", function() {
        const metric = this.dataset.metric;
        const range = this.dataset.range;

        // Remove active class from siblings
        document.querySelectorAll(`[data-metric='${metric}']`).forEach(sibling => {
            sibling.classList.remove("active");
        });
        this.classList.add("active");

        // Fetch appropriate metric based on toggle selection
        if(metric === "metric1") fetchMetric1(range);
        if(metric === "metric3") fetchMetric3(range);
    });
});

// Initial loading of metrics
document.addEventListener("DOMContentLoaded", () => {
    fetchMetric1("1month");
    fetchMetric2();
    fetchMetric3("6weeks");  // Default to last 6 weeks on load
    fetchMetric4("1week");   // Default to last 1 week on load

    // Preload data for all ranges in the background
    preloadData();
});