// Performance Summary V4 with fixes and enhanced visualizations
const PerformanceSummary = (() => {
  let charts = {};
  let topNValue = 5; // default to Top 5

  function createBarChart(ctx, labels, data, label, color, horizontal = false, jobCounts = null) {
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
                const value = typeof ctx.parsed === 'object' ? 
                  (ctx.chart.options.indexAxis === 'y' ? ctx.parsed.x : ctx.parsed.y) : 
                  ctx.parsed;

                const labelName = ctx.label;
                const jobs = jobCounts?.[labelName];

                if (jobCounts && jobs !== undefined) {
                  return `${labelName}: $${value.toLocaleString()} (from ${jobs} jobs)`;
                } else {
                  return `${labelName}: ${value.toLocaleString()}`;
                }
              }
            }
          }
        },
        scales: {
          y: { beginAtZero: true },
          x: { beginAtZero: true }
        }
      }
    });
  }


  function renderKPIs(data) {
    const container = document.getElementById("summaryKPIs");
    if (!container) return;
    container.innerHTML = "";

    const kpis = [
      {
        title: "Top Revenue Job Type",
        value: Object.entries(data.revenue_by_job_type).sort((a,b)=>b[1]-a[1])[0],
        format: v => `$${v.toLocaleString()}`
      },
      {
        title: "Most Jobs Completed",
        value: Object.entries(data.job_type_counts).sort((a,b)=>b[1]-a[1])[0],
        format: v => v.toLocaleString()
      },
      {
        title: "Top Revenue/Hour Job Type",
        value: Object.entries(data.avg_revenue_per_hour_by_job_type)
          .filter(([jt]) => jt.toLowerCase() !== "delivery")
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
            <h4 class="card-title">${label}</h4>
            <p class="card-text fw-bold">${format(val)}</p>
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
            backgroundColor: '#e15759',
            yAxisID: 'y',
            borderRadius: 5,
            order: 2,
          },
          {
            type: 'line',
            label: 'Avg On-Site Hours',
            data: avgHours,
            backgroundColor: '#4e79a7',
            borderColor: '#4e79a7',
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

  function renderBubbleChart(ctx, dataByType) {
    const entries = Object.entries(dataByType);
    const bubbles = entries.map(([jt, data]) => ({
      x: data.avg_revenue,
      y: data.total_revenue,
      r: Math.max(8, Math.sqrt(data.count) * 3),
      label: jt
    }));

    return new Chart(ctx, {
      type: 'bubble',
      data: {
        datasets: [{
          label: 'Job Type Efficiency (Bubble size = Job Count)',
          data: bubbles,
          backgroundColor: '#76b7b2',
          parsing: false
        }]
      },
      options: {
        responsive: true,
        plugins: {
          tooltip: {
            callbacks: {
              label: ctx => `${ctx.raw.label}: $${ctx.raw.x.toFixed(0)} avg, $${ctx.raw.y.toFixed(0)} total, ${Math.round((ctx.raw.r / 3) ** 2)} jobs`
            }
          },
          title: {
            display: true,
            text: 'Each bubble represents a job type. Size = number of jobs. More efficient = top-right.'
          }
        },
        scales: {
          x: { title: { display: true, text: 'Avg Revenue per Job' }, beginAtZero: true },
          y: { title: { display: true, text: 'Total Revenue' }, beginAtZero: true }
        }
      }
    });
  }

  function renderAllCharts(data) {
    charts.jobTypeCountChart?.destroy();
    charts.revenueByJobTypeChart?.destroy();
    charts.avgRevenueByJobTypeChart?.destroy();
    charts.avgRevenuePerHourChart?.destroy();

    const topN = document.getElementById('topNFilter')?.value || "5";
    const n = topN === "all" ? Infinity : parseInt(topN);

    // Helper to get top N sorted keys for a metric
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
      .filter(([jt]) => jt !== "delivery") // exclude delivery
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([jt]) => jt);

    const getFilteredCounts = (jobTypes, fullCounts) => {
      return Object.fromEntries(jobTypes.map(jt => [jt, fullCounts[jt] || 0]));
    };

    charts.jobTypeCountChart = createBarChart(
      document.getElementById('jobTypeCountChart').getContext('2d'),
      topCount,
      topCount.map(jt => data.job_type_counts[jt]),
      'Jobs Completed',
      '#4e79a7'
    );

    charts.revenueByJobTypeChart = createBarChart(
      document.getElementById('revenueByJobTypeChart').getContext('2d'),
      topRevenue,
      topRevenue.map(jt => data.revenue_by_job_type[jt]),
      'Total Revenue ($)',
      '#f28e2b',
      false,
      getFilteredCounts(topRevenue, data.job_type_counts)
    );

    charts.avgRevenueByJobTypeChart = createBarChart(
      document.getElementById('avgRevenueByJobTypeChart').getContext('2d'),
      topAvgRevenue,
      topAvgRevenue.map(jt => data.avg_revenue_by_job_type[jt]),
      'Avg Revenue ($)',
      '#e15759',
      false,
      getFilteredCounts(topAvgRevenue, data.job_type_counts)
    );

    charts.avgRevenuePerHourChart = createBarChart(
      document.getElementById('avgRevenuePerHourChart').getContext('2d'),
      topAvgPerHour,
      topAvgPerHour.map(jt => data.avg_revenue_per_hour_by_job_type[jt]),
      'Avg Revenue / Hour ($)',
      '#59a14f',
      false,
      getFilteredCounts(topAvgPerHour, data.job_type_counts)
    );
  }

  function init() {
    document.addEventListener("DOMContentLoaded", () => {
      const topNControl = document.getElementById('topNFilter');
      if (topNControl) {
        topNControl.addEventListener('change', () => {
          fetch("/api/performance_summary_data")
            .then(res => res.json())
            .then(data => renderAllCharts(data));
        });
      }

      fetch("/api/performance_summary_data")
        .then(res => res.json())
        .then(data => {
          renderKPIs(data);
          renderAllCharts(data);

          const bubbleData = Object.keys(data.job_type_counts).reduce((acc, jt) => {
            acc[jt] = {
              count: data.job_type_counts[jt] || 0,
              total_revenue: data.revenue_by_job_type[jt] || 0,
              avg_revenue: data.avg_revenue_by_job_type[jt] || 0,
            };
            return acc;
          }, {});

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

          charts.bubble = renderBubbleChart(
            document.getElementById('bubbleJobEfficiencyChart').getContext('2d'),
            bubbleData
          );
        });
    });
  }

  return { init };
})();

PerformanceSummary.init();
