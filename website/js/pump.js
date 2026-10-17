// Swamp Gas & Go: gas-station checkout on the Pixel (Web NFC).
// Items → Charge → tap the SwampTag debit card → PIN → scan the SwampTag key fob.
// server.py (terminal.py → PumpAuthorizer) decides: right PIN, key paired with this card,
// and a fresh key code (the key device rewrites the fob every 15 s, so a copy goes stale).
// Approved sales are written to Nessie at the "Swamp Gas & Go" merchant.

const SAME_TAG_IGNORE_MS = 2500;
const FUEL_PRICE = 3; // $ per gallon (whole dollars, because Nessie stores whole dollars)

const FUEL = [
  { id: 'fuel20', label: 'Regular · $20', detail: '≈ 6.7 gal', price: 20 },
  { id: 'fuel40', label: 'Regular · $40', detail: '≈ 13.3 gal', price: 40 },
  { id: 'fuel60', label: 'Regular · $60', detail: '≈ 20 gal', price: 60 },
];
const STORE = [
  { id: 'coffee', label: 'Coffee', icon: '☕', price: 2 },
  { id: 'water', label: 'Water', icon: '💧', price: 2 },
  { id: 'chips', label: 'Chips', icon: '🥔', price: 3 },
  { id: 'energy', label: 'Energy drink', icon: '⚡', price: 4 },
];

const $ = (sel) => document.querySelector(sel);
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

const state = {
  step: 'shop',          // shop | card | pin | key | busy | result
  fuel: null,            // FUEL id
  gallons: 0,            // custom gallons (0 = use a FUEL preset)
  qty: {},               // STORE id -> count
  card: null,            // what the phone read from the card
  cardInfo: null,        // { last4, holder, mode }
  pin: '',
  result: null,
  notice: '',
  lastRead: null,        // for the setup screen: { serialNumber, texts, at }
  pairing: null,         // setup: null | 'card' | { card }
};
let lastTag = { serial: '', at: 0 };
let noticeTimer = null;
let nfcOn = false;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function speak(text) {
  try {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    speechSynthesis.speak(u);
  } catch { /* no voice */ }
}

// ---------- Cart ----------

function cartLines() {
  const lines = [];
  if (state.gallons > 0) lines.push({ label: `Regular · ${state.gallons} gal`, price: state.gallons * FUEL_PRICE });
  else if (state.fuel) {
    const f = FUEL.find((x) => x.id === state.fuel);
    lines.push({ label: f.label, price: f.price });
  }
  for (const item of STORE) {
    const n = state.qty[item.id] || 0;
    if (n) lines.push({ label: n > 1 ? `${item.label} × ${n}` : item.label, price: item.price * n });
  }
  return lines;
}

const cartTotal = () => cartLines().reduce((sum, l) => sum + l.price, 0);

// ---------- Screens ----------

const TAP_ICON = `
  <div class="tap-ripple"><div class="core">
    <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round">
      <path d="M8.5 7.5a6 6 0 0 1 0 9"/><path d="M12 5a9.5 9.5 0 0 1 0 14"/><path d="M15.5 2.5a13 13 0 0 1 0 19"/>
      <circle cx="5" cy="12" r="1.5" fill="#fff" stroke="none"/>
    </svg>
  </div></div>`;

function demoButtons(buttons) {
  if (nfcOn) return '';
  return `<div class="pump-demo"><span class="demo-label">No NFC here: demo buttons</span>${buttons
    .map(([sim, label]) => `<button class="btn btn-outline btn-sm" data-sim="${sim}">${label}</button>`).join('')}</div>`;
}

function shopScreen() {
  const total = cartTotal();
  return `
    <section class="pump-section">
      <h2>Fuel</h2>
      <div class="pump-fuel">
        ${FUEL.map((f) => `
          <button class="pump-tile ${state.fuel === f.id && !state.gallons ? 'on' : ''}" data-fuel="${f.id}">
            <strong>${f.label}</strong><span>${f.detail}</span>
          </button>`).join('')}
      </div>
      <div class="pump-gallons">
        <span>Or choose gallons <small>(${money.format(FUEL_PRICE)}/gal)</small></span>
        <div class="stepper">
          <button data-gal="-1" aria-label="One gallon less">−</button>
          <b class="num">${state.gallons}</b>
          <button data-gal="1" aria-label="One gallon more">+</button>
        </div>
      </div>
    </section>
    <section class="pump-section">
      <h2>Store</h2>
      <div class="pump-store">
        ${STORE.map((it) => {
          const n = state.qty[it.id] || 0;
          return `
            <div class="pump-item ${n ? 'on' : ''}">
              <span class="pump-icon" aria-hidden="true">${it.icon}</span>
              <span class="grow"><strong>${it.label}</strong><small>${money.format(it.price)}</small></span>
              <div class="stepper">
                <button data-item="${it.id}" data-d="-1" aria-label="Remove one ${it.label}">−</button>
                <b class="num">${n}</b>
                <button data-item="${it.id}" data-d="1" aria-label="Add one ${it.label}">+</button>
              </div>
            </div>`;
        }).join('')}
      </div>
    </section>
    <div class="pump-cart">
      <div><span class="muted small">Total</span><div class="pump-total num">${money.format(total)}</div></div>
      <button class="btn btn-primary" id="charge-btn" ${total ? '' : 'disabled'}>Charge ${money.format(total)}</button>
    </div>`;
}

function cardScreen() {
  return `
    <div class="pump-center">
      <p class="pump-amount num">${money.format(cartTotal())}</p>
      ${TAP_ICON}
      <h1 class="pump-title">Tap your card</h1>
      <p class="muted">Hold the SwampTag debit card flat on the back of the phone, near the camera.</p>
      ${demoButtons([['card', 'Tap demo card']])}
      <button class="btn btn-ghost btn-sm" data-act="cancel">Cancel sale</button>
    </div>`;
}

function pinScreen() {
  const dots = [0, 1, 2, 3].map((i) => `<span class="${i < state.pin.length ? 'on' : ''}"></span>`).join('');
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];
  return `
    <div class="pump-center">
      <div class="pump-card-chip">SwampTag Debit •••• ${escapeHtml(state.cardInfo.last4)}<small>${escapeHtml(state.cardInfo.holder)}</small></div>
      <h1 class="pump-title">Enter your PIN</h1>
      <div class="pin-dots" aria-label="${state.pin.length} of 4 digits entered">${dots}</div>
      <div class="pin-pad">
        ${keys.map((k) => `<button data-pin="${k}" ${k === 'clear' || k === 'back' ? 'class="muted-key"' : ''}>${k === 'clear' ? 'Clear' : k === 'back' ? '⌫' : k}</button>`).join('')}
      </div>
      <button class="btn btn-primary btn-block" id="pin-ok" ${state.pin.length === 4 ? '' : 'disabled'}>OK</button>
      <button class="btn btn-ghost btn-sm" data-act="cancel">Cancel sale</button>
    </div>`;
}

function keyScreen() {
  return `
    <div class="pump-center">
      <div class="pump-card-chip">SwampTag Debit •••• ${escapeHtml(state.cardInfo.last4)}<small>PIN entered</small></div>
      ${TAP_ICON}
      <h1 class="pump-title">Scan your SwampTag key</h1>
      <p class="muted">Hold your key fob on the back of the phone. It proves the card's real owner is here.</p>
      ${demoButtons([['good', 'Right key'], ['copied', 'Copied key'], ['wrong', 'Wrong key']])}
      <button class="btn btn-ghost btn-sm" data-act="cancel">Cancel sale</button>
    </div>`;
}

function busyScreen() {
  return `<div class="pump-center">${TAP_ICON}<h1 class="pump-title">Checking your key…</h1></div>`;
}

function resultScreen() {
  const r = state.result;
  if (r.approved) {
    return `
      <div class="pump-center">
        <div class="term-result good">✓</div>
        <h1 class="pump-title good">Approved</h1>
        <div class="receipt">
          ${cartLines().map((l) => `<div><span>${escapeHtml(l.label)}</span><span class="num">${money.format(l.price)}</span></div>`).join('')}
          <div class="receipt-total"><span>Total</span><span class="num">${money.format(cartTotal())}</span></div>
          <div class="muted small">SwampTag Debit •••• ${escapeHtml(r.card.last4)} · ${r.verified ? 'Verified with SwampTag key' : 'Key matched (ID only)'}</div>
        </div>
        <p class="muted small">Put your key back on its dock so it gets a fresh code.</p>
        <button class="btn btn-primary btn-block" data-act="new">New sale</button>
      </div>`;
  }
  const retry = r.step === 'key' ? 'Try the key again' : r.step === 'pin' && !/locked/i.test(r.reason) ? 'Re-enter PIN' : '';
  return `
    <div class="pump-center">
      <div class="term-result bad">✕</div>
      <h1 class="pump-title bad">Declined</h1>
      <p class="pump-reason">${escapeHtml(r.reason)}</p>
      <p class="muted small">No money was taken.</p>
      ${retry ? `<button class="btn btn-primary btn-block" data-act="retry">${retry}</button>` : ''}
      <button class="btn btn-ghost btn-block" data-act="new">Cancel sale</button>
    </div>`;
}

function render() {
  const screens = { shop: shopScreen, card: cardScreen, pin: pinScreen, key: keyScreen, busy: busyScreen, result: resultScreen };
  let html = screens[state.step]();
  if (state.notice) html += `<p class="term-notice">${escapeHtml(state.notice)}</p>`;
  $('#screen').innerHTML = html;
  const order = ['shop', 'card', 'pin', 'key'];
  const at = state.step === 'busy' || state.step === 'result' ? 4 : order.indexOf(state.step);
  document.querySelectorAll('#steps li').forEach((li, i) => {
    li.className = i < at ? 'done' : i === at ? 'now' : '';
  });
}

function flash(message) {
  state.notice = message;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { state.notice = ''; render(); }, 3500);
  render();
}

function go(step) {
  state.step = step;
  render();
}

function newSale() {
  Object.assign(state, { step: 'shop', fuel: null, gallons: 0, qty: {}, card: null, cardInfo: null, pin: '', result: null });
  render();
}

// ---------- Server ----------

async function post(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
}

async function checkCard(read) {
  try {
    const r = await post('/api/pump/card', { card: read });
    if (!r.ok) return flash(r.reason);
    state.card = read;
    state.cardInfo = { last4: r.last4, holder: r.holder, mode: r.mode };
    state.pin = '';
    go('pin');
    speak('Card accepted. Enter your PIN.');
  } catch {
    flash("Can't reach the laptop. Check the USB cable and port forwarding.");
  }
}

async function authorize(keyRead) {
  go('busy');
  try {
    state.result = await post('/api/pump/authorize', {
      card: state.card, pin: state.pin, key: keyRead,
      total: cartTotal(), items: cartLines().map((l) => l.label),
    });
  } catch {
    state.result = { approved: false, reason: "Can't reach the laptop", step: 'key' };
  }
  go('result');
  speak(state.result.approved ? 'Approved. Thank you.' : `Declined. ${state.result.reason}.`);
}

// ---------- NFC ----------

function textsFrom(message) {
  const texts = [];
  for (const record of message.records || []) {
    try {
      if (record.recordType === 'text') texts.push(new TextDecoder(record.encoding || 'utf-8').decode(record.data));
      else if (record.mediaType && record.mediaType.startsWith('text/')) texts.push(new TextDecoder().decode(record.data));
    } catch { /* skip */ }
  }
  return texts;
}

function onTag(read) {
  state.lastRead = { ...read, at: new Date().toLocaleTimeString() };
  if (!$('#setup').classList.contains('hidden')) renderSetup();
  if (state.pairing) return pairStep(read);
  if (state.step === 'card') return checkCard(read);
  if (state.step === 'key') return authorize(read);
  if (state.step === 'shop') return flash('Choose your items, then tap Charge.');
}

async function startNfc() {
  if (!('NDEFReader' in window)) {
    setStatus('No NFC: demo buttons', 'badge-offline');
    render();
    return;
  }
  try {
    const reader = new NDEFReader();
    await reader.scan();
    nfcOn = true;
    setStatus('Card reader on', 'badge-live');
    reader.addEventListener('reading', ({ serialNumber, message }) => {
      const now = Date.now();
      if (serialNumber === lastTag.serial && now - lastTag.at < SAME_TAG_IGNORE_MS) return;
      lastTag = { serial: serialNumber, at: now };
      onTag({ serialNumber, texts: textsFrom(message) });
    });
    reader.addEventListener('readingerror', () => flash("Couldn't read that. Hold it still near the camera."));
  } catch (err) {
    setStatus('Reader off', 'badge-red');
    flash(`Card reader didn't start: ${err.message}`);
  }
  render();
}

function setStatus(text, kind) {
  const el = $('#nfc-status');
  el.className = `badge badge-dot ${kind}`;
  el.textContent = text;
}

// ---------- Setup (⚙): what the phone sees, and pairing for ID-only phones ----------

function renderSetup() {
  const r = state.lastRead;
  const mode = state.cardInfo ? state.cardInfo.mode : null;
  $('#setup-body').innerHTML = `
    <p class="modal-text">Tap a tag on the phone to see what it reads.</p>
    <div class="setup-read">
      ${r ? `<b>Last read (${escapeHtml(r.at)})</b>
        <div class="mono small">ID ${escapeHtml(r.serialNumber || '—')}</div>
        <div class="mono small">${r.texts.length ? r.texts.map(escapeHtml).join('<br>') : 'No data records. This phone sees the ID only.'}</div>`
      : '<span class="muted">Nothing read yet.</span>'}
    </div>
    <p class="small muted">${mode === 'ndef' ? 'Mode: the phone reads the data on your tags (full SwampTag codes).' : mode === 'serial' ? 'Mode: ID-only. Cards are matched to keys by pairing below.' : 'Mode: decided by the first card you tap.'}</p>
    <h3 class="setup-h">Pair a card with its key</h3>
    <p class="small muted">Only needed when the phone sees IDs only.</p>
    ${state.pairing === 'card' ? '<p class="pump-reason">Tap the CARD now…</p>' : state.pairing ? '<p class="pump-reason">Now tap the KEY FOB…</p>' : '<button class="btn btn-outline btn-sm" id="pair-btn">Pair card + key</button>'}`;
  const btn = $('#pair-btn');
  if (btn) btn.addEventListener('click', () => { state.pairing = 'card'; renderSetup(); });
}

async function pairStep(read) {
  if (state.pairing === 'card') {
    state.pairing = { card: read.serialNumber };
  } else {
    const ok = await post('/api/pump/pair', { card: { serialNumber: state.pairing.card }, key: { serialNumber: read.serialNumber } }).then((r) => r.ok).catch(() => false);
    state.pairing = null;
    flash(ok ? 'Card and key paired.' : 'Pairing failed.');
  }
  renderSetup();
}

// ---------- Wire up ----------

$('#screen').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.fuel) {
    state.fuel = state.fuel === b.dataset.fuel && !state.gallons ? null : b.dataset.fuel;
    state.gallons = 0;
  } else if (b.dataset.gal) {
    state.gallons = Math.max(0, Math.min(30, state.gallons + Number(b.dataset.gal)));
    if (state.gallons) state.fuel = null;
  } else if (b.dataset.item) {
    state.qty[b.dataset.item] = Math.max(0, Math.min(9, (state.qty[b.dataset.item] || 0) + Number(b.dataset.d)));
  } else if (b.id === 'charge-btn') {
    return go('card');
  } else if (b.dataset.pin) {
    const k = b.dataset.pin;
    if (k === 'clear') state.pin = '';
    else if (k === 'back') state.pin = state.pin.slice(0, -1);
    else if (state.pin.length < 4) state.pin += k;
  } else if (b.id === 'pin-ok') {
    return go('key');
  } else if (b.dataset.sim) {
    if (state.step === 'card') return checkCard({ simulate: 'card' });
    if (state.step === 'key') return authorize({ simulate: b.dataset.sim });
  } else if (b.dataset.act === 'cancel' || b.dataset.act === 'new') {
    return newSale();
  } else if (b.dataset.act === 'retry') {
    if (state.result.step === 'pin') state.pin = '';
    return go(state.result.step === 'pin' ? 'pin' : 'key');
  }
  render();
});

$('#start-btn').addEventListener('click', async () => {
  $('#start').classList.add('hidden');
  const nfc = startNfc(); // first: its permission prompt needs this tap
  try { await document.documentElement.requestFullscreen(); } catch { /* not allowed */ }
  try { await screen.orientation.lock('portrait-primary'); } catch { /* Android may refuse */ }
  try { await navigator.wakeLock.request('screen'); } catch { /* not available */ }
  await nfc;
});
$('#setup-btn').addEventListener('click', () => { renderSetup(); $('#setup').classList.remove('hidden'); });
$('#setup-close').addEventListener('click', () => { state.pairing = null; $('#setup').classList.add('hidden'); });
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible') {
    try { await navigator.wakeLock.request('screen'); } catch { /* ignore */ }
  }
});

setStatus('Reader off', 'badge-offline');
render();
