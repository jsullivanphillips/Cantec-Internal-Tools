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
    
    // Function to re-index tech rows after any removal.
    function reindexTechRows() {
      const rows = techRowsContainer.querySelectorAll('.tech-row');
      rows.forEach(function(row, index) {
        row.setAttribute('data-row-index', index);
        // Update the name attributes for checkboxes in this row.
        const checkboxes = row.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(function(checkbox) {
          checkbox.name = 'tech_types_' + index + '[]';
        });
      });
      techRowCount = rows.length;
    }
    
    // Function to create a new tech row.
    function createTechRow() {
        const row = document.createElement('div');
        row.classList.add('tech-row');
        row.setAttribute('data-row-index', techRowCount);
      
        // Create the input for number of techs.
        const techCountInput = document.createElement('input');
        techCountInput.type = 'number';
        techCountInput.name = 'tech_count[]';
        techCountInput.min = '1';
        techCountInput.placeholder = '# Techs';
        techCountInput.style.width = '60px';
        techCountInput.style.textAlign = 'center'; // Center align the text
        
        // Create the " x " text.
        const timesSpan = document.createElement('span');
        timesSpan.textContent = " x ";
        
        // Create the dropdown container.
        const dropdownContainer = document.createElement('div');
        dropdownContainer.classList.add('dropdown');
        dropdownContainer.style.display = 'inline-block';
        dropdownContainer.style.position = 'relative';
        
        // The button that shows the dropdown and selected items.
        const dropdownButton = document.createElement('button');
        dropdownButton.type = 'button';
        dropdownButton.classList.add('dropdown-button');
        dropdownButton.textContent = 'Select Tech Types';
        
        // Create the dropdown content container.
        const dropdownContent = document.createElement('div');
        dropdownContent.classList.add('dropdown-content');
        dropdownContent.style.display = 'none';
        dropdownContent.style.position = 'absolute';
        dropdownContent.style.backgroundColor = '#f9f9f9';
        dropdownContent.style.minWidth = '200px';
        dropdownContent.style.boxShadow = '0px 8px 16px rgba(0,0,0,0.2)';
        dropdownContent.style.padding = '5px';
        dropdownContent.style.zIndex = '100';
        
        // Populate the dropdown content with checkboxes.
        techTypes.forEach(function(type) {
        const label = document.createElement('label');
        label.style.display = 'block';
        label.style.padding = '3px 5px';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.name = 'tech_types_' + techRowCount + '[]';
        checkbox.value = type;
        // When toggled, update the dropdown button text.
        checkbox.addEventListener('change', function() {
            updateDropdownButtonText(dropdownButton, dropdownContent);
        });
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(' ' + type));
        dropdownContent.appendChild(label);
        });
        
        // Toggle dropdown when the button is clicked.
        dropdownButton.addEventListener('click', function(event) {
        event.stopPropagation();
        dropdownContent.style.display = dropdownContent.style.display === 'block' ? 'none' : 'block';
        });
        
        dropdownContainer.appendChild(dropdownButton);
        dropdownContainer.appendChild(dropdownContent);
        
        // Create the " for " text.
        const forSpan = document.createElement('span');
        forSpan.textContent = " for ";
        
        // Create the input for number of hours.
        const techHoursInput = document.createElement('input');
        techHoursInput.type = 'number';
        techHoursInput.name = 'tech_hours[]';
        techHoursInput.min = '0.5';
        techHoursInput.step = '0.5';
        techHoursInput.placeholder = 'Hours Free';
        techHoursInput.style.width = '45px';
        techHoursInput.style.textAlign = 'center'; // Center align the text

        // Create a span to display the formatted hours text.
        const techHoursDisplay = document.createElement('span');
        techHoursDisplay.classList.add('hours-display');
        techHoursDisplay.style.marginLeft = '5px';
        techHoursDisplay.textContent = ''; // Initially empty

        // Add an event listener to update the display when the user types.
        techHoursInput.addEventListener('input', function() {
        let val = parseFloat(techHoursInput.value);
        if (!isNaN(val)) {
            techHoursDisplay.textContent = (val === 1 ? 'hour' : ' hours');
        } else {
            techHoursDisplay.textContent = '';
        }
        });
        
        // Create the remove button.
        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.textContent = 'Remove';
        removeButton.style.marginLeft = '10px';
        removeButton.addEventListener('click', function() {
        techRowsContainer.removeChild(row);
        reindexTechRows();
        });

        // Append elements in left-to-right order.
        row.appendChild(techCountInput);
        row.appendChild(timesSpan);
        row.appendChild(dropdownContainer);
        row.appendChild(forSpan);
        row.appendChild(techHoursInput);
        row.appendChild(techHoursDisplay); // New display element
        row.appendChild(removeButton);

        techRowsContainer.appendChild(row);
        techRowCount++;
    }
    
    addTechRowButton.addEventListener('click', createTechRow);
    
    // Global listener to close any open dropdown when clicking outside.
    document.addEventListener('click', function(event) {
      const dropdowns = document.querySelectorAll('.dropdown-content');
      dropdowns.forEach(function(dropdown) {
        dropdown.style.display = 'none';
      });
    });
    
    // Prevent clicks within the dropdown content from closing it.
    techRowsContainer.addEventListener('click', function(event) {
      if (event.target.closest('.dropdown-content')) {
        event.stopPropagation();
      }
    });
    
    // Update the dropdown button text to show selected tech types.
    function updateDropdownButtonText(button, content) {
      const checkboxes = content.querySelectorAll('input[type="checkbox"]');
      const selected = [];
      checkboxes.forEach(function(checkbox) {
        if (checkbox.checked) {
          selected.push(checkbox.value);
        }
      });
      if (selected.length > 0) {
        button.textContent = selected.join(', ');
      } else {
        button.textContent = 'Select Tech Types';
      }
    }
    
    // Weekday toggle functionality.
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
    
    // Before form submission, add hidden inputs for weekdays.
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

    createTechRow();
  });
  