// sw.js (MV3) — Page Console Debug Only

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== "pick-screen-color" && cmd !== "convert-color-format") return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  if (!/^https?:/i.test(tab.url || "")) return;

  // Check shortcut trigger
  const payload = { cmd, ts: Date.now() };

  // Check shortcut trigger (quiet send)
  await safeSendMessage(tab.id, { action: "debug-shortcut-log", payload });

  // Alt+C → Start EyeDropper
  if (cmd === "pick-screen-color") {
    await safeSendMessage(tab.id, { action: "start-eyedropper", payload });
    return;
  }

  // Alt+D → Convert clipboard color format
  if (cmd === "convert-color-format") {
    let text = "";
    try {
      const resp = await readClipboardFromOffscreen();
      text = resp?.text || "";
    } catch (e) {
      console.debug("[CodeTint] offscreen read failed:", e);
    }
    await safeSendMessage(tab.id, {
      action: "convert-color-format",
      text,
      payload,
    });
  }
});

// ----- offscreen helpers -----
async function ensureOffscreen() {
  if (!chrome.offscreen) return;
  if (chrome.offscreen.hasDocument) {
    if (await chrome.offscreen.hasDocument()) return;
  }
  await chrome.offscreen.createDocument({
    url: chrome.runtime.getURL("offscreen.html"),
    reasons: ["CLIPBOARD"],
    justification: "Read clipboard to convert color format via Alt+D",
  });
}

async function readClipboardFromOffscreen() {
  await ensureOffscreen();
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "read-clipboard" }, resolve);
  });
}

// swallow lastError to avoid "Unchecked runtime.lastError"
function safeSendMessage(tabId, message) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, message, () => {
        void chrome.runtime.lastError; // consume if receiver is missing
        resolve();
      });
    } catch {
      resolve(); // e.g., tab already gone
    }
  });
}
