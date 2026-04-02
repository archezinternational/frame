'use strict';

const HISTORY_KEY = 'frame_history';
const MAX_ENTRIES = 100;

function _load() {
  return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
}

function _save(entries) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
}

function savePrompt(templateName, promptText) {
  if (!promptText.trim()) return;
  const entries = _load();
  entries.unshift({ id: Date.now(), ts: Date.now(), template: templateName, prompt: promptText });
  _save(entries.slice(0, MAX_ENTRIES));
  _renderHistory();
}

function deleteEntry(id) {
  _save(_load().filter(e => e.id !== id));
  _renderHistory();
}

function clearHistory() {
  _save([]);
  _renderHistory();
}

function _fmt(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short' }) +
    ' · ' + d.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
}

function _copyEntry(id) {
  const entry = _load().find(e => e.id === id);
  if (!entry) return;
  navigator.clipboard.writeText(entry.prompt).then(() => {
    const btn = document.getElementById('hcopy-' + id);
    if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy'; }, 1800); }
  });
}

function _renderHistory() {
  const entries = _load();
  const list = document.getElementById('historyList');
  if (!list) return;

  document.getElementById('historyCount').textContent =
    entries.length ? `${entries.length} prompt${entries.length > 1 ? 's' : ''}` : '';

  if (!entries.length) {
    list.innerHTML = `<div class="h-empty">No prompts saved yet.<br>Click <strong>Done ✓</strong> to save one.</div>`;
    return;
  }

  list.innerHTML = entries.map(e => `
    <div class="h-entry">
      <div class="h-meta">
        <span class="h-tpl">${e.template}</span>
        <span class="h-ts">${_fmt(e.ts)}</span>
      </div>
      <div class="h-prompt">${e.prompt}</div>
      <div class="h-actions">
        <button class="h-btn-copy" id="hcopy-${e.id}" onclick="_copyEntry(${e.id})">Copy</button>
        <button class="h-btn-del" onclick="deleteEntry(${e.id})">Delete</button>
      </div>
    </div>`).join('');
}

function openHistory() {
  _renderHistory();
  document.getElementById('historyPanel').classList.add('open');
  document.getElementById('historyOverlay').classList.add('open');
}

function closeHistory() {
  document.getElementById('historyPanel').classList.remove('open');
  document.getElementById('historyOverlay').classList.remove('open');
}
