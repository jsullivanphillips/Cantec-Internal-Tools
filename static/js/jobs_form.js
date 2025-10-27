let techData = [];

// Fetch technician data
async function loadTechnicians() {
  const response = await fetch('/api/technicians');
  techData = await response.json(); // { "Senior Tech": [{"id":1,"name":"Adam"}], ... }
  console.log("returned techData:", techData);
}

// === Technician Management Section ===
async function renderTechnicianManagement() {
  const container = document.getElementById('techManagementContainer');
  if (!container) return;
  container.innerHTML = ''; // clear old content

  const response = await fetch('/api/technicians');
  const groupedData = await response.json();

  Object.entries(groupedData).forEach(([type, techs]) => {
    const groupDiv = document.createElement('div');
    groupDiv.classList.add('tech-group');
    groupDiv.style.marginBottom = '25px';
    groupDiv.style.border = '1px solid #ddd';
    groupDiv.style.borderRadius = '8px';
    groupDiv.style.padding = '10px 15px';
    groupDiv.style.background = '#fafafa';

    const header = document.createElement('h3');
    header.textContent = type;
    header.style.marginBottom = '10px';
    header.style.color = '#444';
    header.style.fontSize = '1.1rem';
    groupDiv.appendChild(header);

    const list = document.createElement('ul');
    list.style.listStyle = 'none';
    list.style.padding = '0';

    techs.forEach((tech) => {
      const li = document.createElement('li');
      li.style.display = 'flex';
      li.style.alignItems = 'center';
      li.style.justifyContent = 'space-between';
      li.style.padding = '4px 0';

      const name = document.createElement('span');
      name.textContent = tech.name;
      name.style.flex = '1';

      const select = document.createElement('select');
      ["Senior Tech", "Mid-Level Tech", "Junior Tech", "Trainee Tech", "Sprinkler Tech", "Unassigned"].forEach(optVal => {
        const opt = document.createElement('option');
        opt.value = optVal;
        opt.textContent = optVal;
        if (optVal === type) opt.selected = true;
        select.appendChild(opt);
      });
      select.style.marginLeft = '10px';
      select.style.padding = '3px 5px';
      select.style.borderRadius = '4px';

      select.addEventListener('change', async () => {
        try {
          const response = await fetch(`/api/technicians/${tech.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: select.value })
          });
          const result = await response.json();
          console.log('Updated:', result);
          await renderTechnicianManagement(); // Refresh instantly
        } catch (err) {
          console.error('Failed to update tech type:', err);
        }
      });

      li.appendChild(name);
      li.appendChild(select);
      list.appendChild(li);
    });

    groupDiv.appendChild(list);
    container.appendChild(groupDiv);
  });
}

document.addEventListener('DOMContentLoaded', async function() {
  await loadTechnicians();
  renderTechnicianManagement();

  const techRowsContainer = document.getElementById('techRowsContainer');
  const addTechRowButton = document.getElementById('addTechRowButton');
  const hiddenInputsContainer = document.getElementById('hiddenInputsContainer');
  const scheduleForm = document.getElementById('scheduleForm');
  let techRowCount = 0;

  // === Scheduling Tech Row ===
  function createTechRow() {
    const rowContainer = document.createElement('div');
    rowContainer.classList.add('row-container');

    const row = document.createElement('div');
    row.classList.add('tech-row');
    row.setAttribute('data-row-index', techRowCount);
    row.style.display = 'grid';
    row.style.gridTemplateColumns = 'auto 1fr auto';
    row.style.alignItems = 'center';
    row.style.gap = '10px';
    row.style.width = '100%';

    // --- MAIN SECTION (left) ---
    const mainRow = document.createElement('div');
    mainRow.style.display = 'flex';
    mainRow.style.alignItems = 'center';
    mainRow.style.gap = '10px';

    const techCountInput = document.createElement('input');
    techCountInput.type = 'number';
    techCountInput.name = 'tech_count[]';
    techCountInput.min = '1';
    techCountInput.step = '1';
    techCountInput.value = '1';
    techCountInput.placeholder = '# Techs';
    techCountInput.style.width = '60px';
    techCountInput.style.textAlign = 'center';

    const timesSpan = document.createElement('span');
    timesSpan.textContent = " x ";

    // --- TECH DROPDOWN ---
    const dropdownContainer = document.createElement('div');
    dropdownContainer.style.display = 'inline-block';
    dropdownContainer.style.position = 'relative';

    const dropdownButton = document.createElement('button');
    dropdownButton.type = 'button';
    dropdownButton.textContent = 'Select Technicians';
    dropdownButton.classList.add('secondary-btn');
    dropdownButton.style.width = '300px'; // was 260px
    dropdownButton.style.maxWidth = '100%';


    const dropdownContent = document.createElement('div');
    dropdownContent.classList.add('dropdown-content');
    dropdownContent.style.display = 'none';
    dropdownContent.style.position = 'absolute';
    dropdownContent.style.backgroundColor = '#f9f9f9';
    dropdownContent.style.minWidth = '380px'; // match the button width
    dropdownContent.style.maxWidth = '500px';
    dropdownContent.style.boxShadow = '0px 8px 16px rgba(0,0,0,0.3)';
    dropdownContent.style.padding = '10px';
    dropdownContent.style.zIndex = '100';
    dropdownContent.style.maxHeight = '400px'; // taller view
    dropdownContent.style.overflowY = 'auto';
    dropdownContent.style.borderRadius = '6px';
    dropdownContent.style.border = '1px solid #ccc';

    const typeOrder = [
      "Senior Tech",
      "Mid-Level Tech",
      "Junior Tech",
      "Trainee Tech",
      "Sprinkler Tech",
      "Unassigned"
    ];

    // Render in the specified order (no extra Object.entries loop!)
    typeOrder.forEach(type => {
      if (!techData[type]) return; // skip missing categories
      const technicians = techData[type];

      const groupContainer = document.createElement('div');
      groupContainer.style.borderBottom = '1px solid #ddd';
      groupContainer.style.padding = '5px 0';

      // === Group Header with Select-All checkbox ===
      const headerDiv = document.createElement('div');
      headerDiv.style.display = 'flex';
      headerDiv.style.alignItems = 'center';
      headerDiv.style.justifyContent = 'space-between';
      headerDiv.style.fontWeight = 'bold';
      headerDiv.style.marginBottom = '4px';

      const typeLabel = document.createElement('span');
      typeLabel.textContent = type;

      const selectAllLabel = document.createElement('label');
      selectAllLabel.style.fontWeight = 'normal';
      selectAllLabel.style.fontSize = '0.9rem';
      selectAllLabel.style.cursor = 'pointer';
      selectAllLabel.style.color = '#007bff';

      const selectAllCheckbox = document.createElement('input');
      selectAllCheckbox.type = 'checkbox';
      selectAllCheckbox.style.marginRight = '5px';
      selectAllLabel.appendChild(selectAllCheckbox);
      selectAllLabel.appendChild(document.createTextNode('Select All'));

      headerDiv.appendChild(typeLabel);
      headerDiv.appendChild(selectAllLabel);
      groupContainer.appendChild(headerDiv);

      // === Individual Techs List ===
      const subList = document.createElement('div');
      subList.style.marginLeft = '15px';

      technicians.forEach((tech) => {
        const label = document.createElement('label');
        label.style.display = 'block';
        label.style.padding = '2px 0';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.name = `techs_row_${techRowCount}[]`;
        checkbox.value = tech.id;
        checkbox.dataset.techName = tech.name;
        checkbox.dataset.type = type;          // 👈 add this line
        checkbox.style.marginRight = '5px';

        checkbox.addEventListener('change', () => {
          const allChecked = Array.from(subList.querySelectorAll('input[type="checkbox"]'))
            .every(cb => cb.checked);
          selectAllCheckbox.checked = allChecked;
          updateDropdownButtonText(dropdownButton, dropdownContent);
        });

        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(tech.name));
        subList.appendChild(label);
      });

      groupContainer.appendChild(subList);
      dropdownContent.appendChild(groupContainer);

      // === Select All behavior ===
      selectAllCheckbox.addEventListener('change', () => {
        const allBoxes = subList.querySelectorAll('input[type="checkbox"]');
        allBoxes.forEach(cb => cb.checked = selectAllCheckbox.checked);
        updateDropdownButtonText(dropdownButton, dropdownContent);
      });
    });


    dropdownButton.addEventListener('click', function(event) {
      event.stopPropagation();
      dropdownContent.style.display =
        (dropdownContent.style.display === 'block') ? 'none' : 'block';
    });

    dropdownContainer.appendChild(dropdownButton);
    dropdownContainer.appendChild(dropdownContent);

    function updateDropdownButtonText(button, content) {
      const checked = Array.from(content.querySelectorAll('input[type="checkbox"]:checked'));
      if (checked.length === 0) {
        button.textContent = 'Select Technicians';
        return;
      }

      // Build a map of selected names by type
      const selectedByType = {};
      for (const chk of checked) {
        const t = chk.dataset.type || 'Unassigned';
        if (!selectedByType[t]) selectedByType[t] = [];
        selectedByType[t].push(chk.dataset.techName);
      }

      // Order + plural labels
      const typeOrder = [
        "Senior Tech",
        "Mid-Level Tech",
        "Junior Tech",
        "Trainee Tech",
        "Sprinkler Tech",
        "Unassigned"
      ];

      const pluralLabel = (type) => {
        // Tweak pluralization however you like:
        // return type + "s";
        // or nicer:
        if (type === "Mid-Level Tech") return "Mid-Level Techs";
        if (type === "Senior Tech") return "Senior Techs";
        if (type === "Junior Tech") return "Junior Techs";
        if (type === "Trainee Tech") return "Trainee Techs";
        if (type === "Sprinkler Tech") return "Sprinkler Techs";
        if (type === "Unassigned") return "Unassigned";
        return type + "s";
      };

      const pieces = [];

      // Build the display list in the specified order
      for (const type of typeOrder) {
        if (!techData[type]) continue; // not rendered / no techs of this type in data
        const allNamesInType = techData[type].map(t => t.name);
        const selectedNamesInType = selectedByType[type] || [];

        if (selectedNamesInType.length === allNamesInType.length && allNamesInType.length > 0) {
          // All selected -> push the group label only
          pieces.push(pluralLabel(type));
        } else if (selectedNamesInType.length > 0) {
          // Partial -> list the actual names (keep original selection order)
          pieces.push(...selectedNamesInType);
        }
      }

      button.textContent = pieces.length ? pieces.join(', ') : 'Select Technicians';
    }



    const forSpan = document.createElement('span');
    forSpan.textContent = " for ";

    mainRow.appendChild(techCountInput);
    mainRow.appendChild(timesSpan);
    mainRow.appendChild(dropdownContainer);
    mainRow.appendChild(forSpan);

    // --- DAY / HOURS SECTION (middle) ---
    const daySection = document.createElement('div');
    daySection.style.display = 'block';
    daySection.style.marginTop = '10px';
    daySection.style.justifySelf = 'center';

    const dayContainer = document.createElement('div');
    dayContainer.classList.add('day-container');
    dayContainer.style.display = 'block';

    function addDayEntry() {
      const dayEntry = document.createElement('div');
      dayEntry.classList.add('day-entry');
      dayEntry.style.marginBottom = '5px';

      const dayLabel = document.createElement('span');
      dayLabel.classList.add('day-label');
      const existing = dayContainer.querySelectorAll('.day-entry').length;
      dayLabel.textContent = "Day " + (existing + 1) + ": ";

      const hoursInput = document.createElement('input');
      hoursInput.type = 'number';
      hoursInput.name = `tech_day_hours_${techRowCount}[]`;
      hoursInput.min = '0';
      hoursInput.step = '0.5';
      hoursInput.placeholder = 'Hours';
      hoursInput.style.width = '60px';
      hoursInput.style.textAlign = 'center';

      const hrsSpan = document.createElement('span');
      hrsSpan.textContent = " hrs ";
      hrsSpan.style.color = "#555";

      const removeDayButton = document.createElement('button');
      removeDayButton.type = 'button';
      removeDayButton.textContent = 'x';
      removeDayButton.style.marginLeft = '5px';
      removeDayButton.style.color = 'red';
      removeDayButton.style.background = 'transparent';
      removeDayButton.style.border = 'none';
      removeDayButton.style.fontWeight = 'bold';
      removeDayButton.style.padding = '2px 6px';
      removeDayButton.style.webkitTextStroke = '1px darkred';
      removeDayButton.addEventListener('click', () => {
        dayContainer.removeChild(dayEntry);
        reindexDayEntries(row, techRowCount);
      });

      const removeDayLabel = document.createElement('span');
      removeDayLabel.textContent = " remove day";
      removeDayLabel.style.color = '#cf4655';

      dayEntry.append(dayLabel, hoursInput, hrsSpan, removeDayButton, removeDayLabel);
      dayContainer.appendChild(dayEntry);
    }

    // Default first day
    addDayEntry();

    const addDayButton = document.createElement('button');
    addDayButton.type = 'button';
    addDayButton.textContent = '+ Add Day';
    addDayButton.classList.add('secondary-btn');
    addDayButton.style.marginTop = '5px';
    addDayButton.addEventListener('click', addDayEntry);

    const addDayWrapper = document.createElement('div');
    addDayWrapper.style.textAlign = 'center';
    addDayWrapper.style.marginTop = '5px';
    addDayWrapper.appendChild(addDayButton);

    daySection.appendChild(dayContainer);
    daySection.appendChild(addDayWrapper);

    // --- REMOVE ROW BUTTON (right) ---
    const removeRowContainer = document.createElement('div');
    removeRowContainer.style.display = 'flex';
    removeRowContainer.style.alignItems = 'center';
    removeRowContainer.style.justifyContent = 'start';

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.textContent = 'x';
    removeButton.style.color = 'red';
    removeButton.style.background = 'transparent';
    removeButton.style.border = 'none';
    removeButton.style.fontWeight = 'bold';
    removeButton.style.padding = '2px 6px';
    removeButton.style.webkitTextStroke = '1px darkred';
    removeButton.addEventListener('click', function() {
      techRowsContainer.removeChild(rowContainer);
      reindexTechRows();
    });

    const removeRowLabel = document.createElement('span');
    removeRowLabel.textContent = " remove row";
    removeRowLabel.style.color = '#cf4655';

    removeRowContainer.append(removeButton, removeRowLabel);

    row.append(mainRow, daySection, removeRowContainer);
    rowContainer.appendChild(row);
    techRowsContainer.appendChild(rowContainer);

    techRowCount++;
  }

  addTechRowButton.addEventListener('click', createTechRow);

  // --- Reindex helpers ---
  function reindexDayEntries(row, rowIndex) {
    const entries = row.querySelectorAll('.day-entry');
    entries.forEach((entry, i) => {
      entry.querySelector('.day-label').textContent = `Day ${i + 1}: `;
      entry.querySelector('input[type="number"]').name = `tech_day_hours_${rowIndex}[]`;
    });
  }

  function reindexTechRows() {
    const rows = techRowsContainer.querySelectorAll('.row-container');
    rows.forEach((container, i) => {
      const row = container.querySelector('.tech-row');
      row.setAttribute('data-row-index', i);
      reindexDayEntries(row, i);
    });
    techRowCount = rows.length;
  }

  // Close dropdowns when clicking elsewhere
  document.addEventListener('click', function(event) {
    const allDropdowns = document.querySelectorAll('.dropdown-content');
    allDropdowns.forEach(function(dropdown) {
      if (dropdown.style.display === 'block') {
        const button = dropdown.previousElementSibling;
        if (!dropdown.contains(event.target) && !button.contains(event.target)) {
          dropdown.style.display = 'none';
        }
      }
    });
  });
});
