chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "read-clipboard") {
    navigator.clipboard
      .readText()
      .then((text) => sendResponse({ text }))
      .catch((e) => sendResponse({ error: e?.message || String(e) }));
    return true; // async response
  }
});
