// Strategy engine — determines mode, manages attempt tracking, handles escalation

const StrategyEngine = {

  MODES: ['auto', 'bot', 'human'],
  TONES: ['polite', 'firm', 'urgent'],
  GOALS: ['general', 'refund', 'escalation', 'complaint'],

  GOAL_LABELS: {
    general:    'General Assistance',
    refund:     'Refund Request',
    escalation: 'Escalation',
    complaint:  'Formal Complaint'
  },

  TONE_LABELS: {
    polite: 'Polite',
    firm:   'Firm',
    urgent: 'Urgent'
  },

  // Determine effective mode based on session mode + detected state
  getEffectiveMode(session) {
    if (session.mode === 'human') return 'human';
    if (session.mode === 'bot') return 'bot';

    // Auto mode: switch to human if HUMAN_CONNECTED state detected
    if (session.state === 'HUMAN_CONNECTED') return 'human';
    return 'bot';
  },

  // Increment attempt counter, auto-escalate if needed
  recordAttempt(session) {
    const updated = {
      ...session,
      currentAttempts: (session.currentAttempts || 0) + 1
    };

    // Auto-escalate tone when near limit
    const ratio = updated.currentAttempts / updated.maxAttempts;
    if (ratio >= 1) {
      updated.state = 'LIMIT_REACHED';
      updated.tone = 'urgent';
    } else if (ratio >= 0.7 && updated.tone === 'polite') {
      updated.tone = 'firm';
    }

    return updated;
  },

  // Get attempt status label
  getAttemptStatus(session) {
    const current = session.currentAttempts || 0;
    const max = session.maxAttempts || 10;
    const ratio = current / max;

    if (ratio >= 1) return { label: 'Limit reached', severity: 'critical' };
    if (ratio >= 0.7) return { label: 'Approaching limit', severity: 'warning' };
    return { label: 'On track', severity: 'ok' };
  },

  // Get escalation suggestion when limit is reached
  getEscalationStrategy(goal) {
    const strategies = {
      refund: "You've reached the attempt limit. Consider: (1) Requesting a formal complaint reference number, (2) Contacting via a different channel (phone/email), (3) Citing consumer protection rights.",
      escalation: "Attempt limit reached. Next steps: (1) Ask for a complaint reference, (2) Request written confirmation of the refusal, (3) Contact the company's head office directly.",
      complaint: "Limit reached. Consider: (1) Filing with an ombudsman or regulator, (2) Using social media to escalate publicly, (3) Seeking a chargeback via your bank.",
      general: "You've reached the limit. Try: (1) Switching to phone or email support, (2) Asking to speak with a manager, (3) Filing a formal complaint."
    };
    return strategies[goal] || strategies.general;
  }
};
