// SwampTag phone terminal (runs on the Pixel inside the card-scanner case).
// - Shows what the dashboard is waiting for (amount, merchant) and the result.
// - Reads the key with Web NFC (Chrome on Android) and sends it to server.py,
//   which checks the key's code and tells the dashboard (terminal.py).
// The phone sits upside down in the case so its NFC spot is over the slot, so the
// page asks for upside-down portrait, or rotates itself if Android says no.

const POLL_MS = 400;
const RESULT_SHOW_MS = 5000;
const SAME_TAG_IGNORE_MS = 2500;
const FLIP_KEY = 'swamptag-terminal-flip';

const $ = (sel) => document.querySelector(sel);
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

let current = { seq: -1, request: null, result: null };
let resultShownAt = 0;
let lastRead = { serial: '', at: 0 };
let notice = '';
let noticeTimer = null;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const TAP_ICON = `
  <div class="tap-ripple"><div class="core">
    <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round">
      <path d="M8.5 7.5a6 6 0 0 1 0 9"/><path d="M12 5a9.5 9.5 0 0 1 0 14"/><path d="M15.5 2.5a13 13 0 0 1 0 19"/>
      <circle cx="5" cy="12" r="1.5" fill="#fff" stroke="none"/>
    </svg>
  </div></div>`;

// ---------- Screens ----------

function render() {
  const { request, result } = current;
  const showResult = result && Date.now() - resultShownAt < RESULT_SHOW_MS;
  let html;

  if (showResult && result === 'OK') {
    html = `
      <div class="term-result good">✓</div>
      <h1 class="term-title good">${request && request.linking ? 'Key linked' : 'Approved'}</h1>
      ${request && request.amount ? `<div class="term-amount">${money.format(request.amount)}</div>` : ''}
      <p class="term-sub">${request && request.trusted ? 'Within your tap limit, no key needed' : 'Verified with your SwampTag key'}</p>`;
  } else if (showResult && result === 'DENY') {
    html = `
      <div class="term-result bad">✕</div>
      <h1 class="term-title bad">Payment blocked</h1>
      ${request && request.amount ? `<div class="term-amount">${money.format(request.amount)}</div>` : ''}
      <p class="term-sub">${escapeHtml((request && request.reason) || "This key isn't the one linked to the card")}.</p>`;
  } else if (request && !result && request.linking) {
    html = `
      <p class="term-merchant">Link a new key</p>
      ${TAP_ICON}
      <p class="term-prompt">Insert the key you want to link</p>
      <div class="term-arrow" aria-hidden="true">▼</div>`;
  } else if (request && !result) {
    const reasons = (request.reasons || []).slice(0, 3);
    html = `
      <p class="term-merchant">${escapeHtml(request.name || 'Payment')}${request.place ? ` · ${escapeHtml(request.place)}` : ''}</p>
      <div class="term-amount">${money.format(request.amount || 0)}</div>
      ${reasons.length ? `<div class="term-reasons">${reasons.map((r) => `<span class="badge badge-amber">${escapeHtml(r)}</span>`).join('')}</div>` : ''}
      ${TAP_ICON}
      <p class="term-prompt">Insert your SwampTag key</p>
      <div class="term-arrow" aria-hidden="true">▼</div>`;
  } else {
    html = `
      <div class="term-idle">${TAP_ICON}</div>
      <h1 class="term-title">Ready for payment</h1>
      <p class="term-sub">Start a payment on the SwampTag dashboard.</p>`;
  }

  if (notice) html += `<p class="term-notice">${escapeHtml(notice)}</p>`;
  $('#screen').innerHTML = html;
}

function flash(message) {
  notice = message;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice = ''; render(); }, 3000);
  render();
}

function speak(text) {
  try {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    speechSynthesis.speak(utterance);
  } catch { /* no voice available */ }
}

// ---------- Talking to server.py ----------

async function poll() {
  try {
    const res = await fetch('/api/terminal/state', { cache: 'no-store' });
    const next = await res.json();
    if (next.seq !== current.seq) {
      const newResult = next.result && next.result !== current.result;
      current = next;
      if (newResult) {
        resultShownAt = Date.now();
        speak(next.result === 'OK' ? (next.request && next.request.linking ? 'Key linked' : 'Approved') : 'Payment blocked');
      }
      render();
    } else if (current.result && Date.now() - resultShownAt >= RESULT_SHOW_MS) {
      render(); // result timed out, back to Ready
    }
  } catch {
    setStatus('Laptop not reachable. Check port forwarding.', 'badge-red');
  }
}

async function sendRead(payload) {
  try {
    const res = await fetch('/api/terminal/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const { line } = await res.json();
    if (line && line.startsWith('BADTAG:')) flash(line.slice(7));
  } catch {
    flash("Couldn't reach the laptop.");
  }
}

function waiting() {
  return current.request && !current.result;
}

// ---------- NFC ----------

function textsFrom(message) {
  const texts = [];
  for (const record of message.records || []) {
    try {
      if (record.recordType === 'text') {
        texts.push(new TextDecoder(record.encoding || 'utf-8').decode(record.data));
      } else if (record.mediaType && record.mediaType.startsWith('text/')) {
        texts.push(new TextDecoder().decode(record.data));
      }
    } catch { /* skip records we can't decode */ }
  }
  return texts;
}

async function startNfc() {
  if (!('NDEFReader' in window)) {
    setStatus('No Web NFC here. Use Chrome on Android, or the demo buttons.', 'badge-offline');
    $('#demo-buttons').classList.remove('hidden');
    return;
  }
  try {
    const reader = new NDEFReader();
    await reader.scan();
    setStatus('Key reader on', 'badge-live');
    reader.addEventListener('reading', ({ serialNumber, message }) => {
      const now = Date.now();
      if (serialNumber === lastRead.serial && now - lastRead.at < SAME_TAG_IGNORE_MS) return;
      lastRead = { serial: serialNumber, at: now };
      if (!waiting()) {
        flash('No payment is waiting for a key.');
        return;
      }
      sendRead({ serialNumber, texts: textsFrom(message) });
    });
    reader.addEventListener('readingerror', () => flash("Couldn't read that key. Hold it still in the slot."));
  } catch (err) {
    setStatus(`Key reader off: ${err.message}`, 'badge-red');
    $('#demo-buttons').classList.remove('hidden');
  }
}

function setStatus(text, kind) {
  const el = $('#nfc-status');
  el.className = `badge badge-dot ${kind}`;
  el.textContent = text;
}

// ---------- Screen setup ----------

function setFlipped(on) {
  document.body.classList.toggle('flipped', on);
  try { localStorage.setItem(FLIP_KEY, on ? '1' : '0'); } catch { /* storage blocked */ }
}

async function enterTerminalMode() {
  try { await document.documentElement.requestFullscreen(); } catch { /* not allowed */ }
  // Upside-down portrait puts the phone's NFC spot over the case's slot.
  let locked = false;
  try {
    await screen.orientation.lock('portrait-secondary');
    locked = true;
  } catch { /* Android may refuse */ }
  let saved = null;
  try { saved = localStorage.getItem(FLIP_KEY); } catch { /* storage blocked */ }
  setFlipped(saved === null ? !locked : saved === '1');
  try { await navigator.wakeLock.request('screen'); } catch { /* keep-awake not available */ }
}

$('#start-btn').addEventListener('click', async () => {
  $('#start').classList.add('hidden');
  await enterTerminalMode();
  await startNfc();
});
$('#flip-btn').addEventListener('click', () => setFlipped(!document.body.classList.contains('flipped')));
document.querySelectorAll('[data-sim]').forEach((b) => {
  b.addEventListener('click', () => {
    if (!waiting()) return flash('No payment is waiting for a key.');
    sendRead({ simulate: b.dataset.sim });
  });
});
document.addEventListener('visibilitychange', async () => {
  // Android drops the screen wake lock when the page is hidden; take it back.
  if (document.visibilityState === 'visible') {
    try { await navigator.wakeLock.request('screen'); } catch { /* ignore */ }
  }
});

render();
poll();
setInterval(poll, POLL_MS);
