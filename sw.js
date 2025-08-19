// sw.js (MV3) — Page Console Debug Only

chrome.commands.onCommand.addListener(async (cmd) => {
  if (!["pick-screen-color", "convert-color-format"].includes(cmd)) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  if (!/^https?:/i.test(tab.url || "")) return;

  // Check shortcut trigger
  const payload = { cmd, ts: Date.now() };
  chrome.tabs
    .sendMessage(tab.id, { action: "debug-shortcut-log", payload })
    .catch(() => console.warn("[CodeTint] content.js not available"));

  // Alt+C → Start EyeDropper
  if (cmd === "pick-screen-color") {
    chrome.tabs
      .sendMessage(tab.id, {
        action: "start-eyedropper",
        payload,
      })
      .catch(() => console.warn("[CodeTint] content.js not available"));
  }
});
