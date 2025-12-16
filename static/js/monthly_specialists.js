let allRoutes = [];

document.addEventListener("DOMContentLoaded", () => {
  fetchMonthlySpecialists();

  document.getElementById("route-search").addEventListener("input", (e) => {
    const query = e.target.value.toLowerCase();
    const filtered = allRoutes.filter(route =>
      route.location_name.toLowerCase().includes(query)
    );
    renderRouteCards(filtered);
  });
});

function fetchMonthlySpecialists() {
  fetch("/api/monthly_specialists")
    .then(res => res.json())
    .then(data => {
      allRoutes = data.routes;
      renderRouteCards(allRoutes);
    })
    .catch(err => console.error(err));
}


function renderRouteCards(routes) {
  const container = document.getElementById("route-cards-container");
  container.innerHTML = "";

  routes.forEach((route) => {
    const cardCol = document.createElement("div");
    cardCol.className = "col-xl-3 col-lg-4 col-md-6 mb-4";

    cardCol.innerHTML = `
      <div class="card h-100 shadow-sm">
        <div class="card-body d-flex flex-column">

          <h5 class="card-title mb-1">${escapeHtml(route.location_name)}</h5>

          <div class="text-muted small mb-2">
            ${route.completed_jobs_count} completed jobs
          </div>

          <ul class="list-group list-group-flush mb-3">
            ${renderTechnicians(route.top_technicians)}
          </ul>

          <div class="mt-auto text-muted small">
            Updated ${formatDate(route.last_updated_at)}
          </div>

        </div>
      </div>
    `;

    container.appendChild(cardCol);
  });
}

function renderTechnicians(techs) {
  if (!techs || techs.length === 0) {
    return `<li class="list-group-item text-muted">No technicians found</li>`;
  }

  return techs
    .map((tech) => {
      const badgeClass = getTechBadgeClass(tech.jobs);
      return `
        <li class="list-group-item d-flex justify-content-between align-items-center">
          <span>${escapeHtml(tech.tech_name)}</span>
          <span class="badge ${badgeClass}">
            ${tech.jobs}
          </span>
        </li>
      `;
    })
    .join("");
}

function getTechBadgeClass(jobCount) {
  if (jobCount >= 15) return "bg-warning text-dark";   // Gold
  if (jobCount > 10) return "badge-silver text-dark";
  if (jobCount > 5) return "bg-orange";               // Bronze (custom)
  return "bg-light text-muted";                       // Grey
}

function formatDate(isoString) {
  if (!isoString) return "Unknown";
  const date = new Date(isoString);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
