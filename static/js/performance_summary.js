// Performance Summary V4 with fixes and enhanced visualizations
const PerformanceSummary = (() => {
  let charts = {};
  let topNValue = 5; // default to Top 5

  function formatLabelName(camelCaseLabel) {
    return camelCaseLabel
      .replace(/_/g, ' ')
      .replace(/\b\w/g, char => char.toUpperCase());
  }


  function createBarChart(ctx, labels, data, label, color, horizontal = false, jobCounts = null, isCurrency = false) {
    return new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label,
          data,
          backgroundColor: color,
          borderRadius: 5
        }]
      },
      options: {
        responsive: true,
        indexAxis: horizontal ? 'y' : 'x',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => {
                const rawLabel = ctx.label;
                const formattedLabel = formatLabelName(rawLabel);
                const value = typeof ctx.parsed === 'object' ? 
                  (ctx.chart.options.indexAxis === 'y' ? ctx.parsed.x : ctx.parsed.y) : 
                  ctx.parsed;

                const jobs = jobCounts?.[rawLabel];

                if (jobCounts && jobs !== undefined) {
                  return `${formattedLabel}: $${value.toLocaleString()} (from ${jobs} jobs)`;
                } else {
                  return isCurrency ? `${formattedLabel}: $${value.toLocaleString()}` : `${formattedLabel}: ${value.toLocaleString()}`;
                }
              }
            }
          },
          datalabels: {
            anchor: 'center',
            align: 'center',
            color: 'white',                      // Main fill color
            font: {
              weight: 'bold',
              size: 12
            },
            textStrokeColor: 'black',            // Outline color
            textStrokeWidth: 1,                  // Outline thickness
            formatter: value => isCurrency 
              ? `$${value.toLocaleString()}` 
              : value.toLocaleString()
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: {
              callback: value => formatLabelName(labels[value])
            }
          },
          y: {
            beginAtZero: true
          }
        }
      },
      plugins: [ChartDataLabels]
    });
  }




  function renderJobsAndRevenueKPIs(data) {
    const container = document.getElementById("JobsAndRevenueKPIs");
    if (!container) return;
    container.innerHTML = "";

    const kpis = [
      {
        title: "Total Revenue Earned",
        value: ["", Object.values(data.revenue_by_job_type).reduce((sum, v) => sum + v, 0)],
        format: v => `$${v.toLocaleString()}`
      },
      {
        title: "Total Jobs Completed",
        value: ["", Object.values(data.job_type_counts).reduce((sum, v) => sum + v, 0)],
        format: v => v.toLocaleString()
      },
      {
        title: "Top Revenue/Hour Job Type",
        value: Object.entries(data.avg_revenue_per_hour_by_job_type)
          .filter(([jt]) => jt.toLowerCase() !== "delivery" && jt.toLowerCase() !== "pickup")
          .sort((a, b) => b[1] - a[1])[0],
        format: v => `$${v.toLocaleString()}/hr`
      }
    ];

    kpis.forEach(({ title, value: [label, val], format }) => {
        const card = document.createElement("div");
        card.className = "col-md-4 mb-3";
        card.innerHTML = `
          <div class="card shadow-sm">
            <div class="card-body">
              <h6 class="card-subtitle text-muted">${title}</h6>
              ${label ? `<h4 class="card-title">${label}</h4>\n<p class="card-text fw-bold">${format(val)}</p>` : `<h4 class="card-title">${format(val)}</h4>`}
            </div>
          </div>
        `;
        container.appendChild(card);
    });
  }


  function renderComboChart(ctx, labels, avgRevenue, avgHours) {
    return new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            type: 'bar',
            label: 'Avg Revenue ($)',
            data: avgRevenue,
            backgroundColor: '#59a14f',
            yAxisID: 'y',
            borderRadius: 5,
            order: 2,
          },
          {
            type: 'line',
            label: 'Avg On-Site Hours',
            data: avgHours,
            backgroundColor: '#ED2939',
            borderColor: '#ED2939',
            yAxisID: 'y1',
            tension: 0.3,
            fill: false,
            order: 1,
          }
        ]
      },
      options: {
        responsive: true,
        scales: {
          x: {
            ticks: {
              callback: function(value, index) {
                return formatLabelName(labels[index]);
              }
            }
          },
          y: {
            type: 'linear',
            position: 'left',
            beginAtZero: true,
            title: { display: true, text: 'Avg Revenue ($)' }
          },
          y1: {
            type: 'linear',
            position: 'right',
            beginAtZero: true,
            grid: { drawOnChartArea: false },
            title: { display: true, text: 'Avg On-Site Hours' }
          }
        }
      }
    });
  }

  function renderDeficiencyInsights(data) {
    // --- Funnel Chart (unchanged) ---
    const funnelValues = [
      data.deficiency_insights.total_deficiencies,
      data.deficiency_insights.quoted_deficiencies,
      data.deficiency_insights.quoted_with_job,
      data.deficiency_insights.quoted_with_completed_job
    ];
    const labels = [
      "Deficiencies Created",
      "Quoted",
      "Quoted → Job Created",
      "Quoted → Job Completed"
    ];
    const trace = {
      type: "funnel",
      y: labels,
      x: funnelValues,
      textinfo: "value+percent initial",
      textposition: "inside",
      marker: {
        color: ["#4e79a7", "#f28e2b", "#e15759", "#76b7b2"]
      }
    };
    const layout = {
      margin: { l: 180, r: 30, t: 20, b: 40 },
      height: 400,
      autosize: true
    };
    Plotly.newPlot("deficiencyFunnelChart", [trace], layout, {
      responsive: true,
      displayModeBar: false
    });

    // --- Time-to-Quote / Time-to-Job Cards (unchanged) ---
    document.getElementById("avgDefToQuote").textContent =
      data.time_to_quote_metrics.avg_days_deficiency_to_quote + " days";
    document.getElementById("avgQuoteToJob").textContent =
      data.time_to_quote_metrics.avg_days_quote_to_job + " days";

    // --- Deficiencies by Service Line (Stacked Bar) ---
    let svcData = data.deficiencies_by_service_line
      // make a copy and sort by “quoted_to_complete” descending
      .slice()
      .sort((a, b) => b.quoted_to_complete - a.quoted_to_complete);

    // then apply your Top-N if you had one (you didn’t specify here, so we take all):
    // svcData = svcData.slice(0, topCount);

    const serviceLines      = svcData.map(d => d.service_line);
    const noQuote           = svcData.map(d => d.no_quote);
    const quotedNoJob       = svcData.map(d => d.quoted_no_job);
    const quotedToJob       = svcData.map(d => d.quoted_to_job);
    const quotedToComplete  = svcData.map(d => d.quoted_to_complete);

    charts.deficienciesByServiceLineChart?.destroy();
    charts.deficienciesByServiceLineChart = new Chart(
      document.getElementById("deficienciesByServiceLineChart").getContext("2d"),
      {
        type: "bar",
        data: {
          labels: serviceLines,
          datasets: [
            { label: "No Quote",            data: noQuote,          backgroundColor: "#4e79a7" },
            { label: "Quoted, No Job",      data: quotedNoJob,      backgroundColor: "#f28e2b" },
            { label: "Quoted → Job Created", data: quotedToJob,      backgroundColor: "#e15759" },
            { label: "Job → Completed",      data: quotedToComplete, backgroundColor: "#76b7b2" }
          ]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { position: "top" },
            tooltip: { mode: "index", intersect: false }
          },
          scales: {
            x: { stacked: true },
            y: {
              stacked: true,
              beginAtZero: true,
              title: { display: true, text: "Number of Deficiencies" }
            }
          }
        }
      }
    );

    // --- Conversion Rate by Service Line (Sorted Vertical Bars with Inside Labels) ---
    const filteredSvc = svcData
      .filter(d => d.quoted_to_complete > 0)
      .sort((a, b) => {
        const totalA = a.no_quote + a.quoted_no_job + a.quoted_to_job;
        const rateA  = totalA ? (a.quoted_to_complete / totalA) * 100 : 0;
        const totalB = b.no_quote + b.quoted_no_job + b.quoted_to_job;
        const rateB  = totalB ? (b.quoted_to_complete / totalB) * 100 : 0;
        return rateB - rateA;
      });

    const convLabels = filteredSvc.map(d => d.service_line);
    const convRates  = filteredSvc.map(d => {
      const total = d.no_quote + d.quoted_no_job + d.quoted_to_job;
      return total ? (d.quoted_to_complete / total) * 100 : 0;
    });

    // destroy previous instance
    charts.serviceLineConversionRateChart?.destroy();

    charts.serviceLineConversionRateChart = new Chart(
      document.getElementById("serviceLineConversionRateChart").getContext("2d"), {
        type: "bar",
        data: {
          labels: convLabels,
          datasets: [{
            label: "Conversion Rate (%)",
            data: convRates,
            backgroundColor: "#59a14f",
            borderRadius: 4,
            datalabels: {
              color: "white",
              textStrokeColor: "black",
              textStrokeWidth: 2,
              anchor: "center",
              align: "center",
              formatter: v => v.toFixed(1) + "%"
            }
          }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: ctx => `Conversion: ${ctx.raw.toFixed(1)}%`
              }
            }
          },
          scales: {
            x: {
              title: { display: true, text: "Service Line" }
            },
            y: {
              beginAtZero: true,
              max: 100,
              title: { display: true, text: "Conversion Rate (%)" },
              ticks: { callback: val => val + "%" }
            }
          }
        },
        plugins: [ChartDataLabels]
      }
    );

  }




  function renderJobAndRevenue(data) {
    charts.jobTypeCountChart?.destroy();
    charts.revenueByJobTypeChart?.destroy();
    charts.avgRevenueByJobTypeChart?.destroy();
    charts.avgRevenuePerHourChart?.destroy();
    charts.revenueOverTimeChart?.destroy();

    const topN = document.getElementById('topNFilter')?.value || "5";
    const n = topN === "all" ? Infinity : parseInt(topN);

    function topJobTypes(metricObj) {
      return Object.entries(metricObj)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([jt]) => jt);
    }

    const topCount = topJobTypes(data.job_type_counts);
    const topRevenue = topJobTypes(data.revenue_by_job_type);
    const topAvgRevenue = topJobTypes(data.avg_revenue_by_job_type);
    const topAvgPerHour = Object.entries(data.avg_revenue_per_hour_by_job_type)
      .filter(([jt]) => jt.toLowerCase() !== "delivery" && jt.toLowerCase() !== "pickup")
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([jt]) => jt);

    const getFilteredCounts = (jobTypes, fullCounts) => {
      return Object.fromEntries(jobTypes.map(jt => [jt, fullCounts[jt] || 0]));
    };

    charts.jobTypeCountChart = createBarChart(
      document.getElementById('jobTypeCountChart').getContext('2d'),
      topCount,
      topCount.map(jt => data.job_type_counts[jt]),
      'Jobs Completed',
      '#4e79a7',
    );

    charts.revenueByJobTypeChart = createBarChart(
      document.getElementById('revenueByJobTypeChart').getContext('2d'),
      topRevenue,
      topRevenue.map(jt => data.revenue_by_job_type[jt]),
      'Total Revenue ($)',
      '#59a14f',
      false,
      getFilteredCounts(topRevenue, data.job_type_counts),
      true
    );

    charts.avgRevenueByJobTypeChart = createBarChart(
      document.getElementById('avgRevenueByJobTypeChart').getContext('2d'),
      topAvgRevenue,
      topAvgRevenue.map(jt => data.avg_revenue_by_job_type[jt]),
      'Avg Revenue ($)',
      '#59a14f',
      false,
      getFilteredCounts(topAvgRevenue, data.job_type_counts),
      true
    );

    charts.avgRevenuePerHourChart = createBarChart(
      document.getElementById('avgRevenuePerHourChart').getContext('2d'),
      topAvgPerHour,
      topAvgPerHour.map(jt => data.avg_revenue_per_hour_by_job_type[jt]),
      'Avg Revenue / Hour ($)',
      '#59a14f',
      false,
      getFilteredCounts(topAvgPerHour, data.job_type_counts),
      true
    );

    // ===== Revenue Over Time (Line Chart) =====
    const weeks = data.weekly_revenue_over_time.map(entry => entry.week_start);
    const revenues = data.weekly_revenue_over_time.map(entry => entry.revenue);

    charts.revenueOverTimeChart = new Chart(
      document.getElementById('revenueOverTimeChart').getContext('2d'),
      {
        type: 'line',
        data: {
          labels: weeks,
          datasets: [{
            label: 'Weekly Revenue',
            data: revenues,
            fill: false,
            borderColor: '#59a14f',
            backgroundColor: '#59a14f',
            tension: 0.3,
            pointRadius: 3,
            pointHoverRadius: 5
          }]
        },
        options: {
          responsive: true,
          plugins: {
            tooltip: {
              callbacks: {
                label: ctx => `$${ctx.raw.toLocaleString()}`
              }
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              title: { display: true, text: 'Revenue ($)' }
            },
           x: {
              title: { display: true, text: 'Month' },
              ticks: {
                autoSkip: true,
                maxTicksLimit: 12,
                callback: function(value, index, ticks) {
                  const dateStr = this.getLabelForValue(value);
                  const date = new Date(dateStr);
                  return date.toLocaleString('default', { month: 'short' });
                }
              }
            }
          }
        }
      }
    );
  }


  function renderTechnicianMetrics(data) {
    const charts = {};
    const revenueData = data.technician_metrics.revenue_per_hour;
    const jobCountData = data.technician_metrics.jobs_completed_by_tech;

    function renderTechCharts(topN = 5) {
      // Prep raw data
      let techs = Object.keys(revenueData).map(t => ({
        tech: t,
        revenue: revenueData[t],
        jobs: jobCountData[t] || 0
      }));

      // ===== Revenue per Hour Chart =====
      const sortedByRevenue = [...techs].sort((a, b) => b.revenue - a.revenue);
      const revenueSelected = topN === "all" ? sortedByRevenue : sortedByRevenue.slice(0, parseInt(topN));
      const revenueLabels = revenueSelected.map(t => t.tech);
      const revenueValues = revenueSelected.map(t => t.revenue);

      charts.revenuePerHour?.destroy();
      charts.revenuePerHour = new Chart(
        document.getElementById('revenuePerHourByTechChart').getContext('2d'),
        {
          type: 'bar',
          data: {
            labels: revenueLabels,
            datasets: [{
              label: "Revenue per Hour ($)",
              data: revenueValues,
              backgroundColor: '#4e79a7',
              borderRadius: 5
            }]
          },
          options: {
            responsive: true,
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: ctx => `$${ctx.raw.toFixed(2)}`
                }
              }
            },
            scales: {
              y: {
                beginAtZero: true,
                title: { display: true, text: 'Revenue per Hour ($)' }
              }
            }
          }
        }
      );

      // ===== Jobs Completed Chart =====
      const sortedByJobs = [...techs].sort((a, b) => b.jobs - a.jobs);
      const jobsSelected = topN === "all" ? sortedByJobs : sortedByJobs.slice(0, parseInt(topN));
      const jobsLabels = jobsSelected.map(t => t.tech);
      const jobsValues = jobsSelected.map(t => t.jobs);

      charts.jobsCompleted?.destroy();
      charts.jobsCompleted = new Chart(
        document.getElementById('jobsCompletedByTechChart').getContext('2d'),
        {
          type: 'bar',
          data: {
            labels: jobsLabels,
            datasets: [{
              label: "Jobs Completed",
              data: jobsValues,
              backgroundColor: '#f28e2b',
              borderRadius: 5
            }]
          },
          options: {
            responsive: true,
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: ctx => `${ctx.raw} jobs`
                }
              }
            },
            scales: {
              y: {
                beginAtZero: true,
                title: { display: true, text: 'Jobs Completed' }
              }
            }
          }
        }
      );
    }


    // Initial render
    renderTechCharts("5");

    // Top-N filter handler
    document.getElementById("techTopNFilter")?.addEventListener("change", (e) => {
      renderTechCharts(e.target.value);
    });
  }

 function renderCustomerAndLocationMetrics(data) {
    // stash the full datasets once
    const allLocations       = [...data.location_service_type_counts];
    const allCustomerRevenue = [...data.top_customer_revenue];

    // hook up Top-N filter
    const topNFilter = document.getElementById("locationTopNFilter");
    if (topNFilter && !topNFilter.dataset.bound) {
      topNFilter.addEventListener("change", () => render(topNFilter.value));
      topNFilter.dataset.bound = "true";
    }

    function render(topN = "5") {
      const topCount = topN === "all" ? Infinity : parseInt(topN, 10);

      // 🚨 Destroy any existing instances before drawing new ones
      charts.locationServiceTypeChart?.destroy();
      charts.topCustomerRevenueChart?.destroy();
      // removed deficiencyRevenueConversionChart entirely

      // --- stacked Service Calls chart ---
      const svc = [...allLocations]
        .sort((a, b) => b.total - a.total)
        .slice(0, topCount);
      const svcLabels    = svc.map(l => l.address);
      const svcEmergency = svc.map(l => l.emergency);
      const svcRegular   = svc.map(l => l.service);

      charts.locationServiceTypeChart = new Chart(
        document.getElementById("locationServiceTypeChart").getContext("2d"), {
          type: "bar",
          data: {
            labels: svcLabels,
            datasets: [
              { label: "Service Calls", data: svcRegular,   backgroundColor: "#4e79a7", stack: "calls" },
              { label: "Emergency Calls", data: svcEmergency, backgroundColor: "#e15759", stack: "calls" }
            ]
          },
          options: {
            responsive: true,
            plugins: {
              tooltip: { mode: "index", intersect: false },
              legend: { position: "top" }
            },
            scales: {
              x: { stacked: true },
              y: { stacked: true, beginAtZero: true, title: { display: true, text: "Number of Calls" } }
            }
          }
        }
      );

      // --- Top Customers by Revenue chart ---
      const topCust = [...allCustomerRevenue]
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, topCount);

      charts.topCustomerRevenueChart = new Chart(
        document.getElementById("topCustomerRevenueChart").getContext("2d"), {
          type: "bar",
          data: {
            labels: topCust.map(c => c.customer),
            datasets: [{
              label: "Revenue ($)",
              data: topCust.map(c => c.revenue),
              backgroundColor: "#f28e2b",
              borderRadius: 5
            }]
          },
          options: {
            indexAxis: "y",
            responsive: true,
            plugins: {
              tooltip: {
                callbacks: { label: ctx => `$${ctx.raw.toLocaleString()}` }
              },
              legend: { display: false }
            },
            scales: {
              x: { beginAtZero: true, title: { display: true, text: "Revenue ($)" } }
            }
          }
        }
      );
    }

    // initial draw
    render(topNFilter.value || "5");
  }









  function init() {
    document.addEventListener("DOMContentLoaded", () => {

      const topNControl = document.getElementById('topNFilter');
      if (topNControl) {
        topNControl.addEventListener('change', () => {
          fetch("/api/performance_summary_data")
            .then(res => res.json())
            .then(data => renderJobAndRevenue(data));
        });
      }

      fetch("/api/performance_summary_data")
        .then(res => res.json())
        .then(data => {
          renderJobsAndRevenueKPIs(data);
          renderJobAndRevenue(data);
          renderDeficiencyInsights(data);
          renderTechnicianMetrics(data);
          renderCustomerAndLocationMetrics(data);

          const avgRevenueEntries = Object.entries(data.avg_revenue_by_job_type);

          // Sort by descending average revenue
          avgRevenueEntries.sort((a, b) => b[1] - a[1]);

          // Extract the sorted labels and revenue
          const sortedLabels = avgRevenueEntries.map(([jt]) => jt);
          const sortedAvgRevenue = avgRevenueEntries.map(([, rev]) => rev);

          // Reorder the avgHours array to match the sorted labels
          const sortedAvgHours = sortedLabels.map(jt => {
            const totalHours = data.hours_by_job_type[jt] || 0;
            const jobCount = data.job_type_counts[jt] || 1;
            return totalHours / jobCount;
          });

          // Now call the renderComboChart with sorted data
          charts.combo = renderComboChart(
            document.getElementById('comboRevenueHoursChart').getContext('2d'),
            sortedLabels,
            sortedAvgRevenue,
            sortedAvgHours
          );
        });
    });
  }

  return { init };
})();

PerformanceSummary.init();
