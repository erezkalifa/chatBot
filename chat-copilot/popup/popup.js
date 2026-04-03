// Popup — settings only

(async function () {
  const settings = await Storage.getSettings();

  const maxRange  = document.getElementById('max-attempts-range');
  const maxNum    = document.getElementById('max-attempts');
  const modeEl    = document.getElementById('default-mode');
  const goalEl    = document.getElementById('default-goal');
  const toneEl    = document.getElementById('default-tone');
  const btnSave   = document.getElementById('btn-save');
  const savedMsg  = document.getElementById('saved-msg');
  const btnClear  = document.getElementById('btn-clear');

  // Populate
  maxRange.value = settings.maxAttempts;
  maxNum.value   = settings.maxAttempts;
  modeEl.value   = settings.defaultMode;
  goalEl.value   = settings.defaultGoal;
  toneEl.value   = settings.defaultTone;

  // Sync range ↔ number
  maxRange.addEventListener('input', () => { maxNum.value = maxRange.value; });
  maxNum.addEventListener('input', () => {
    let v = Math.min(20, Math.max(1, parseInt(maxNum.value) || 1));
    maxNum.value = v;
    maxRange.value = v;
  });

  btnSave.addEventListener('click', async () => {
    await Storage.saveSettings({
      maxAttempts:  parseInt(maxNum.value) || 10,
      defaultMode:  modeEl.value,
      defaultGoal:  goalEl.value,
      defaultTone:  toneEl.value
    });
    savedMsg.style.display = 'block';
    setTimeout(() => { savedMsg.style.display = 'none'; }, 2000);
  });

  btnClear.addEventListener('click', async () => {
    if (confirm('Clear all session data?')) {
      await new Promise(r => chrome.storage.local.remove('sessions', r));
      btnClear.textContent = 'Cleared!';
      setTimeout(() => { btnClear.textContent = 'Clear Data'; }, 1500);
    }
  });

})();
