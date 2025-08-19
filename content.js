// content.js

chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg?.action === "debug-shortcut-log") {
    const { cmd, ts } = msg.payload || {};
    console.log(
      `[CodeTint] ${cmd} @ ${new Date(ts || Date.now()).toLocaleString()}`
    );
  }

  // Alt+C → Start EyeDropper
  if (msg?.action === "start-eyedropper") {
    if (!window.EyeDropper) {
      console.debug("[CodeTint] EyeDropper not supported on this page.");
      return;
    }
    try {
      const { sRGBHex } = await new EyeDropper().open();
      const color = sample(sRGBHex);

      // Load the currently selected profile
      const { profile = "flutter" } = await chrome.storage.local.get("profile");
      const text = formatByProfile(profile, color);

      // copy
      await navigator.clipboard.writeText(text);
      console.log(`[CodeTint] Picked ${sRGBHex} → Copied: ${text}`);
      showToast(`Copied ${text}`, sRGBHex);

      // Save last color for popup preview update (detected by popup.js)
      await chrome.storage.local.set({ last: color });
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);

      // User canceled
      if (/abort|canceled?/i.test(msg)) {
        showToast("Canceled", "#000");
        return;
      }

      // User gesture required → retry on next click
      if (/activation|gesture|user.?input|NotAllowedError/i.test(msg)) {
        showToast("Click anywhere to start picker", "#000");

        const once = async () => {
          document.removeEventListener("pointerdown", once, true);
          try {
            const { sRGBHex } = await new EyeDropper().open();
            const color = sample(sRGBHex);
            const { profile = "flutter" } = await chrome.storage.local.get(
              "profile"
            );
            const text = formatByProfile(profile, color);
            await navigator.clipboard.writeText(text);
            showToast(`Copied ${text}`, sRGBHex);
            await chrome.storage.local.set({ last: color });
          } catch (err) {
            const m2 = String(err?.message || err);
            if (/abort|canceled?/i.test(m2)) showToast("Canceled", "#000");
            else {
              console.debug("[CodeTint] Eyedropper error:", err);
              showToast("Eyedropper error", "#000");
            }
          }
        };

        document.addEventListener("pointerdown", once, true);
        return;
      }

      // Other errors
      console.debug("[CodeTint] Eyedropper error:", e);
      showToast(`Error: ${e?.name || e?.message || "Unknown"}`, "#000");
    }
  }

  // Alt+D → convert clipboard color format
  if (msg?.action === "convert-color-format") {
    try {
      // Use the text provided by the Service Worker (if empty, try a last-resort direct clipboard read)
      let raw = (msg.text || "").trim();
      if (!raw) {
        try {
          raw = (await navigator.clipboard.readText())?.trim() || "";
        } catch {}
      }

      if (!raw) {
        showToast("Clipboard is empty", "#000");
        return;
      }

      const color = parseClipboardColor(raw);
      if (!color) {
        showToast("No color found in clipboard", "#000");
        return;
      }

      const { profile = "flutter" } = await chrome.storage.local.get("profile");
      const out = formatByProfile(profile, color);

      try {
        await navigator.clipboard.writeText(out);
        showToast(`Converted: ${out}`, color.hex || "#000");
      } catch {
        showToast("Clipboard write failed", color.hex || "#000");
      }

      await chrome.storage.local.set({ last: color });
    } catch (e) {
      console.warn("[CodeTint] Convert error:", e);
      showToast(`Error: ${e?.name || e?.message || "Unknown"}`, "#000");
    }
  }
});

function formatByProfile(profile, { hex, r, g, b, a } = sample("#3498DB")) {
  const HEX = (hex || "#000000").replace("#", "").toUpperCase();
  const AHEX = (a ?? 255).toString(16).padStart(2, "0").toUpperCase();
  const R1 = (r / 255).toFixed(3);
  const G1 = (g / 255).toFixed(3);
  const B1 = (b / 255).toFixed(3);
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

// ---- Parse various color string formats → {hex,r,g,b,a} ----
function parseClipboardColor(str) {
  // 1) Flutter: const Color(0xAARRGGBB)
  let m = /0x([A-Fa-f0-9]{8})/.exec(str);
  if (m) return fromAARRGGBB(m[1].toUpperCase());

  // 2) Android XML: #AARRGGBB
  m = /#([A-Fa-f0-9]{8})\b/.exec(str);
  if (m) return fromAARRGGBB(m[1].toUpperCase());

  // 3) Hex 6-digit (css-hex, react-native, tailwind)
  //   - '#RRGGBB' | RRGGBB | '#RRGGBB' in text-[color:#RRGGBB]
  m = /#([A-Fa-f0-9]{6})\b/.exec(str) || /\b([A-Fa-f0-9]{6})\b/.exec(str);
  if (m) return sample("#" + m[1]);

  // tailwind form: text-[color:#RRGGBB]
  m = /text-\[color:#([A-Fa-f0-9]{6})\]/.exec(str);
  if (m) return sample("#" + m[1]);

  // 4) CSS rgba()/rgb()
  m =
    /rgba?\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})(?:\s*,\s*([0-9.]+))?\s*\)/i.exec(
      str
    );
  if (m) {
    const r = clamp255(+m[1]),
      g = clamp255(+m[2]),
      b = clamp255(+m[3]);
    const a = m[4] != null ? clamp255(Math.round(parseFloat(m[4]) * 255)) : 255;
    return makeColor(r, g, b, a);
  }

  // 5) SwiftUI: Color(red:x, green:y, blue:z, opacity:a)
  m =
    /Color\(\s*red:\s*([0-9.]+)\s*,\s*green:\s*([0-9.]+)\s*,\s*blue:\s*([0-9.]+)\s*,\s*(?:opacity|alpha):\s*([0-9.]+)\s*\)/i.exec(
      str
    );
  if (m) {
    const r = clamp255(Math.round(parseFloat(m[1]) * 255));
    const g = clamp255(Math.round(parseFloat(m[2]) * 255));
    const b = clamp255(Math.round(parseFloat(m[3]) * 255));
    const a = clamp255(Math.round(parseFloat(m[4]) * 255));
    return makeColor(r, g, b, a);
  }

  // 6) UIKit: UIColor(red:x, green:y, blue:z, alpha:a)
  m =
    /UI(?:Color)?\(\s*red:\s*([0-9.]+)\s*,\s*green:\s*([0-9.]+)\s*,\s*blue:\s*([0-9.]+)\s*,\s*alpha:\s*([0-9.]+)\s*\)/i.exec(
      str
    );
  if (m) {
    const r = clamp255(Math.round(parseFloat(m[1]) * 255));
    const g = clamp255(Math.round(parseFloat(m[2]) * 255));
    const b = clamp255(Math.round(parseFloat(m[3]) * 255));
    const a = clamp255(Math.round(parseFloat(m[4]) * 255));
    return makeColor(r, g, b, a);
  }

  return null;
}

function fromAARRGGBB(aargb) {
  const A = parseInt(aargb.slice(0, 2), 16);
  const R = parseInt(aargb.slice(2, 4), 16);
  const G = parseInt(aargb.slice(4, 6), 16);
  const B = parseInt(aargb.slice(6, 8), 16);
  return makeColor(R, G, B, A);
}

function makeColor(r, g, b, a = 255) {
  const hex =
    "#" +
    [r, g, b]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
  return { hex, r, g, b, a };
}
function clamp255(n) {
  return Math.max(0, Math.min(255, n));
}

// ---------- Toast (bottom-right, dark-mode aware) ----------
function ensureToastContainer() {
  let c = document.getElementById("codetint-toast-container");
  if (c) return c;
  c = document.createElement("div");
  c.id = "codetint-toast-container";
  Object.assign(c.style, {
    position: "fixed",
    right: "12px",
    bottom: "12px",
    zIndex: 2147483647,
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    alignItems: "flex-end",
    pointerEvents: "none",
  });
  document.documentElement.appendChild(c);
  return c;
}

function showToast(message, colorHex = "#000") {
  const container = ensureToastContainer();

  const dark =
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;

  const bg = dark ? "#fff" : "#111";
  const fg = dark ? "#111" : "#fff";
  const border = dark ? "#e5e7eb" : "#444";

  const box = document.createElement("div");
  Object.assign(box.style, {
    pointerEvents: "auto",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 12px",
    background: bg,
    color: fg,
    borderRadius: "10px",
    boxShadow: "0 6px 16px rgba(0,0,0,.3)",
    fontSize: "12px",
    maxWidth: "360px",
    transform: "translateY(8px)",
    opacity: "0",
    transition: "opacity 140ms ease, transform 140ms ease",
    border: `1px solid ${border}`,
  });

  const text = document.createElement("span");
  text.textContent = message;

  const swatch = document.createElement("span");
  Object.assign(swatch.style, {
    width: "12px",
    height: "12px",
    borderRadius: "3px",
    border: `1px solid ${border}`,
    background: colorHex || "#000",
    flex: "0 0 auto",
  });

  box.append(text, swatch);
  container.appendChild(box);

  // fade-in
  requestAnimationFrame(() => {
    box.style.opacity = "1";
    box.style.transform = "translateY(0)";
  });

  // auto-dismiss
  setTimeout(() => {
    box.style.opacity = "0";
    box.style.transform = "translateY(8px)";
    setTimeout(() => box.remove(), 180);
  }, 1600);
}
