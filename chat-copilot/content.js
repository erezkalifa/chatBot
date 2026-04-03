// Content script — injects sidebar, reads visible chat text, handles insert

(function () {
  'use strict';

  // Only accept postMessages from our own extension pages (e.g. the sidebar iframe)
  const EXTENSION_ORIGIN = chrome.runtime.getURL('').slice(0, -1); // "chrome-extension://<id>"

  // ── Sidebar width constant — adjust here to resize the panel globally ────
  const SIDEBAR_WIDTH = 360; // px

  let sidebarFrame = null;
  let sidebarContainer = null;
  let toggleBtn = null;   // hoisted so toggleSidebar can reposition it
  let isOpen = false;
  let myTabId = null;

  // ── Docking state ─────────────────────────────────────────────────────────
  let dockTarget      = null;  // the element whose margin/padding we shifted
  let dockProp        = '';    // 'marginRight' or 'paddingRight'
  let dockOrigValue   = '';    // its original inline value before we touched it

  // Fetch this tab's ID from the background (works from content scripts)
  chrome.runtime.sendMessage({ type: 'GET_TAB_ID' }, (response) => {
    myTabId = response?.tabId ?? null;
  });

  // ─── SIDEBAR INJECTION ──────────────────────────────────────────────────

  function injectSidebar() {
    if (sidebarContainer) return;

    // Container div that slides in from right
    sidebarContainer = document.createElement('div');
    sidebarContainer.id = 'chat-copilot-sidebar-container';
    sidebarContainer.style.cssText = `
      position: fixed;
      top: 0;
      right: -${SIDEBAR_WIDTH + 20}px;
      width: ${SIDEBAR_WIDTH}px;
      height: 100vh;
      z-index: 2147483647;
      transition: right 0.3s ease;
      box-shadow: -4px 0 24px rgba(0,0,0,0.18);
    `;

    sidebarFrame = document.createElement('iframe');
    sidebarFrame.src = chrome.runtime.getURL('sidebar/sidebar.html');
    sidebarFrame.id = 'chat-copilot-sidebar';
    sidebarFrame.style.cssText = `
      width: 100%;
      height: 100%;
      border: none;
      display: block;
    `;

    sidebarContainer.appendChild(sidebarFrame);
    document.body.appendChild(sidebarContainer);

    // Toggle button
    toggleBtn = document.createElement('button');
    toggleBtn.id = 'chat-copilot-toggle';
    toggleBtn.title = 'Chat Copilot';
    toggleBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><circle cx="9" cy="10" r="1" fill="currentColor"/><circle cx="12" cy="10" r="1" fill="currentColor"/><circle cx="15" cy="10" r="1" fill="currentColor"/></svg>`;
    toggleBtn.style.cssText = `
      position: fixed;
      top: 50%;
      right: 0px;
      transform: translateY(-50%);
      z-index: 2147483646;
      background: #4f46e5;
      color: white;
      border: none;
      border-radius: 8px 0 0 8px;
      width: 36px;
      height: 56px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: -2px 0 12px rgba(79,70,229,0.4);
      transition: background 0.2s, right 0.3s ease;
    `;
    toggleBtn.addEventListener('mouseenter', () => { toggleBtn.style.background = '#4338ca'; });
    toggleBtn.addEventListener('mouseleave', () => { toggleBtn.style.background = '#4f46e5'; });
    toggleBtn.addEventListener('click', toggleSidebar);

    document.body.appendChild(toggleBtn);
  }

  // ─── DOCKING ────────────────────────────────────────────────────────────────

  // Finds the best element to nudge left when the sidebar opens.
  // Preference order: common SPA root → first large child of body → body itself.
  function findDockTarget() {
    const candidates = ['#app', '#root', '#__next', '#main', 'main', 'body > div'];
    for (const sel of candidates) {
      try {
        const el = document.querySelector(sel);
        if (el && el !== document.body) return el;
      } catch (_) {}
    }
    return document.body;
  }

  function applyDocking() {
    const target = findDockTarget();
    const style  = getComputedStyle(target);

    // Prefer marginRight; fall back to paddingRight for elements that use padding
    // for internal layout (e.g. full-bleed flex containers).
    const prop = (parseFloat(style.marginRight) >= 0 || style.marginRight === '0px')
      ? 'marginRight'
      : 'paddingRight';

    dockTarget    = target;
    dockProp      = prop;
    dockOrigValue = target.style[prop] || '';  // preserve any inline value

    const existing = parseFloat(style[prop]) || 0;
    target.style[prop] = `${existing + SIDEBAR_WIDTH}px`;

    // Sanity check: if the page overflows horizontally after docking, undo and
    // fall back to overlay mode (sidebar will simply cover the page).
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 4) {
      removeDocking();
    }
  }

  function removeDocking() {
    if (!dockTarget) return;
    dockTarget.style[dockProp] = dockOrigValue;
    dockTarget    = null;
    dockProp      = '';
    dockOrigValue = '';
  }

  function toggleSidebar() {
    isOpen = !isOpen;
    if (isOpen) {
      sidebarContainer.style.right = '0';
      applyDocking();
      // Reposition the toggle tab to sit flush against the sidebar's left edge
      if (toggleBtn) toggleBtn.style.right = `${SIDEBAR_WIDTH}px`;
      sendChatContext();
    } else {
      sidebarContainer.style.right = `-${SIDEBAR_WIDTH + 20}px`;
      removeDocking();
      if (toggleBtn) toggleBtn.style.right = '0px';
    }
  }

  // ─── CHAT TEXT READING ──────────────────────────────────────────────────
  // Reads visible text from common chat widget selectors
  // Does NOT scrape hidden data or APIs

  const CHAT_SELECTORS = [
    // Generic patterns
    '[class*="chat-message"]',
    '[class*="message-content"]',
    '[class*="chat-bubble"]',
    '[class*="bot-message"]',
    '[class*="agent-message"]',
    '[class*="chat-text"]',
    '[data-testid*="message"]',
    '[role="log"] [role="listitem"]',
    // Common support platforms
    '.intercom-interblocks-paragraph',
    '.zd-comment',
    '.chat-msg-content',
    '.livechat-message-text',
    '.helpscout-chat-message',
    '[class*="MessageBubble"]',
    '[class*="message-bubble"]'
  ];

  function readVisibleChatMessages() {
    const messages = [];
    const seen = new Set();
    const hits = [];

    for (const selector of CHAT_SELECTORS) {
      try {
        const elements = document.querySelectorAll(selector);
        let hitCount = 0;
        for (const el of elements) {
          const text = el.innerText?.trim();
          if (text && text.length > 2 && !seen.has(text)) {
            seen.add(text);
            messages.push(text);
            hitCount++;
          }
        }
        if (hitCount) hits.push(`${selector}(${hitCount})`);
      } catch (_) {
        // Ignore invalid selectors
      }
    }

    if (hits.length) {
      console.debug('[ChatCopilot] readVisibleChatMessages — selectors matched:', hits.join(', '));
    } else {
      console.debug('[ChatCopilot] readVisibleChatMessages — NO selectors matched. 0 messages extracted.');
    }
    return messages;
  }

  function getLastBotMessage() {
    const messages = readVisibleChatMessages();
    // Heuristic: last message in the list is most recent
    return messages[messages.length - 1] || '';
  }

  function sendChatContext(forced = false) {
    if (!sidebarFrame?.contentWindow) return;
    const allMessages = readVisibleChatMessages();
    const lastMessage = allMessages[allMessages.length - 1] || '';
    console.debug('[ChatCopilot] sendChatContext — extracted', allMessages.length,
      'messages; lastMessage:', JSON.stringify(lastMessage.slice(0, 80)), '| forced:', forced);
    sidebarFrame.contentWindow.postMessage({
      type: 'CHAT_CONTEXT',
      lastMessage,
      allMessages,
      tabId: myTabId,
      forced
    }, EXTENSION_ORIGIN);
  }

  // ─── MESSAGE HANDLING ───────────────────────────────────────────────────

  window.addEventListener('message', (event) => {
    // Only process messages from our extension (the sidebar iframe)
    if (event.origin !== EXTENSION_ORIGIN) return;
    if (!event.data?.type) return;

    switch (event.data.type) {
      case 'INSERT_TEXT':
        insertTextIntoChat(event.data.text);
        break;

      case 'REFRESH_CONTEXT':
        sendChatContext(/* forced= */ true);
        break;

      case 'CLOSE_SIDEBAR':
        isOpen = false;
        sidebarContainer.style.right = `-${SIDEBAR_WIDTH + 20}px`;
        removeDocking();
        if (toggleBtn) toggleBtn.style.right = '0px';
        break;
    }
  });

  // ─── TEXT INSERTION ─────────────────────────────────────────────────────
  // Tries to insert text into the visible chat input field

  const INPUT_SELECTORS = [
    'textarea[class*="chat"]',
    'input[class*="chat"]',
    '[contenteditable="true"][class*="chat"]',
    '[contenteditable="true"][class*="message"]',
    '[contenteditable="true"][role="textbox"]',
    'textarea[placeholder*="message" i]',
    'textarea[placeholder*="type" i]',
    'textarea[placeholder*="write" i]',
    'input[placeholder*="message" i]',
    'input[placeholder*="type" i]',
    '.intercom-composer-send-button ~ * textarea',
    '[data-testid*="input"]',
    '[data-testid*="composer"]',
    // Fallback: any visible textarea
    'textarea'
  ];

  function insertTextIntoChat(text) {
    let inputEl = null;

    for (const selector of INPUT_SELECTORS) {
      try {
        const candidates = document.querySelectorAll(selector);
        for (const el of candidates) {
          if (isVisible(el)) {
            inputEl = el;
            break;
          }
        }
      } catch (_) {}
      if (inputEl) break;
    }

    if (!inputEl) {
      sidebarFrame?.contentWindow?.postMessage({ type: 'INSERT_FAILED' }, EXTENSION_ORIGIN);
      return;
    }

    inputEl.focus();

    if (inputEl.isContentEditable) {
      inputEl.innerText = text;
      // Trigger input event for React/Vue frameworks
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      // Native input setter to bypass React's synthetic events
      const nativeInputSetter = Object.getOwnPropertyDescriptor(
        inputEl.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        'value'
      )?.set;
      if (nativeInputSetter) {
        nativeInputSetter.call(inputEl, text);
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        inputEl.value = text;
      }
    }

    sidebarFrame?.contentWindow?.postMessage({ type: 'INSERT_SUCCESS' }, EXTENSION_ORIGIN);
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0'
    );
  }

  // ─── INIT ───────────────────────────────────────────────────────────────

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectSidebar);
  } else {
    injectSidebar();
  }

  // Debounced wrapper — avoids hammering postMessage on every DOM mutation
  let debounceTimer = null;
  function debouncedSendContext() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(sendChatContext, 400);
  }

  // Observe DOM changes to pick up new chat messages
  const observer = new MutationObserver(() => {
    if (isOpen) debouncedSendContext();
  });
  observer.observe(document.body, { childList: true, subtree: true });

})();
