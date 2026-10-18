// Swamp Gas & Go: gas-station checkout on the Pixel (Web NFC).
// Items → Charge → tap the QuackTag debit card → PIN → scan the QuackTag key fob.
// server.py (terminal.py → PumpAuthorizer) decides: right PIN, key paired with this card,
// and a fresh key code (the key device rewrites the fob every 15 s, so a copy goes stale).
// Approved sales are written to Nessie at the "Swamp Gas & Go" merchant.

const SAME_TAG_IGNORE_MS = 2500;
const FUEL_PRICE = 3; // $ per gallon (whole dollars, because Nessie stores whole dollars)
const MERCHANT = 'Swamp Gas & Go';

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
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const state = {
  step: 'shop',          // shop | card | pin | key | busy | result
  fuel: null,            // FUEL id
  gallons: 0,            // custom gallons (0 = use a FUEL preset)
  qty: {},               // STORE id -> count
  card: null,            // what the phone read from the card
  cardInfo: null,        // { last4, holder, mode }
  pin: '',
  result: null,
  lastRead: null,        // for the setup screen: { serialNumber, texts, at }
  pairing: null,         // setup: null | 'card' | { card }
};
let lastTag = { serial: '', at: 0 };
let toastTimer = null;
let nfcOn = false;
let shownStep = null;    // which screen is on display, so re-renders only animate on a real change
let audio = null;        // AudioContext, created on the Start tap (browsers need a tap for sound)

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

// Two quick rising notes, like a payment app's "sent" sound.
function chime() {
  if (!audio) return;
  try {
    audio.resume();
    const t = audio.currentTime;
    [[880, 0], [1320, 0.11]].forEach(([freq, at]) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t + at);
      gain.gain.exponentialRampToValueAtTime(0.25, t + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.45);
      osc.connect(gain).connect(audio.destination);
      osc.start(t + at);
      osc.stop(t + at + 0.5);
    });
  } catch { /* no sound */ }
}

function buzz(pattern) {
  try { navigator.vibrate?.(pattern); } catch { /* no vibration */ }
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

// ---------- Artwork ----------

const NFC_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M8.5 7.5a6 6 0 0 1 0 9"/><path d="M12 5a9.5 9.5 0 0 1 0 14"/><path d="M15.5 2.5a13 13 0 0 1 0 19"/></svg>`;
const BANK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10h18L12 4z"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18"/></svg>`;

function cardArt(last4) {
  return `
    <div class="tap-stage" aria-hidden="true">
      <div class="waves"><i></i><i></i><i></i></div>
      <div class="art-card">
        <span class="ac-brand">QuackTag</span>
        <span class="ac-nfc">${NFC_ICON}</span>
        <span class="ac-chip"></span>
        <span class="ac-num">•••• ${last4 ? escapeHtml(last4) : '••••'}</span>
        <span class="ac-debit">Debit</span>
      </div>
    </div>`;
}

function fobArt() {
  return `
    <div class="tap-stage" aria-hidden="true">
      <div class="waves"><i></i><i></i><i></i></div>
      <div class="art-fob"><span style="color:#fff">${NFC_ICON}</span></div>
    </div>`;
}

function cardChip(sub) {
  return `<div class="pump-card-chip"><span>QuackTag Debit •••• ${escapeHtml(state.cardInfo.last4)}<small>${escapeHtml(sub)}</small></span></div>`;
}

function demoButtons(buttons) {
  if (nfcOn) return '';
  return `<div class="pump-demo"><span class="demo-label">No NFC here · demo buttons</span>${buttons
    .map(([sim, label]) => `<button class="pill" data-sim="${sim}">${label}</button>`).join('')}</div>`;
}

const cancelButton = '<button class="pill pill-ghost" data-act="cancel">Cancel sale</button>';

// ---------- Screens ----------

function shopScreen() {
  const total = cartTotal();
  return `
    <div class="hello">
      <h1>What are we<br>filling up today?</h1>
      <p>Pick fuel and snacks, then pay with your card and QuackTag key.</p>
    </div>
    <section class="pump-section">
      <h2>Fuel · Regular</h2>
      <div class="pump-fuel">
        ${FUEL.map((f) => `
          <button class="pump-tile ${state.fuel === f.id && !state.gallons ? 'on' : ''}" data-fuel="${f.id}" aria-pressed="${state.fuel === f.id && !state.gallons}">
            <strong class="num">$${f.price}</strong><span>${f.detail}</span>
          </button>`).join('')}
      </div>
      <div class="pump-gallons">
        <span>Exact gallons<small>${money.format(FUEL_PRICE)} per gallon</small></span>
        <div class="stepper">
          <button data-gal="-1" aria-label="One gallon less">−</button>
          <b class="num">${state.gallons}</b>
          <button data-gal="1" aria-label="One gallon more">+</button>
        </div>
      </div>
    </section>
    <section class="pump-section">
      <h2>From the store</h2>
      <div class="pump-store">
        ${STORE.map((it) => {
          const n = state.qty[it.id] || 0;
          return `
            <div class="pump-item ${n ? 'on' : ''}">
              <span class="pump-icon" aria-hidden="true">${it.icon}</span>
              <span class="grow"><strong>${it.label}</strong><small class="num">${money.format(it.price)}</small></span>
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
      <div><div class="label">Total</div><div class="pump-total num">${money.format(total)}</div></div>
      <button class="pill pill-blue" id="charge-btn" ${total ? '' : 'disabled'}>Pay ${money.format(total)}</button>
    </div>`;
}

function cardScreen() {
  return `
    <div class="pump-center">
      <span class="pump-amount-label">Amount due</span>
      <p class="pump-amount num">${money.format(cartTotal())}</p>
      ${cardArt()}
      <h1 class="pump-title">Tap your card</h1>
      <p class="pump-sub">Hold your QuackTag debit card flat against the back of the phone, near the camera.</p>
      ${demoButtons([['card', 'Tap demo card']])}
      ${cancelButton}
    </div>`;
}

function pinScreen() {
  const dots = [0, 1, 2, 3].map((i) => `<span class="${i < state.pin.length ? 'on' : ''}${i === state.pin.length - 1 ? ' new' : ''}"></span>`).join('');
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];
  return `
    <div class="pump-center">
      ${cardChip(state.cardInfo.holder)}
      <h1 class="pump-title" style="margin-top:14px">Enter your PIN</h1>
      <div class="pin-dots" aria-label="${state.pin.length} of 4 digits entered">${dots}</div>
      <div class="pin-pad">
        ${keys.map((k) => `<button data-pin="${k}" ${k === 'clear' || k === 'back' ? 'class="muted-key"' : ''} aria-label="${k === 'back' ? 'Delete' : k}">${k === 'clear' ? 'Clear' : k === 'back' ? '⌫' : k}</button>`).join('')}
      </div>
      <button class="pill pill-blue pill-block" id="pin-ok" ${state.pin.length === 4 ? '' : 'disabled'}>Continue</button>
      ${cancelButton}
    </div>`;
}

function keyScreen() {
  return `
    <div class="pump-center">
      ${cardChip('PIN entered')}
      ${fobArt()}
      <h1 class="pump-title">Scan your QuackTag key</h1>
      <p class="pump-sub">Hold your key fob against the back of the phone. It proves the card's real owner is here.</p>
      ${demoButtons([['good', 'Right key'], ['copied', 'Copied key'], ['wrong', 'Wrong key']])}
      ${cancelButton}
    </div>`;
}

function busyScreen() {
  return `
    <div class="pump-center">
      <div class="spinner" role="progressbar" aria-label="Checking"></div>
      <h1 class="pump-title">Checking your key…</h1>
      <div class="check-list"><span>Card read</span><span>PIN entered</span></div>
    </div>`;
}

// Proof that the sale went to the bank: Capital One's Nessie API (see server.py settle_pump_sale).
function nessieLine(n) {
  if (!n) return '';
  if (!n.recorded) return `<div class="receipt-nessie off">${BANK_ICON}<span>${escapeHtml(n.note || '')}</span></div>`;
  return `<div class="receipt-nessie">${BANK_ICON}<span>Recorded in Capital One Nessie · purchase ${escapeHtml(n.purchaseId.slice(0, 8))}…<br>New balance <b class="num">${money.format(n.balanceAfter)}</b></span></div>`;
}

// Paper-like confetti that bursts from the check mark.
function confetti(count = 34) {
  const colors = ['#FFC83D', '#ffffff', '#F28C1E', '#FFC83D', '#a8ccff', '#ffe28a'];   // QuackTag duck yellow + beak orange
  let html = '';
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
    const dist = 90 + Math.random() * 120;
    html += `<i style="--x:${Math.round(Math.cos(angle) * dist)}px;--y:${Math.round(Math.sin(angle) * dist - 40)}px;--r:${Math.round(Math.random() * 720 - 360)}deg;--s:${6 + Math.round(Math.random() * 6)}px;--c:${colors[i % colors.length]};--d:${(0.55 + Math.random() * 0.15).toFixed(2)}s"></i>`;
  }
  return html;
}

function approvedScreen(r) {
  const total = cartTotal();
  return `
    <div class="paid" role="status">
      <div class="paid-hero">
        <div class="paid-check" aria-hidden="true">
          <span class="ring"></span><span class="ring"></span><span class="ring"></span>
          <span class="paid-burst">${reducedMotion() ? '' : confetti()}</span>
          <span class="disc"></span>
          <svg viewBox="0 0 52 52"><path class="tick" d="M14 27.5 22.5 36 39 18"/></svg>
        </div>
        <h1 class="pump-title">Approved</h1>
        <p class="paid-amount num" data-total="${total}">${money.format(total)}</p>
        <p class="paid-to">paid to <b>${MERCHANT}</b></p>
        <span class="paid-verified"><img class="duck-mark" src="logo.svg" alt="" width="18" height="18">${r.verified ? 'Verified with your QuackTag key' : 'Key matched (ID only)'}</span>
      </div>
      <div class="paid-sheet">
        <div class="grabber"></div>
        <div class="receipt">
          ${cartLines().map((l) => `<div><span>${escapeHtml(l.label)}</span><span class="num">${money.format(l.price)}</span></div>`).join('')}
          <div class="receipt-total"><span>Total</span><span class="num">${money.format(total)}</span></div>
        </div>
        <div class="paid-meta"><div class="pump-card-chip"><span>QuackTag Debit •••• ${escapeHtml(r.card.last4)}<small>${escapeHtml(r.card.holder || '')}</small></span></div></div>
        ${nessieLine(r.nessie)}
        <p class="paid-hint">Put your key back on its dock so it gets a fresh code.</p>
        <button class="pill pill-blue pill-block" data-act="new">Done</button>
      </div>
    </div>`;
}

function declinedScreen(r) {
  const retry = r.step === 'key' ? 'Try the key again' : r.step === 'pin' && !/locked/i.test(r.reason) ? 'Re-enter PIN' : '';
  return `
    <div class="declined" role="alert">
      <div class="dc-icon" aria-hidden="true"><svg viewBox="0 0 52 52"><path d="M17 17l18 18"/><path d="M35 17 17 35"/></svg></div>
      <h1 class="pump-title bad">Declined</h1>
      <p class="pump-reason">${escapeHtml(r.reason)}</p>
      <p class="muted">No money was taken.</p>
      <div class="actions">
        ${retry ? `<button class="pill pill-blue pill-block" data-act="retry">${retry}</button>` : ''}
        <button class="pill pill-ghost" data-act="new">Cancel sale</button>
      </div>
    </div>`;
}

function resultScreen() {
  return state.result.approved ? approvedScreen(state.result) : declinedScreen(state.result);
}

// Counts the big amount up from $0, PayPal-style.
function countUp(el) {
  const target = Number(el.dataset.total) || 0;
  if (reducedMotion()) return;
  const start = performance.now() + 850;
  const dur = 900;
  el.textContent = money.format(0);
  const tick = (now) => {
    const t = Math.min(1, Math.max(0, (now - start) / dur));
    el.textContent = money.format(target * (1 - Math.pow(1 - t, 3)));
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function render() {
  const screens = { shop: shopScreen, card: cardScreen, pin: pinScreen, key: keyScreen, busy: busyScreen, result: resultScreen };
  const el = $('#screen');
  const changed = shownStep !== state.step;
  shownStep = state.step;
  // Entrance animation only when the screen changes, not on every +/− tap.
  el.innerHTML = `<div class="view${changed && state.step !== 'result' ? ' screen-in' : ''}">${screens[state.step]()}</div>`;
  if (changed) window.scrollTo(0, 0);
  if (changed && state.step === 'result' && state.result.approved) {
    countUp(el.querySelector('.paid-amount'));
    setTimeout(chime, 550);
    buzz([25, 70, 45]);
  } else if (changed && state.step === 'result') {
    buzz([90, 60, 90]);
  }
  const order = ['shop', 'card', 'pin', 'key'];
  const at = state.step === 'busy' || state.step === 'result' ? 4 : order.indexOf(state.step);
  document.querySelectorAll('#steps li').forEach((li, i) => {
    li.className = i < at ? 'done' : i === at ? 'now' : '';
  });
}

function flash(message) {
  const t = $('#toast');
  t.textContent = message;
  t.classList.remove('hidden');
  t.style.animation = 'none';
  void t.offsetWidth; // restart the drop-in animation
  t.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3500);
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
    buzz(20);
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
  if (state.result.approved) setTimeout(() => speak('Approved. Thank you.'), 900);
  else speak(`Declined. ${state.result.reason}.`);
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
  if (state.step === 'shop') return flash('Choose your items, then tap Pay.');
}

async function startNfc() {
  if (!('NDEFReader' in window)) {
    setStatus('Demo mode', 'demo');
    render();
    return;
  }
  try {
    const reader = new NDEFReader();
    await reader.scan();
    nfcOn = true;
    setStatus('Reader on', 'live');
    reader.addEventListener('reading', ({ serialNumber, message }) => {
      const now = Date.now();
      if (serialNumber === lastTag.serial && now - lastTag.at < SAME_TAG_IGNORE_MS) return;
      lastTag = { serial: serialNumber, at: now };
      onTag({ serialNumber, texts: textsFrom(message) });
    });
    reader.addEventListener('readingerror', () => flash("Couldn't read that. Hold it still near the camera."));
  } catch (err) {
    setStatus('Reader off', 'off');
    flash(`Card reader didn't start: ${err.message}`);
  }
  render();
}

function setStatus(text, kind) {
  const el = $('#nfc-status');
  el.className = `status-pill ${kind}`;
  el.textContent = text;
}

// ---------- Setup (⚙): what the phone sees, and pairing for ID-only phones ----------

function renderSetup() {
  const r = state.lastRead;
  const mode = state.cardInfo ? state.cardInfo.mode : null;
  $('#setup-body').innerHTML = `
    <p class="muted">Tap a tag on the phone to see what it reads.</p>
    <div class="setup-read">
      ${r ? `<b>Last read (${escapeHtml(r.at)})</b>
        <div class="mono small">ID ${escapeHtml(r.serialNumber || '—')}</div>
        <div class="mono small">${r.texts.length ? r.texts.map(escapeHtml).join('<br>') : 'No data records. This phone sees the ID only.'}</div>`
      : '<span class="muted">Nothing read yet.</span>'}
    </div>
    <p class="small muted">${mode === 'ndef' ? 'Mode: the phone reads the data on your tags (full QuackTag codes).' : mode === 'serial' ? 'Mode: ID-only. Cards are matched to keys by pairing below.' : 'Mode: decided by the first card you tap.'}</p>
    <h3 class="setup-h">Pair a card with its key</h3>
    <p class="small muted">Only needed when the phone sees IDs only.</p>
    ${state.pairing === 'card' ? '<p class="setup-prompt">Tap the CARD now…</p>' : state.pairing ? '<p class="setup-prompt">Now tap the KEY FOB…</p>' : '<button class="pill pill-soft" id="pair-btn" style="margin-top:10px">Pair card + key</button>'}`;
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
    else if (state.pin.length < 4) { state.pin += k; buzz(8); }
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
  try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* no sound */ }
  try { await document.documentElement.requestFullscreen(); } catch { /* not allowed */ }
  try { await screen.orientation.lock('portrait-primary'); } catch { /* Android may refuse */ }
  try { await navigator.wakeLock.request('screen'); } catch { /* not available */ }
  await nfc;
});
$('#setup-btn').addEventListener('click', () => { renderSetup(); $('#setup').classList.remove('hidden'); });
$('#setup-close').addEventListener('click', () => { state.pairing = null; $('#setup').classList.add('hidden'); });
$('#setup').addEventListener('click', (e) => { if (e.target.id === 'setup') { state.pairing = null; $('#setup').classList.add('hidden'); } });
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible') {
    try { await navigator.wakeLock.request('screen'); } catch { /* ignore */ }
  }
});

setStatus('Reader off', 'off');
render();
