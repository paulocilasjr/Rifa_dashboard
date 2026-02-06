(function () {
  const storageKey = "raffle:selectedNumbers";
  const localStore = (() => {
    try {
      const testKey = "__raffle_test__";
      localStorage.setItem(testKey, "1");
      localStorage.removeItem(testKey);
      return localStorage;
    } catch (error) {
      return null;
    }
  })();
  const sessionStore = (() => {
    try {
      const testKey = "__raffle_test__";
      sessionStorage.setItem(testKey, "1");
      sessionStorage.removeItem(testKey);
      return sessionStorage;
    } catch (error) {
      return null;
    }
  })();

  function readStore(store) {
    if (!store) {
      return null;
    }
    try {
      return store.getItem(storageKey);
    } catch (error) {
      return null;
    }
  }

  function writeStore(store, value) {
    if (!store) {
      return false;
    }
    try {
      store.setItem(storageKey, value);
      return true;
    } catch (error) {
      return false;
    }
  }

  function removeStore(store) {
    if (!store) {
      return;
    }
    try {
      store.removeItem(storageKey);
    } catch (error) {
      // Ignore storage errors.
    }
  }

  function loadSelection() {
    const raw = readStore(localStore) ?? readStore(sessionStore);
    if (!raw) {
      return new Set();
    }
    try {
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
    const payload = JSON.stringify(Array.from(selected));
    if (writeStore(localStore, payload)) {
      return;
    }
    writeStore(sessionStore, payload);
  }

  function clearStoredSelection() {
    removeStore(localStore);
    removeStore(sessionStore);
  }

  const selectedCount = document.getElementById("selected-count");
  const selectedPreview = document.getElementById("selected-preview");
  const numbersForm = document.getElementById("numbers-form");
  const checkboxes = Array.from(document.querySelectorAll("input[name='numbers']"));
  const checkboxMap = new Map(checkboxes.map((box) => [box.value, box]));
  const searchToggles = Array.from(document.querySelectorAll(".js-select-number"));
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

  function isCheckbox(element) {
    return (
      element &&
      element.tagName === "INPUT" &&
      element.getAttribute("type") === "checkbox"
    );
  }

  function setSearchToggleState(toggle, isSelected) {
    if (isCheckbox(toggle)) {
      toggle.checked = isSelected;
      return;
    }
    if (!toggle.dataset.defaultLabel) {
      toggle.dataset.defaultLabel = toggle.textContent.trim();
    }
    toggle.textContent = isSelected ? "Remover da seleção" : toggle.dataset.defaultLabel;
    toggle.classList.toggle("primary", isSelected);
  }

  function syncSearchToggles() {
    searchToggles.forEach((toggle) => {
      const number = toggle.dataset.number;
      if (!number) {
        return;
      }
      const isSelected = selected.has(String(number));
      setSearchToggleState(toggle, isSelected);
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
    syncSearchToggles();
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
    syncSearchToggles();
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
      syncSearchToggles();
    });
  });

  searchToggles.forEach((toggle) => {
    const handler = () => {
      const selectable = toggle.dataset.selectable;
      if (selectable === "false") {
        if (isCheckbox(toggle)) {
          toggle.checked = selected.has(String(toggle.dataset.number || ""));
        }
        return;
      }
      const number = toggle.dataset.number;
      if (!number) {
        return;
      }
      if (isCheckbox(toggle)) {
        if (toggle.checked) {
          selected.add(String(number));
        } else {
          selected.delete(String(number));
        }
        saveSelection(selected);
        updateSummary();
        syncSearchToggles();
        return;
      }
      toggleSelection(number);
    };
    if (isCheckbox(toggle)) {
      toggle.addEventListener("change", handler);
    } else {
      toggle.addEventListener("click", handler);
    }
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

  if (checkboxes.length > 0 || searchToggles.length > 0) {
    syncCheckboxes();
    updateSummary();
    syncSearchToggles();
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
