// Interactive suit builder: tracks selections, updates the SVG preview
// and the recipe summary line.

const state = {
  topStyle: "Triangle",
  topColor: { hex: "#f7c9c9", name: "Blush" },
  bottomStyle: "Tie-Side",
  bottomColor: { hex: "#fdf3dc", name: "Buttercream" },
  size: "S",
};

function wireChips(groupId, onPick) {
  const group = document.getElementById(groupId);
  group.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip, .color-dot");
    if (!btn) return;
    group.querySelectorAll(".selected").forEach((el) => el.classList.remove("selected"));
    btn.classList.add("selected");
    onPick(btn);
    render();
  });
}

wireChips("top-styles", (btn) => (state.topStyle = btn.textContent.trim()));
wireChips("bottom-styles", (btn) => (state.bottomStyle = btn.textContent.trim()));
wireChips("sizes", (btn) => (state.size = btn.textContent.trim()));
wireChips("top-colors", (btn) => (state.topColor = { hex: btn.dataset.color, name: btn.dataset.name }));
wireChips("bottom-colors", (btn) => (state.bottomColor = { hex: btn.dataset.color, name: btn.dataset.name }));

// A few named "house special" recipes; everything else gets a generic name.
const houseSpecials = {
  "Blush|Buttercream": "The Sunset Spritz",
  "Seafoam|Denim": "The Lagoon Cooler",
  "Buttercream|Buttercream": "The Beach Club Classic",
  "Denim|Coral": "The Boardwalk Punch",
  "Espresso|Espresso": "The Midnight Swim",
};

function render() {
  const key = `${state.topColor.name}|${state.bottomColor.name}`;
  const name = houseSpecials[key] || "Your Custom Mix";

  document.querySelector("#preview-top path").setAttribute("fill", state.topColor.hex);
  document.querySelector("#preview-bottom path").setAttribute("fill", state.bottomColor.hex);

  document.getElementById("recipe-name").textContent = name;
  document.getElementById("recipe-desc").textContent =
    `${state.topStyle} top in ${state.topColor.name} · ${state.bottomStyle} bottoms in ${state.bottomColor.name}`;
  document.getElementById("summary-line").textContent =
    `${state.topStyle} top in ${state.topColor.name} · ${state.bottomStyle} bottoms in ${state.bottomColor.name} · Size ${state.size}`;
}

render();
