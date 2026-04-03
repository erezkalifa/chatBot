// Content script — injects sidebar, reads visible chat text, handles insert

(function () {
  'use strict';

  const EXTENSION_ORIGIN = chrome.runtime.getURL('').slice(0, -1); // "chrome-extension://<id>"
  const SIDEBAR_WIDTH    = 360; // px
  const IS_TOP_FRAME     = (window === window.top);

  // ─── SHARED: EXTRACTION ENGINE ─────────────────────────────────────────
  // These run in every frame (top + iframes). Selectors are ordered by
  // reliability: ARIA/semantic first (vendor-agnostic), then data attrs,
  // then class substrings (camel and kebab), then known platform classes.

  const EXTRACTION_SELECTORS = [
    // ── Tier 1: ARIA roles — work regardless of class names ────────────────
    '[role="log"] [role="listitem"]',
    '[role="log"] [role="article"]',
    '[role="log"] p',
    '[role="feed"] [role="article"]',
    '[aria-live="polite"] [role="listitem"]',
    '[aria-live="assertive"] [role="listitem"]',
    '[aria-live] p',
    '[aria-live] [class]',           // any classed child of a live region
    // ── Tier 2: data attributes ────────────────────────────────────────────
    '[data-testid*="message"]',
    '[data-qa*="message"]',
    '[data-cy*="message"]',
    '[data-id*="message"]',
    '[data-testid*="chat"]',
    // ── Tier 3: class substring — kebab ────────────────────────────────────
    '[class*="chat-message"]',
    '[class*="message-content"]',
    '[class*="message-text"]',
    '[class*="message-bubble"]',
    '[class*="message-body"]',
    '[class*="chat-bubble"]',
    '[class*="chat-text"]',
    '[class*="bot-message"]',
    '[class*="agent-message"]',
    '[class*="balloon"]',
    '[class*="speech-bubble"]',
    // ── Tier 3b: class substring — PascalCase (React components) ──────────
    '[class*="ChatMessage"]',
    '[class*="MessageContent"]',
    '[class*="MessageText"]',
    '[class*="MessageBubble"]',
    '[class*="MessageBody"]',
    '[class*="ChatBubble"]',
    '[class*="BotMessage"]',
    '[class*="AgentMessage"]',
    // ── Tier 4: known support platforms ────────────────────────────────────
    '.intercom-interblocks-paragraph',
    '.intercom-block-paragraph',
    '.zd-comment',
    '.chat-msg-content',
    '.livechat-message-text',
    '.helpscout-chat-message',
    '[class*="lcm-message"]',
    '[class*="fresh-chat"]',
    '[class*="ujet-message"]',
  ];

  function isVisibleEl(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 &&
      s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
  }

  // Walk text nodes inside a container, deduplicating into seen/messages.
  function walkTextNodes(root, seen, messages) {
    const ownerDoc = root.ownerDocument || document;
    const walker = ownerDoc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const t = node.textContent.trim();
        if (t.length < 4) return NodeFilter.FILTER_SKIP;
        const p = node.parentElement;
        if (!p || !isVisibleEl(p)) return NodeFilter.FILTER_SKIP;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let node;
    while ((node = walker.nextNode())) {
      const t = node.textContent.trim();
      if (!seen.has(t)) { seen.add(t); messages.push(t); }
    }
  }

  // Find fixed/absolute panels that look like an open chat widget.
  function findChatPanels(doc) {
    const panels = [];
    for (const el of doc.querySelectorAll('*')) {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') continue;
      if (s.position !== 'fixed' && s.position !== 'absolute') continue;
      const r = el.getBoundingClientRect();
      // Heuristic: visible panel at least 200×150, not our own sidebar
      if (r.height < 150 || r.width < 100) continue;
      if (el.id === 'chat-copilot-sidebar-container') continue;
      panels.push(el);
    }
    return panels;
  }

  function extractFromDocument(doc) {
    const messages = [];
    const seen = new Set();

    // Pass 1 — selector-based
    for (const sel of EXTRACTION_SELECTORS) {
      try {
        for (const el of doc.querySelectorAll(sel)) {
          const t = el.innerText?.trim();
          if (t && t.length > 3 && !seen.has(t)) { seen.add(t); messages.push(t); }
        }
      } catch (_) {}
    }

    // Pass 2 — container-walk fallback (only when selectors found nothing)
    if (messages.length === 0) {
      for (const panel of findChatPanels(doc)) {
        walkTextNodes(panel, seen, messages);
        if (messages.length > 0) break; // stop at first productive panel
      }
    }

    return messages;
  }

  // ─── SHARED: DOM DEBUG INSPECTOR ────────────────────────────────────────
  // Called once per forced Refresh to help identify the chatbot DOM structure.

  function debugDOMInspect(doc) {
    console.group('[ChatCopilot] DOM Inspection');

    // Iframes
    const frames = Array.from(doc.querySelectorAll('iframe'));
    console.log(`Found ${frames.length} iframe(s):`);
    frames.forEach((f, i) => {
      let accessible = false;
      try { accessible = !!f.contentDocument?.body; } catch (_) {}
      const r = f.getBoundingClientRect();
      console.log(`  [${i}] src="${f.src || f.getAttribute('src') || '(none)'}" ` +
        `${Math.round(r.width)}×${Math.round(r.height)} visible=${isVisibleEl(f)} ` +
        `same-origin=${accessible}`);
    });

    // ARIA live regions
    const lives = Array.from(doc.querySelectorAll('[aria-live]'));
    console.log(`Found ${lives.length} aria-live element(s):`);
    lives.forEach((el, i) => {
      console.log(`  [${i}] <${el.tagName.toLowerCase()}> aria-live="${el.getAttribute('aria-live')}" ` +
        `class="${el.className}" children=${el.children.length} ` +
        `text="${el.innerText?.trim().slice(0, 60)}"`);
    });

    // role=log
    const logs = Array.from(doc.querySelectorAll('[role="log"]'));
    console.log(`Found ${logs.length} role="log" element(s):`);
    logs.forEach((el, i) => {
      console.log(`  [${i}] <${el.tagName.toLowerCase()}> class="${el.className}" ` +
        `children=${el.children.length}`);
    });

    // Fixed/absolute panels
    const panels = findChatPanels(doc);
    console.log(`Found ${panels.length} fixed/absolute panel(s):`);
    panels.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      console.log(`  [${i}] <${el.tagName.toLowerCase()}> id="${el.id}" class="${el.className.toString().slice(0, 80)}" ` +
        `${Math.round(r.width)}×${Math.round(r.height)} @ (${Math.round(r.left)},${Math.round(r.top)})`);
    });

    // Top-5 text snippets from panels (to confirm messages are present)
    if (panels.length > 0) {
      const sample = []; const sSet = new Set();
      walkTextNodes(panels[0], sSet, sample);
      console.log('Text samples from first panel:', sample.slice(0, 8).map(t => `"${t.slice(0, 50)}"`));
    }

    console.groupEnd();
  }

  // ─── TOP FRAME ONLY ────────────────────────────────────────────────────
  // Sidebar, docking, message handling, and DOM observation only run in the
  // main page context. In cross-origin chat widget iframes we skip all this
  // and just extract + relay messages via the background script.

  if (!IS_TOP_FRAME) {
    function relay() {
      if (!document.body) return;
      const msgs = extractFromDocument(document);
      if (msgs.length) {
        console.debug('[ChatCopilot][iframe]', window.location.href.slice(0, 60),
          '— relaying', msgs.length, 'messages');
        chrome.runtime.sendMessage({ type: 'IFRAME_CHAT_MESSAGES', messages: msgs });
      }
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', relay);
    } else {
      relay();
    }
    let iframeDebounce = null;
    new MutationObserver(() => {
      clearTimeout(iframeDebounce);
      iframeDebounce = setTimeout(relay, 400);
    }).observe(document.documentElement, { childList: true, subtree: true });
    return; // nothing else to do in an iframe
  }

  // Top-frame state
  let sidebarFrame     = null;
  let sidebarContainer = null;
  let toggleBtn        = null;
  let isOpen           = false;
  let myTabId          = null;
  let iframeMessages   = []; // messages relayed from cross-origin chat iframes

  // Docking state
  let dockTarget    = null;
  let dockProp      = '';
  let dockOrigValue = '';

  // Collect messages relayed by iframe content scripts via the background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'IFRAME_CHAT_MESSAGES') {
      iframeMessages = msg.messages || [];
      console.debug('[ChatCopilot] iframe relay received —', iframeMessages.length, 'messages');
    }
  });

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

  // Merge main-document messages with any messages relayed from iframe scripts.
  function readVisibleChatMessages() {
    const mainMessages = extractFromDocument(document);
    const seen = new Set(mainMessages);
    const merged = [...mainMessages];
    for (const m of iframeMessages) {
      if (!seen.has(m)) { seen.add(m); merged.push(m); }
    }
    console.debug('[ChatCopilot] readVisibleChatMessages — main:', mainMessages.length,
      '| iframe relay:', iframeMessages.length, '| total:', merged.length);
    return merged;
  }

  function sendChatContext(forced = false) {
    if (!sidebarFrame?.contentWindow) return;
    if (forced) debugDOMInspect(document); // one-shot DOM dump on manual refresh
    const allMessages = readVisibleChatMessages();
    const lastMessage = allMessages[allMessages.length - 1] || '';
    console.debug('[ChatCopilot] sendChatContext — lastMessage:',
      JSON.stringify(lastMessage.slice(0, 80)), '| forced:', forced);
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
          if (isVisibleEl(el)) {
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
