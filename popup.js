import { formatByProfile, sample } from "./lib/color.js";

const sel = document.getElementById("profile");
const swatch = document.getElementById("swatch");
const preview = document.getElementById("preview");
const copyPreviewBtn = document.getElementById("copyPreview");
const openShortcuts = document.getElementById("openShortcuts");

(async function init() {
  const { profile = "flutter" } = await chrome.storage.local.get("profile");
  sel.value = profile;

  const { last } = await chrome.storage.local.get("last");
  if (last) renderPreview(sel.value, last);
  else renderEmpty();

  setTriggerLabelToCurrent();
  await renderHistory();
})();

sel.addEventListener("change", async () => {
  await chrome.storage.local.set({ profile: sel.value });

  const { last } = await chrome.storage.local.get("last");
  if (last) renderPreview(sel.value, last);
  else renderEmpty();

  setTriggerLabelToCurrent();
  await renderHistory();
});

function setTriggerLabelToCurrent() {
  const valSpan = document.querySelector("#profile_trigger .select-value");
  if (!valSpan) return;
  const opt = sel.options[sel.selectedIndex];
  valSpan.textContent = opt?.textContent?.trim() || sel.value;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.last) {
    const nv = changes.last.newValue;
    nv ? renderPreview(sel.value, nv) : renderEmpty();
  }
  if (changes.history) renderHistory();
});

const clearHistoryBtn = document.getElementById("clearHistory");
if (clearHistoryBtn) {
  clearHistoryBtn.addEventListener("click", async () => {
    await chrome.storage.local.set({ history: [] });
    await renderHistory();
  });
}

// --- Shared copy logic (used by button & preview) ---
async function copyCurrentPreview() {
  const { last } = await chrome.storage.local.get("last");
  if (!last) return;
  const text = formatByProfile(sel.value, last);
  await navigator.clipboard.writeText(text);

  // Button feedback (if present)
  if (copyPreviewBtn) {
    copyPreviewBtn.textContent = "Copied!";
    setTimeout(() => (copyPreviewBtn.textContent = "Copy"), 800);
  }

  // Optional visual hint on preview
  if (preview) {
    preview.classList.add("copied");
    setTimeout(() => preview.classList.remove("copied"), 200);
  }
}

// Button → copy
copyPreviewBtn.addEventListener("click", copyCurrentPreview);

// Preview → click / keyboard to copy
if (preview) {
  preview.addEventListener("click", copyCurrentPreview);
  preview.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      copyCurrentPreview();
    }
  });
  // a11y / affordance
  preview.setAttribute("role", "button");
  preview.setAttribute("tabindex", "0");
  preview.setAttribute("aria-label", "Copy color code");
}

// Enable/disable copy UI together
function setCopyEnabled(enabled) {
  copyPreviewBtn.disabled = !enabled;
  copyPreviewBtn.setAttribute("aria-disabled", String(!enabled));
  preview.classList.toggle("copyable", enabled);
  preview.setAttribute("aria-disabled", String(!enabled));
}

// Render “no last color” state
function renderEmpty() {
  preview.textContent = "—";
  preview.title = "No color yet";
  swatch.style.background = "transparent";
  swatch.classList.add("is-empty");
  swatch.title = "No color yet";
  setCopyEnabled(false);
}

// Render normal preview
function renderPreview(profile, color) {
  preview.textContent = formatByProfile(profile, color);
  preview.title = preview.textContent;
  swatch.style.background = color?.hex || "transparent";
  swatch.classList.remove("is-empty");
  swatch.title = color?.hex || "";
  setCopyEnabled(true);
}

openShortcuts.addEventListener("click", () =>
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" })
);

// function renderPreview(profile, color) {
//   preview.textContent = formatByProfile(profile, color);
//   swatch.style.background = color?.hex || "#000";
// }

// dropdown
(function initProfileDropdown() {
  const sourceSel = document.querySelector(".select-group")?.dataset?.source;
  const selectEl = sourceSel ? document.querySelector(sourceSel) : null;
  const trigger = document.getElementById("profile_trigger");
  const panel = document.getElementById("profile_listbox");
  const valueSpan = trigger?.querySelector(".select-value");

  if (!selectEl || !trigger || !panel || !valueSpan) return;

  // Build option list from the native <select>
  const buildOptions = () => {
    panel.innerHTML = "";
    Array.from(selectEl.options).forEach((opt, idx) => {
      const li = document.createElement("li");
      li.className = "select-option";
      li.setAttribute("role", "option");
      li.dataset.value = opt.value;
      const label = opt.textContent?.trim() || opt.value;
      const desc = opt.dataset?.desc || "";
      li.innerHTML = `
       <span class="opt-label">${label}</span>
       <span class="opt-desc" title="${desc.replace(
         /"/g,
         "&quot;"
       )}">${desc}</span>
     `;
      li.setAttribute("aria-label", `${label}${desc ? ", " + desc : ""}`);

      if (opt.value === selectEl.value) {
        li.classList.add("is-selected");
        valueSpan.textContent = label;
        panel.setAttribute("aria-activedescendant", `opt-${idx}`);
      }
      li.id = `opt-${idx}`;
      panel.appendChild(li);
    });
  };

  const open = () => {
    buildOptions();
    trigger.setAttribute("aria-expanded", "true");
    panel.style.display = "block";
    // Give a focus/active hint to the selected item
    const sel =
      panel.querySelector(".select-option.is-selected") ||
      panel.firstElementChild;
    sel?.classList.add("is-active");
  };

  const close = () => {
    trigger.setAttribute("aria-expanded", "false");
    panel.style.display = "none";
    // Remove active indication
    panel
      .querySelectorAll(".is-active")
      .forEach((el) => el.classList.remove("is-active"));
  };

  const toggle = () => (panel.style.display === "block" ? close() : open());

  const commit = (value, text) => {
    const prev = selectEl.value;
    selectEl.value = value;
    const labelOnly =
      selectEl.options[selectEl.selectedIndex]?.textContent?.trim() || value;
    valueSpan.textContent = labelOnly;
    panel.querySelectorAll(".select-option").forEach((el) => {
      el.classList.toggle("is-selected", el.dataset.value === value);
    });
    close();
    if (prev !== value) {
      selectEl.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };

  // Click/keyboard handling
  trigger.addEventListener("click", toggle);

  panel.addEventListener("click", (e) => {
    const item = e.target.closest(".select-option");
    if (!item) return;
    commit(item.dataset.value);
  });

  // Keyboard: ArrowUp/ArrowDown to navigate, Enter to select, Esc to close
  trigger.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  });

  panel.addEventListener("keydown", (e) => {
    const items = Array.from(panel.querySelectorAll(".select-option"));
    const current = panel.querySelector(".select-option.is-active");
    let idx = Math.max(0, items.indexOf(current));

    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[idx]?.classList.remove("is-active");
      idx = Math.min(items.length - 1, idx + 1);
      items[idx]?.classList.add("is-active");
      items[idx]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[idx]?.classList.remove("is-active");
      idx = Math.max(0, idx - 1);
      items[idx]?.classList.add("is-active");
      items[idx]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const i = items[idx];
      if (i) commit(i.dataset.value, i.textContent);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
      trigger.focus();
    }
  });

  // Close when clicking outside
  document.addEventListener("click", (e) => {
    if (!trigger.contains(e.target) && !panel.contains(e.target)) close();
  });

  // Initial render (reflect current selection of the native select)
  const selectedOpt =
    selectEl.options[selectEl.selectedIndex] || selectEl.options[0];
  if (selectedOpt) {
    valueSpan.textContent = selectedOpt.textContent || selectedOpt.value;
  }
})();

// Shortcuts
// Render current shortcuts when the popup opens
document.addEventListener("DOMContentLoaded", () => {
  hydrateShortcuts();
  wireOpenShortcuts();
});

function escapeHTML(s) {
  return String(s).replace(
    /[&<>"']/g,
    (m) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        m
      ])
  );
}

async function hydrateShortcuts() {
  try {
    const commands = await chrome.commands.getAll();

    // Hide internal commands EXCEPT "_execute_action"
    const visible = commands.filter(
      (c) => c.name === "_execute_action" || !/^_execute_/.test(c.name)
    );

    // Desired order (keys must match manifest "commands" names)
    const WEIGHT = {
      _execute_action: 0, // Open popup
      "pick-screen-color": 1, // Alt+C
      "convert-color-format": 2, // Alt+D
    };

    // Optional label overrides
    const LABELS = {
      _execute_action: "Open popup",
    };

    // Sort by weight, then by label (alphabetically)
    const sorted = visible.slice().sort((a, b) => {
      const wa = WEIGHT[a.name] ?? 99;
      const wb = WEIGHT[b.name] ?? 99;
      if (wa !== wb) return wa - wb;
      const la = LABELS[a.name] || a.description || a.name || "";
      const lb = LABELS[b.name] || b.description || b.name || "";
      return la.localeCompare(lb);
    });

    const html = sorted
      .map((c) => {
        const label = LABELS[c.name] || c.description || c.name;
        const keys = c.shortcut && c.shortcut.trim() ? c.shortcut : "Not set";
        return `
        <div class="shortcut-item">
          <span class="shortcut-label">${escapeHTML(label)}</span>
          <kbd class="shortcut-keys">${escapeHTML(keys)}</kbd>
        </div>`;
      })
      .join("");

    const el = document.getElementById("shortcutsContainer");
    el.innerHTML =
      html ||
      '<div class="shortcut-item"><span class="shortcut-label">No commands</span></div>';
  } catch (e) {
    console.error("Failed to load shortcuts", e);
    const el = document.getElementById("shortcutsContainer");
    el.textContent = "Could not load shortcuts.";
  }
}

function wireOpenShortcuts() {
  const btn = document.getElementById("openShortcuts");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    // Fallback so it still opens even if the tabs API fails
    try {
      await chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
    } catch {
      window.open("chrome://extensions/shortcuts", "_blank");
    }
  });
}

async function renderHistory() {
  const wrap = document.getElementById("history");
  if (!wrap) return;

  const { history = [] } = await chrome.storage.local.get("history");
  wrap.innerHTML = "";

  if (!history.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No recent colors";
    wrap.appendChild(empty);
    return;
  }

  // Build chips
  for (const c of history) {
    // The history array already stores {hex,r,g,b,a}. As a safeguard, recover from hex-only entries.
    const color = typeof c?.r === "number" ? c : sample(c?.hex || "#000000");

    const btn = document.createElement("button");
    btn.className = "chip";
    btn.type = "button";
    btn.title = `Copy ${formatByProfile(sel.value, color)}`;
    btn.setAttribute("aria-label", `Copy ${color.hex}`);
    btn.dataset.hex = color.hex;
    btn.style.background = color.hex || "#000";

    btn.addEventListener("click", async () => {
      const text = formatByProfile(sel.value, color);

      // instant visual feedback
      btn.dataset.copied = "1";

      // paint flush (ensure the ring shows up before clipboard work)
      await new Promise(requestAnimationFrame);

      try {
        // do the async write
        await navigator.clipboard.writeText(text);
      } catch (e) {
        console.error("Copy failed", e);
      } finally {
        // remove feedback after a short delay
        setTimeout(() => btn.removeAttribute("data-copied"), 600);
      }
    });

    wrap.appendChild(btn);
  }
}

(async function () {
  const key = "codetint_blocked";
  const { [key]: info } = await chrome.storage.session.get(key);
  if (info?.message) {
    const el = document.getElementById("blockedBanner");
    if (el) {
      el.textContent = info.message;
      el.style.display = "block";
      // Auto-hide after 2.5 seconds
      setTimeout(() => (el.style.display = "none"), 5000);
    }
    // Since it was shown, clean up the flag and reset the badge
    await chrome.storage.session.remove(key);
    chrome.action.setBadgeText({ text: "" });
  }
})();

//SPONSOR
const SPONSOR_URL = "https://github.com/sponsors/eclipse25";
const BMAC_URL = "https://buymeacoffee.com/eclipse25";

const $ = (q) => document.querySelector(q);
const cta = $("#support-cta");
const inline = $("#support-inline");

cta.addEventListener("click", () => {
  const isOpen = !inline.classList.contains("hidden");
  if (isOpen) {
    inline.classList.add("hidden");
    inline.innerHTML = "";
    cta.setAttribute("aria-expanded", "false");
  } else {
    renderQuestionRow();
    inline.classList.remove("hidden");
    cta.setAttribute("aria-expanded", "true");
  }
});

inline.addEventListener("click", (e) => {
  const id = e.target.id;
  if (id === "dev-yes") return renderActionRow("github");
  if (id === "dev-no") return renderActionRow("bmac");
  if (id === "go-sponsor") return openSupport(SPONSOR_URL);
  if (id === "go-bmac") return openSupport(BMAC_URL);
});

function renderQuestionRow() {
  inline.innerHTML = `
    <span class="label">Are you a developer?</span>
    <button id="dev-yes" class="primary sm">Yes</button>
    <button id="dev-no" class="secondary sm">No</button>
  `;
}

function renderActionRow(kind) {
  inline.innerHTML =
    kind === "github"
      ? `<button id="go-sponsor" class="primary">Sponsor on GitHub</button>`
      : `<button id="go-bmac" class="secondary">Buy me a coffee</button>`;
}

function openSupport(base) {
  const ver = chrome.runtime.getManifest().version;
  const qs = new URLSearchParams({
    utm_source: "codetint",
    utm_medium: "extension",
    utm_campaign: "popup",
    v: ver,
  }).toString();
  const url = base + (base.includes("?") ? "&" : "?") + qs;
  chrome.tabs.create({ url });
}
