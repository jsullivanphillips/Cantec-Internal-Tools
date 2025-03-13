document.addEventListener("DOMContentLoaded", function() {
    // Global variable to hold the chart instance for Metric 1
    let chartInstance = null;
    // Global variable for Metric 2 (monthly invoice totals)
    let monthlyChartInstance = null;
    // Global variable for Metric 3 (scheduled jobs count)
    let serviceChartInstance = null;

    // Helper function to format month label (e.g., "2023-03" -> "March 2023")
    function formatMonthLabel(ymStr) {
        const parts = ymStr.split("-");
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1; // zero-indexed month
        const date = new Date(year, month);
        return date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    }
    
    // Function to fetch and display Metric 1 data (Top Companies by Invoice Amount)
    function fetchData(dateAfter, dateBefore) {
        let url = "/data-analytics/metric1";
        if (dateAfter && dateBefore) {
            url += `?dateAfter=${dateAfter}&dateBefore=${dateBefore}`;
        }
        fetch(url)
          .then(response => response.json())
          .then(data => {
              const topCompanies = data.topCompanies || [];
              const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
              const companyResults = document.getElementById('companyResults');
              if (companyResults) {
                  let htmlContent = `<ul class="card-text">`;
                  topCompanies.forEach(item => {
                      htmlContent += `<li>${item[0]}: ${formatter.format(item[1])}</li>`;
                  });
                  htmlContent += `</ul>`;
                  companyResults.innerHTML = htmlContent;
              }
    
              // Render or update the bar chart for Metric 1
              const ctx = document.getElementById('chartCanvas');
              if (ctx && topCompanies.length > 0) {
                  const labels = topCompanies.map(item => item[0]);
                  const dataValues = topCompanies.map(item => item[1]);
    
                  if (chartInstance) {
                      chartInstance.data.labels = labels;
                      chartInstance.data.datasets[0].data = dataValues;
                      chartInstance.update();
                  } else {
                      chartInstance = new Chart(ctx, {
                          type: 'bar',
                          data: {
                              labels: labels,
                              datasets: [{
                                  label: 'Invoice Sum ($)',
                                  data: dataValues,
                                  backgroundColor: 'rgba(12, 98, 166, 0.5)',
                                  borderColor: 'rgba(12, 98, 166, 1)',
                                  borderWidth: 1
                              }]
                          },
                          options: {
                              scales: {
                                  y: {
                                      beginAtZero: true,
                                      ticks: {
                                          callback: function(value) {
                                              return formatter.format(value);
                                          }
                                      }
                                  }
                              }
                          }
                      });
                  }
              } else if (ctx) {
                  if (chartInstance) {
                      chartInstance.destroy();
                      chartInstance = null;
                  }
              }
          })
          .catch(error => {
              console.error("Error fetching metric1 data:", error);
          });
    }
    
    // Function to fetch and display Metric 2 data (Monthly Invoice Totals)
    function fetchMetric2() {
        fetch("/data-analytics/metric2")
          .then(response => response.json())
          .then(data => {
              const monthlyData = data.monthlyTotals || [];
              const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
              let htmlContent = `<ul class="card-text">`;
              const labels = [];
              const totals = [];
              monthlyData.forEach(item => {
                  const formattedMonth = formatMonthLabel(item.month);
                  labels.push(formattedMonth);
                  totals.push(item.total);
                  htmlContent += `<li>${formattedMonth}: ${formatter.format(item.total)}</li>`;
              });
              htmlContent += `</ul>`;
              document.getElementById("monthlyTotalsList").innerHTML = htmlContent;
    
              // Render or update the bar chart for Metric 2
              const ctx = document.getElementById('monthlyChartCanvas');
              if (ctx && monthlyData.length > 0) {
                  if (monthlyChartInstance) {
                      monthlyChartInstance.data.labels = labels;
                      monthlyChartInstance.data.datasets[0].data = totals;
                      monthlyChartInstance.update();
                  } else {
                      monthlyChartInstance = new Chart(ctx, {
                          type: 'bar',
                          data: {
                              labels: labels,
                              datasets: [{
                                  label: 'Total Invoice Amount ($)',
                                  data: totals,
                                  backgroundColor: 'rgba(0, 123, 255, 0.5)',
                                  borderColor: 'rgba(0, 123, 255, 1)',
                                  borderWidth: 1
                              }]
                          },
                          options: {
                              scales: {
                                  y: {
                                      beginAtZero: true,
                                      ticks: {
                                          callback: function(value) {
                                              return formatter.format(value);
                                          }
                                      }
                                  }
                              }
                          }
                      });
                  }
              } else if (ctx) {
                  if (monthlyChartInstance) {
                      monthlyChartInstance.destroy();
                      monthlyChartInstance = null;
                  }
              }
          })
          .catch(error => {
              console.error("Error fetching metric2 data:", error);
          });
    }
    
    function fetchMetric3() {
        fetch("/data-analytics/metric3")
            .then(response => response.json())
            .then(data => {
                const monthlyData = data.monthlyScheduled || [];
                let htmlContent = `<ul class="card-text">`;
                const labels = [];
                const counts = [];
                monthlyData.forEach(item => {
                    const formattedMonth = formatMonthLabel(item.month);
                    labels.push(formattedMonth);
                    counts.push(item.job_count);  // <-- Corrected here
                    htmlContent += `<li>${formattedMonth}: ${item.job_count} jobs</li>`;  // <-- Corrected here
                });
                htmlContent += `</ul>`;
                document.getElementById("serviceMetricList").innerHTML = htmlContent;
    
                // Render or update the bar chart for Metric 3
                const ctx = document.getElementById('serviceChartCanvas');
                if (ctx && monthlyData.length > 0) {
                    if (window.serviceChartInstance) {
                        window.serviceChartInstance.data.labels = labels;
                        window.serviceChartInstance.data.datasets[0].data = counts;
                        window.serviceChartInstance.update();
                    } else {
                        window.serviceChartInstance = new Chart(ctx, {
                            type: 'bar',
                            data: {
                                labels: labels,
                                datasets: [{
                                    label: 'Scheduled Jobs Count',
                                    data: counts,
                                    backgroundColor: 'rgba(40, 167, 69, 0.5)',
                                    borderColor: 'rgba(40, 167, 69, 1)',
                                    borderWidth: 1
                                }]
                            },
                            options: {
                                scales: {
                                    y: {
                                        beginAtZero: true,
                                        precision: 0
                                    }
                                }
                            }
                        });
                    }
                } else if (ctx) {
                    if (window.serviceChartInstance) {
                        window.serviceChartInstance.destroy();
                        window.serviceChartInstance = null;
                    }
                }
            })
            .catch(error => {
                console.error("Error fetching metric3 data:", error);
            });
    }
    
    
    // Fetch default data on page load for all metrics
    fetchData();
    fetchMetric2();
    fetchMetric3();
    
    // Add event listener for the Update button on Metric 1
    const updateButton = document.getElementById('updateDateRange');
    if (updateButton) {
        updateButton.addEventListener('click', function() {
            const dateAfterInput = document.getElementById('dateAfter');
            const dateBeforeInput = document.getElementById('dateBefore');
            const dateAfter = dateAfterInput.value;
            const dateBefore = dateBeforeInput.value;
            if (dateAfter && dateBefore) {
                const companyResults = document.getElementById('companyResults');
                if (companyResults) {
                    companyResults.innerHTML = "<p class='card-text'>Loading data...</p>";
                }
                fetchData(dateAfter, dateBefore);
            } else {
                alert("Please enter both start and end dates.");
            }
        });
    }
});
