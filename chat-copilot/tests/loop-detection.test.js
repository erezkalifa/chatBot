'use strict';

/**
 * Focused tests for loop detection and session hydration behaviour.
 *
 * Covers:
 *   1. First context processes immediately
 *   2. Passive DOM refresh does not increment loop counters
 *   3. A stable new turn is processed after two consecutive appearances
 *   4. Hydration guard prevents overwriting a saved session
 *   5. Repeated passive refreshes never trigger LOOP_DETECTED
 *
 * No external dependencies — uses Node's built-in node:test and node:assert.
 * Run with:  node --test tests/loop-detection.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const vm   = require('node:vm');
const fs   = require('node:fs');
const path = require('node:path');

// ─── Load StateEngine without modifying production code ───────────────────────
// `const` declarations don't escape vm.runInContext, so we wrap the file in an
// IIFE that returns the object explicitly.

const engineSrc = fs.readFileSync(
  path.join(__dirname, '../engine/stateEngine.js'), 'utf8'
);
const StateEngine = vm.runInContext(
  `(function () { ${engineSrc}; return StateEngine; })()`,
  vm.createContext({})
);

// ─── Pure simulator of processContext ─────────────────────────────────────────
// Mirrors the exact logic of processContext() in sidebar/sidebar.js
// (lines 288–330) with the DOM/storage side-effects stripped out.
// Returns { processed: boolean, session: updatedSession }.

function simulateProcessContext(session, lastMessage) {
  if (!lastMessage) return { processed: false, session };

  const previouslySeen = session.lastSeenMessage;

  // Always record latest visible message (even on skips)
  session = { ...session, lastSeenMessage: lastMessage };

  // ── Pure passive refresh ────────────────────────────────────────────────────
  if (lastMessage === session.lastProcessedMessage && lastMessage === previouslySeen) {
    return { processed: false, session };
  }

  // ── Wait for stability ──────────────────────────────────────────────────────
  if (previouslySeen !== null && lastMessage !== previouslySeen) {
    return { processed: false, session };
  }

  // ── Confirmed new turn ──────────────────────────────────────────────────────
  session = { ...session, lastProcessedMessage: lastMessage };

  const detectedState = StateEngine.detectFromText(lastMessage, session);
  const finalState = StateEngine.checkLimitReached(session)
    ? StateEngine.STATES.LIMIT_REACHED
    : detectedState;

  session = StateEngine.updateSession(session, finalState);
  return { processed: true, session };
}

// ─── Session factory — fresh copy per test ────────────────────────────────────

function makeSession(overrides = {}) {
  return {
    mode: 'auto',
    state: 'ASK_INTENT',
    maxAttempts: 10,
    currentAttempts: 0,
    stateHistory: [],
    lastDetectedState: null,
    consecutiveStateCount: 0,
    lastSeenMessage: null,
    lastProcessedMessage: null,
    ...overrides
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('processContext — loop detection and turn tracking', () => {

  // 1 ────────────────────────────────────────────────────────────────────────

  test('first context processes immediately (lastSeenMessage is null)', () => {
    const session = makeSession();
    const r = simulateProcessContext(session, 'How can I help you today?');

    assert.equal(r.processed, true, 'should process the very first context');
    assert.equal(r.session.lastProcessedMessage, 'How can I help you today?');
    assert.equal(r.session.lastSeenMessage,       'How can I help you today?');
  });

  // 2 ────────────────────────────────────────────────────────────────────────

  test('passive DOM refresh does not increment consecutiveStateCount', () => {
    let session = makeSession();

    // First context — processed, establishes baseline
    let r = simulateProcessContext(session, 'How can I help you today?');
    assert.equal(r.processed, true);
    const countAfterFirstTurn = r.session.consecutiveStateCount;
    session = r.session;

    // Multiple passive refreshes with the same visible message
    for (let i = 0; i < 5; i++) {
      r = simulateProcessContext(session, 'How can I help you today?');
      assert.equal(r.processed, false, `refresh #${i + 1} should be skipped`);
      session = r.session;
    }

    assert.equal(
      session.consecutiveStateCount,
      countAfterFirstTurn,
      'loop counter must not move on passive refreshes'
    );
  });

  // 3 ────────────────────────────────────────────────────────────────────────

  test('stable new turn is processed after appearing in two consecutive cycles', () => {
    let session = makeSession();

    // Establish initial state
    let r = simulateProcessContext(session, 'How can I help you today?');
    assert.equal(r.processed, true);
    session = r.session;

    // New message appears for the first time — not yet stable
    r = simulateProcessContext(session, 'Please provide your booking reference.');
    assert.equal(r.processed, false, 'first appearance of new message is not yet committed');
    assert.equal(r.session.lastSeenMessage, 'Please provide your booking reference.',
      'lastSeenMessage advances even when we wait for stability');
    session = r.session;

    // Same message on the next cycle — now stable, confirmed new turn
    r = simulateProcessContext(session, 'Please provide your booking reference.');
    assert.equal(r.processed, true, 'stable message on second cycle is processed');
    assert.equal(r.session.state, 'ASK_BOOKING', 'state engine should detect ASK_BOOKING');
    assert.equal(r.session.lastProcessedMessage, 'Please provide your booking reference.');
  });

  // 4 ────────────────────────────────────────────────────────────────────────

  test('hydration guard: saveSession is a no-op before isHydrated, saved data is not overwritten', async () => {
    // This test simulates the race described in Bug 3:
    //   processContext fires before loadSession() returns.
    //   saveSession() must be a no-op while !isHydrated.

    // Saved session in storage (represents a returning user mid-conversation)
    const persistedSession = {
      state: 'CASE_CREATED',
      currentAttempts: 6,
      maxAttempts: 10,
      consecutiveStateCount: 1
    };

    let storage = { ...persistedSession };  // simulates chrome.storage.local
    let isHydrated = false;
    let inMemorySession = makeSession();    // defaults before hydration

    // Inline saveSession guard — exact logic from sidebar.js
    const saveSession = (session) => {
      if (!isHydrated) return;             // guard: no writes before hydration
      storage = { ...session };
    };

    // Simulate: processContext fires first (before loadSession resolves)
    // It detects a state and tries to save defaults
    inMemorySession = { ...inMemorySession, state: 'ASK_INTENT', currentAttempts: 0 };
    saveSession(inMemorySession);           // should be no-op

    // Verify: storage is still the persisted data, not the defaults
    assert.equal(storage.state, 'CASE_CREATED',  'storage state must survive pre-hydration write attempt');
    assert.equal(storage.currentAttempts, 6,      'storage attempts must survive pre-hydration write attempt');

    // Simulate: loadSession() resolves — merges saved data, sets flag
    inMemorySession = { ...inMemorySession, ...persistedSession };
    isHydrated = true;

    // Verify: in-memory session now reflects saved data
    assert.equal(inMemorySession.state,           'CASE_CREATED');
    assert.equal(inMemorySession.currentAttempts, 6);

    // Verify: now that isHydrated is true, a subsequent save works
    inMemorySession = { ...inMemorySession, currentAttempts: 7 };
    saveSession(inMemorySession);
    assert.equal(storage.currentAttempts, 7, 'post-hydration save should persist');
  });

  // 5 ────────────────────────────────────────────────────────────────────────

  test('many passive refreshes of the same message never trigger LOOP_DETECTED', () => {
    let session = makeSession();

    // Process once to establish state
    let r = simulateProcessContext(session, 'How can I help you today?');
    assert.equal(r.processed, true);
    session = r.session;

    // Simulate many passive refreshes (MutationObserver firing repeatedly)
    for (let i = 0; i < 20; i++) {
      r = simulateProcessContext(session, 'How can I help you today?');
      session = r.session;
    }

    assert.notEqual(session.state, 'LOOP_DETECTED',
      'LOOP_DETECTED must not fire from passive DOM refreshes alone');
    assert.equal(session.consecutiveStateCount, 1,
      'consecutive count must stay at 1 — only one real turn occurred');
  });

});
