// Suggestion engine — returns 2-3 reply suggestions per state/mode/tone/goal

const SuggestionEngine = {

  // ─── BOT MODE SUGGESTIONS ────────────────────────────────────────────────

  BOT_SUGGESTIONS: {
    ASK_INTENT: {
      main: "I need to speak with a human agent regarding an issue with my account.",
      alternatives: [
        "I'd like to escalate my issue to a customer service representative.",
        "Can you connect me to a live agent? I need help with a complex issue."
      ]
    },
    ASK_BOOKING: {
      main: "I don't have that reference to hand — can I be transferred to a human agent instead?",
      alternatives: [
        "I'd prefer to speak with someone directly rather than provide that here.",
        "I'm unable to locate that information right now. Can I speak to a representative?"
      ]
    },
    VERIFY_IDENTITY: {
      main: "I can verify my identity with a human agent. Please connect me to one.",
      alternatives: [
        "For security reasons, I'd prefer to share that with a live representative.",
        "Can I verify these details over the phone or with a live agent?"
      ]
    },
    CASE_CREATED: {
      main: "Thank you, but I'd still like to speak with a human agent to resolve this urgently.",
      alternatives: [
        "I understand a case has been created, but I need to speak with someone now.",
        "Can a human agent contact me today rather than via email?"
      ]
    },
    ASYNC_SUPPORT: {
      main: "I'd prefer not to wait. Is there a way to speak with someone right now?",
      alternatives: [
        "I need this resolved today — can you escalate to a live agent?",
        "Waiting is not an option for me. Please connect me to a manager or live agent."
      ]
    },
    LOOP_DETECTED: {
      main: "We seem to be going in circles. Please connect me to a human agent immediately.",
      alternatives: [
        "This bot isn't helping me. I need to speak to a real person now.",
        "I've answered these questions already. Escalate this to a human agent please."
      ]
    },
    LIMIT_REACHED: {
      main: "I've made many attempts to resolve this. I need to speak with a manager right now.",
      alternatives: [
        "I'm formally requesting escalation to a senior agent or manager.",
        "I'll need to take further action if I can't speak with a human agent immediately."
      ]
    },
    HUMAN_CONNECTED: {
      main: "Hi, thank you for connecting. I'd like to discuss an issue and reach a resolution today.",
      alternatives: [
        "Hello, I need assistance and I'm hoping we can resolve this quickly.",
        "Thanks for joining. I have an issue I'd like to escalate — can you help?"
      ]
    }
  },

  // ─── HUMAN AGENT MODE SUGGESTIONS ───────────────────────────────────────

  HUMAN_SUGGESTIONS: {
    refund: {
      polite: {
        main: "I'd like to kindly request a full refund for my order. It didn't meet expectations and I believe I'm entitled to one.",
        alternatives: [
          "I'm reaching out about a refund. I'd appreciate your help resolving this.",
          "Could you please process a refund for me? I have not received what I paid for."
        ]
      },
      firm: {
        main: "I am requesting a full refund. This is my right under your refund policy and I expect this to be processed promptly.",
        alternatives: [
          "I need a refund processed today. I've already waited too long for resolution.",
          "Please initiate a full refund. I am prepared to escalate if this is not resolved."
        ]
      },
      urgent: {
        main: "I need an immediate refund processed right now. This has been unacceptable and I need resolution today.",
        alternatives: [
          "This is urgent — I require a refund processed within 24 hours or I will escalate.",
          "I am formally requesting an urgent refund. Please escalate to your supervisor if needed."
        ]
      }
    },
    escalation: {
      polite: {
        main: "I'd like to kindly request to speak with a supervisor or senior member of your team.",
        alternatives: [
          "Could you escalate my case to someone with the authority to resolve this?",
          "I appreciate your help, but I'd like this reviewed by a senior agent."
        ]
      },
      firm: {
        main: "I'm requesting escalation to a manager immediately. The current resolution is not acceptable.",
        alternatives: [
          "Please transfer me to your supervisor or team lead. I need a higher-level decision.",
          "I need this escalated now. A manager needs to review my case."
        ]
      },
      urgent: {
        main: "I need to speak with a manager RIGHT NOW. This situation is unacceptable and requires immediate senior attention.",
        alternatives: [
          "Escalate this to your manager immediately. I will not continue without senior involvement.",
          "I am demanding escalation. Please connect me with the highest available authority."
        ]
      }
    },
    complaint: {
      polite: {
        main: "I'd like to formally raise a complaint about my experience. I hope we can reach a satisfactory outcome.",
        alternatives: [
          "I wish to lodge a complaint. I'd appreciate acknowledgment and a path to resolution.",
          "I'm disappointed with the service received and would like to file a formal complaint."
        ]
      },
      firm: {
        main: "I am lodging a formal complaint. I expect a written acknowledgment and a resolution timeline.",
        alternatives: [
          "This complaint needs to be formally recorded. I expect a response within 5 business days.",
          "I am filing a complaint and expect a senior review of my case."
        ]
      },
      urgent: {
        main: "This is an urgent formal complaint. I require immediate acknowledgment and same-day escalation.",
        alternatives: [
          "I am raising an urgent complaint that needs senior review today.",
          "This complaint requires immediate action. Please escalate and confirm receipt now."
        ]
      }
    },
    general: {
      polite: {
        main: "I'd like some help resolving an issue with my account. Can you assist?",
        alternatives: [
          "I'm reaching out because I need assistance. Thank you for your time.",
          "Could you help me with a matter regarding my account or order?"
        ]
      },
      firm: {
        main: "I need this issue resolved today. Please review my case and provide a clear solution.",
        alternatives: [
          "I've been waiting too long. I need a resolution now, not a delay.",
          "Please focus on resolving my issue rather than offering workarounds."
        ]
      },
      urgent: {
        main: "This is urgent and requires immediate attention. I need a resolution now.",
        alternatives: [
          "Please treat this as a priority. I cannot wait for standard timelines.",
          "I need this resolved within the hour. Please escalate if you're unable to help directly."
        ]
      }
    }
  },

  // ─── GET SUGGESTIONS ─────────────────────────────────────────────────────

  getSuggestions(mode, state, goal, tone) {
    if (mode === 'bot' || (mode === 'auto' && state !== 'HUMAN_CONNECTED')) {
      const suggestion = this.BOT_SUGGESTIONS[state] || this.BOT_SUGGESTIONS.ASK_INTENT;
      return {
        main: suggestion.main,
        alternatives: suggestion.alternatives
      };
    }

    // Human agent mode
    const goalKey = goal || 'general';
    const toneKey = tone || 'polite';
    const goalSuggestions = this.HUMAN_SUGGESTIONS[goalKey] || this.HUMAN_SUGGESTIONS.general;
    const toneSuggestions = goalSuggestions[toneKey] || goalSuggestions.polite;

    return {
      main: toneSuggestions.main,
      alternatives: toneSuggestions.alternatives
    };
  }
};
