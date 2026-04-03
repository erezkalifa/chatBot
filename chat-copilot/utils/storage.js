// Chrome storage wrapper — keeps all storage calls in one place

const Storage = {
  async get(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get(key, (result) => {
        resolve(result[key]);
      });
    });
  },

  async set(key, value) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, resolve);
    });
  },

  async getSettings() {
    const settings = await this.get('settings');
    return settings || {
      maxAttempts: 10,
      defaultMode: 'auto',
      defaultTone: 'polite',
      defaultGoal: 'general'
    };
  },

  async saveSettings(settings) {
    return this.set('settings', settings);
  },

  async getSession(tabId) {
    const sessions = await this.get('sessions') || {};
    return sessions[tabId] || {
      mode: 'auto',
      state: 'ASK_INTENT',
      goal: 'general',
      tone: 'polite',
      currentAttempts: 0,
      maxAttempts: 10,
      lastMessages: [],
      feedback: []
    };
  },

  async saveSession(tabId, session) {
    const sessions = await this.get('sessions') || {};
    sessions[tabId] = session;
    return this.set('sessions', sessions);
  },

  async saveFeedback(entry) {
    const feedback = await this.get('feedback') || [];
    feedback.push({ ...entry, timestamp: Date.now() });
    // Keep last 200 entries
    if (feedback.length > 200) feedback.splice(0, feedback.length - 200);
    return this.set('feedback', feedback);
  }
};
