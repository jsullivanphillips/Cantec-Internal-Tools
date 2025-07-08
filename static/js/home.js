document.addEventListener("DOMContentLoaded", function () {
  const listContainer = document.getElementById("minutes-list");
  const createBtn = document.getElementById("create-minute-btn");
  const loading = document.getElementById("loading");

  let offset = 0;
  const limit = 4;
  let isLoading = false;
  let reachedEnd = false;

  // Format date to "Month Day, Year"
  function formatDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric"
    });
  }

  // Create a DOM element for a meeting minute entry
  function renderMinute(minute, prepend = false) {
    const wrapper = document.createElement("div");
    wrapper.classList.add("meeting-card");
    wrapper.dataset.id = minute.id;

    const contentId = `editor-${minute.id}`;

    wrapper.innerHTML = `
        <div class="meeting-header">
        <div class="meeting-title">${formatDate(minute.week_of)} Meeting Minutes</div>
        <div class="btn-group-sm">
            <button class="btn btn-outline-primary edit-btn">Edit</button>
            <button class="btn btn-outline-danger delete-btn">Delete</button>
        </div>
        </div>

        <div class="meta-info">Last edited by ${minute.modified_by} on ${new Date(minute.updated_at).toLocaleString()}</div>

        <div class="date-editor">
        <label><strong>Meeting Date:</strong></label>
        <input type="date" class="form-control form-control-sm week-of-input" value="${minute.week_of}" />
        </div>

        <div id="${contentId}" class="minute-content-display word-style">${minute.content || "<p><em>No content yet.</em></p>"}</div>

        <div class="edit-toolbar">
        <button class="btn btn-sm btn-success save-btn">Save</button>
        <button class="btn btn-sm btn-secondary cancel-btn">Cancel</button>
        </div>
    `;

    const titleEl = wrapper.querySelector(".meeting-title");
    const dateInput = wrapper.querySelector(".week-of-input");
    const editBtn = wrapper.querySelector(".edit-btn");
    const saveBtn = wrapper.querySelector(".save-btn");
    const cancelBtn = wrapper.querySelector(".cancel-btn");
    const deleteBtn = wrapper.querySelector(".delete-btn");
    const displayEl = wrapper.querySelector(`#${contentId}`);

    let editor = null;
    let originalContent = minute.content || "";
    let originalDate = minute.week_of;

    editBtn.addEventListener("click", async () => {
        if (!window.Tiptap || !window.Tiptap.Editor) {
            alert("Tiptap editor not loaded.");
            return;
        }
        if (editor) return; // Already editing

        wrapper.classList.add("editing");

        // Initialize Tiptap editor
        editor = new window.Tiptap.Editor({
        element: displayEl,
        extensions: [window.Tiptap.StarterKit],
        content: originalContent || "<p><em>No content yet.</em></p>",
        editorProps: {
            attributes: {
            class: "word-style",
            },
        }
        });

        displayEl.focus();
    });

    cancelBtn.addEventListener("click", () => {
        if (editor) {
        editor.destroy();
        editor = null;
        }
        displayEl.innerHTML = originalContent || "<p><em>No content yet.</em></p>";
        dateInput.value = originalDate;
        wrapper.classList.remove("editing");
    });

    saveBtn.addEventListener("click", () => {
        const newContent = editor ? editor.getHTML() : displayEl.innerHTML;
        const newDate = dateInput.value;

        fetch(`/api/meeting_minutes/${minute.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newContent, week_of: newDate }),
        })
        .then(() => {
            originalContent = newContent;
            originalDate = newDate;
            titleEl.textContent = `${formatDate(newDate)} Meeting Minutes`;
            wrapper.classList.remove("editing");

            if (editor) {
            editor.destroy();
            editor = null;
            }

            displayEl.innerHTML = newContent;
        })
        .catch((err) => {
            alert("Save failed.");
            console.error(err);
        });
    });

    deleteBtn.addEventListener("click", () => {
        if (!confirm("Are you sure you want to delete this meeting?")) return;

        fetch(`/api/meeting_minutes/${minute.id}`, {
        method: "DELETE",
        })
        .then(() => {
            wrapper.remove();
        })
        .catch((err) => {
            alert("Delete failed.");
            console.error(err);
        });
    });

    if (prepend) {
        listContainer.insertBefore(wrapper, listContainer.firstChild);
    } else {
        listContainer.appendChild(wrapper);
    }
    }






  // Fetch meeting minutes in pages
  function loadMinutes() {
    if (isLoading || reachedEnd) return;
    isLoading = true;
    loading.style.display = "block";

    fetch(`/api/meeting_minutes/list?offset=${offset}&limit=${limit}`)
      .then(res => res.json())
      .then(data => {
        if (data.length < limit) reachedEnd = true;
        data.forEach(renderMinute);
        offset += limit;
      })
      .catch(err => {
        console.error("Error loading meeting minutes:", err);
      })
      .finally(() => {
        isLoading = false;
        loading.style.display = "none";
      });
  }

  // Create a new blank meeting minute
  createBtn.addEventListener("click", () => {
    const todayStr = new Date().toISOString().split("T")[0];
    fetch("/api/meeting_minutes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ week_of: todayStr, content: "" })
    })
      .then(res => res.json())
      .then(data => {
        renderMinute({
          id: data.id,
          content: "",
          week_of: data.week_of,
          updated_at: data.updated_at,
          modified_by: data.modified_by
        }, true);
        window.scrollTo({ top: 0, behavior: "smooth" });
      })
      .catch(err => {
        console.error("Error creating new meeting:", err);
        alert("Could not create new meeting.");
      });
  });

  // Infinite scroll trigger
  window.addEventListener("scroll", () => {
    if (
      window.innerHeight + window.scrollY >= document.body.offsetHeight - 300
    ) {
      loadMinutes();
    }
  });

  // Initial load
  loadMinutes();
});
