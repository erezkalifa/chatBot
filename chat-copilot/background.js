// Service worker - minimal, handles extension lifecycle only

chrome.runtime.onInstalled.addListener(() => {
  // Set default settings on install
  chrome.storage.local.get('settings', (data) => {
    if (!data.settings) {
      chrome.storage.local.set({
        settings: {
          maxAttempts: 10,
          defaultMode: 'auto',
          defaultTone: 'polite',
          defaultGoal: 'general'
        }
      });
    }
  });
});

// Relay messages between content script and sidebar iframe if needed
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_TAB_ID') {
    sendResponse({ tabId: sender.tab?.id });
  }
  return true;
});
