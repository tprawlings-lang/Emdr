// Build Your Bikini: tracks selections, updates the SVG preview,
// the build summary, and live pricing (base build + charms).

const BASE_PRICE = 98;
const CHARM_PRICE = 6;

const state = {
  topStyle: "Triangle",
  topColor: { hex: "#0F5132", name: "Cactus Green" },
  bottomStyle: "Tie-Side",
  bottomColor: { hex: "#F6EFE3", name: "Sand Cream" },
  size: "S",
  charms: [], // [{ name, icon }]
};

function wireSingleSelect(groupId, onPick) {
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

wireSingleSelect("top-styles", (btn) => (state.topStyle = btn.textContent.trim()));
wireSingleSelect("bottom-styles", (btn) => (state.bottomStyle = btn.textContent.trim()));
wireSingleSelect("sizes", (btn) => (state.size = btn.textContent.trim()));
wireSingleSelect("top-colors", (btn) => (state.topColor = { hex: btn.dataset.color, name: btn.dataset.name }));
wireSingleSelect("bottom-colors", (btn) => (state.bottomColor = { hex: btn.dataset.color, name: btn.dataset.name }));

// Charms are multi-select: toggle on/off.
document.getElementById("charms").addEventListener("click", (e) => {
  const btn = e.target.closest(".chip");
  if (!btn) return;
  btn.classList.toggle("selected");
  const name = btn.textContent.trim();
  const icon = btn.dataset.icon;
  if (btn.classList.contains("selected")) {
    state.charms.push({ name, icon });
  } else {
    state.charms = state.charms.filter((c) => c.name !== name);
  }
  render();
});

// Named builds for signature color pairings; everything else is "Your Custom Build".
const namedBuilds = {
  "Cactus Green|Sand Cream": "Desert Luxe Build",
  "Cactus Green|Gold": "Desert Luxe Build",
  "Black|Desert Tan": "Wild Print Build",
  "Neon Pink|Black": "Neon Nights Build",
  "Black|Neon Pink": "Neon Nights Build",
  "Bridal White|Bridal White": "Bridal Pool Party Build",
  "Turquoise|Desert Tan": "Scottsdale Edit Build",
  "Cactus Green|Turquoise": "Scottsdale Edit Build",
};

function render() {
  const key = `${state.topColor.name}|${state.bottomColor.name}`;
  const name = namedBuilds[key] || "Your Custom Build";
  const price = BASE_PRICE + state.charms.length * CHARM_PRICE;

  document.querySelector("#preview-top path").setAttribute("fill", state.topColor.hex);
  document.querySelector("#preview-bottom path").setAttribute("fill", state.bottomColor.hex);
  document.getElementById("charm-display").textContent = state.charms.map((c) => c.icon).join(" ");

  document.getElementById("recipe-name").textContent = name;
  document.getElementById("recipe-desc").textContent =
    `${state.topStyle} top in ${state.topColor.name} · ${state.bottomStyle} bottoms in ${state.bottomColor.name}`;
  document.getElementById("price-line").textContent = `$${price}`;
  document.getElementById("sticky-add").textContent = `Add Full Build to Cart · $${price}`;

  document.getElementById("summary-line").textContent =
    `${state.topStyle} top in ${state.topColor.name} · ${state.bottomStyle} bottoms in ${state.bottomColor.name} · Size ${state.size}`;
  document.getElementById("summary-charms").textContent = state.charms.length
    ? state.charms.map((c) => c.name).join(", ") + ` (+$${state.charms.length * CHARM_PRICE})`
    : "None yet — make it yours.";
}

render();
