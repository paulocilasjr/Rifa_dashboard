(function () {
  const selectedCount = document.getElementById("selected-count");
  const selectedPreview = document.getElementById("selected-preview");
  const checkboxes = document.querySelectorAll("input[name='numbers']");
  if (!selectedCount || !selectedPreview || checkboxes.length === 0) {
    return;
  }

  function updateSelection() {
    const selected = Array.from(checkboxes)
      .filter((box) => box.checked)
      .map((box) => box.value);
    selectedCount.textContent = String(selected.length);
    selectedPreview.textContent = selected.length
      ? `Números: ${selected.slice(0, 12).join(", ")}${selected.length > 12 ? "..." : ""}`
      : "";
  }

  checkboxes.forEach((box) => {
    box.addEventListener("change", updateSelection);
  });

  updateSelection();
})();
