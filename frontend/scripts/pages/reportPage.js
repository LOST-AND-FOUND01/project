/* FOUNDIT — Report Lost or Found Item Page (Connected to PostgreSQL & Private Storage) */

window.FOUNDIT = window.FOUNDIT || {};

window.FOUNDIT.reportPage = (() => {
  const { readImageFile, toast } = window.FOUNDIT.helpers;
  let selectedFile = null;

  function populateOptions() {
    const { CATEGORIES, CAMPUS_ZONES } = window.FOUNDIT.MOCK_DATA;
    const cat = document.getElementById("itemCategory");
    const loc = document.getElementById("itemLocation");

    if (cat && cat.options.length === 0) {
      CATEGORIES.forEach((c) => {
        const opt = document.createElement("option");
        opt.value = c;
        opt.textContent = c;
        cat.appendChild(opt);
      });
    }

    if (loc && loc.options.length <= 1) {
      CAMPUS_ZONES.forEach((z) => {
        const opt = document.createElement("option");
        opt.value = z;
        opt.textContent = z;
        loc.appendChild(opt);
      });
    }
  }

  function updatePreview(dataUrl) {
    const img = document.getElementById("photoPreview");
    const clearBtn = document.getElementById("clearPhotoBtn");
    if (img) {
      if (dataUrl) {
        img.src = dataUrl;
        img.style.display = "block";
      } else {
        img.src = "";
        img.style.display = "none";
      }
    }
    if (clearBtn) {
      clearBtn.style.display = dataUrl ? "inline-flex" : "none";
    }
  }

  function clearPhoto() {
    selectedFile = null;
    const fileInput = document.getElementById("itemPhoto");
    if (fileInput) fileInput.value = "";
    updatePreview("");
  }

  function handleFile(file) {
    if (!file) {
      clearPhoto();
      return;
    }
    readImageFile(
      file,
      (dataUrl) => {
        selectedFile = file;
        updatePreview(dataUrl);
      },
      (err) => {
        toast(err);
        clearPhoto();
      }
    );
  }

  function init() {
    populateOptions();
    const dateInput = document.getElementById("itemDate");
    if (dateInput && !dateInput.value) {
      dateInput.value = new Date().toISOString().slice(0, 10);
    }

    const fileInput = document.getElementById("itemPhoto");
    if (fileInput) {
      fileInput.addEventListener("change", (e) => {
        handleFile(e.target.files[0]);
      });
    }

    const dropzone = document.getElementById("photoDropzone");
    if (dropzone) {
      ["dragenter", "dragover"].forEach((evt) => {
        dropzone.addEventListener(evt, (e) => {
          e.preventDefault();
          dropzone.classList.add("dragover");
        });
      });
      ["dragleave", "drop"].forEach((evt) => {
        dropzone.addEventListener(evt, (e) => {
          e.preventDefault();
          dropzone.classList.remove("dragover");
        });
      });
      dropzone.addEventListener("drop", (e) => {
        const file = e.dataTransfer?.files?.[0];
        if (file) handleFile(file);
      });
    }

    const form = document.getElementById("reportForm");
    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const user = window.FOUNDIT.store.getCurrentUser();
        if (!user) {
          toast("Please sign in first to submit a report.");
          window.FOUNDIT.router.showPage("auth");
          return;
        }

        const name = document.getElementById("itemName").value.trim();
        const type = document.getElementById("itemType").value;
        const category = document.getElementById("itemCategory").value;
        const colour = document.getElementById("itemColour").value.trim();
        const location = document.getElementById("itemLocation").value;
        const date = document.getElementById("itemDate").value;
        const description = document.getElementById("itemDescription").value.trim();
        const anonymous = document.getElementById("anonymous").checked;

        if (name.length < 2) {
          toast("Please enter an item name (at least 2 characters).");
          return;
        }
        if (!location) {
          toast("Please choose a campus location.");
          return;
        }

        const btn = form.querySelector("button[type='submit']");
        if (btn) {
          btn.disabled = true;
          btn.textContent = "Submitting...";
        }

        const res = await window.FOUNDIT.store.createItem(
          { name, type, category, colour, location, date, description, anonymous },
          selectedFile
        );

        if (btn) {
          btn.disabled = false;
          btn.textContent = "Submit report ↗";
        }

        if (!res.ok) {
          toast(res.error);
          return;
        }

        form.reset();
        clearPhoto();
        if (dateInput) dateInput.value = new Date().toISOString().slice(0, 10);
        toast(res.warning ? res.warning : "Report submitted to campus listings!");
        window.FOUNDIT.router.showPage("browse");
      });
    }
  }

  function render() {
    populateOptions();
    const guard = document.getElementById("reportAuthGuard");
    const user = window.FOUNDIT.store.getCurrentUser();
    if (guard) {
      guard.style.display = user ? "none" : "flex";
    }
  }

  return {
    init,
    render,
    clearPhoto
  };
})();
