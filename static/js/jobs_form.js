document.addEventListener('DOMContentLoaded', function() {
    const techRowsContainer = document.getElementById('techRowsContainer');
    const addTechRowButton = document.getElementById('addTechRowButton');
    const hiddenInputsContainer = document.getElementById('hiddenInputsContainer');
    
    // Define the available tech types.
    const techTypes = [
      "Senior Tech",
      "Mid-Level Tech",
      "Junior Tech",
      "Trainee Tech",
      "Sprinkler Tech"
    ];
    
    let techRowCount = 0;
    
    // Function to create a new tech row.
    function createTechRow() {
      // Create a container for the entire tech row.
      const rowContainer = document.createElement('div');
      rowContainer.classList.add('row-container');
      // You can style rowContainer in your CSS with .row-container { ... }
  
      // The grid row that holds main row, day section, and remove row.
      const row = document.createElement('div');
      row.classList.add('tech-row');
      row.setAttribute('data-row-index', techRowCount);
      // Example grid layout (3 columns)
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
      mainRow.style.justifySelf = 'end'; // right align in the grid cell
  
      // Tech count input
      const techCountInput = document.createElement('input');
      techCountInput.type = 'number';
      techCountInput.name = 'tech_count[]';
      techCountInput.min = '1';
      techCountInput.placeholder = '# Techs';
      techCountInput.style.width = '60px';
      techCountInput.style.textAlign = 'center';
  
      // " x " text
      const timesSpan = document.createElement('span');
      timesSpan.textContent = " x ";
  
      // Dropdown container
      const dropdownContainer = document.createElement('div');
      dropdownContainer.classList.add('dropdown');
      dropdownContainer.style.display = 'inline-block';
      dropdownContainer.style.position = 'relative';
  
      // Dropdown button
      const dropdownButton = document.createElement('button');
      dropdownButton.type = 'button';
      dropdownButton.classList.add('dropdown-button');
      dropdownButton.textContent = 'Select Tech Types';
  
      // Dropdown content container
      const dropdownContent = document.createElement('div');
      dropdownContent.classList.add('dropdown-content');
      dropdownContent.style.display = 'none';
      dropdownContent.style.position = 'absolute';
      dropdownContent.style.backgroundColor = '#f9f9f9';
      dropdownContent.style.minWidth = '200px';
      dropdownContent.style.boxShadow = '0px 8px 16px rgba(0,0,0,0.2)';
      dropdownContent.style.padding = '5px';
      dropdownContent.style.zIndex = '100';
  
      // Populate the dropdown content with checkboxes
      techTypes.forEach(function(type) {
        const label = document.createElement('label');
        label.style.display = 'block';
        label.style.padding = '3px 5px';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        // Use techRowCount so each row has unique name for these checkboxes
        checkbox.name = 'tech_types_' + techRowCount + '[]';
        checkbox.value = type;
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(' ' + type));
        dropdownContent.appendChild(label);
      });
  
      // Toggle dropdown display on button click
      dropdownButton.addEventListener('click', function(event) {
        event.stopPropagation(); // prevent the global click from closing it immediately
        dropdownContent.style.display = (dropdownContent.style.display === 'block') ? 'none' : 'block';
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
      dayContainer.style.display = 'block'; // stack day entries vertically
  
      function addDayEntry() {
        const dayEntry = document.createElement('div');
        dayEntry.classList.add('day-entry');
        dayEntry.style.marginBottom = '5px';
  
        // Day label
        const dayLabel = document.createElement('span');
        dayLabel.classList.add('day-label');
        dayLabel.textContent = "Day " + (dayContainer.querySelectorAll('.day-entry').length + 1) + ": ";
  
        // Hours input
        const dayHoursInput = document.createElement('input');
        dayHoursInput.type = 'number';
        dayHoursInput.name = 'tech_day_hours_' + row.getAttribute('data-row-index') + '[]';
        dayHoursInput.min = '0';
        dayHoursInput.step = '0.5';
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
        removeDayLabel.style.color = '#cf4655'; // updated color
  
        dayEntry.appendChild(dayLabel);
        dayEntry.appendChild(dayHoursInput);
        dayEntry.appendChild(dayHoursSuffix);
        dayEntry.appendChild(removeDayButton);
        dayEntry.appendChild(removeDayLabel);
        dayContainer.appendChild(dayEntry);
      }
  
      // One default day entry
      addDayEntry();
  
      // Add Day button
      const addDayButton = document.createElement('button');
      addDayButton.type = 'button';
      addDayButton.textContent = '+ Add Day';
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
      removeRowLabel.style.color = '#cf4655'; // updated color
  
      removeRowContainer.appendChild(removeButton);
      removeRowContainer.appendChild(removeRowLabel);
  
      // Append columns to row
      row.appendChild(mainRow);      // Left column
      row.appendChild(daySection);   // Middle column
      row.appendChild(removeRowContainer); // Right column
  
      // Put the row in the row container
      rowContainer.classList.add('row-container');
      rowContainer.appendChild(row);
      techRowsContainer.appendChild(rowContainer);
  
      techRowCount++;
    }
  
    // Add Tech Row button
    addTechRowButton.addEventListener('click', createTechRow);
  
    // If you want a default row on page load, uncomment:
    // createTechRow();
  
    // Weekday toggle
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
  
    // Before form submission, gather weekday states
    document.getElementById('scheduleForm').addEventListener('submit', function(event) {
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
  
    // Close any open dropdown when clicking elsewhere on the page
    document.addEventListener('click', function(event) {
      // For each dropdown content
      const allDropdowns = document.querySelectorAll('.dropdown-content');
      allDropdowns.forEach(function(dropdown) {
        // If the dropdown is open
        if (dropdown.style.display === 'block') {
          // Check if the click is outside the dropdown and its button
          // The button is the sibling or parent of dropdown => parentNode or previousSibling
          const button = dropdown.previousElementSibling; // The .dropdown-button
          if (!dropdown.contains(event.target) && !button.contains(event.target)) {
            dropdown.style.display = 'none';
          }
        }
      });
    });
  
    // Utility function to update the dropdown button text
    function updateDropdownButtonText(button, content) {
      const checkboxes = content.querySelectorAll('input[type="checkbox"]');
      const selected = [];
      checkboxes.forEach(function(checkbox) {
        if (checkbox.checked) {
          selected.push(checkbox.value);
        }
      });
      button.textContent = selected.length > 0 ? selected.join(', ') : 'Select Tech Types';
    }
  
    // Utility function to reindex the day entries if needed
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
  
    // Utility function to reindex tech rows
    function reindexTechRows() {
      const rows = techRowsContainer.querySelectorAll('.row-container');
      rows.forEach(function(container, index) {
        const row = container.querySelector('.tech-row');
        row.setAttribute('data-row-index', index);
  
        // Update the day entries
        reindexDayEntries(row, index);
  
        // Update the dropdown checkboxes
        const checkboxes = row.querySelectorAll('.dropdown-content input[type="checkbox"]');
        checkboxes.forEach(function(checkbox) {
          checkbox.name = 'tech_types_' + index + '[]';
        });
      });
      techRowCount = rows.length;
    }
  });
  