const LimboJobTracker = (() => {
  let jobData = [];
  const itemsPerPage = 10;
  let currentPage = 1;

  function renderCards(page) {
    const container = document.getElementById("jobCardsContainer");
    container.innerHTML = "";

    const sortOrder = document.getElementById("sortSelect")?.value || "newest";
    const sortedData = [...jobData].sort((a, b) => {
        const dateA = a.most_recent_appt === "Not Scheduled" ? 0 : new Date(a.most_recent_appt).getTime();
        const dateB = b.most_recent_appt === "Not Scheduled" ? 0 : new Date(b.most_recent_appt).getTime();
        return sortOrder === "newest" ? dateB - dateA : dateA - dateB;
    });

    const start = (page - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    const jobsToDisplay = sortedData.slice(start, end);

    // Update "showing X–Y of Z" display
    const jobCountDisplay = document.getElementById("jobCountDisplay");
    const total = jobData.length;
    const from = total === 0 ? 0 : start + 1;
    const to = Math.min(end, total);
    jobCountDisplay.textContent = `Showing jobs ${from}–${to} of ${total}`;

    jobsToDisplay.forEach(job => {
        const formattedType = job.type
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());

        let formattedAppt = job.most_recent_appt;
        if (formattedAppt !== "Not Scheduled") {
        const dt = new Date(formattedAppt);
        const options = { year: 'numeric', month: 'long', day: 'numeric' };
        formattedAppt = dt.toLocaleDateString(undefined, options);
        }

        const card = document.createElement("div");
        card.className = "col-12 col-md-6 col-lg-4";
        card.innerHTML = `
        <div class="card shadow-sm h-100">
            <div class="card-body">
            <h5 class="card-title">${job.address}</h5>
            <p class="card-text"><strong>Type:</strong> ${formattedType}</p>
            <p class="card-text"><strong>Most Recent Appointment:</strong> ${formattedAppt}</p>
            <a href="${job.job_link}" target="_blank" class="btn btn-primary">View Job</a>
            </div>
        </div>`;
        container.appendChild(card);
    });
    }


    
    function showLoadingPlaceholders(count = itemsPerPage) {
        const container = document.getElementById("jobCardsContainer");
        const pagination = document.getElementById("paginationControls");
        container.innerHTML = "";
        pagination.innerHTML = "";

        for (let i = 0; i < count; i++) {
            const placeholder = document.createElement("div");
            placeholder.className = "col-12 col-md-6 col-lg-4";
            placeholder.innerHTML = `
            <div class="shimmer-card mb-4"></div>
            `;
            container.appendChild(placeholder);
        }
    }



  function renderPaginationControls() {
    const pagination = document.getElementById("paginationControls");
    pagination.innerHTML = "";

    const totalPages = Math.ceil(jobData.length / itemsPerPage);

    for (let i = 1; i <= totalPages; i++) {
      const li = document.createElement("li");
      li.className = `page-item ${i === currentPage ? "active" : ""}`;
      li.innerHTML = `<a class="page-link" href="#">${i}</a>`;
      li.addEventListener("click", (e) => {
        e.preventDefault();
        currentPage = i;
        renderCards(currentPage);
        renderPaginationControls();
      });
      pagination.appendChild(li);
    }
  }

  

  function loadLimboJobs() {
  showLoadingPlaceholders();

  fetch("/limbo_job_tracker/job_list", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  })
    .then(r => r.json())
    .then(data => {
      jobData = data;
      currentPage = 1;
      renderCards(currentPage);
      renderPaginationControls();
    })
    .catch(console.error);
}


  function init() {
    document.addEventListener("DOMContentLoaded", () => {
        
        document.getElementById("sortSelect").addEventListener("change", () => {
            renderCards(currentPage);
        });

        loadLimboJobs();
    });
  }

  return { init };
})();
LimboJobTracker.init();
