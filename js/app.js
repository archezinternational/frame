'use strict';
/* ─── STATE ─────────────────────────────────────────────────────────── */
let tplIdx = 0;
let stepIdx = 0;
let vals = {};      // key → typed or auto-assembled string
let sel = {};       // key → Set of selected chip values

function initState(ti) {
  tplIdx = ti;
  stepIdx = 0;
  vals = {};
  sel = {};
  T[ti].els.forEach(el => { vals[el.key] = ''; sel[el.key] = new Set(); });
}

/* ─── RENDER ─────────────────────────────────────────────────────────── */
function renderSidebar() {
  document.getElementById('tplList').innerHTML = T.map((t, i) => `
    <div class="tpl-item ${i===tplIdx?'active':''}" onclick="selectTpl(${i})">
      <span class="tpl-num">${String(i+1).padStart(2,'0')}</span>
      <span class="tpl-name">${t.name}</span>
    </div>`).join('');
}

function renderHeader() {
  const t = T[tplIdx];
  document.getElementById('tplHeader').innerHTML = `
    <div class="tpl-tag">Template ${t.id} / ${T.length}</div>
    <h2>${t.name}</h2>
    <p>${t.desc}</p>`;
}

function renderStepper() {
  const t = T[tplIdx];
  document.getElementById('stepper').innerHTML = t.els.map((el, i) => {
    const done = i < stepIdx && vals[el.key];
    const active = i === stepIdx;
    const cls = active ? 'active' : (done ? 'done' : '');
    return `
      <div class="step ${cls}" onclick="jumpStep(${i})">
        <div class="step-check"><svg viewBox="0 0 10 8" fill="none" stroke="#1a1a1a" stroke-width="2"><polyline points="1 4 4 7 9 1"/></svg></div>
        <div class="step-letter">${el.key}</div>
        <div class="step-name">${el.label}</div>
      </div>`;
  }).join('');
}

function renderPanel() {
  const t = T[tplIdx];
  const el = t.els[stepIdx];
  const chips = sel[el.key];

  const groupsHTML = el.groups.map(g => `
    <div class="chip-group">
      <div class="cg-label">${g.label}</div>
      <div class="chips">
        ${g.chips.map(c => `
          <button class="chip ${chips.has(c)?'on':''}"
            onclick="toggleChip('${el.key}','${c.replace(/'/g,"\\'")}')">
            ${c}
          </button>`).join('')}
      </div>
    </div>`).join('');

  document.getElementById('elementPanel').innerHTML = `
    <div class="panel-top">
      <div class="panel-letter">${el.key}</div>
      <div class="panel-meta">
        <div class="panel-label">${el.label}</div>
        <div class="panel-sublabel">${el.sub}</div>
      </div>
    </div>
    <div class="panel-body">
      <div class="input-wrap">
        <input class="el-input" id="elInput"
          placeholder="${el.ph}"
          value="${vals[el.key].replace(/"/g,'&quot;')}"
          oninput="onType('${el.key}', this.value)" />
        <button class="input-clear" id="inputClear"
          onclick="clearEl('${el.key}')"
          style="display:${vals[el.key]?'block':'none'}">×</button>
      </div>
      ${groupsHTML}
    </div>`;
}

function renderNav() {
  const t = T[tplIdx];
  const last = stepIdx === t.els.length - 1;
  const el = t.els[stepIdx];

  document.getElementById('btnBack').disabled = stepIdx === 0;
  document.getElementById('stepCounter').innerHTML =
    `<strong>${stepIdx+1}</strong> of ${t.els.length} — ${el.label}`;

  const btn = document.getElementById('btnNext');
  if (last) {
    btn.classList.add('finish');
    btn.innerHTML = 'Done ✓';
  } else {
    btn.classList.remove('finish');
    btn.innerHTML = 'Next <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>';
  }
}

function renderPrompt() {
  const t = T[tplIdx];
  const ar = document.getElementById('arSelect').value;
  const parts = t.els.map(el => vals[el.key].trim()).filter(Boolean);

  // dots
  document.getElementById('pDots').innerHTML =
    t.els.map(el => `<div class="p-dot ${vals[el.key].trim()?'on':''}"></div>`).join('');

  const ptEl = document.getElementById('promptText');
  if (!parts.length) {
    ptEl.innerHTML = `<span class="pt-empty">Your prompt will appear here as you fill in the FRAME elements…</span>`;
  } else {
    const joined = parts.map(p=>`<span>${p}</span>`).join('<span class="pt-sep">, </span>');
    ptEl.innerHTML = joined + `<span class="pt-sep"> </span><span class="pt-ar">--ar ${ar}</span>`;
  }
}

function renderExample() {
  const t = T[tplIdx];
  document.getElementById('exBlock').innerHTML = `
    <div class="ex-label">Full Applied Example</div>
    <div class="ex-text">${t.example}</div>`;
}

function render() {
  renderSidebar();
  renderHeader();
  renderStepper();
  renderPanel();
  renderNav();
  renderPrompt();
  renderExample();
  document.getElementById('arSelect').value = T[tplIdx].defaultAr;
}

/* ─── INTERACTIONS ───────────────────────────────────────────────────── */
function selectTpl(i) {
  initState(i);
  render();
}

function jumpStep(i) {
  stepIdx = i;
  renderStepper();
  renderPanel();
  renderNav();
}

function goBack() {
  if (stepIdx > 0) { stepIdx--; renderStepper(); renderPanel(); renderNav(); }
}

function goNext() {
  const t = T[tplIdx];
  if (stepIdx < t.els.length - 1) {
    stepIdx++;
    renderStepper();
    renderPanel();
    renderNav();
  } else {
    // Done — save to history
    const ar = document.getElementById('arSelect').value;
    const parts = t.els.map(el => vals[el.key].trim()).filter(Boolean);
    if (parts.length) savePrompt(t.name, parts.join(', ') + ` --ar ${ar}`);
  }
}

function toggleChip(key, val) {
  const s = sel[key];
  if (s.has(val)) s.delete(val); else s.add(val);
  vals[key] = [...s].join(', ');
  // sync input
  const inp = document.getElementById('elInput');
  if (inp) {
    inp.value = vals[key];
    document.getElementById('inputClear').style.display = vals[key] ? 'block' : 'none';
  }
  renderStepper();
  renderPanel();
  renderPrompt();
}

function onType(key, v) {
  vals[key] = v;
  sel[key].clear();
  document.getElementById('inputClear').style.display = v ? 'block' : 'none';
  renderStepper();
  // re-render chips to clear selections
  const t = T[tplIdx]; const el = t.els[stepIdx];
  if (el.key === key) {
    // just update chip classes without full re-render
    el.groups.forEach(g => g.chips.forEach(c => {
      const btn = [...document.querySelectorAll('.chip')].find(b=>b.textContent.trim()===c && b.closest('#elementPanel'));
      if(btn) btn.classList.toggle('on', sel[key].has(c));
    }));
  }
  renderPrompt();
}

function clearEl(key) {
  vals[key] = '';
  sel[key].clear();
  const inp = document.getElementById('elInput');
  if (inp) { inp.value = ''; }
  document.getElementById('inputClear').style.display = 'none';
  renderStepper();
  renderPanel();
  renderPrompt();
}

function resetCurrent() {
  initState(tplIdx);
  render();
}

function resetAll() { resetCurrent(); }

function buildPrompt() { renderPrompt(); }

function copyPrompt() {
  const t = T[tplIdx];
  const ar = document.getElementById('arSelect').value;
  const parts = t.els.map(el => vals[el.key].trim()).filter(Boolean);
  const text = parts.join(', ') + (parts.length ? ` --ar ${ar}` : '');
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('btnCopy');
    btn.classList.add('ok');
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Copied!`;
    const t2 = document.getElementById('toast');
    t2.classList.add('show');
    setTimeout(()=>{ btn.classList.remove('ok'); btn.innerHTML=`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> Copy Prompt`; t2.classList.remove('show'); }, 2200);
  });
}

/* ─── INIT ───────────────────────────────────────────────────────────── */
initState(0);
render();
