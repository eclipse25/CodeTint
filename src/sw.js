// sw.js (MV3) — Page Console Debug Only

const RESTRICTED_SCHEMES = /^(chrome|chrome-search|edge|about):/i;
const WEBSTORE_RE =
  /(^https:\/\/chromewebstore\.google\.)|(^https:\/\/chrome\.google\.com\/webstore)/i;
const HTTP_S = /^https?:/i;
const FILE = /^file:/i;

/** Return a reason ONLY when blocked; null when allowed (http/https). */
function getBlockReason(url) {
  if (!url) return "unknown";
  if (RESTRICTED_SCHEMES.test(url)) return "chrome";
  if (WEBSTORE_RE.test(url)) return "webstore";
  if (FILE.test(url)) return "file";
  if (!HTTP_S.test(url)) return "unknown";
  return null; // allowed
}

// ---- Badge helpers (tab-scoped) ----
function setBadgeWarning(show, tabId) {
  const params = tabId ? { tabId } : {};
  if (show) {
    chrome.action.setBadgeText({ text: "!", ...params });
    chrome.action.setBadgeBackgroundColor({ color: "#d97706" });
  } else {
    chrome.action.setBadgeText({ text: "", ...params });
  }
}

// auto-clear after N ms (fallback in case popup didn't open)
function clearBadgeSoon(tabId, ms = 2500) {
  try {
    setTimeout(() => setBadgeWarning(false, tabId), ms);
  } catch {}
}

/**
 * Notify the user via extension-side UI (popup banner + system notification + badge)
 * that the command can't run on the current page.
 */
async function notifyBlocked({ cmd, url, tabId }) {
  const reason = getBlockReason(url) ?? "unknown";

  let message =
    "This page doesn't allow extensions to run. Try again on a normal webpage.";
  if (reason === "chrome")
    message = "Internal pages like chrome://newtab and Settings are blocked.";
  else if (reason === "webstore")
    message = "Chrome Web Store pages are blocked.";
  else if (reason === "file")
    message =
      "file:// pages are blocked by default. Enable 'Allow access to file URLs' in the extension settings.";
  else if (reason === "unknown")
    message =
      "This page restricts script injection. Try again on a normal webpage.";

  // 1) Ask the popup to show a banner
  await chrome.storage.session.set({
    codetint_blocked: { cmd, url, message, ts: Date.now() },
  });

  // 2) Open the popup immediately (keyboard command → user gesture)
  try {
    await chrome.action.openPopup();
  } catch {}

  // 3) Show tab-scoped badge briefly, then clear
  setBadgeWarning(true, tabId);
  clearBadgeSoon(tabId, 2500);
}

// Clear badge when user switches to an allowed page
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab?.url && !getBlockReason(tab.url)) setBadgeWarning(false, tabId);
  } catch {}
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (
    changeInfo.status === "complete" &&
    tab?.url &&
    !getBlockReason(tab.url)
  ) {
    setBadgeWarning(false, tabId);
  }
});

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== "pick-screen-color" && cmd !== "convert-color-format") return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  const url = tab.url || "";
  const reason = getBlockReason(url);
  if (reason) {
    await notifyBlocked({ cmd, url, tabId: tab.id });
    return;
  }

  // ===== Normal flow on allowed http/https pages =====
  const payload = { cmd, ts: Date.now() };

  // Clear any badge when we’re about to run successfully
  setBadgeWarning(false, tab.id);

  await ensureInjected(tab.id);

  // Quietly log shortcut trigger (no-op if content script isn't present)
  await safeSendMessage(tab.id, { action: "debug-shortcut-log", payload });

  if (cmd === "pick-screen-color") {
    await safeSendMessage(tab.id, { action: "start-eyedropper", payload });
    return;
  }

  if (cmd === "convert-color-format") {
    await safeSendMessage(tab.id, {
      action: "convert-color-format",
      text: "",
      payload,
    });
  }
});

/** Send message and swallow runtime.lastError noise. */
function safeSendMessage(tabId, message) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, message, () => {
        void chrome.runtime.lastError;
        resolve();
      });
    } catch {
      resolve();
    }
  });
}

async function ensureInjected(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
      world: "ISOLATED",
    });
  } catch {}
}
