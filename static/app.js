(function () {
  const storageKey = "raffle:selectedNumbers";

  function loadSelection() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        return new Set();
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return new Set();
      }
      return new Set(parsed.map((value) => String(value)));
    } catch (error) {
      return new Set();
    }
  }

  function saveSelection(selected) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(Array.from(selected)));
    } catch (error) {
      // Ignore storage errors (private browsing or disabled storage).
    }
  }

  function clearStoredSelection() {
    try {
      localStorage.removeItem(storageKey);
    } catch (error) {
      // Ignore storage errors.
    }
  }

  const selectedCount = document.getElementById("selected-count");
  const selectedPreview = document.getElementById("selected-preview");
  const numbersForm = document.getElementById("numbers-form");
  const checkboxes = Array.from(document.querySelectorAll("input[name='numbers']"));
  const checkboxMap = new Map(checkboxes.map((box) => [box.value, box]));
  const searchButtons = Array.from(document.querySelectorAll(".js-select-number"));
  const clearSelectionButton = document.getElementById("clear-selection-btn");

  let selected = loadSelection();

  const params = new URLSearchParams(window.location.search);
  if (params.get("clear_selection") === "1") {
    selected = new Set();
    clearStoredSelection();
    params.delete("clear_selection");
    const newQuery = params.toString();
    const newUrl = `${window.location.pathname}${newQuery ? `?${newQuery}` : ""}`;
    window.history.replaceState({}, "", newUrl);
  }

  function formatPreview(values) {
    const sorted = values
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b)
      .map((value) => String(value));
    return {
      total: sorted.length,
      preview: sorted.length
        ? `Números: ${sorted.slice(0, 12).join(", ")}${sorted.length > 12 ? "..." : ""}`
        : "",
    };
  }

  function updateSummary() {
    if (!selectedCount || !selectedPreview) {
      return;
    }
    const result = formatPreview(Array.from(selected));
    selectedCount.textContent = String(result.total);
    selectedPreview.textContent = result.preview;
  }

  function setSearchButtonState(button, isSelected) {
    if (!button.dataset.defaultLabel) {
      button.dataset.defaultLabel = button.textContent.trim();
    }
    button.textContent = isSelected ? "Remover da seleção" : button.dataset.defaultLabel;
    button.classList.toggle("primary", isSelected);
  }

  function syncSearchButtons() {
    searchButtons.forEach((button) => {
      const number = button.dataset.number;
      if (!number) {
        return;
      }
      const isSelected = selected.has(String(number));
      setSearchButtonState(button, isSelected);
    });
  }

  function syncCheckboxes() {
    let changed = false;
    checkboxes.forEach((box) => {
      const value = box.value;
      if (selected.has(value)) {
        if (box.disabled) {
          selected.delete(value);
          box.checked = false;
          changed = true;
        } else {
          box.checked = true;
        }
      } else {
        box.checked = false;
      }
    });
    if (changed) {
      saveSelection(selected);
    }
  }

  function clearSelection() {
    selected = new Set();
    clearStoredSelection();
    checkboxes.forEach((box) => {
      box.checked = false;
    });
    updateSummary();
    syncSearchButtons();
  }

  function toggleSelection(value) {
    const stringValue = String(value);
    if (selected.has(stringValue)) {
      selected.delete(stringValue);
    } else {
      selected.add(stringValue);
    }
    const checkbox = checkboxMap.get(stringValue);
    if (checkbox && !checkbox.disabled) {
      checkbox.checked = selected.has(stringValue);
    }
    saveSelection(selected);
    updateSummary();
    syncSearchButtons();
  }

  checkboxes.forEach((box) => {
    box.addEventListener("change", () => {
      if (box.checked) {
        selected.add(box.value);
      } else {
        selected.delete(box.value);
      }
      saveSelection(selected);
      updateSummary();
      syncSearchButtons();
    });
  });

  searchButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const selectable = button.dataset.selectable;
      if (selectable === "false") {
        return;
      }
      const number = button.dataset.number;
      if (!number) {
        return;
      }
      toggleSelection(number);
    });
  });

  if (clearSelectionButton) {
    clearSelectionButton.addEventListener("click", clearSelection);
  }

  if (numbersForm) {
    numbersForm.addEventListener("submit", () => {
      numbersForm
        .querySelectorAll("input[data-selected-hidden='1']")
        .forEach((input) => input.remove());
      if (selected.size === 0) {
        return;
      }
      const presentValues = new Set(checkboxes.map((box) => box.value));
      selected.forEach((value) => {
        if (!presentValues.has(value)) {
          const input = document.createElement("input");
          input.type = "hidden";
          input.name = "numbers";
          input.value = value;
          input.dataset.selectedHidden = "1";
          numbersForm.appendChild(input);
        }
      });
    });
  }

  if (checkboxes.length > 0 || searchButtons.length > 0) {
    syncCheckboxes();
    updateSummary();
    syncSearchButtons();
  }

  const modal = document.getElementById("confirm-modal");
  if (modal) {
    const modalForm = document.getElementById("confirm-form");
    const modalTitle = document.getElementById("confirm-title");
    const modalMessage = document.getElementById("confirm-message");
    const modalSubmit = document.getElementById("confirm-submit");
    const modalCancel = modal.querySelector("[data-modal-cancel]");
    const triggers = Array.from(document.querySelectorAll(".js-confirm"));

    const closeModal = () => {
      modal.classList.remove("is-open");
      modal.setAttribute("aria-hidden", "true");
    };

    triggers.forEach((trigger) => {
      trigger.addEventListener("click", () => {
        if (!modalForm) {
          return;
        }
        const action = trigger.dataset.confirmAction;
        if (!action) {
          return;
        }
        modalForm.action = action;
        if (modalTitle) {
          modalTitle.textContent = trigger.dataset.confirmTitle || "Confirmar ação";
        }
        if (modalMessage) {
          modalMessage.textContent =
            trigger.dataset.confirmMessage || "Tem certeza que deseja continuar?";
        }
        if (modalSubmit) {
          modalSubmit.textContent = trigger.dataset.confirmSubmit || "Confirmar";
        }
        modal.classList.add("is-open");
        modal.setAttribute("aria-hidden", "false");
      });
    });

    if (modalCancel) {
      modalCancel.addEventListener("click", closeModal);
    }

    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        closeModal();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && modal.classList.contains("is-open")) {
        closeModal();
      }
    });
  }
})();
