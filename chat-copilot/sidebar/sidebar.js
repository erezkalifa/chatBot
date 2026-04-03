// Sidebar UI logic — orchestrates state, suggestions, and user interactions

(function () {
  'use strict';

  // ─── STATUS MAP ───────────────────────────────────────────────────────────
  // Maps internal state names to human-friendly copy and a visual type.
  // Nothing from this map is shown verbatim in the main UI as a label.

  const STATUS_MAP = {
    ASK_INTENT:      { text: 'Bot is asking what you need',        type: 'bot'     },
    ASK_BOOKING:     { text: 'Bot needs your reference number',    type: 'bot'     },
    VERIFY_IDENTITY: { text: 'Bot is verifying your identity',     type: 'bot'     },
    CASE_CREATED:    { text: 'A support case has been created',    type: 'bot'     },
    ASYNC_SUPPORT:   { text: 'Waiting for a callback or email',    type: 'bot'     },
    LOOP_DETECTED:   { text: 'Bot seems to be going in circles',   type: 'warning' },
    LIMIT_REACHED:   { text: 'Consider asking for a manager',      type: 'danger'  },
    HUMAN_CONNECTED: { text: 'Human agent connected',              type: 'human'   }
  };

  // ─── SESSION STATE ────────────────────────────────────────────────────────

  let session = {
    mode: 'auto',
    state: 'ASK_INTENT',
    goal: 'general',
    tone: 'polite',
    currentAttempts: 0,
    maxAttempts: 10,
    stateHistory: [],
    lastContext: null,
    // Loop detection fingerprints (persisted with session):
    // lastSeenMessage    — updated on every context arrival, including skipped ones.
    // lastProcessedMessage — updated only when state detection actually runs.
    // Together they distinguish passive DOM refreshes from genuine new bot turns.
    lastSeenMessage: null,
    lastProcessedMessage: null
  };

  let currentSuggestions = { main: '', alternatives: [] };
  let tabId = null;
  // Locked to the origin of the first message we receive from the content script.
  // Content scripts execute in the page context, so event.origin is the page origin.
  let parentOrigin = null;

  // Set to true once the saved session has been loaded from storage.
  // saveSession() is a no-op while false, preventing the race where the first
  // processContext call overwrites persisted data before loadSession() returns.
  let isHydrated = false;

  // ─── DOM REFS ─────────────────────────────────────────────────────────────

  const $ = (id) => document.getElementById(id);

  const els = {
    statusChip:        $('status-chip'),
    statusText:        $('status-text'),
    switchRow:         $('switch-row'),
    btnSwitchHuman:    $('btn-switch-human'),
    moreToggle:        $('more-toggle'),
    morePanel:         $('more-panel'),
    modeTabs:          $('mode-tabs'),
    humanOptions:      $('human-options'),
    goalSelect:        $('goal-select'),
    toneSelect:        $('tone-select'),
    attemptCount:      $('attempt-count'),
    progressFill:      $('progress-fill'),
    attemptStatus:     $('attempt-status'),
    suggestionText:    $('suggestion-text'),
    alternativesList:  $('alternatives-list'),
    escalationSection: $('escalation-section'),
    escalationText:    $('escalation-text'),
    btnRefresh:        $('btn-refresh'),
    btnCopy:           $('btn-copy'),
    btnInsert:         $('btn-insert'),
    btnWorked:         $('btn-worked'),
    btnFailed:         $('btn-failed'),
    toast:             $('toast')
  };

  // ─── INIT ─────────────────────────────────────────────────────────────────

  async function init() {
    const settings = await Storage.getSettings();
    session.maxAttempts = settings.maxAttempts;
    session.mode = settings.defaultMode;
    session.goal = settings.defaultGoal;
    session.tone = settings.defaultTone;

    // tabId comes from the content script via CHAT_CONTEXT — see handleContentMessage.
    // We render defaults immediately and reload from storage once the first context arrives.
    renderAll();
    bindEvents();
  }

  // Called once tabId is known (received in first CHAT_CONTEXT message).
  // Sets isHydrated = true so saveSession() becomes active only after this completes.
  async function loadSession() {
    if (!tabId) return;
    const saved = await Storage.getSession(tabId);
    if (saved) session = { ...session, ...saved };
    // Reset lastProcessedMessage so the first processContext after hydration always
    // runs state detection against the restored session, even if the visible message
    // text matches what was last processed before the page was closed.
    // lastSeenMessage is intentionally kept from storage — it accurately records
    // what was last visible, and the stability check uses it correctly on reload.
    session.lastProcessedMessage = null;
    isHydrated = true;
    renderAll();
  }

  // ─── RENDER ───────────────────────────────────────────────────────────────

  function renderAll() {
    renderStatus();
    renderModeTabs();
    renderHumanOptions();
    renderAttempts();
    renderSuggestions();
    renderEscalation();
  }

  function renderStatus() {
    const effectiveMode = StrategyEngine.getEffectiveMode(session);
    const status = STATUS_MAP[session.state] || { text: 'Detecting...', type: 'bot' };

    // Update chip text and type class
    els.statusChip.className = `status-chip status-${status.type}`;
    els.statusText.textContent = status.text;

    // Show the "Switch to Human Agent mode" CTA only when not already in human mode
    const showSwitch = effectiveMode !== 'human';
    els.switchRow.style.display = showSwitch ? 'block' : 'none';
  }

  function renderModeTabs() {
    els.modeTabs.querySelectorAll('.mode-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.mode === session.mode);
    });
  }

  function renderHumanOptions() {
    const effectiveMode = StrategyEngine.getEffectiveMode(session);
    els.humanOptions.style.display = effectiveMode === 'human' ? 'block' : 'none';
    els.goalSelect.value = session.goal;
    els.toneSelect.value = session.tone;
  }

  function renderAttempts() {
    const current = session.currentAttempts || 0;
    const max = session.maxAttempts || 10;
    const pct = Math.min((current / max) * 100, 100);
    const status = StrategyEngine.getAttemptStatus(session);

    els.attemptCount.textContent = `${current} / ${max}`;
    els.progressFill.style.width = `${pct}%`;
    els.progressFill.className = 'progress-fill';
    if (status.severity !== 'ok') els.progressFill.classList.add(status.severity);

    els.attemptStatus.textContent = status.label;
    els.attemptStatus.className = 'attempt-status';
    if (status.severity !== 'ok') els.attemptStatus.classList.add(status.severity);
  }

  function renderSuggestions() {
    const effectiveMode = StrategyEngine.getEffectiveMode(session);
    currentSuggestions = SuggestionEngine.getSuggestions(
      effectiveMode, session.state, session.goal, session.tone
    );

    els.suggestionText.textContent = currentSuggestions.main;

    // Render alternatives
    els.alternativesList.innerHTML = '';
    currentSuggestions.alternatives.forEach((alt, i) => {
      const item = document.createElement('div');
      item.className = 'alternative-item';
      item.innerHTML = `
        <p class="alternative-text">${escapeHtml(alt)}</p>
        <div class="alt-actions">
          <button class="btn btn-secondary alt-copy" data-index="${i}">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            Copy
          </button>
          <button class="btn btn-secondary alt-insert" data-index="${i}">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/>
            </svg>
            Insert
          </button>
        </div>
      `;
      els.alternativesList.appendChild(item);
    });

    // Bind alternative buttons
    els.alternativesList.querySelectorAll('.alt-copy').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index);
        copyToClipboard(currentSuggestions.alternatives[idx]);
      });
    });

    els.alternativesList.querySelectorAll('.alt-insert').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index);
        insertText(currentSuggestions.alternatives[idx]);
      });
    });
  }

  function renderEscalation() {
    const show = session.state === 'LIMIT_REACHED';
    els.escalationSection.style.display = show ? 'block' : 'none';
    if (show) {
      els.escalationText.textContent = StrategyEngine.getEscalationStrategy(session.goal);
      // Surface the guidance automatically — user shouldn't have to hunt for it
      openMorePanel();
    }
  }

  function openMorePanel() {
    els.morePanel.style.display = 'block';
    els.moreToggle.classList.add('open');
    els.moreToggle.childNodes[0].textContent = 'Fewer options ';
  }

  function closeMorePanel() {
    els.morePanel.style.display = 'none';
    els.moreToggle.classList.remove('open');
    els.moreToggle.childNodes[0].textContent = 'More options ';
  }

  // ─── EVENTS ───────────────────────────────────────────────────────────────

  function bindEvents() {
    // Mode tabs
    els.modeTabs.querySelectorAll('.mode-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        session.mode = tab.dataset.mode;
        saveSession();
        renderAll();
      });
    });

    // Goal/Tone selects
    els.goalSelect.addEventListener('change', () => {
      session.goal = els.goalSelect.value;
      saveSession();
      renderSuggestions();
    });

    els.toneSelect.addEventListener('change', () => {
      session.tone = els.toneSelect.value;
      saveSession();
      renderSuggestions();
    });

    // Switch to human agent mode (main-view CTA)
    els.btnSwitchHuman.addEventListener('click', () => {
      session.mode = 'human';
      saveSession();
      renderAll();
    });

    // More options expand / collapse
    els.moreToggle.addEventListener('click', () => {
      const isOpen = els.morePanel.style.display === 'block';
      if (isOpen) closeMorePanel(); else openMorePanel();
    });

    // Refresh
    els.btnRefresh.addEventListener('click', () => {
      if (parentOrigin) window.parent.postMessage({ type: 'REFRESH_CONTEXT' }, parentOrigin);
      showToast('Refreshing context...');
    });

    // Copy main suggestion
    els.btnCopy.addEventListener('click', () => {
      copyToClipboard(currentSuggestions.main);
    });

    // Insert main suggestion
    els.btnInsert.addEventListener('click', () => {
      insertText(currentSuggestions.main);
    });

    // Feedback
    els.btnWorked.addEventListener('click', () => recordFeedback(true));
    els.btnFailed.addEventListener('click', () => recordFeedback(false));

    // Messages from content script
    window.addEventListener('message', (event) => {
      // Lock to the first origin we receive from; reject anything else after that
      if (!parentOrigin) {
        parentOrigin = event.origin;
      } else if (event.origin !== parentOrigin) {
        return;
      }
      if (!event.data?.type) return;
      handleContentMessage(event.data);
    });
  }

  // ─── CONTENT SCRIPT MESSAGES ──────────────────────────────────────────────

  function handleContentMessage(data) {
    switch (data.type) {
      case 'CHAT_CONTEXT': {
        // Capture tabId on first message from content script, then load saved session
        const isFirstContext = (tabId === null && data.tabId != null);
        if (isFirstContext) {
          tabId = data.tabId;
          loadSession(); // async — re-renders once storage is read
        }
        processContext(data.lastMessage);
        break;
      }

      case 'INSERT_SUCCESS':
        // Increment attempt on successful insert
        session = StrategyEngine.recordAttempt(session);
        saveSession();
        renderAttempts();
        renderEscalation();
        showToast('Inserted! Remember to send it manually.');
        break;

      case 'INSERT_FAILED':
        showToast('Could not find chat input. Copy instead.');
        break;
    }
  }

  function processContext(lastMessage) {
    if (!lastMessage) return;

    const previouslySeen = session.lastSeenMessage;

    // Always record the latest visible message, even when we skip processing.
    // This is what lets us detect the transition from transient content
    // (typing indicators) back to a stable message on the next cycle.
    session = { ...session, lastSeenMessage: lastMessage };

    // ── Pure passive refresh ────────────────────────────────────────────────
    // The visible message is identical to what we last observed AND last processed.
    // Nothing has changed — no new bot turn, skip entirely.
    if (lastMessage === session.lastProcessedMessage && lastMessage === previouslySeen) {
      return;
    }

    // ── Wait for stability ──────────────────────────────────────────────────
    // The visible message changed since our last observation. This could be a
    // typing indicator, a timestamp update, or a genuine new bot message.
    // We don't commit until we've seen the same content on two consecutive
    // context arrivals — confirming it's a stable new message, not a transient.
    // Exception: if this is the very first context ever (previouslySeen === null),
    // process immediately so the sidebar shows suggestions on first open.
    if (previouslySeen !== null && lastMessage !== previouslySeen) {
      return;
    }

    // ── Confirmed new turn ──────────────────────────────────────────────────
    // Either: this is the first context ever, OR the message has been stable
    // across two consecutive observations and differs from what we last processed.
    // Only at this point do we advance loop counters and update state.
    session = { ...session, lastProcessedMessage: lastMessage };

    const detectedState = StateEngine.detectFromText(lastMessage, session);
    const finalState = StateEngine.checkLimitReached(session)
      ? StateEngine.STATES.LIMIT_REACHED
      : detectedState;

    session = StateEngine.updateSession(session, finalState);
    saveSession();
    renderAll();
  }

  // ─── ACTIONS ──────────────────────────────────────────────────────────────

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
      showToast('Copied to clipboard');
    }).catch(() => {
      // Fallback for restricted contexts
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('Copied to clipboard');
    });
  }

  function insertText(text) {
    if (!parentOrigin) { showToast('Not connected to page yet.'); return; }
    window.parent.postMessage({ type: 'INSERT_TEXT', text }, parentOrigin);
  }

  async function recordFeedback(worked) {
    // Visual feedback
    els.btnWorked.classList.toggle('active', worked);
    els.btnFailed.classList.toggle('active', !worked);
    setTimeout(() => {
      els.btnWorked.classList.remove('active');
      els.btnFailed.classList.remove('active');
    }, 1500);

    // Store feedback locally
    await Storage.saveFeedback({
      worked,
      state: session.state,
      mode: session.mode,
      goal: session.goal,
      tone: session.tone,
      suggestion: currentSuggestions.main
    });

    showToast(worked ? 'Great! Feedback saved.' : 'Noted. Feedback saved.');

    // If didn't work, suggest alternatives
    if (!worked) {
      showToast("Try one of the alternatives below.");
    }
  }

  async function saveSession() {
    // Do not write until the saved session has been loaded; prevents the race
    // where processContext runs before loadSession() returns and overwrites
    // persisted data (attempts, state, etc.) with in-memory defaults.
    if (!isHydrated || !tabId) return;
    await Storage.saveSession(tabId, session);
  }

  // ─── HELPERS ──────────────────────────────────────────────────────────────

  let toastTimer = null;

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2500);
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ─── START ────────────────────────────────────────────────────────────────

  init();

})();
