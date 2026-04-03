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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_TAB_ID') {
    sendResponse({ tabId: sender.tab?.id });
    return true;
  }

  // Content script running inside a cross-origin iframe relays extracted messages
  // here. Forward them to the main frame (frameId 0) of the same tab.
  if (message.type === 'IFRAME_CHAT_MESSAGES') {
    if (sender.tab?.id) {
      chrome.tabs.sendMessage(
        sender.tab.id,
        { type: 'IFRAME_CHAT_MESSAGES', messages: message.messages },
        { frameId: 0 }
      );
    }
    return false;
  }

  return false;
});
