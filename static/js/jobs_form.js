document.addEventListener('DOMContentLoaded', function() {
  const techRowsContainer = document.getElementById('techRowsContainer');
  const addTechRowButton = document.getElementById('addTechRowButton');
  const hiddenInputsContainer = document.getElementById('hiddenInputsContainer');
  const scheduleForm = document.getElementById('scheduleForm');

  // Nested array of tech types and their available technicians.
  const techData = [
    {
      type: "Senior Tech",
      technicians: ["Adam Bendorffe", "Craig Shepherd", "Jonathan Graves", "James Martyn"]
    },
    {
      type: "Mid-Level Tech",
      technicians: ["Alex Turko", "Austin Rasmussen", "Kyler Dickey", "Crosby Stewart", "Eric Turko"]
    },
    {
      type: "Junior Tech",
      technicians: ["Jonathan Palahicky", "Mariah Grier", "Seth Ealing"]
    },
    {
      type: "Trainee Tech",
      technicians: ["Liam Knowles", "Kevin Gao", "Hannah Feness", "James McNeil"]
    },
    {
      type: "Sprinkler Tech",
      technicians: ["Justin Walker", "Colin Peterson"]
    }
  ];

  let techRowCount = 0;

  /**
   * Creates a new tech row with:
   * - A numeric input for # of techs
   * - A nested multi-select dropdown for tech types and their technicians
   * - A "Day" section with hours input
   * - A remove-row button
   */
  function createTechRow() {
    // --- ROW CONTAINER ---
    const rowContainer = document.createElement('div');
    rowContainer.classList.add('row-container');

    // Grid-based wrapper for the row's columns
    const row = document.createElement('div');
    row.classList.add('tech-row');
    row.setAttribute('data-row-index', techRowCount);

    // Example 3-column grid
    row.style.display = 'grid';
    row.style.gridTemplateColumns = 'auto 1fr auto';
    row.style.alignItems = 'center';
    row.style.gap = '10px';
    row.style.width = '100%';

    // --- MAIN ROW (Left Column) ---
    const mainRow = document.createElement('div');
    mainRow.style.display = 'flex';
    mainRow.style.flexWrap = 'nowrap';
    mainRow.style.alignItems = 'center';
    mainRow.style.gap = '10px';
    mainRow.style.justifySelf = 'end'; // aligns right in the grid cell

    // Tech count input
    const techCountInput = document.createElement('input');
    techCountInput.type = 'number';
    techCountInput.name = 'tech_count[]';
    techCountInput.min = '1';
    techCountInput.step = '1';
    techCountInput.value = '1'; // default to 1
    techCountInput.placeholder = '# Techs';
    techCountInput.style.width = '60px';
    techCountInput.style.textAlign = 'center';

    // " x " text
    const timesSpan = document.createElement('span');
    timesSpan.textContent = " x ";

    // --- DROPDOWN CONTAINER ---
    const dropdownContainer = document.createElement('div');
    dropdownContainer.style.display = 'inline-block';
    dropdownContainer.style.position = 'relative';

    // Dropdown button with fixed width
    const dropdownButton = document.createElement('button');
    dropdownButton.type = 'button';
    dropdownButton.textContent = 'Select Tech Types';
    dropdownButton.classList.add('secondary-btn');
    dropdownButton.style.width = '260px';

    // Dropdown content container
    const dropdownContent = document.createElement('div');
    dropdownContent.classList.add('dropdown-content'); // for outside-click detection
    dropdownContent.style.display = 'none';
    dropdownContent.style.position = 'absolute';
    dropdownContent.style.backgroundColor = '#f9f9f9';
    dropdownContent.style.minWidth = '150px';
    dropdownContent.style.boxShadow = '0px 8px 16px rgba(0,0,0,0.2)';
    dropdownContent.style.padding = '5px';
    dropdownContent.style.zIndex = '100';

    // Populate the dropdown with nested checkboxes
    techData.forEach((group) => {
      // Container for each top-level type + sub-list
      const groupContainer = document.createElement('div');
      groupContainer.style.borderBottom = '1px solid #ddd';
      groupContainer.style.padding = '5px 0';

      // Main type label + checkbox
      const typeLabel = document.createElement('label');
      typeLabel.style.display = 'block';
      typeLabel.style.fontWeight = 'bold';
      const typeCheckbox = document.createElement('input');
      typeCheckbox.type = 'checkbox';
      typeCheckbox.name = 'tech_types_' + techRowCount + '[]';
      typeCheckbox.value = group.type;
      typeCheckbox.style.marginRight = '6px';

      // Toggle sub-tech checkboxes when main type is checked/unchecked
      typeCheckbox.addEventListener('change', function() {
        const subChecks = groupContainer.querySelectorAll('.sub-tech-checkbox');
        subChecks.forEach((sub) => {
          sub.checked = typeCheckbox.checked;
        });
        updateDropdownButtonText(dropdownButton, dropdownContent);
      });

      typeLabel.appendChild(typeCheckbox);
      typeLabel.appendChild(document.createTextNode(group.type));

      // Sub-list container
      const subList = document.createElement('div');
      subList.style.marginLeft = '20px';

      group.technicians.forEach((techName) => {
        // Each sub-tech is also a checkbox
        const subLabel = document.createElement('label');
        subLabel.style.display = 'block';
        subLabel.style.padding = '3px 0';

        const subCheckbox = document.createElement('input');
        subCheckbox.type = 'checkbox';
        // Stored as "Type:Technician" to know which group they belong to
        subCheckbox.value = group.type + ':' + techName;
        subCheckbox.name = 'tech_types_' + techRowCount + '[]';
        subCheckbox.classList.add('sub-tech-checkbox');
        subCheckbox.style.marginRight = '6px';

        // If a sub-tech is unchecked, uncheck the main type
        subCheckbox.addEventListener('change', function() {
          if (!subCheckbox.checked) {
            typeCheckbox.checked = false;
          }
          updateDropdownButtonText(dropdownButton, dropdownContent);
        });

        subLabel.appendChild(subCheckbox);
        // Display only the technician's name
        subLabel.appendChild(document.createTextNode(techName));
        subList.appendChild(subLabel);
      });

      groupContainer.appendChild(typeLabel);
      groupContainer.appendChild(subList);
      dropdownContent.appendChild(groupContainer);
    });

    // Toggle dropdown on button click
    dropdownButton.addEventListener('click', function(event) {
      event.stopPropagation();
      dropdownContent.style.display =
        (dropdownContent.style.display === 'block') ? 'none' : 'block';
    });

    dropdownContainer.appendChild(dropdownButton);
    dropdownContainer.appendChild(dropdownContent);

    // " for " text
    const forSpan = document.createElement('span');
    forSpan.textContent = " for ";

    // Append main row elements
    mainRow.appendChild(techCountInput);
    mainRow.appendChild(timesSpan);
    mainRow.appendChild(dropdownContainer);
    mainRow.appendChild(forSpan);

    // --- DAY SECTION (Middle Column) ---
    const daySection = document.createElement('div');
    daySection.style.display = 'block';
    daySection.style.marginTop = '10px';
    daySection.style.justifySelf = 'center';

    const dayContainer = document.createElement('div');
    dayContainer.classList.add('day-container');
    dayContainer.style.display = 'block';

    // Adds a single "Day" input row
    function addDayEntry() {
      const dayEntry = document.createElement('div');
      dayEntry.classList.add('day-entry');
      dayEntry.style.marginBottom = '5px';

      // Day label
      const dayLabel = document.createElement('span');
      dayLabel.classList.add('day-label');

      // "Day X: "
      const existingEntries = dayContainer.querySelectorAll('.day-entry');
      dayLabel.textContent = "Day " + (existingEntries.length + 1) + ": ";

      // Hours input
      const dayHoursInput = document.createElement('input');
      dayHoursInput.type = 'number';
      dayHoursInput.name = 'tech_day_hours_' + row.getAttribute('data-row-index') + '[]';
      dayHoursInput.min = '0';
      dayHoursInput.step = '0.5';
      dayHoursInput.placeholder = 'Hours';
      dayHoursInput.style.width = '60px';
      dayHoursInput.style.textAlign = 'center';

      const dayHoursSuffix = document.createElement('span');
      dayHoursSuffix.textContent = " hrs";
      dayHoursSuffix.style.color = "#555";

      // Remove day button
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

      removeDayButton.addEventListener('click', function() {
        dayContainer.removeChild(dayEntry);
        reindexDayEntries(row, row.getAttribute('data-row-index'));
      });

      const removeDayLabel = document.createElement('span');
      removeDayLabel.textContent = " remove day";
      removeDayLabel.style.color = '#cf4655';

      dayEntry.appendChild(dayLabel);
      dayEntry.appendChild(dayHoursInput);
      dayEntry.appendChild(dayHoursSuffix);
      dayEntry.appendChild(removeDayButton);
      dayEntry.appendChild(removeDayLabel);
      dayContainer.appendChild(dayEntry);
    }

    // Add one default day entry
    addDayEntry();

    // + Add Day button
    const addDayButton = document.createElement('button');
    addDayButton.type = 'button';
    addDayButton.textContent = '+ Add Day';
    addDayButton.classList.add('secondary-btn');
    addDayButton.style.marginTop = '5px';

    addDayButton.addEventListener('click', function() {
      addDayEntry();
    });

    const addDayWrapper = document.createElement('div');
    addDayWrapper.style.textAlign = 'center';
    addDayWrapper.style.marginTop = '5px';
    addDayWrapper.appendChild(addDayButton);

    daySection.appendChild(dayContainer);
    daySection.appendChild(addDayWrapper);

    // --- REMOVE ROW (Right Column) ---
    const removeRowContainer = document.createElement('div');
    removeRowContainer.style.display = 'flex';
    removeRowContainer.style.alignItems = 'center';
    removeRowContainer.style.justifyContent = 'start';
    removeRowContainer.style.alignSelf = 'center';

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

    removeRowContainer.appendChild(removeButton);
    removeRowContainer.appendChild(removeRowLabel);

    row.appendChild(mainRow);
    row.appendChild(daySection);
    row.appendChild(removeRowContainer);

    rowContainer.appendChild(row);
    techRowsContainer.appendChild(rowContainer);

    techRowCount++;
  }

  addTechRowButton.addEventListener('click', createTechRow);

  // Uncomment the following line if you want a default row on page load:
  // createTechRow();

  // --- WEEKDAY BUTTONS ---
  const weekdayButtons = document.querySelectorAll('.weekday-button');
  weekdayButtons.forEach(function(button) {
    button.addEventListener('click', function() {
      if (button.classList.contains('weekday-true')) {
        button.classList.remove('weekday-true');
        button.classList.add('weekday-false');
      } else {
        button.classList.remove('weekday-false');
        button.classList.add('weekday-true');
      }
    });
  });

  scheduleForm.addEventListener('submit', function() {
    hiddenInputsContainer.innerHTML = '';
    weekdayButtons.forEach(function(button) {
      if (button.classList.contains('weekday-true')) {
        const day = button.getAttribute('data-day');
        const hiddenInput = document.createElement('input');
        hiddenInput.type = 'hidden';
        hiddenInput.name = 'weekdays';
        hiddenInput.value = day;
        hiddenInputsContainer.appendChild(hiddenInput);
      }
    });
  });

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

  /**
   * Updates the dropdown button text.
   * For each group, if all sub-technicians are checked, it shows "GroupType s"
   * Otherwise, it lists individual technician names.
   */
  function updateDropdownButtonText(button, content) {
    let selected = [];
    Array.from(content.children).forEach(groupContainer => {
      const typeLabel = groupContainer.querySelector('label');
      const mainCheckbox = typeLabel.querySelector('input[type="checkbox"]');
      const groupType = mainCheckbox.value;
      const subList = groupContainer.querySelector('div');
      const subCheckboxes = subList.querySelectorAll('.sub-tech-checkbox');
      const totalSubs = subCheckboxes.length;
      let checkedSubs = [];
      subCheckboxes.forEach(sub => {
        if (sub.checked) {
          let subName = sub.value.split(':')[1];
          checkedSubs.push(subName);
        }
      });
      if (checkedSubs.length === totalSubs && totalSubs > 0) {
        // All technicians in this group are selected: display group label (pluralized)
        selected.push(groupType + "s");
      } else if (checkedSubs.length > 0) {
        selected = selected.concat(checkedSubs);
      }
    });
    button.textContent = selected.length > 0 ? selected.join(', ') : 'Select Tech Types';
  }

  /**
   * Reindexes day entries so the labels and input names remain consistent.
   */
  function reindexDayEntries(row, rowIndex) {
    const dayContainer = row.querySelector('.day-container');
    const dayEntries = dayContainer.querySelectorAll('.day-entry');
    dayEntries.forEach(function(entry, idx) {
      const label = entry.querySelector('.day-label');
      label.textContent = "Day " + (idx + 1) + ": ";
      const hoursInput = entry.querySelector('input[type="number"]');
      hoursInput.name = 'tech_day_hours_' + rowIndex + '[]';
    });
  }

  /**
   * Reindexes tech rows after one is removed.
   */
  function reindexTechRows() {
    const rows = techRowsContainer.querySelectorAll('.row-container');
    rows.forEach(function(container, index) {
      const row = container.querySelector('.tech-row');
      row.setAttribute('data-row-index', index);

      reindexDayEntries(row, index);

      const checkboxes = row.querySelectorAll('.dropdown-content input[type="checkbox"]');
      checkboxes.forEach(function(checkbox) {
        checkbox.name = 'tech_types_' + index + '[]';
      });

      const hoursInputs = row.querySelectorAll('input[name^="tech_day_hours_"]');
      hoursInputs.forEach(function(input) {
        input.name = 'tech_day_hours_' + index + '[]';
      });
    });
    techRowCount = rows.length;
  }
});
