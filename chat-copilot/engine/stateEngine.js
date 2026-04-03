// State detection engine — rule-based, no AI required
// Reads visible chat text and classifies the current conversation state

const StateEngine = {
  // Bot mode states
  STATES: {
    ASK_INTENT:      'ASK_INTENT',
    ASK_BOOKING:     'ASK_BOOKING',
    VERIFY_IDENTITY: 'VERIFY_IDENTITY',
    CASE_CREATED:    'CASE_CREATED',
    ASYNC_SUPPORT:   'ASYNC_SUPPORT',
    LOOP_DETECTED:   'LOOP_DETECTED',
    LIMIT_REACHED:   'LIMIT_REACHED',
    HUMAN_CONNECTED: 'HUMAN_CONNECTED'
  },

  STATE_LABELS: {
    ASK_INTENT:      'Bot asking what you need',
    ASK_BOOKING:     'Bot asking for booking/reference',
    VERIFY_IDENTITY: 'Bot verifying your identity',
    CASE_CREATED:    'Support case created',
    ASYNC_SUPPORT:   'Waiting for callback/email',
    LOOP_DETECTED:   'Conversation looping',
    LIMIT_REACHED:   'Attempt limit reached',
    HUMAN_CONNECTED: 'Human agent connected'
  },

  // Keyword rules per state — matched against last bot message (lowercase)
  RULES: [
    {
      state: 'HUMAN_CONNECTED',
      patterns: [
        /hi,?\s+i('m| am) [a-z]+/,
        /hello,?\s+my name is/,
        /this is [a-z]+ from/,
        /you('re| are) now (connected|chatting) with/,
        /agent has joined/,
        /representative.*here to help/
      ]
    },
    {
      state: 'ASYNC_SUPPORT',
      patterns: [
        /we('ll| will) (email|contact|get back)/,
        /expect.*response.*\d+\s*(hour|day|business)/,
        /ticket.*submitted/,
        /we('ve| have) sent.*email/,
        /case.*raised/,
        /someone will be in touch/
      ]
    },
    {
      state: 'CASE_CREATED',
      patterns: [
        /case (number|id|#|reference)/,
        /ticket (number|id|#|reference)/,
        /reference number.*\d+/,
        /your (case|ticket|request) has been (created|opened|logged)/
      ]
    },
    {
      state: 'VERIFY_IDENTITY',
      patterns: [
        /verify your (identity|account|details)/,
        /confirm your (name|email|date of birth|postcode|address)/,
        /for security.*please (provide|confirm|tell)/,
        /what('s| is) your (email|postcode|date of birth)/,
        /last (4|four) digits/
      ]
    },
    {
      state: 'ASK_BOOKING',
      patterns: [
        /booking (reference|number|id)/,
        /order (number|reference|id)/,
        /reservation (number|code)/,
        /flight number/,
        /policy number/,
        /account number/,
        /please (provide|enter|share).*(reference|number|id)/
      ]
    },
    {
      state: 'ASK_INTENT',
      patterns: [
        /how can (i|we) help/,
        /what (can i|brings you|do you need)/,
        /what.*issue/,
        /choose an option/,
        /select.*topic/,
        /what.*assist.*with/,
        /tell (me|us) (more about )?how we can help/
      ]
    }
  ],

  // Detect state from a text string (last bot message)
  detectFromText(text, session) {
    if (!text) return session.state || this.STATES.ASK_INTENT;

    const lower = text.toLowerCase();

    for (const rule of this.RULES) {
      for (const pattern of rule.patterns) {
        if (pattern.test(lower)) {
          return rule.state;
        }
      }
    }

    // Check for loop: if the last 3 detected states are the same
    if (session.stateHistory && session.stateHistory.length >= 3) {
      const last3 = session.stateHistory.slice(-3);
      if (last3.every(s => s === last3[0])) {
        return this.STATES.LOOP_DETECTED;
      }
    }

    // Fall back to current state
    return session.state || this.STATES.ASK_INTENT;
  },

  // Check if we should switch to LIMIT_REACHED
  checkLimitReached(session) {
    return session.currentAttempts >= session.maxAttempts;
  },

  // Update session with new state, maintaining history
  updateSession(session, newState) {
    const history = session.stateHistory || [];
    history.push(newState);
    if (history.length > 10) history.shift();

    return {
      ...session,
      state: newState,
      stateHistory: history
    };
  }
};
