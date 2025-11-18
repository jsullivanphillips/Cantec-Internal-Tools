// Performance Summary V4 with fixes and enhanced visualizations
const PerformanceSummary = (() => {
  let charts = {};
  let topNValue = 5; // default to Top 5
  let latestData = null;

  async function fetchAllSections(startDate, endDate) {
    const params = `?start_date=${startDate}&end_date=${endDate}`;

    const [
      jobsRevenue,
      deficiencies,
      technicians,
      quotes,
      customersLocations
    ] = await Promise.all([
      fetch(`/api/performance/jobs_revenue${params}`).then(r => r.json()),
      fetch(`/api/performance/deficiencies${params}`).then(r => r.json()),
      fetch(`/api/performance/technicians${params}`).then(r => r.json()),
      fetch(`/api/performance/quotes${params}`).then(r => r.json()),
      fetch(`/api/performance/customers_locations${params}`).then(r => r.json())
    ]);

    return {
      ...jobsRevenue,
      ...deficiencies,
      ...technicians,
      ...quotes,
      ...customersLocations
    };
  }


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
      const total_d = data.deficiency_insights.total_deficiencies;
      const p = data.deficiency_insights.percentages;

      // --- Funnel values ---
      const funnelValues = [
        total_d,
        data.deficiency_insights.quoted_deficiencies,
        data.deficiency_insights.quoted_with_job,
        data.deficiency_insights.quoted_with_completed_job
      ];

      // --- Labels will now show percentages beside each step ---
      const labels = [
        `Deficiencies Created (${total_d})`,
        `Quoted (${p.quoted_pct}% of total)`,
        `Job Created (${p.job_created_pct}% of total)`,
        `Job Completed (${p.job_completed_pct}% of total)`
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
        margin: { l: 220, r: 30, t: 20, b: 40 },
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



    // --- Quotes Sent / Accepted / Canceled / Rejected / Draft by User (Grouped Bar + Total Line + % in Tooltip) ---
    let quoteStats = data.quote_statistics_by_user || [];

    // parse emails "first.last@cantec.ca" → "F Last"
    const displayNames = quoteStats.map(({ user: email }) => {
      const [first, last] = email.split('@')[0].split('.');
      const initial = first.charAt(0).toUpperCase();
      const lastName = last
        ? last.charAt(0).toUpperCase() + last.slice(1)
        : '';
      return `${initial} ${lastName}`;
    });

    const submitted = quoteStats.map(d => d.submitted);
    const accepted  = quoteStats.map(d => d.accepted);
    const canceled  = quoteStats.map(d => d.canceled);
    const rejected  = quoteStats.map(d => d.rejected);
    const draft     = quoteStats.map(d => d.draft);

    // compute total per user
    const total = quoteStats.map(d =>
      d.submitted + d.accepted + d.canceled + d.rejected + d.draft
    );

    // Destroy existing instance if present
    charts.quoteStatisticsByUserChart?.destroy();
    charts.quoteStatisticsByUserChart = new Chart(
      document.getElementById("quoteStatisticsByUserChart").getContext("2d"),
      {
        data: {
          labels: displayNames,
          datasets: [
            { label: "Submitted", data: submitted, type: 'bar', backgroundColor: "#4e79a7" },
            { label: "Accepted",  data: accepted,  type: 'bar', backgroundColor: "#59a14f" },
            { label: "Canceled",  data: canceled,  type: 'bar', backgroundColor: "#e15759" },
            { label: "Rejected",  data: rejected,  type: 'bar', backgroundColor: "#f28e2b" },
            { label: "Draft",     data: draft,     type: 'bar', backgroundColor: "#bab0ac" },
            {
              label: "Total",
              data: total,
              type: 'line',
              yAxisID: 'y1',
              borderWidth: 2,
              fill: false,
              pointRadius: 4,
              borderColor: '#c6d6ec',
              backgroundColor: '#c6d6ec'
            }
          ]
        },
        options: {
          responsive: true,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { position: "top" },
            tooltip: {
              mode: 'index',
              intersect: false,
              callbacks: {
                label: function(context) {
                  const label = context.dataset.label || '';
                  const value = context.parsed.y;
                  const userTotal = total[context.dataIndex] || 0;
                  const pct = userTotal
                    ? Math.round((value / userTotal) * 100)
                    : 0;
                  return `${label}: ${value} (${pct}%)`;
                }
              }
            }
          },
          scales: {
            x: { stacked: false },
            y: {
              beginAtZero: true,
              title: { display: true, text: "Number of Quotes" }
            },
            y1: {
              position: 'right',
              beginAtZero: true,
              grid: { drawOnChartArea: false },
              title: { display: true, text: "Total Quotes" }
            }
          }
        }
      }
    );

    
    // // --- Quoting Accuracy by User (Grouped Bar Chart) ---
    // const quoteAccuracy = data.quote_accuracy_by_user || [];

    // const accNames = quoteAccuracy.map(({ user }) => {
    //   const [first, last] = user.split('@')[0].split('.');
    //   const initial = first.charAt(0).toUpperCase();
    //   const lastName = last
    //     ? last.charAt(0).toUpperCase() + last.slice(1)
    //     : '';
    //   return `${initial} ${lastName}`;
    // });

    // const laborAcc = quoteAccuracy.map(d =>
    //   d.labor_accuracy != null ? +(d.labor_accuracy * 100).toFixed(1) : null
    // );
    // const partsAcc = quoteAccuracy.map(d =>
    //   d.parts_accuracy != null ? +(d.parts_accuracy * 100).toFixed(1) : null
    // );

    // charts.quoteAccuracyByUser?.destroy();
    // charts.quoteAccuracyByUser = new Chart(
    //   document.getElementById("quoteAccuracyByUser").getContext("2d"),
    //   {
    //     type: "bar",
    //     data: {
    //       labels: accNames,
    //       datasets: [
    //         {
    //           label: "Labor Accuracy",
    //           data: laborAcc,
    //           backgroundColor: "#4e79a7"
    //         },
    //         {
    //           label: "Parts Accuracy",
    //           data: partsAcc,
    //           backgroundColor: "#f28e2b"
    //         }
    //       ]
    //     },
    //     options: {
    //       responsive: true,
    //       plugins: {
    //         legend: { position: "top" },
    //         tooltip: {
    //           callbacks: {
    //             label: function (ctx) {
    //               const value = ctx.raw;
    //               return `${ctx.dataset.label}: ${value}%`;
    //             }
    //           }
    //         }
    //       },
    //       scales: {
    //         y: {
    //           beginAtZero: true,
    //           max: 200,
    //           title: { display: true, text: "Accuracy (%)" }
    //         }
    //       },
    //       animation: false, // Important to make afterDraw consistent
    //       plugins: {
    //         customLine: {
    //           lineAt: 100
    //         }
    //       }
    //     },
    //     plugins: [
    //       {
    //         id: 'customLine',
    //         beforeDraw(chart) {
    //           const yValue = chart.options.plugins.customLine.lineAt;
    //           const yScale = chart.scales.y;
    //           const ctx = chart.ctx;
    //           const y = yScale.getPixelForValue(yValue);

    //           ctx.save();
    //           ctx.beginPath();
    //           ctx.moveTo(chart.chartArea.left, y);
    //           ctx.lineTo(chart.chartArea.right, y);
    //           ctx.lineWidth = 1;
    //           ctx.strokeStyle = "green";
    //           ctx.stroke();

    //           // Optional label
    //           ctx.fillStyle = "green";
    //           ctx.font = "12px sans-serif";
    //           ctx.fillText(`${yValue}%`, chart.chartArea.left + 4, y - 4);
    //           ctx.restore();
    //         }
    //       }
    //     ]
    //   }
    // );


    // // --- Quoting Cost Comparison by Job Type (Combined Bar + Line, from individual job margins) ---
    // const quoteCostData = data.quote_cost_comparison_by_job_type || [];

    // const costLabels = quoteCostData.map(({ job_type }) => job_type);

    // const avgMargin = quoteCostData.map(d => d.avg_margin);
    // const jobCounts = quoteCostData.map(d => d.job_count);

    // charts.quoteCostComparisonChart?.destroy();
    // charts.quoteCostComparisonChart = new Chart(
    //   document.getElementById("quoteCostComparisonChart").getContext("2d"),
    //   {
    //     type: "bar",
    //     data: {
    //       labels: costLabels,
    //       datasets: [
    //         {
    //           label: "Average Quote Margin (Quoted - Actual)",
    //           data: avgMargin,
    //           backgroundColor: avgMargin.map(v => v >= 0 ? "#59a14f" : "#e15759")
    //         }
    //       ]
    //     },
    //     options: {
    //       responsive: true,
    //       interaction: { mode: "index", intersect: false },
    //       plugins: {
    //         legend: { position: "top" },
    //         tooltip: {
    //           callbacks: {
    //             title: ctx => {
    //               const idx = ctx[0].dataIndex;
    //               return `${ctx[0].label} (Based on ${jobCounts[idx]} job${jobCounts[idx] === 1 ? '' : 's'})`;
    //             },
    //             label: ctx => `Avg Margin: $${ctx.raw.toFixed(2)}`
    //           }
    //         }
    //       },
    //       scales: {
    //         y: {
    //           beginAtZero: true,
    //           title: { display: true, text: "Avg Margin ($)" }
    //         }
    //       }
    //     }
    //   }
    // );



  }




  function renderJobAndRevenue(data) {
    charts.jobTypeCountChart?.destroy();
    charts.revenueByJobTypeChart?.destroy();
    charts.avgRevenueByJobTypeChart?.destroy();
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

    

    // ===== Revenue & Jobs Over Time (Combo Line Chart) =====
    const weeks         = data.weekly_revenue_over_time.map(e => e.week_start);
    const revenues      = data.weekly_revenue_over_time.map(e => e.revenue);
    const jobsCompleted = data.weekly_jobs_over_time.map(e => e.jobs_completed);
    const maxJobs       = Math.max(...jobsCompleted, 0);

    // destroy old chart
    charts.revenueOverTimeChart?.destroy();

    charts.revenueOverTimeChart = new Chart(
      document.getElementById('revenueOverTimeChart').getContext('2d'),
      {
        data: {
          labels: weeks,
          datasets: [
            {
              type: 'line',
              label: 'Weekly Revenue',
              data: revenues,
              yAxisID: 'y',
              borderColor: '#59a14f',
              backgroundColor: '#59a14f',
              tension: 0.3,
              fill: false,
              pointRadius: 3,
              pointHoverRadius: 5
            },
            {
              type: 'line',
              label: 'Jobs Completed',
              data: jobsCompleted,
              yAxisID: 'y1',
              borderColor: '#4e79a7',
              backgroundColor: '#4e79a7',
              tension: 0.3,
              fill: false,
              pointRadius: 3,
              pointHoverRadius: 5
            }
          ]
        },
        options: {
          responsive: true,
          plugins: {
            tooltip: {
              mode: 'index',
              intersect: false,
              callbacks: {
                label: ctx => {
                  if (ctx.dataset.label === 'Weekly Revenue') {
                    return `Revenue: $${ctx.raw.toLocaleString()}`;
                  } else {
                    return `Jobs: ${ctx.raw}`;
                  }
                }
              }
            },
            legend: { position: 'top' }
          },
          scales: {
            x: {
              title: { display: true, text: 'Week Starting' },
              ticks: {
                autoSkip: true,
                maxTicksLimit: 12,
                callback(value) {
                  const date = new Date(this.getLabelForValue(value));
                  return date.toLocaleString('default', { month: 'short', day: 'numeric' });
                }
              }
            },
            y: {
              type: 'linear',
              position: 'left',
              beginAtZero: true,
              title: { display: true, text: 'Revenue ($)' }
            },
            y1: {
              type: 'linear',
              position: 'right',
              display: true,
              beginAtZero: true,
              suggestedMax: maxJobs * 1.6,
              title: { display: true, text: 'Jobs Completed' },
              grid: { drawOnChartArea: false },
              ticks: {
                autoSkip: true,
                maxTicksLimit: 8
              }
            }
          }
        }
      }
    );


  }

  const techCharts = {};
  function renderTechnicianMetrics(data) {
    
    const revenueData = data.technician_metrics.revenue_per_hour;
    const jobCountData = data.technician_metrics.jobs_completed_by_tech;
    const onTimeStats = data.technician_ontime_stats || [];

    function renderTechCharts(topN = 5) {
      // Prep raw data
      let techs = Object.keys(revenueData).map(t => ({
        tech: t,
        revenue: revenueData[t],
        jobs: jobCountData[t] || 0
      }));


      // ===== Job Items added by Tech (Bar) =====
      techCharts.jobItemsAddedByTech?.destroy();

      const jiSimple = data.job_items_created_by_tech || { technicians: [], counts: [] };
      const allTechs = jiSimple.technicians || [];
      const allCounts = jiSimple.counts || [];

      // Optional Top-N (reuse global `topN` if you have it)
      let N_items = (typeof topN !== 'undefined' && topN !== "all") ? parseInt(topN, 10) : allTechs.length;
      if (Number.isNaN(N_items) || N_items < 1) N_items = allTechs.length;

      // Slice top-N (arrays are already sorted desc by backend)
      const labelsJI = allTechs.slice(0, N_items);
      const dataJI   = allCounts.slice(0, N_items);

      // Build chart
      const ctxJI = document.getElementById('jobItemsAddedByTechChart').getContext('2d');
      techCharts.jobItemsAddedByTech = new Chart(ctxJI, {
        type: 'bar',
        data: {
          labels: labelsJI,
          datasets: [
            {
              label: 'Job Items Added',
              data: dataJI,
              // use your existing theming or let Chart.js pick defaults
              borderWidth: 1
            }
          ]
        },
        options: {
          responsive: true,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: true, position: 'top' },
            tooltip: {
              callbacks: {
                title: items => {
                  const tech = items[0].label;
                  return tech;
                },
                label: it => `Job Items: ${it.raw}`
              }
            }
          },
          scales: {
            x: { title: { display: true, text: 'Technician' } },
            y: {
              beginAtZero: true,
              title: { display: true, text: 'Job Items Added' },
              ticks: { precision: 0 }
            }
          }
        }
      });
      

      // ===== Jobs Completed by Tech (Grouped Bar + Total Line) =====
      techCharts.jobsCompleted?.destroy();

      // 1️⃣ Grab the payload
      const jobsPayload   = data.technician_metrics.jobs_completed_by_tech_job_type;
      const techsJobs     = jobsPayload.technicians;   // [ "Alice", "Bob", … ]
      const jobTypes      = jobsPayload.job_types;     // [ "Repair", "Install", … ]
      const jobsEntries   = jobsPayload.entries;       // [ { technician, job_type, count }, … ]

      // 2️⃣ Pivot into lookupJobs[tech][jobType] = count
      const lookupJobs = {};
      techsJobs.forEach(t => { lookupJobs[t] = {}; });
      jobsEntries.forEach(({ technician, job_type, count }) => {
        lookupJobs[technician][job_type] = count;
      });

      // 3️⃣ Compute total jobs per tech and sort descending
      const totalsJobs = techsJobs
        .map(t => ({
          tech:  t,
          total: jobTypes.reduce((sum, jt) => sum + (lookupJobs[t][jt] || 0), 0)
        }))
        .sort((a, b) => b.total - a.total);

      // 4️⃣ Apply Top-N filter to technicians
      const N_jobs         = topN === "all" ? totalsJobs.length : parseInt(topN, 10);
      const selectedTechsJ = totalsJobs.slice(0, N_jobs).map(d => d.tech);

      // 5️⃣ Globally total up each jobType and pick top 8 + Other
      const jobTypeTotals = jobTypes.map(jt => ({
        jobType: jt,
        total: techsJobs.reduce((sum, tech) => sum + (lookupJobs[tech][jt] || 0), 0)
      }));
      jobTypeTotals.sort((a, b) => b.total - a.total);
      const topJobTypes   = jobTypeTotals.slice(0, 8).map(x => x.jobType);
      const otherJobTypes = jobTypes.filter(jt => !topJobTypes.includes(jt));
      const finalJobTypes = [...topJobTypes, 'Other'];

      // 6️⃣ Build one bar dataset per finalJobType (no stacking)
      const paletteJobs = [
        '#c6d6ec','#8eb0d6','#4e79a7','#2d527d',
        '#ffe0b3','#f7b366','#f28e2b','#b6651a',
        '#678dbd','#d1873d'
      ];
      const jobDatasets = finalJobTypes.map((jt, i) => {
        const data = selectedTechsJ.map(tech => {
          if (jt === 'Other') {
            return otherJobTypes.reduce((sum, other) => sum + (lookupJobs[tech][other] || 0), 0);
          }
          return lookupJobs[tech][jt] || 0;
        });
        return {
          label: formatLabelName(jt),
          data,
          type: 'bar',
          backgroundColor: paletteJobs[i % paletteJobs.length]
        };
      });

      // 7️⃣ Compute total jobs per selected tech for the overlay line
      const jobTotalsByTech = selectedTechsJ.map((_, idx) =>
        jobDatasets.reduce((sum, ds) => sum + ds.data[idx], 0)
      );
      const totalJobsDataset = {
        label: 'Total Jobs',
        data: jobTotalsByTech,
        type: 'line',
        yAxisID: 'y1',
        borderColor: '#add8e6',
        backgroundColor: '#add8e6',
        borderWidth: 2,
        fill: false,
        pointRadius: 4
      };

      // 8️⃣ Render the grouped-bar + line chart
      techCharts.jobsCompleted = new Chart(
        document.getElementById('jobsCompletedByTechChart').getContext('2d'),
        {
          type: 'bar',
          data: {
            labels: selectedTechsJ,
            datasets: [
              ...jobDatasets,
              totalJobsDataset
            ]
          },
          options: {
            responsive: true,
            interaction: { mode: 'index', intersect: false },
            plugins: {
              legend: { position: 'top' },
              tooltip: {
                mode: 'index',
                intersect: false,
                callbacks: {
                  title: items => {
                    const tech = items[0].label;
                    const total = jobTotalsByTech[items[0].dataIndex];
                    return `${tech} (Total Jobs: ${total})`;
                  },
                  label: it => `${it.dataset.label}: ${it.raw}`
                }
              }
            },
            scales: {
              x: { stacked: false, title: { display: true, text: 'Technician' } },
              y: {
                beginAtZero: true,
                title: { display: true, text: 'Jobs Completed' }
              },
              y1: {
                position: 'right',
                beginAtZero: true,
                grid: { drawOnChartArea: false },
                title: { display: true, text: 'Total Jobs' }
              }
            }
          }
        }
      );



      // ===== Deficiencies Created by Tech (Grouped Bar + Total Line) =====
      techCharts.deficienciesByTechSL?.destroy();

      // 1️⃣ Grab the payload
      const defsPayload   = data.deficiencies_by_tech_service_line;
      const techsDefs     = defsPayload.technicians;       // [ "Alice", … ]
      const rawLines      = defsPayload.service_lines;     // [ "Electrical", … ]
      const defsEntries   = defsPayload.entries;           // [ { technician, service_line, count }, … ]

      // 2️⃣ Pivot into lookupDefs[tech][line] = count
      const lookupDefs = {};
      techsDefs.forEach(t => { lookupDefs[t] = {}; });
      defsEntries.forEach(({ technician, service_line, count }) => {
        lookupDefs[technician][service_line] = count;
      });

      // 3️⃣ Compute and sort global line totals, pick top-6
      const lineTotals = rawLines
        .map(sl => ({
          line: sl,
          total: techsDefs.reduce((sum, t) => sum + (lookupDefs[t][sl] || 0), 0)
        }))
        .sort((a, b) => b.total - a.total);
      const topLines = lineTotals.slice(0, 6).map(x => x.line);

      // 4️⃣ Build “Other” set
      const otherLines = rawLines.filter(sl => !topLines.includes(sl));

      // 5️⃣ Final lines = topLines + Other
      const finalLines = [...topLines, 'Other'];

      // 6️⃣ Build datasets for deficiencies (for all techs)
      const paletteDefs = [
        '#c6d6ec','#8eb0d6','#4e79a7','#2d527d',
        '#ffe0b3','#f7b366','#f28e2b','#b6651a',
        '#678dbd','#d1873d'
      ];
      const defDatasets = finalLines.map((sl, idx) => {
        const data = techsDefs.map(tech => {
          if (sl === 'Other') {
            return otherLines.reduce(
              (sum, ol) => sum + (lookupDefs[tech][ol] || 0),
              0
            );
          }
          return lookupDefs[tech][sl] || 0;
        });
        return {
          label: sl,
          data,
          backgroundColor: paletteDefs[idx % paletteDefs.length]
        };
      });

      // 7️⃣ Compute total defs per tech and apply Top-N
      const totalsDefs = techsDefs
        .map(t => ({
          tech:  t,
          total: finalLines.reduce((sum, sl) => {
            const ds = defDatasets[finalLines.indexOf(sl)];
            return sum + ds.data[techsDefs.indexOf(t)];
          }, 0)
        }))
        .sort((a, b) => b.total - a.total);
      const N_defs = topN === "all" ? totalsDefs.length : parseInt(topN, 10);
      const selectedTechsD = totalsDefs.slice(0, N_defs).map(d => d.tech);

      // 8️⃣ Build bar datasets for selected techs
      const barDatasets = defDatasets.map(ds => ({
        label: ds.label,
        data: selectedTechsD.map(tech =>
          ds.data[techsDefs.indexOf(tech)]
        ),
        type: 'bar',
        backgroundColor: ds.backgroundColor
      }));

      // 9️⃣ Line dataset for total deficiencies
      const defTotalsByTech = selectedTechsD.map((tech, i) =>
        barDatasets.reduce((sum, ds) => sum + ds.data[i], 0)
      );
      const totalDefsDataset = {
        label: 'Total Defs',
        data: defTotalsByTech,
        type: 'line',
        yAxisID: 'y1',
        borderColor: '#add8e6',
        backgroundColor: '#add8e6',
        borderWidth: 2,
        fill: false,
        pointRadius: 4
      };

      // 10️⃣ Render the grouped-bar + line chart
      techCharts.deficienciesByTechSL = new Chart(
        document.getElementById('deficienciesCreatedByTechChart').getContext('2d'),
        {
          data: {
            labels: selectedTechsD,
            datasets: [
              ...barDatasets,
              totalDefsDataset
            ]
          },
          options: {
            responsive: true,
            interaction: { mode: 'index', intersect: false },
            plugins: {
              legend: { position: 'top' },
              tooltip: {
                mode: 'index',
                intersect: false,
                callbacks: {
                  title: items => {
                    const tech = items[0].label;
                    const total = defTotalsByTech[items[0].dataIndex];
                    return `${tech} (Total Defs: ${total})`;
                  },
                  label: it => `${it.dataset.label}: ${it.raw}`
                }
              }
            },
            scales: {
              x: { stacked: false, title: { display: true, text: 'Technician' } },
              y: {
                beginAtZero: true,
                title: { display: true, text: 'Deficiencies Created' }
              },
              y1: {
                position: 'right',
                beginAtZero: true,
                grid: { drawOnChartArea: false },
                title: { display: true, text: 'Total Deficiencies' }
              }
            }
          }
        }
      );



      // ===== Attachments Added to Deficiencies by Tech =====
      const attachments = data.attachments_by_tech || [];
      // sort descending by count
      const sortedAtt = [...attachments].sort((a, b) => b.count - a.count);
      // apply Top-N
      const N_att = topN === "all" ? sortedAtt.length : parseInt(topN, 10);
      const topAtt = sortedAtt.slice(0, N_att);

      const attLabels = topAtt.map(d => d.technician);
      const attValues = topAtt.map(d => d.count);

      techCharts.attachmentsAdded?.destroy();
      techCharts.attachmentsAdded = new Chart(
        document.getElementById('attachmentsAddedToDeficienciesByTechChart').getContext('2d'),
        {
          type: 'bar',
          data: {
            labels: attLabels,
            datasets: [{
              label: 'Attachments Added',
              data: attValues,
              backgroundColor: '#8eb0d6',
              borderRadius: 5
            }]
          },
          options: {
            indexAxis: 'y',
            responsive: true,
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: ctx => `${ctx.raw} attachments`
                }
              }
            },
            scales: {
              x: {
                beginAtZero: true,
                title: { display: true, text: 'Count of Attachments' }
              },
              y: {
                title: { display: true, text: 'Technician' }
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
  const topNFilter = document.getElementById("locationTopNFilter");

  if (topNFilter && !topNFilter.dataset.bound) {
    topNFilter.addEventListener("change", () => {
      if (latestData) render(latestData, topNFilter.value);
    });
    topNFilter.dataset.bound = "true";
  }

  function render(currentData, topN = "5") {
    const topCount = topN === "all" ? Infinity : parseInt(topN, 10);

    const allLocations = [...currentData.location_service_type_counts];
    const allCustomerRevenue = [...currentData.top_customer_revenue];

    charts.locationServiceTypeChart?.destroy();
    charts.topCustomerRevenueChart?.destroy();

    const svc = allLocations
      .sort((a, b) => b.total - a.total)
      .slice(0, topCount);

    charts.locationServiceTypeChart = new Chart(
      document.getElementById("locationServiceTypeChart").getContext("2d"),
      {
        type: "bar",
        data: {
          labels: svc.map(l => l.address),
          datasets: [
            {
              label: "Service Calls",
              data: svc.map(l => l.service),
              backgroundColor: "#4e79a7",
              stack: "calls"
            },
            {
              label: "Emergency Calls",
              data: svc.map(l => l.emergency),
              backgroundColor: "#e15759",
              stack: "calls"
            }
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
            y: {
              stacked: true,
              beginAtZero: true,
              title: { display: true, text: "Number of Calls" }
            }
          }
        }
      }
    );

    // Top customers chart
    const topCust = allCustomerRevenue
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, topCount);
   
    charts.topCustomerRevenueChart = new Chart(
      document.getElementById("topCustomerRevenueChart").getContext("2d"),
      {
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

  // 🔁 Initial draw
  render(data, topNFilter.value || "5");
}




  function renderQuoteCostBreakdownLog(response) {
    // normalize
    const buckets = Array.isArray(response)
      ? response
      : response.quote_cost_breakdown_log || [];
    if (!Array.isArray(buckets)) return console.error("Invalid data", response);

    const tabs  = document.getElementById('quoteCostTypeTabs');
    const panes = document.getElementById('quoteCostTypeTabsContent');
    tabs.innerHTML  = '';
    panes.innerHTML = '';

    buckets.forEach((bucket, idx) => {
      // use the user as the key
      const key    = bucket.user.replace(/\s+/g,'-').toLowerCase();
      const active = idx === 0;

      // --- create the pill tab ---
      const btn = document.createElement('button');
      btn.className = `nav-link${active ? ' active' : ''}`;
      btn.id           = `tab-${key}-btn`;
      btn.setAttribute('data-bs-toggle','pill');
      btn.setAttribute('data-bs-target',`#pane-${key}`);
      btn.type         = 'button';
      btn.role         = 'tab';
      btn.ariaControls = `pane-${key}`;
      btn.ariaSelected = active;
      // label with user and count
      btn.innerText    = `${bucket.user} (${bucket.job_count})`;

      const li = document.createElement('li');
      li.className = 'nav-item';
      li.role      = 'presentation';
      li.appendChild(btn);
      tabs.appendChild(li);

      // --- create the pane ---
      const pane = document.createElement('div');
      pane.className = `tab-pane fade${active ? ' show active' : ''}`;
      pane.id             = `pane-${key}`;
      pane.role           = 'tabpanel';
      pane.ariaLabelledby = `tab-${key}-btn`;

      // 1) chart canvas
      const canvas = document.createElement('canvas');
      canvas.id = `chart-${key}`;
      pane.appendChild(canvas);

      // 2) empty <pre> for log output
      const logPre = document.createElement('pre');
      logPre.id = `log-${key}`;
      logPre.style.whiteSpace = 'pre-wrap';
      logPre.style.display     = 'none';
      pane.appendChild(logPre);

      panes.appendChild(pane);

      // --- render the chart with onclick handler ---
      new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels: bucket.jobs.map(j => j.location_address || '(no address)'),
          datasets: [{
            label: 'Total Margin ($)',
            data: bucket.jobs.map(j => j.total_margin),
            backgroundColor: bucket.jobs.map(j =>
              j.total_margin >= 0 ? '#59a14f' : '#e15759'
            )
          }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: ctx => `Margin: $${ctx.raw.toFixed(2)}`
              }
            }
          },
          scales: {
            x: {
              title: { display: true, text: 'Location Address' }
            },
            y: {
              title: { display: true, text: 'Margin ($)' },
              beginAtZero: true
            }
          },
          onClick: (evt, elements) => {
            if (!elements.length) return;
            const i   = elements[0].index;
            const job = bucket.jobs[i];
            const url = `https://app.servicetrade.com/jobs/${job.job_id}`;

            // build HTML: a clickable link + the preformatted lines
            const lines = job.summary_lines || [];
            logPre.innerHTML = `<a href="${url}" target="_blank">View Job ${job.job_id}</a>\n`
                              + lines.join('\n');
            logPre.style.display = 'block';
          }
        }
      });
    });
  }






  function init() {
    document.addEventListener("DOMContentLoaded", () => {
      const topNControl = document.getElementById('topNFilter');
      const startInput = document.getElementById('startDate');
      const endInput = document.getElementById('endDate');
      const filterBtn = document.getElementById('applyDateFilter');
      updateLastUpdated();

      // 1️⃣ Set default range: previous Monday to last Monday
      const today = new Date();
      const dayOfWeek = today.getDay(); // Sunday=0, Monday=1, ..., Saturday=6

      // Calculate how many days since the *last* Monday
      const daysSinceLastMonday = (dayOfWeek + 6) % 7; // e.g. if Tuesday (2), then 1
      const lastMonday = new Date(today);
      lastMonday.setDate(today.getDate() - daysSinceLastMonday);

      // Get previous Monday (7 days before lastMonday)
      const prevMonday = new Date(lastMonday);
      prevMonday.setDate(lastMonday.getDate() - 7);

      // Format to YYYY-MM-DD
      const toISODate = date => date.toISOString().split("T")[0];
      const defaultStart = toISODate(prevMonday);
      const defaultEnd = toISODate(lastMonday);

      // Set inputs
      startInput.value = defaultStart;
      endInput.value = defaultEnd;

      async function fetchAndRenderWithDateRange(startDate, endDate) {
        document.getElementById("loadingMessage").style.display = "block";
        document.getElementById("reportContent").style.display = "none";

        const data = await fetchAllSections(startDate, endDate);
        latestData = data;

        document.getElementById("loadingMessage").style.display = "none";
        document.getElementById("reportContent").style.display = "block";

        // Re-render all sections
        renderJobsAndRevenueKPIs(data);
        renderJobAndRevenue(data);
        renderDeficiencyInsights(data);
        renderTechnicianMetrics(data);
        renderCustomerAndLocationMetrics(data);
        renderQuoteCostBreakdownLog(data);

        // Combo chart logic unchanged
        const avgRevenueEntries = Object.entries(data.avg_revenue_by_job_type)
          .sort((a, b) => b[1] - a[1]);

        const sortedLabels = avgRevenueEntries.map(([jt]) => jt);
        const sortedAvgRevenue = avgRevenueEntries.map(([, rev]) => rev);
        const sortedAvgHours = sortedLabels.map(jt => {
          const totalHours = data.hours_by_job_type[jt] || 0;
          const jobCount = data.job_type_counts[jt] || 1;
          return totalHours / jobCount;
      });

      if (charts.combo) charts.combo.destroy();

      charts.combo = renderComboChart(
        document.getElementById('comboRevenueHoursChart').getContext('2d'),
        sortedLabels,
        sortedAvgRevenue,
        sortedAvgHours
      );
    }

      


      if (topNControl) {
        topNControl.addEventListener('change', () => {
          const start = startInput?.value;
          const end = endInput?.value;
          fetchAndRenderWithDateRange(start, end);
        });
      }

      if (filterBtn) {
        filterBtn.addEventListener("click", () => {
          const start = startInput?.value;
          const end = endInput?.value;
          fetchAndRenderWithDateRange(start, end);
        });
      }

      // 2️⃣ Initial fetch with last week's range
      fetchAndRenderWithDateRange(defaultStart, defaultEnd);
      
    });

    function updateLastUpdated() {
      fetch("/api/last_updated")
        .then(res => res.json())
        .then(data => {
          const span = document.getElementById("lastUpdated");
          if (data.last_updated) {
            const date = new Date(data.last_updated);
            span.textContent = date.toLocaleDateString('en-CA', {
              year: 'numeric',
              month: 'short',
              day: 'numeric'
            });
          } else {
            span.textContent = "Unavailable";
          }
        });
      }
  }

  return { init };
})();

PerformanceSummary.init();
