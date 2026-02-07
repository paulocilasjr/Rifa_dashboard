(function () {
  const storageKey = "raffle:selectedNumbers";
  const windowNameKey = "raffle_selected_numbers";
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

  function readWindowName() {
    try {
      if (!window.name) {
        return null;
      }
      const parsed = JSON.parse(window.name);
      if (!parsed || typeof parsed !== "object") {
        return null;
      }
      return parsed[windowNameKey] ?? null;
    } catch (error) {
      return null;
    }
  }

  function writeWindowName(value) {
    try {
      let parsed = {};
      if (window.name) {
        parsed = JSON.parse(window.name);
        if (!parsed || typeof parsed !== "object") {
          parsed = {};
        }
      }
      parsed[windowNameKey] = value;
      window.name = JSON.stringify(parsed);
      return true;
    } catch (error) {
      try {
        window.name = JSON.stringify({ [windowNameKey]: value });
        return true;
      } catch (errorInner) {
        return false;
      }
    }
  }

  function removeWindowName() {
    try {
      if (!window.name) {
        return;
      }
      const parsed = JSON.parse(window.name);
      if (!parsed || typeof parsed !== "object") {
        return;
      }
      if (windowNameKey in parsed) {
        delete parsed[windowNameKey];
        window.name = JSON.stringify(parsed);
      }
    } catch (error) {
      // Ignore window.name errors.
    }
  }

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
    const raw = readStore(localStore) ?? readStore(sessionStore) ?? readWindowName();
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
      writeWindowName(payload);
      return;
    }
    if (writeStore(sessionStore, payload)) {
      writeWindowName(payload);
      return;
    }
    writeWindowName(payload);
  }

  function clearStoredSelection() {
    removeStore(localStore);
    removeStore(sessionStore);
    removeWindowName();
  }

  const selectedCount = document.getElementById("selected-count");
  const selectedPreview = document.getElementById("selected-preview");
  const numbersForm = document.getElementById("numbers-form");
  const checkboxes = Array.from(document.querySelectorAll("input[name='numbers']"));
  const checkboxMap = new Map(checkboxes.map((box) => [box.value, box]));
  const searchToggles = Array.from(document.querySelectorAll(".js-select-number"));
  const clearSelectionButtons = Array.from(
    document.querySelectorAll("[data-clear-selection=\"1\"]")
  );
  const numberFilter = document.getElementById("number-filter");
  const numberItems = Array.from(document.querySelectorAll(".number-item[data-number]"));
  const searchInput = document.getElementById("search-number-input");
  const searchButton = document.getElementById("search-number-btn");
  const searchResult = document.getElementById("search-result");
  const searchResultNumber = document.getElementById("search-result-number");
  const searchResultPill = document.getElementById("search-result-pill");
  const searchResultNote = document.getElementById("search-result-note");
  const searchSelectButton = document.getElementById("search-select-btn");
  const findAvailableButton = document.getElementById("find-available-btn");
  const availablePreview = document.getElementById("available-preview");

  let selected = loadSelection();
  if (selected.size > 0) {
    saveSelection(selected);
  }

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
    if (availablePreview) {
      availablePreview.textContent = "";
    }
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

  clearSelectionButtons.forEach((button) => {
    button.addEventListener("click", clearSelection);
  });

  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-clear-selection=\"1\"]");
    if (!target) {
      return;
    }
    event.preventDefault();
    clearSelection();
  });

  const pageLinks = Array.from(document.querySelectorAll(".page-controls a"));
  pageLinks.forEach((link) => {
    link.addEventListener("click", () => {
      saveSelection(selected);
    });
  });

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

  function copyTextToClipboard(text) {
    if (!text) {
      return Promise.resolve(false);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(
        () => true,
        () => false
      );
    }
    return new Promise((resolve) => {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      let success = false;
      try {
        success = document.execCommand("copy");
      } catch (error) {
        success = false;
      }
      document.body.removeChild(textarea);
      resolve(success);
    });
  }

  if (findAvailableButton) {
    findAvailableButton.addEventListener("click", () => {
      const found = [];
      const items = numberItems.length
        ? numberItems
        : Array.from(document.querySelectorAll(".number-item[data-number]"));
      for (const item of items) {
        if (item.offsetParent === null) {
          continue;
        }
        const number = item.dataset.number;
        if (!number) {
          continue;
        }
        const input = item.querySelector("input[name='numbers']");
        if (!input || input.disabled) {
          continue;
        }
        if (selected.has(String(number))) {
          continue;
        }
        found.push(number);
        if (found.length >= 100) {
          break;
        }
      }
      const text = found.join(", ");
      if (!text) {
        return;
      }
      copyTextToClipboard(text).then((ok) => {
        if (!findAvailableButton) {
          return;
        }
        if (ok) {
          findAvailableButton.textContent = "Números copiados";
          findAvailableButton.classList.remove("success");
        } else {
          findAvailableButton.textContent = "Copie manualmente";
        }
      });
    });
  }

  if (numberFilter) {
    const applyFilter = () => {
      const value = numberFilter.value.trim();
      if (!value) {
        numberItems.forEach((item) => {
          item.style.display = "";
        });
        return;
      }
      numberItems.forEach((item) => {
        const number = item.dataset.number || "";
        item.style.display = number === value ? "" : "none";
      });
    };
    numberFilter.addEventListener("input", applyFilter);
    numberFilter.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") {
        return;
      }
      const value = numberFilter.value.trim();
      if (!value) {
        return;
      }
      const numberValue = Number(value);
      if (!Number.isInteger(numberValue) || numberValue < 1) {
        return;
      }
      const target = document.querySelector(
        `.number-item[data-number="${numberValue}"]`
      );
      if (!target) {
        navigateToNumber(numberValue);
      }
    });
    applyFilter();
  }

  function renderSearchResult(value) {
    if (!searchResult || !searchResultNumber || !searchResultPill || !searchResultNote) {
      return;
    }
    const raw = value.trim();
    if (!raw) {
      searchResult.hidden = true;
      return;
    }

    const maxValue = searchInput ? Number(searchInput.getAttribute("max")) : null;
    const numberValue = Number(raw);
    searchResult.hidden = false;

    const setPill = (label, className) => {
      searchResultPill.textContent = label;
      searchResultPill.classList.remove("sold", "reserved", "available");
      if (className) {
        searchResultPill.classList.add(className);
      }
    };

    if (!Number.isInteger(numberValue) || numberValue < 1 || (maxValue && numberValue > maxValue)) {
      searchResultNumber.textContent = "Número inválido";
      searchResultNote.textContent = "Digite um número dentro do intervalo.";
      setPill("Inválido", "");
      if (searchSelectButton) {
        searchSelectButton.dataset.selectable = "false";
        searchSelectButton.dataset.number = "";
        searchSelectButton.disabled = true;
      }
      return;
    }

    const target = document.querySelector(
      `.number-item[data-number="${numberValue}"]`
    );
    searchResultNumber.textContent = `Número ${numberValue}`;

    if (!target) {
      searchResultNote.textContent = "Número não encontrado.";
      setPill("Indisponível", "reserved");
      if (searchSelectButton) {
        searchSelectButton.dataset.selectable = "false";
        searchSelectButton.dataset.number = "";
        searchSelectButton.disabled = true;
      }
      return;
    }

    const isSold = target.classList.contains("is-sold");
    const isReservedOther =
      target.classList.contains("is-reserved") && !target.classList.contains("is-reserved-me");
    const isReservedMe = target.classList.contains("is-reserved-me");

    if (isSold) {
      setPill("Vendido", "sold");
      searchResultNote.textContent = "Este número já foi vendido.";
      if (searchSelectButton) {
        searchSelectButton.dataset.selectable = "false";
        searchSelectButton.dataset.number = "";
        searchSelectButton.disabled = true;
      }
      return;
    }

    if (isReservedOther) {
      setPill("Reservado", "reserved");
      searchResultNote.textContent = "Reservado por outro vendedor.";
      if (searchSelectButton) {
        searchSelectButton.dataset.selectable = "false";
        searchSelectButton.dataset.number = "";
        searchSelectButton.disabled = true;
      }
      return;
    }

    if (isReservedMe) {
      setPill("Reservado", "reserved");
      searchResultNote.textContent = "Reservado por você.";
      if (searchSelectButton) {
        searchSelectButton.dataset.selectable = "true";
        searchSelectButton.dataset.number = String(numberValue);
        searchSelectButton.disabled = false;
      }
      syncSearchToggles();
      return;
    }

    setPill("Disponível", "available");
    searchResultNote.textContent = "Número disponível para selecionar.";
    if (searchSelectButton) {
      searchSelectButton.dataset.selectable = "true";
      searchSelectButton.dataset.number = String(numberValue);
      searchSelectButton.disabled = false;
    }
    syncSearchToggles();
  }

  function navigateToNumber(numberValue) {
    if (!searchInput) {
      return;
    }
    const pageSize = Number(searchInput.dataset.pageSize || "0");
    if (!pageSize || !Number.isFinite(pageSize)) {
      return;
    }
    const targetPage = Math.floor((numberValue - 1) / pageSize) + 1;
    const params = new URLSearchParams(window.location.search);
    params.set("page", String(targetPage));
    params.set("search", String(numberValue));
    window.location.search = params.toString();
  }

  if (searchButton && searchInput) {
    const performSearch = () => {
      const raw = searchInput.value || "";
      const value = raw.trim();
      if (!value) {
        renderSearchResult("");
        return;
      }
      const numberValue = Number(value);
      if (Number.isInteger(numberValue) && numberValue >= 1) {
        const target = document.querySelector(
          `.number-item[data-number="${numberValue}"]`
        );
        if (!target) {
          navigateToNumber(numberValue);
          return;
        }
      }
      renderSearchResult(value);
    };
    searchButton.addEventListener("click", performSearch);
    searchInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        performSearch();
      }
    });
    const params = new URLSearchParams(window.location.search);
    const initialSearch = params.get("search");
    if (initialSearch) {
      searchInput.value = initialSearch;
      renderSearchResult(initialSearch);
      if (numberFilter) {
        numberFilter.value = initialSearch;
        const inputEvent = new Event("input", { bubbles: true });
        numberFilter.dispatchEvent(inputEvent);
      }
    }
  }

  window.addEventListener("pagehide", () => {
    saveSelection(selected);
  });

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
