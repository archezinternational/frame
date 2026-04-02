'use strict';

const WORKER_URL   = 'https://frame-license-validator.archez-international.workers.dev';
const STORAGE_KEY  = 'frame_license';
const REVALIDATE_H = 24;

async function _validateKey(key) {
  try {
    const res  = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ license_key: key }),
    });
    const data = await res.json();
    if (data.valid) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ key, ts: Date.now() }));
      return true;
    }
    localStorage.removeItem(STORAGE_KEY);
    return false;
  } catch {
    // Network failure — fail open if a stored key exists
    return !!localStorage.getItem(STORAGE_KEY);
  }
}

async function _checkStored() {
  const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  if (!stored) return false;
  const hoursSince = (Date.now() - stored.ts) / 36e5;
  if (hoursSince < REVALIDATE_H) return true;
  return _validateKey(stored.key);
}

function _showError(msg) {
  const el = document.getElementById('gateError');
  el.textContent = msg;
  el.style.display = 'block';
}

function _dismissGate() {
  const gate = document.getElementById('gate');
  gate.style.transition = 'opacity 0.4s';
  gate.style.opacity = '0';
  setTimeout(() => gate.remove(), 400);
}

async function unlockFRAME() {
  const key = document.getElementById('gateInput').value.trim();
  const btn = document.getElementById('gateBtn');
  const err = document.getElementById('gateError');

  if (!key) { _showError('Please enter your license key.'); return; }

  btn.textContent = 'Validating…';
  btn.disabled = true;
  err.style.display = 'none';

  const valid = await _validateKey(key);

  if (valid) {
    _dismissGate();
  } else {
    btn.textContent = 'Unlock FRAME';
    btn.disabled = false;
    _showError('Invalid or revoked license key. Check your Gumroad receipt and try again.');
  }
}

// On load — skip gate if valid session exists or running locally
(async () => {
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    _dismissGate(); return;
  }
  if (await _checkStored()) _dismissGate();
})();
