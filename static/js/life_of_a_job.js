let timeline = null; // Global reference to clear old timeline

document.addEventListener("DOMContentLoaded", function () {
    const form = document.getElementById("jobForm");
    const errorMessage = document.getElementById("errorMessage");
    const intervalsAlert = document.getElementById("jobIntervals");
    const legendContainer = document.getElementById("timelineLegend");
    const visualizationContainer = document.getElementById("visualization");

    // Mapping from event label to color with updated labels
    const eventColors = {
        "Time to Schedule": "rgba(54, 162, 235, 0.6)",    
        "How Far Out Booking Was": "rgba(75, 192, 192, 0.6)",
        "Technician Time Spent": "rgba(255, 205, 86, 0.6)",
        "Time to Process": "rgba(255, 159, 64, 0.6)",
        "Time to Invoice": "rgba(153, 102, 255, 0.6)",
        "Time Spent in Pink Folder": "rgba(255, 105, 180, 0.6)"
    };

    // Generate work week options for the past year.
    function generateWorkWeekOptions() {
        const weekSelect = document.getElementById("weekSelect");
        weekSelect.innerHTML = "";
        const options = [];
        const now = new Date();
        
        // Determine the current week Monday.
        // In JavaScript, Sunday = 0, Monday = 1, ... Saturday = 6.
        const day = now.getDay(); 
        let mondayThisWeek = new Date(now);
        // Compute Monday of this week:
        mondayThisWeek.setDate(now.getDate() - ((day + 6) % 7)); 
        // Friday of this week:
        let fridayThisWeek = new Date(mondayThisWeek);
        fridayThisWeek.setDate(mondayThisWeek.getDate() + 4);
        
        // Check if the current week is complete.
        // Consider complete if now > Friday 5:00pm of this week.
        const friday5pm = new Date(fridayThisWeek);
        friday5pm.setHours(17, 0, 0, 0);
        let lastCompletedMonday;
        if (now > friday5pm) {
            lastCompletedMonday = mondayThisWeek;
        } else {
            // Otherwise, use the previous week.
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
            const value = currentMonday.toISOString().slice(0, 10);
            
            options.push({ value, text: displayText });
            
            // Move to previous week.
            currentMonday.setDate(currentMonday.getDate() - 7);
        }
        
        // Reverse so most recent weeks appear first.
        options.reverse();
        
        // Populate the select element.
        for (let opt of options) {
            const optionEl = document.createElement("option");
            optionEl.value = opt.value;
            optionEl.textContent = opt.text;
            weekSelect.appendChild(optionEl);
        }
    }

    // Existing Job Timeline form event listener
    form.addEventListener("submit", function (e) {
        e.preventDefault();
        // Clear previous timeline and messages.
        errorMessage.textContent = "";
        intervalsAlert.style.display = "none";
        intervalsAlert.innerHTML = "";
        legendContainer.innerHTML = "";
        if (timeline) {
            timeline.destroy();
            timeline = null;
        }

        const jobUrl = document.getElementById("jobUrl").value.trim();
        if (!jobUrl) {
            errorMessage.textContent = "Please enter a valid job URL.";
            return;
        }

        // Show loading spinner.
        errorMessage.innerHTML = `
          <div class="spinner-border text-primary" role="status">
            <span class="visually-hidden">Loading...</span>
          </div>
          Fetching job data...
        `;

        // Fetch job data.
        fetch("/life-of-a-job", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobUrl: jobUrl })
        })
        .then(response => response.json())
        .then(data => {
            errorMessage.textContent = "";
            if (data.error) {
                errorMessage.textContent = data.error;
                return;
            }
            if (data.intervals && data.job_data) {
                buildIntervalsOutput(data.intervals, data.job_data);
            }
            renderTimeline(data.job_data);
            buildLegend();
        })
        .catch(error => {
            console.error("Error fetching job data:", error);
            errorMessage.textContent = "Error loading data.";
        });
    });

    function buildIntervalsOutput(intervals, jobData) {
        function formatDate(dateStr) {
            const d = new Date(dateStr);
            const options = { month: 'long', day: 'numeric' };
            const day = d.getDate();
            return d.toLocaleDateString('en-US', options).replace(day, day + getOrdinal(day));
        }
        function getOrdinal(n) {
            const s = ["th", "st", "nd", "rd"],
                  v = n % 100;
            return s[(v - 20) % 10] || s[v] || s[0];
        }

        const intervalsMapping = [
            {
                label: "Time to Schedule",
                days: intervals.created_to_scheduled,
                start: jobData.date_created,
                end: jobData.date_released
            },
            {
                label: "How Far Out Booking Was",
                days: intervals.scheduled_to_appointment,
                start: jobData.date_released,
                end: jobData.tech_time_start
            },
            {
                label: "Technician Time Spent",
                days: intervals.tech_time,
                start: jobData.tech_time_start,
                end: jobData.tech_time_end
            },
            {
                label: "Time to Process",
                days: intervals.completed_to_processed,
                start: jobData.tech_time_end,
                end: jobData.processing_complete
            },
            {
                label: "Time to Invoice",
                days: intervals.processed_to_invoiced,
                start: jobData.processing_complete,
                end: jobData.date_invoiced
            }
        ];
        if (jobData.pink_folder_start && jobData.pink_folder_end) {
            intervalsMapping.push({
                label: "Time Spent in Pink Folder",
                days: intervals.pink_folder,
                start: jobData.pink_folder_start,
                end: jobData.pink_folder_end
            });
        }

        const intervalsHTML = intervalsMapping.map(intv => {
            if (intv.start && intv.end) {
                const color = eventColors[intv.label] || "rgba(100, 100, 100, 0.6)";
                const days = intv.days || 0;
                const startStr = formatDate(intv.start);
                const endStr = formatDate(intv.end);
                return `
                  <span class="badge me-2" style="background-color: ${color}; color: #fff;">
                    ${intv.label}
                  </span> 
                  ${days} days. ${startStr} - ${endStr}
                `;
            }
            return "";
        });

        intervalsAlert.innerHTML = intervalsHTML.join("<strong> | </strong>");
        intervalsAlert.style.display = "block";
    }

    function buildLegend() {
        let html = "<strong>Color Legend:</strong><br>";
        html += "<ul style='list-style: none; padding-left: 0; display: flex; flex-wrap: wrap; gap: 15px;'>";
        for (const [label, color] of Object.entries(eventColors)) {
            html += `
                <li style="display: flex; align-items: center;">
                    <span class="legend-color" style="background-color: ${color};"></span>
                    ${label}
                </li>
            `;
        }
        html += "</ul>";
        legendContainer.innerHTML = html;
    }

    function renderTimeline(jobData) {
        if (!jobData) {
            console.warn("No job_data returned from backend");
            return;
        }

        const groups = [];
        let groupId = 1;
        const items = [];

        function diffInDays(startDate, endDate) {
            const msInDay = 24 * 60 * 60 * 1000;
            return Math.ceil((endDate - startDate) / msInDay);
        }

        function addEventGroup(label, start, end) {
            if (!start || !end) return;
            const startDate = new Date(start);
            const endDate = new Date(end);
            if (isNaN(startDate) || isNaN(endDate)) return;

            groups.push({ id: groupId, content: label });
            const daysCount = diffInDays(startDate, endDate);
            const daysLabel = daysCount === 1 ? "1 Day" : `${daysCount} Days`;

            items.push({
                id: groupId,
                group: groupId,
                start: startDate,
                end: endDate,
                content: daysLabel,
                style: `background-color: ${eventColors[label] || "rgba(100,100,100,0.6)"};`,
                title: `${label}: ${formatTooltipDate(start)} - ${formatTooltipDate(end)}`
            });
            groupId++;
        }

        function formatTooltipDate(dateStr) {
            const d = new Date(dateStr);
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        }

        addEventGroup("Time to Schedule", jobData.date_created, jobData.date_released);
        addEventGroup("How Far Out Booking Was", jobData.date_released, jobData.tech_time_start);
        addEventGroup("Technician Time Spent", jobData.tech_time_start, jobData.tech_time_end);
        addEventGroup("Time to Process", jobData.tech_time_end, jobData.processing_complete);
        addEventGroup("Time to Invoice", jobData.processing_complete, jobData.date_invoiced);
        if (jobData.pink_folder_start && jobData.pink_folder_end) {
            addEventGroup("Time Spent in Pink Folder", jobData.pink_folder_start, jobData.pink_folder_end);
        }

        if (!items.length) {
            console.warn("No valid timeline items.");
            return;
        }

        let minStart = items[0].start;
        let maxEnd = items[0].end;
        items.forEach(item => {
            if (item.start < minStart) minStart = item.start;
            if (item.end > maxEnd) maxEnd = item.end;
        });

        const oneDay = 24 * 60 * 60 * 1000;
        minStart = new Date(minStart.getTime() - oneDay);
        maxEnd = new Date(maxEnd.getTime() + oneDay);

        if (timeline) {
            timeline.destroy();
        }
        timeline = new vis.Timeline(
            visualizationContainer,
            new vis.DataSet(items),
            new vis.DataSet(groups),
            {
                stack: false,
                moveable: false,
                zoomable: false,
                autoResize: true,
                start: minStart,
                end: maxEnd,
                format: {
                    minorLabels: {
                        hour: 'ha',
                        day: 'MMM d'
                    },
                    majorLabels: {
                        hour: 'ha',
                        day: 'MMM d, yyyy'
                    }
                }
            }
        );
    }

    // --- New Section: Average Life of a Job ---
    // Global variables for pagination of work weeks:
    let weekOptions = [];
    let currentPage = 0;
    const itemsPerPage = 5;

    // Function to generate work week options for the past year.
    function generateWorkWeekOptions() {
        const weekSelect = document.getElementById("weekSelect");
        weekOptions = []; // Clear previous options
        const now = new Date();
        
        // Determine Monday of the current week.
        const day = now.getDay(); // Sunday = 0, Monday = 1, etc.
        let mondayThisWeek = new Date(now);
        // Calculate Monday: if today is Sunday, treat it as last week's Monday.
        mondayThisWeek.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
        
        // Determine Friday of this week.
        let fridayThisWeek = new Date(mondayThisWeek);
        fridayThisWeek.setDate(mondayThisWeek.getDate() + 4);
        
        // Only include current week if it's fully complete (i.e. after Friday 5:00pm)
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
            let currentFriday = new Date(currentMonday);
            currentFriday.setDate(currentMonday.getDate() + 4);
            
            // Format display text: e.g., "Mar 10 - Mar 14, 2025"
            const optionsFormat = { month: 'short', day: 'numeric' };
            const mondayStr = currentMonday.toLocaleDateString('en-US', optionsFormat);
            const fridayStr = currentFriday.toLocaleDateString('en-US', optionsFormat);
            const year = currentMonday.getFullYear();
            const displayText = `${mondayStr} - ${fridayStr}, ${year}`;
            const value = currentMonday.toISOString().slice(0, 10);
            
            // Push the option; most recent week first.
            weekOptions.push({ value, text: displayText });
            
            // Move to previous week.
            currentMonday.setDate(currentMonday.getDate() - 7);
        }
        
        // weekOptions is already sorted with most recent week first.
        currentPage = 0;
        renderWeekOptions();
    }

    // Function to render current page of week options.
    function renderWeekOptions() {
        const weekSelect = document.getElementById("weekSelect");
        weekSelect.innerHTML = "";
        
        const startIdx = currentPage * itemsPerPage;
        const endIdx = startIdx + itemsPerPage;
        const currentOptions = weekOptions.slice(startIdx, endIdx);
        
        currentOptions.forEach(opt => {
            const optionEl = document.createElement("option");
            optionEl.value = opt.value;
            optionEl.textContent = opt.text;
            weekSelect.appendChild(optionEl);
        });
        
        // Update Prev/Next buttons disabled states.
        document.getElementById("weekPrev").disabled = currentPage === 0;
        document.getElementById("weekNext").disabled = (currentPage + 1) * itemsPerPage >= weekOptions.length;
    }

    // Attach event listeners for pagination buttons.
    document.getElementById("weekPrev").addEventListener("click", function() {
        if (currentPage > 0) {
            currentPage--;
            renderWeekOptions();
        }
    });
    document.getElementById("weekNext").addEventListener("click", function() {
        if ((currentPage + 1) * itemsPerPage < weekOptions.length) {
            currentPage++;
            renderWeekOptions();
        }
    });

    generateWorkWeekOptions();

    if (averageJobForm) {
        averageJobForm.addEventListener("submit", function(e) {
            e.preventDefault();
            averageJobOutput.style.display = "none";
            averageJobOutput.innerHTML = "";
            // Clear job stats as well.
            document.getElementById("jobStats").textContent = "";
    
            const jobType = document.getElementById("jobType").value;
            const weekStart = document.getElementById("weekSelect").value;
    
            // Show a loading spinner.
            averageJobOutput.innerHTML = `
                <div class="spinner-border text-primary" role="status">
                  <span class="visually-hidden">Loading...</span>
                </div>
                Fetching average life data...
            `;
            averageJobOutput.style.display = "block";
    
            fetch("/average-life-of-a-job", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({ jobType: jobType, weekStart: weekStart })
            })
            .then(resp => resp.json())
            .then(data => {
                // Check for no jobs case.
                if (!data.intervals || Object.keys(data.intervals).length === 0) {
                    averageJobOutput.innerHTML = "<p>No jobs in selected time period.</p>";
                    return;
                }
                // Display the job stats above the timeline.
                const statsEl = document.getElementById("jobStats");
                // Assume backend returns "total_jobs" and "pink_folder_jobs" keys.
                statsEl.innerHTML = `
                  <p>Total Jobs: ${data.total_jobs}</p>
                  <p>Jobs with Pink Folder: ${data.pink_folder_jobs}</p>
                `;
    
                // Render the timeline using the returned intervals.
                renderAverageTimeline(data.intervals);
            })
            .catch(error => {
                averageJobOutput.innerHTML = "Error fetching average job data.";
                console.error("Error:", error);
            });
        });
    }
    
    
    
    function renderAverageTimeline(averageIntervals) {
        // Mapping from backend keys to display labels.
        const mapping = {
          "created_to_scheduled": "Time to Schedule",
          "scheduled_to_appointment": "How Far Out Booking Was",
          "tech_time": "Technician Time Spent",
          "completed_to_processed": "Time to Process",
          "processed_to_invoiced": "Time to Invoice",
          "pink_folder": "Time Spent in Pink Folder"
        };
      
        // We'll create a separate group and item for each event type.
        const groups = [];
        const items = [];
        let groupId = 1;
      
        // Use an arbitrary base date. (It doesn't matter what date we choose since we're only interested in durations.)
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
            // Create an item (block) that displays the duration inside.
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
      
        // Determine overall end date: the maximum end among items.
        let overallEnd = baseDate;
        items.forEach(item => {
          if (item.end > overallEnd) overallEnd = item.end;
        });
      
        const options = {
          stack: false,      // Each group is on its own row.
          moveable: false,
          zoomable: false,
          start: baseDate,
          end: overallEnd,
          format: {
            minorLabels: { day: 'D' },
            majorLabels: { day: 'MMM D, YYYY' }
          }
        };
      
        // Replace the content of the averageJobOutput container with a timeline container.
        const output = document.getElementById("averageJobOutput");
        output.innerHTML = '<div id="averageTimeline" style="min-height:300px;"></div>';
        output.style.display = "block";
      
        // Create the timeline using vis.js.
        const avgTimeline = new vis.Timeline(
          document.getElementById("averageTimeline"),
          new vis.DataSet(items),
          new vis.DataSet(groups),
          options
        );
      }
      
      
});
