const sel = document.getElementById("profile");
const swatch = document.getElementById("swatch");
const preview = document.getElementById("preview");
const copyPreviewBtn = document.getElementById("copyPreview");
const openShortcuts = document.getElementById("openShortcuts");

(async function init() {
  const { profile = "flutter" } = await chrome.storage.local.get("profile");
  sel.value = profile;
  const { last } = await chrome.storage.local.get("last");
  renderPreview(sel.value, last || sample("#3498DB"));
})();

sel.addEventListener("change", async () => {
  await chrome.storage.local.set({ profile: sel.value });
  const { last } = await chrome.storage.local.get("last");
  renderPreview(sel.value, last || sample("#3498DB"));
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.last)
    renderPreview(sel.value, changes.last.newValue);
});

copyPreviewBtn.addEventListener("click", async () => {
  const { last } = await chrome.storage.local.get("last");
  if (!last) return;
  await navigator.clipboard.writeText(formatByProfile(sel.value, last));
  copyPreviewBtn.textContent = "Copied!";
  setTimeout(() => (copyPreviewBtn.textContent = "Copy"), 800);
});

openShortcuts.addEventListener("click", () =>
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" })
);

function renderPreview(profile, color) {
  preview.textContent = formatByProfile(profile, color);
  swatch.style.background = color?.hex || "#000";
}

function formatByProfile(profile, { hex, r, g, b, a } = sample("#3498DB")) {
  const HEX = (hex || "#000000").replace("#", "").toUpperCase();
  const AHEX = (a ?? 255).toString(16).padStart(2, "0").toUpperCase();
  const R1 = (r / 255).toFixed(3),
    G1 = (g / 255).toFixed(3),
    B1 = (b / 255).toFixed(3);
  const AF = ((a ?? 255) / 255).toFixed(2);
  switch (profile) {
    case "flutter":
      return `const Color(0x${AHEX}${HEX})`;
    case "css-hex":
      return `#${HEX}`;
    case "css-rgba":
      return `rgba(${r}, ${g}, ${b}, ${AF})`;
    case "react-native":
      return `'#${HEX}'`;
    case "ios-swiftui":
      return `Color(red:${R1}, green:${G1}, blue:${B1}, opacity:${AF})`;
    case "ios-uikit":
      return `UIColor(red:${R1}, green:${G1}, blue:${B1}, alpha:${AF})`;
    case "android-xml":
      return `#${AHEX}${HEX}`;
    case "tailwind":
      return `text-[color:#${HEX}]`;
    default:
      return `#${HEX}`;
  }
}
function sample(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return {
    hex: hex.toUpperCase(),
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16),
    a: 255,
  };
}
