document.addEventListener("DOMContentLoaded", function() {
    // Global variable to hold the chart instance
    let chartInstance = null;

    // Function to fetch and display data with an optional date range
    function fetchData(dateAfter, dateBefore) {
        let url = "/data-analytics/metric1";
        if (dateAfter && dateBefore) {
            url += `?dateAfter=${dateAfter}&dateBefore=${dateBefore}`;
        }
        fetch(url)
          .then(response => response.json())
          .then(data => {
              const topCompanies = data.topCompanies || [];
              // Use Intl.NumberFormat to format amounts as USD currency
              const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
              const companyResults = document.getElementById('companyResults');
              if (companyResults) {
                  let htmlContent = `<ul class="card-text">`;
                  topCompanies.forEach(item => {
                      // item[0] is the company name, item[1] is the invoice sum
                      htmlContent += `<li>${item[0]}: ${formatter.format(item[1])}</li>`;
                  });
                  htmlContent += `</ul>`;
                  companyResults.innerHTML = htmlContent;
              }
    
              // Render or update a bar chart using Chart.js
              const ctx = document.getElementById('chartCanvas');
              if (ctx && topCompanies.length > 0) {
                  const labels = topCompanies.map(item => item[0]);
                  const dataValues = topCompanies.map(item => item[1]);
    
                  // If chart already exists, update its data; otherwise, create a new chart.
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
                  // If there is no data, clear the chart (if needed)
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
    
    // Fetch default data on page load
    fetchData();
    
    // Add event listener for the Update button
    const updateButton = document.getElementById('updateDateRange');
    if (updateButton) {
        updateButton.addEventListener('click', function() {
            const dateAfterInput = document.getElementById('dateAfter');
            const dateBeforeInput = document.getElementById('dateBefore');
            const dateAfter = dateAfterInput.value;
            const dateBefore = dateBeforeInput.value;
            if (dateAfter && dateBefore) {
                // Show a loading message while fetching
                const companyResults = document.getElementById('companyResults');
                if (companyResults) {
                    companyResults.innerHTML = "<p class='card-text'>Loading data...</p>";
                }
                // Re-fetch data with the specified date range
                fetchData(dateAfter, dateBefore);
            } else {
                alert("Please enter both start and end dates.");
            }
        });
    }
});
