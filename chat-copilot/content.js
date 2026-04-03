// Content script — injects sidebar, reads visible chat text, handles insert

(function () {
  'use strict';

  let sidebarFrame = null;
  let sidebarContainer = null;
  let isOpen = false;

  // ─── SIDEBAR INJECTION ──────────────────────────────────────────────────

  function injectSidebar() {
    if (sidebarContainer) return;

    // Container div that slides in from right
    sidebarContainer = document.createElement('div');
    sidebarContainer.id = 'chat-copilot-sidebar-container';
    sidebarContainer.style.cssText = `
      position: fixed;
      top: 0;
      right: -380px;
      width: 360px;
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
    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'chat-copilot-toggle';
    toggleBtn.title = 'Chat Copilot';
    toggleBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><circle cx="9" cy="10" r="1" fill="currentColor"/><circle cx="12" cy="10" r="1" fill="currentColor"/><circle cx="15" cy="10" r="1" fill="currentColor"/></svg>`;
    toggleBtn.style.cssText = `
      position: fixed;
      top: 50%;
      right: 0;
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
      transition: background 0.2s;
    `;
    toggleBtn.addEventListener('mouseenter', () => { toggleBtn.style.background = '#4338ca'; });
    toggleBtn.addEventListener('mouseleave', () => { toggleBtn.style.background = '#4f46e5'; });
    toggleBtn.addEventListener('click', toggleSidebar);

    document.body.appendChild(toggleBtn);
  }

  function toggleSidebar() {
    isOpen = !isOpen;
    sidebarContainer.style.right = isOpen ? '0' : '-380px';
    if (isOpen) {
      // Send current page chat context to sidebar on open
      sendChatContext();
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

    for (const selector of CHAT_SELECTORS) {
      try {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          const text = el.innerText?.trim();
          if (text && text.length > 2 && !seen.has(text)) {
            seen.add(text);
            messages.push(text);
          }
        }
      } catch (_) {
        // Ignore invalid selectors
      }
    }

    return messages;
  }

  function getLastBotMessage() {
    const messages = readVisibleChatMessages();
    // Heuristic: last message in the list is most recent
    return messages[messages.length - 1] || '';
  }

  function sendChatContext() {
    if (!sidebarFrame?.contentWindow) return;
    const lastMessage = getLastBotMessage();
    sidebarFrame.contentWindow.postMessage({
      type: 'CHAT_CONTEXT',
      lastMessage,
      allMessages: readVisibleChatMessages()
    }, '*');
  }

  // ─── MESSAGE HANDLING ───────────────────────────────────────────────────

  window.addEventListener('message', (event) => {
    if (!event.data?.type) return;

    switch (event.data.type) {
      case 'INSERT_TEXT':
        insertTextIntoChat(event.data.text);
        break;

      case 'REFRESH_CONTEXT':
        sendChatContext();
        break;

      case 'CLOSE_SIDEBAR':
        isOpen = false;
        sidebarContainer.style.right = '-380px';
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
      // Notify sidebar that no input was found
      sidebarFrame?.contentWindow?.postMessage({ type: 'INSERT_FAILED' }, '*');
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

    sidebarFrame?.contentWindow?.postMessage({ type: 'INSERT_SUCCESS' }, '*');
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

  // Observe DOM changes to pick up new chat messages
  const observer = new MutationObserver(() => {
    if (isOpen) sendChatContext();
  });
  observer.observe(document.body, { childList: true, subtree: true });

})();
