(() => {
  if (window.__codetint_ready) return;
  window.__codetint_ready = true;

  // Expose shared utils (formatByProfile, sample, clamp255, makeColor) from lib/color.js
  let formatByProfile, sample, clamp255, makeColor;

  // Load shared module and assign exported functions to module-scope bindings
  const ColorLibReady = import(chrome.runtime.getURL("lib/color.js")).then(
    (m) => {
      ({ formatByProfile, sample, clamp255, makeColor } = m);
    }
  );

  // Register the message listener only in the top frame (avoid duplicate toasts/events in iframes)
  if (window === window.top) {
    chrome.runtime.onMessage.addListener(async (msg) => {
      // Ensure color utils are loaded before using them
      await ColorLibReady;

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

          const { profile = "flutter" } = await chrome.storage.local.get(
            "profile"
          );
          const text = formatByProfile(profile, color);

          await navigator.clipboard.writeText(text);
          console.log(`[CodeTint] Picked ${sRGBHex} → Copied: ${text}`);
          showToast(`Copied ${text}`, sRGBHex);

          // Persist last color
          await chrome.storage.local.set({ last: color });

          // Keep recent history (dedupe by hex, limit to 8)
          {
            const { history = [] } = await chrome.storage.local.get("history");
            const next = [
              { ...color },
              ...history.filter((c) => c.hex !== color.hex),
            ].slice(0, 8);
            await chrome.storage.local.set({ history: next });
          }
        } catch (e) {
          const msg = e && e.message ? e.message : String(e);

          // User canceled
          if (/abort|canceled?/i.test(msg)) {
            showToast("Canceled", "#000");
            return;
          }

          // User gesture required → retry on the next click
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

                // Persist last color
                await chrome.storage.local.set({ last: color });

                // Keep recent history (dedupe by hex, limit to 8)
                const { history = [] } = await chrome.storage.local.get(
                  "history"
                );
                const next = [
                  { ...color },
                  ...history.filter((c) => c.hex !== color.hex),
                ].slice(0, 8);
                await chrome.storage.local.set({ history: next });
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

      // Alt+D → Convert clipboard color format
      if (msg?.action === "convert-color-format") {
        try {
          // Prefer text provided by SW; fallback to direct clipboard read as a last resort
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

          const { profile = "flutter" } = await chrome.storage.local.get(
            "profile"
          );
          const out = formatByProfile(profile, color);

          try {
            await navigator.clipboard.writeText(out);
            showToast(`Converted: ${out}`, color.hex || "#000");
          } catch {
            showToast("Clipboard write failed", color.hex || "#000");
          }

          // Persist last color
          await chrome.storage.local.set({ last: color });

          // Keep recent history (dedupe by hex, limit to 8)
          {
            const { history = [] } = await chrome.storage.local.get("history");
            const next = [
              { ...color },
              ...history.filter((c) => c.hex !== color.hex),
            ].slice(0, 8);
            await chrome.storage.local.set({ history: next });
          }
        } catch (e) {
          console.warn("[CodeTint] Convert error:", e);
          showToast(`Error: ${e?.name || e?.message || "Unknown"}`, "#000");
        }
      }
    });
  }

  // ---- Parse various color string formats → {hex,r,g,b,a} ----
  function parseClipboardColor(input) {
    const s = String(input || "").trim();
    if (!s) return null;

    // 0) CSS named colors (extend as needed)
    const NAMED = {
      black: "#000000",
      white: "#FFFFFF",
      red: "#FF0000",
      lime: "#00FF00",
      blue: "#0000FF",
      gray: "#808080",
      grey: "#808080",
      silver: "#C0C0C0",
      maroon: "#800000",
      green: "#008000",
      navy: "#000080",
      teal: "#008080",
      purple: "#800080",
      olive: "#808000",
      orange: "#FFA500",
      aqua: "#00FFFF",
      fuchsia: "#FF00FF",
      rebeccapurple: "#663399",
      transparent: "#00000000",
    };
    const lower = s.toLowerCase();
    if (NAMED[lower]) {
      const hex = NAMED[lower].replace("#", "");
      if (hex.length === 8) return fromRRGGBBAA(hex.toUpperCase());
      return sample("#" + hex);
    }

    // 1) Flutter: const Color(0xAARRGGBB)
    let m = /0x([A-Fa-f0-9]{8})\b/.exec(s);
    if (m) return fromAARRGGBB(m[1].toUpperCase());

    // 2) 8-digit hex: #RRGGBBAA (CSS) vs #AARRGGBB (Android XML) → choose heuristically
    m = /#([A-Fa-f0-9]{8})\b/.exec(s);
    if (m) {
      const hex8 = m[1].toUpperCase();
      const css = fromRRGGBBAA(hex8);
      const android = fromAARRGGBB(hex8);

      // If the string hints Android/XML formats, pick Android-style
      if (/android|xml|aarrggbb/i.test(s)) return android;

      // If only one result is semi-transparent, prefer that one
      if (css.a !== 255 && android.a === 255) return css;
      if (android.a !== 255 && css.a === 255) return android;

      // Default to CSS 8-digit
      return css;
    }

    // 3) #RRGGBB / RRGGBB
    m = /#([A-Fa-f0-9]{6})\b/.exec(s) || /\b([A-Fa-f0-9]{6})\b/.exec(s);
    if (m) return sample("#" + m[1]);

    // 4) #RGB / #RGBA (3/4 digits)
    m = /#([A-Fa-f0-9]{3,4})\b/.exec(s);
    if (m) return fromShortHex(m[1].toUpperCase());

    // 5) Tailwind form: text-[color:#RRGGBB]
    m = /text-\[color:#([A-Fa-f0-9]{6})\]/.exec(s);
    if (m) return sample("#" + m[1]);

    // 6) CSS rgba()/rgb()
    m =
      /rgba?\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})(?:\s*,\s*([0-9.]+))?\s*\)/i.exec(
        s
      );
    if (m) {
      const r = clamp255(+m[1]),
        g = clamp255(+m[2]),
        b = clamp255(+m[3]);
      const a =
        m[4] != null ? clamp255(Math.round(parseFloat(m[4]) * 255)) : 255;
      return makeColor(r, g, b, a);
    }

    // 7) hsl()/hsla()
    m =
      /hsla?\(\s*([\-0-9.]+)\s*,\s*([0-9.]+)%\s*,\s*([0-9.]+)%(?:\s*,\s*([0-9.]+))?\s*\)/i.exec(
        s
      );
    if (m) {
      const h = parseFloat(m[1]);
      const sPct = parseFloat(m[2]);
      const lPct = parseFloat(m[3]);
      const aF = m[4] != null ? parseFloat(m[4]) : 1;
      return hslToRgba(
        h,
        sPct / 100,
        lPct / 100,
        clamp255(Math.round(aF * 255))
      );
    }

    // 8) SwiftUI
    m =
      /Color\(\s*red:\s*([0-9.]+)\s*,\s*green:\s*([0-9.]+)\s*,\s*blue:\s*([0-9.]+)\s*,\s*(?:opacity|alpha):\s*([0-9.]+)\s*\)/i.exec(
        s
      );
    if (m) {
      const r = clamp255(Math.round(parseFloat(m[1]) * 255));
      const g = clamp255(Math.round(parseFloat(m[2]) * 255));
      const b = clamp255(Math.round(parseFloat(m[3]) * 255));
      const a = clamp255(Math.round(parseFloat(m[4]) * 255));
      return makeColor(r, g, b, a);
    }

    // 9) UIKit
    m =
      /UI(?:Color)?\(\s*red:\s*([0-9.]+)\s*,\s*green:\s*([0-9.]+)\s*,\s*blue:\s*([0-9.]+)\s*,\s*alpha:\s*([0-9.]+)\s*\)/i.exec(
        s
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

  // Helpers (use shared clamp255/makeColor from lib/color.js)
  function fromShortHex(sh) {
    // #RGB → #RRGGBB, #RGBA → #RRGGBBAA
    if (sh.length === 3) {
      const r = sh[0] + sh[0],
        g = sh[1] + sh[1],
        b = sh[2] + sh[2];
      return makeColor(parseInt(r, 16), parseInt(g, 16), parseInt(b, 16), 255);
    }
    // 4-digit RGBA
    const r = sh[0] + sh[0],
      g = sh[1] + sh[1],
      b = sh[2] + sh[2],
      a = sh[3] + sh[3];
    return makeColor(
      parseInt(r, 16),
      parseInt(g, 16),
      parseInt(b, 16),
      parseInt(a, 16)
    );
  }

  function fromRRGGBBAA(rrggbbaa) {
    const R = parseInt(rrggbbaa.slice(0, 2), 16);
    const G = parseInt(rrggbbaa.slice(2, 4), 16);
    const B = parseInt(rrggbbaa.slice(4, 6), 16);
    const A = parseInt(rrggbbaa.slice(6, 8), 16);
    return makeColor(R, G, B, A);
  }

  function hslToRgba(h, s, l, a = 255) {
    // H in degrees; s, l in [0, 1]
    const C = (1 - Math.abs(2 * l - 1)) * s;
    const Hp = (((h % 360) + 360) % 360) / 60;
    const X = C * (1 - Math.abs((Hp % 2) - 1));
    let r1 = 0,
      g1 = 0,
      b1 = 0;
    if (0 <= Hp && Hp < 1) [r1, g1, b1] = [C, X, 0];
    else if (1 <= Hp && Hp < 2) [r1, g1, b1] = [X, C, 0];
    else if (2 <= Hp && Hp < 3) [r1, g1, b1] = [0, C, X];
    else if (3 <= Hp && Hp < 4) [r1, g1, b1] = [0, X, C];
    else if (4 <= Hp && Hp < 5) [r1, g1, b1] = [X, 0, C];
    else [r1, g1, b1] = [C, 0, X];
    const m = l - C / 2;
    const r = clamp255(Math.round((r1 + m) * 255));
    const g = clamp255(Math.round((g1 + m) * 255));
    const b = clamp255(Math.round((b1 + m) * 255));
    return makeColor(r, g, b, a);
  }

  function fromAARRGGBB(aargb) {
    const A = parseInt(aargb.slice(0, 2), 16);
    const R = parseInt(aargb.slice(2, 4), 16);
    const G = parseInt(aargb.slice(4, 6), 16);
    const B = parseInt(aargb.slice(6, 8), 16);
    return makeColor(R, G, B, A);
  }

  // ---------- Toast UI (bottom-right, dark-mode aware) ----------
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

    // Fade-in
    requestAnimationFrame(() => {
      box.style.opacity = "1";
      box.style.transform = "translateY(0)";
    });

    // Auto-dismiss
    setTimeout(() => {
      box.style.opacity = "0";
      box.style.transform = "translateY(8px)";
      setTimeout(() => box.remove(), 180);
    }, 1600);
  }
})();
