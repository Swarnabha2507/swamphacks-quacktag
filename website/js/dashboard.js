// SwampTag dashboard: renders the account and runs the tap-to-approve flow.
// Money data comes from Bank (Nessie or offline). Key, settings, alerts and
// blocked attempts live in Store.

const APPROVAL_SECONDS = 30;
const DEMO_GOOD_UID = 'D3E40A11';
const DEMO_BAD_UID = 'BADC0FFE';

const state = Store.load();
const link = new SerialLink();

let snap = null;         // latest Bank snapshot
let pending = null;      // { onTag(uid) } while a modal is waiting for a tap
let modalLocked = false; // true while a payment is mid-approval (Esc won't close it)
let lastTap = null;
let readerError = false;

const $ = (sel) => document.querySelector(sel);

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatDate(iso, dateOnly = false) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return dateOnly ? 'Today' : 'Today, ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const TAP_ICON = `
  <div class="tap-ripple"><div class="core">
    <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round">
      <path d="M8.5 7.5a6 6 0 0 1 0 9"/><path d="M12 5a9.5 9.5 0 0 1 0 14"/><path d="M15.5 2.5a13 13 0 0 1 0 19"/>
      <circle cx="5" cy="12" r="1.5" fill="#fff" stroke="none"/>
    </svg>
  </div></div>`;

// ---------- Data ----------

async function refresh() {
  snap = await Bank.load();
  renderAll();
}

// Bank rows plus the rows only SwampTag knows about (blocked attempts, requests), newest first.
function allRows() {
  return [...snap.transactions, ...state.localRows].sort((a, b) =>
    new Date(b.date) - new Date(a.date) || (b.order ?? 0) - (a.order ?? 0));
}

function displayBalance() {
  // Payments saved locally while Nessie was down still count.
  const savedOffline = Bank.live ? state.localRows.filter((r) => r.status === 'approved').reduce((s, r) => s + r.amount, 0) : 0;
  return snap.balance + savedOffline;
}

// ---------- Rendering ----------

function renderBalance() {
  $('#balance').textContent = money.format(displayBalance());
}

function renderTransactions(highlightNewest) {
  const rows = allRows().slice(0, 10);
  $('#tx-list').innerHTML = rows.map((tx, i) => {
    const amountClass = tx.status === 'blocked' ? 'blocked' : tx.amount > 0 ? 'in' : '';
    const sign = tx.amount > 0 ? '+' : '−';
    let chip = '';
    if (tx.status === 'approved') {
      chip = tx.verified ? '<span class="chip chip-green">✓ Verified with SwampTag</span>'
        : tx.trusted ? '<span class="chip chip-blue">Trusted · no tap needed</span>'
        : '<span class="chip chip-amber">No SwampTag check</span>';
    } else if (tx.status === 'blocked') chip = '<span class="chip chip-red">✕ Blocked</span>';
    else if (tx.status === 'received') chip = '<span class="chip chip-blue">Received</span>';
    else if (tx.status === 'pending') chip = '<span class="chip chip-amber">Requested</span>';
    return `
      <li class="tx${highlightNewest && i === 0 ? ' new' : ''}">
        <div class="avatar">${escapeHtml(tx.initials)}</div>
        <div class="tx-main">
          <div class="tx-name">${escapeHtml(tx.name)}</div>
          <div class="tx-sub">${escapeHtml(tx.sub)} · ${formatDate(tx.date, tx.dateOnly)}</div>
        </div>
        <div class="tx-right">
          <div class="tx-amount ${amountClass}">${sign}${money.format(Math.abs(tx.amount))}</div>
          ${chip}
        </div>
      </li>`;
  }).join('') || '<li class="muted">No activity yet.</li>';
}

function renderBills() {
  $('#bill-list').innerHTML = snap.bills.map((b) => `
    <div class="bill">
      <div class="avatar">${escapeHtml(initialsOf(b.payee))}</div>
      <div class="grow">
        <strong>${escapeHtml(b.payee)}</strong>
        <span class="muted" style="font-size:0.84rem">${escapeHtml(b.nickname || 'Bill')} · due ${formatDate(b.due, true)}</span>
      </div>
      <span class="bill-amount">${money.format(b.amount)}</span>
      <button class="btn btn-outline btn-sm" data-bill="${escapeHtml(b.id)}">Pay</button>
    </div>`).join('') || '<p class="muted">You\'re all paid up.</p>';
  $('#bill-list').querySelectorAll('[data-bill]').forEach((btn) => {
    btn.addEventListener('click', () => payBillFlow(snap.bills.find((b) => b.id === btn.dataset.bill)));
  });
}

function renderShield() {
  const blocked = state.localRows.filter((r) => r.status === 'blocked');
  $('#blocked-total').textContent = money.format(blocked.reduce((s, r) => s + Math.abs(r.amount), 0));
  $('#score-number').textContent = blocked.length;

  const hasKey = Boolean(state.keyUid);
  $('#score-status').textContent = hasKey ? 'Protected' : 'At risk';
  $('#score-sub').textContent = hasKey ? `Key ${state.keyUid} · updated ${formatDate(new Date().toISOString())}` : 'Link a key to protect your card';
  $('#score-bar').classList.toggle('risk', !hasKey);
  $('#score-bar > div').style.width = hasKey ? '92%' : '25%';

  const icons = { danger: '!', good: '✓', info: 'i' };
  $('#alert-list').innerHTML = state.alerts.slice(0, 5).map((a) => `
    <li class="alert ${a.level}">
      <div class="a-icon">${icons[a.level] || 'i'}</div>
      <div>
        <strong>${escapeHtml(a.title)}</strong>
        <span class="muted">${escapeHtml(a.detail)}</span>
        <div class="a-time">${formatDate(a.date)}</div>
      </div>
    </li>`).join('');
}

function renderSource() {
  const pill = $('#source-pill');
  pill.classList.toggle('live', Bank.live);
  pill.textContent = Bank.live ? 'Live · Capital One Nessie' : 'Offline demo data';
  pill.title = Bank.live ? 'Balance, purchases, transfers and bills come from the Nessie API' : Bank.offlineReason;
  $('#source-text').textContent = Bank.live ? 'Nessie API (live)' : `Offline: ${Bank.offlineReason}`;
}

function renderKeyPanel() {
  const dot = $('#reader-dot');
  const text = $('#reader-text');
  dot.className = 'status-dot';
  if (link.connected && readerError) {
    dot.classList.add('warn');
    text.textContent = 'Reader not detected';
  } else if (link.connected) {
    dot.classList.add('on');
    text.textContent = 'Connected';
  } else {
    text.textContent = state.demoMode ? 'Demo mode' : 'Not connected';
  }

  $('#connect-btn').textContent = link.connected ? 'Disconnect reader' : 'Connect reader';
  $('#connect-btn').disabled = !SerialLink.supported();
  $('#serial-unsupported').classList.toggle('hidden', SerialLink.supported());

  const hasKey = Boolean(state.keyUid);
  $('#key-uid').textContent = hasKey ? state.keyUid : 'None';
  $('#key-tile-uid').textContent = hasKey ? '...' + state.keyUid.slice(-4) : '';
  $('#key-tile-status').textContent = hasKey ? 'Protected' : 'Not linked';
  $('#key-tile-caption').textContent = hasKey ? 'Card ...4821 needs your tap' : 'Card ...4821 is unprotected';
  $('#register-btn').textContent = hasKey ? 'Replace key' : 'Link a key';
  $('#unlink-btn').classList.toggle('hidden', !hasKey);
  $('#last-tap').textContent = lastTap ? `${lastTap.uid} · ${formatDate(lastTap.date)}` : '—';

  $('#demo-toggle').checked = state.demoMode;
  $('#smart-toggle').checked = !state.alwaysTap;
}

function renderAll(highlightNewest = false) {
  if (!snap) return;
  renderBalance();
  renderTransactions(highlightNewest);
  renderBills();
  renderShield();
  renderSource();
  renderKeyPanel();
}

function toast(message) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ---------- Modals ----------

function openModal(html, { locked = false } = {}) {
  modalLocked = locked;
  $('#modal-root').innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  const modal = $('#modal-root .modal');
  modal.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeModal));
  $('#modal-root .modal-backdrop').addEventListener('click', (e) => {
    if (e.target === e.currentTarget && !modalLocked) closeModal();
  });
  const focusable = modal.querySelector('input, button.btn');
  if (focusable) focusable.focus();
  return modal;
}

function closeModal() {
  $('#modal-root').innerHTML = '';
  modalLocked = false;
  // Closing a "tap your key" screen early cancels it.
  if (pending) {
    pending = null;
    link.send('IDLE');
  }
}

function modalHead(title, closable = true) {
  return `<div class="modal-head"><h2>${title}</h2>${closable ? '<button class="icon-btn" data-close aria-label="Close">×</button>' : ''}</div>`;
}

function demoButtonsHtml({ wrong = true } = {}) {
  if (!(state.demoMode || !link.connected)) return '';
  return `
    <div class="demo-buttons">
      <span class="demo-label">Demo mode</span>
      <button class="btn btn-outline btn-sm" data-sim="good">Simulate correct tap (T)</button>
      ${wrong ? '<button class="btn btn-outline btn-sm" data-sim="bad">Simulate wrong tap (X)</button>' : ''}
    </div>`;
}

function wireDemoButtons(modal) {
  modal.querySelectorAll('[data-sim]').forEach((b) => {
    b.addEventListener('click', () => simulateTap(b.dataset.sim === 'good'));
  });
}

function simulateTap(correct) {
  if (!pending) return;
  onTag(correct ? (state.keyUid || DEMO_GOOD_UID) : DEMO_BAD_UID);
}

function showResult(kind, title, body, extraHtml = '') {
  const icon = { good: '✓', bad: '✕', busy: '…' }[kind];
  return openModal(`
    <div class="approval">
      <div class="result-icon ${kind}">${icon}</div>
      <div class="result-title ${kind}">${title}</div>
      <p class="muted" style="margin:10px 0 22px">${escapeHtml(body)}</p>
      ${extraHtml}
      ${kind === 'busy' ? '' : '<button class="btn btn-navy btn-block" data-close>Done</button>'}
    </div>`, { locked: kind === 'busy' });
}

// ---------- Arduino messages ----------

function handleLine(line) {
  if (line === 'READY') {
    readerError = false;
    toast('SwampTag reader is ready');
  } else if (line === 'ERROR:READER') {
    readerError = true;
    toast('RFID reader not detected. Check the RC522 wiring.');
  } else if (line.startsWith('TAG:')) {
    const uid = line.slice(4).trim().toUpperCase();
    if (/^[0-9A-F]{4,20}$/.test(uid)) onTag(uid);
    return;
  }
  renderKeyPanel();
}

function onTag(uid) {
  lastTap = { uid, date: new Date().toISOString() };
  renderKeyPanel();
  if (pending) pending.onTag(uid);
  else toast(`Key ${uid} tapped. No payment is waiting for approval.`);
}

// ---------- Payments ----------
// payment: { kind: 'purchase' | 'transfer' | 'bill', name, initials, place, amount, note?,
//            merchant?, contact?, bill?, fraud? }

// Sends an authorized payment to the bank. mode: 'verified' | 'trusted' | 'unverified'
async function commit(payment, mode) {
  try {
    if (payment.kind === 'purchase') await Bank.pay(payment.merchant, payment.amount, mode);
    else if (payment.kind === 'transfer') await Bank.transfer(payment.contact, payment.amount, payment.note, mode);
    else await Bank.payBill(payment.bill, mode);
    await refresh();
  } catch (err) {
    console.warn(err);
    Store.addLocalRow({
      name: payment.name, initials: payment.initials, sub: 'Saved on this device · Nessie unavailable',
      amount: -payment.amount, status: 'approved', verified: mode === 'verified', trusted: mode === 'trusted',
    });
    toast("Nessie didn't respond, so this payment was saved on this device.");
  }
  renderAll(true);
}

function recordBlocked(payment, reason) {
  // Blocked money never moves, so nothing is sent to the bank.
  Store.addLocalRow({ name: payment.name, initials: payment.initials, sub: reason, amount: -payment.amount, status: 'blocked' });
  Store.addAlert('danger', `Blocked ${money.format(payment.amount)} at ${payment.name}`, `${reason}. Card ...4821 · ${payment.place}`);
  renderAll(true);
}

function startPayment(payment) {
  if (!snap) return;
  if (payment.amount > displayBalance() && !payment.fraud) {
    toast('Insufficient funds for this payment.');
    return;
  }
  if (!state.keyUid) {
    payWithoutKey(payment);
    return;
  }
  const risk = assessRisk(payment, snap.history, snap.home, { alwaysTap: state.alwaysTap });
  if (risk.tapRequired) requestApproval(payment, risk);
  else approveTrusted(payment);
}

async function approveTrusted(payment) {
  link.send('OK');
  showResult('busy', 'Approving…', `Checking ${payment.name} against your history.`);
  await commit(payment, 'trusted');
  showResult('good', 'Approved, no tap needed',
    `${payment.name} is a merchant you use near home, and ${money.format(payment.amount)} is under your $${RISK.TAP_FREE_LIMIT} tap-free limit.`);
}

// Shows the "tap your key" screen and settles the payment.
function requestApproval(payment, risk) {
  const reasons = risk.reasons.length ? risk.reasons : ['Smart taps are off'];
  const modal = openModal(`
    <div class="approval">
      ${modalHead(payment.fraud ? 'Card payment at terminal' : 'Approve payment', false)}
      ${payment.fraud ? `<div class="fraud-banner">Simulation: a thief copied card ...4821, watched you type your PIN, and is now checking out. Tap the white card (the thief's tag).</div>` : ''}
      <div class="approval-merchant">${escapeHtml(payment.name)} · ${escapeHtml(payment.place)}</div>
      <div class="approval-amount">${money.format(payment.amount)}</div>
      <div class="risk-box">
        <span class="risk-label">Why we're asking · ${risk.level} risk</span>
        ${reasons.map((r) => `<span class="chip ${risk.level === 'high' ? 'chip-red' : 'chip-amber'}">${escapeHtml(r)}</span>`).join('')}
      </div>
      ${TAP_ICON}
      <div class="approval-prompt">Tap your SwampTag key to approve</div>
      <div class="countdown"><div id="cd-bar"></div></div>
      <div class="muted" style="font-size:0.85rem" id="cd-text">Expires in ${APPROVAL_SECONDS}s</div>
      <button class="btn btn-ghost btn-sm" id="cancel-approval" style="margin-top:10px">Cancel</button>
      ${demoButtonsHtml()}
    </div>`, { locked: true });

  wireDemoButtons(modal);
  link.send('WAIT');

  let remaining = APPROVAL_SECONDS;
  const timer = setInterval(() => {
    remaining -= 1;
    $('#cd-bar').style.width = (remaining / APPROVAL_SECONDS) * 100 + '%';
    $('#cd-text').textContent = `Expires in ${remaining}s`;
    if (remaining <= 0) {
      if (payment.fraud) finish('blocked', 'No SwampTag key was tapped');
      else finish('timeout');
    }
  }, 1000);

  pending = {
    onTag(uid) {
      if (uid === state.keyUid) finish('approved');
      else finish('blocked', `Unrecognized key ${uid}`);
    },
  };

  $('#cancel-approval').addEventListener('click', () => finish('cancelled'));

  async function finish(result, reason) {
    clearInterval(timer);
    pending = null;

    if (result === 'approved') {
      link.send('OK');
      showResult('busy', 'Key verified', Bank.live ? 'Recording the payment with Nessie…' : 'Recording the payment…');
      await commit(payment, 'verified');
      Store.addAlert('good', `Approved ${money.format(payment.amount)} with your key`, payment.name);
      renderShield();
      showResult('good', 'Payment approved', `${money.format(payment.amount)} to ${payment.name}. Verified with your SwampTag key.`);
    } else if (result === 'blocked') {
      link.send('DENY');
      recordBlocked(payment, reason);
      showResult('bad', 'Payment blocked', `${reason}. Your ${money.format(payment.amount)} stayed in your account and the attempt is logged in SwampTag Shield.`);
    } else {
      link.send('IDLE');
      closeModal();
      if (result === 'timeout') toast('Approval timed out. The payment was cancelled.');
    }
  }
}

// With no key linked, payments go straight through, like a normal debit card today.
async function payWithoutKey(payment) {
  showResult('busy', 'Processing…', 'No SwampTag key is linked, so nothing stops this payment.');
  await commit(payment, 'unverified');
  if (payment.fraud) {
    Store.addAlert('danger', `Fraudulent charge: ${money.format(payment.amount)}`, `${payment.name} · ${payment.place}. Your card wasn't protected by SwampTag.`);
    renderShield();
    const modal = showResult('bad', 'The thief got through',
      `A copied card and a stolen PIN were enough to take ${money.format(payment.amount)}. Link a SwampTag key to stop this.`,
      '<button class="btn btn-primary btn-block" id="link-now" style="margin-bottom:10px">Link a key now</button>');
    modal.querySelector('#link-now').addEventListener('click', registerFlow);
  } else {
    closeModal();
    toast(`Paid ${money.format(payment.amount)} to ${payment.name}. Not verified: link a key to protect payments.`);
  }
}

// ---------- Flows ----------

function contactPicker() {
  return `<div class="contact-picker">${snap.contacts.map((c, i) => `
    <button type="button" class="contact-option${i === 0 ? ' selected' : ''}" data-i="${i}">
      <span class="avatar">${escapeHtml(c.initials)}</span>${escapeHtml(c.name.split(' ')[0])}
    </button>`).join('')}</div>`;
}

function wireContactPicker(modal) {
  let selected = 0;
  modal.querySelectorAll('.contact-option').forEach((b) => {
    b.addEventListener('click', () => {
      modal.querySelectorAll('.contact-option').forEach((x) => x.classList.remove('selected'));
      b.classList.add('selected');
      selected = Number(b.dataset.i);
    });
  });
  return () => snap.contacts[selected];
}

function readDollars(input) {
  return Math.round(parseFloat(input.value.replace(/[^0-9.]/g, '')));
}

function sendFlow() {
  if (!snap) return;
  const modal = openModal(`
    ${modalHead('Send money')}
    ${contactPicker()}
    <form id="send-form">
      <input class="input amount-input" id="send-amount" inputmode="numeric" value="$25" aria-label="Amount in whole dollars">
      <div class="field" style="margin-top:12px">
        <input class="input" id="send-note" placeholder="What's it for?" maxlength="40" value="Lunch">
      </div>
      <button class="btn btn-primary btn-block" type="submit">Continue</button>
    </form>`);
  const getContact = wireContactPicker(modal);
  modal.querySelector('#send-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = readDollars(modal.querySelector('#send-amount'));
    if (!(amount > 0)) return toast('Enter an amount of at least $1.');
    const c = getContact();
    const note = modal.querySelector('#send-note').value.trim() || 'Sent with SwampTag';
    startPayment({ kind: 'transfer', name: c.name, initials: c.initials, place: 'Peer-to-peer', note, contact: c, amount });
  });
}

function requestFlow() {
  if (!snap) return;
  const modal = openModal(`
    ${modalHead('Request money')}
    ${contactPicker()}
    <form id="req-form">
      <input class="input amount-input" id="req-amount" inputmode="numeric" value="$15" aria-label="Amount in whole dollars">
      <button class="btn btn-primary btn-block" type="submit" style="margin-top:12px">Send request</button>
    </form>`);
  const getContact = wireContactPicker(modal);
  modal.querySelector('#req-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = readDollars(modal.querySelector('#req-amount'));
    if (!(amount > 0)) return toast('Enter an amount of at least $1.');
    const c = getContact();
    Store.addLocalRow({ name: c.name, initials: c.initials, sub: 'Request sent', amount, status: 'pending' });
    renderAll(true);
    closeModal();
    toast(`Requested ${money.format(amount)} from ${c.name}.`);
  });
}

function payFlow() {
  if (!snap) return;
  const stores = snap.merchants.filter((m) => m.role === 'store');
  const modal = openModal(`
    ${modalHead('Pay in store')}
    <p class="muted" style="margin-bottom:16px">Pick a checkout to simulate swiping card ...4821 and entering your PIN.</p>
    <div class="merchant-list">${stores.map((m, i) => `
      <button class="merchant-option" data-i="${i}">
        <span class="avatar">${escapeHtml(m.initials)}</span>
        <span class="grow"><strong>${escapeHtml(m.name)}</strong><span class="muted" style="font-size:0.85rem">${escapeHtml(m.place)}</span></span>
        <strong>${money.format(m.amount)}</strong>
      </button>`).join('')}
    </div>`);
  modal.querySelectorAll('.merchant-option').forEach((b) => {
    b.addEventListener('click', () => {
      const m = stores[Number(b.dataset.i)];
      startPayment({ kind: 'purchase', name: m.name, initials: m.initials, place: m.place, merchant: m, amount: m.amount });
    });
  });
}

let fraudIndex = 0;
function fraudFlow() {
  if (!snap) return;
  const targets = snap.merchants.filter((m) => m.role === 'fraud');
  const m = targets[fraudIndex++ % targets.length];
  startPayment({ kind: 'purchase', name: m.name, initials: m.initials, place: m.place, merchant: m, amount: m.amount, fraud: true });
}

function payBillFlow(bill) {
  if (!bill) return;
  startPayment({ kind: 'bill', name: bill.payee, initials: initialsOf(bill.payee), place: bill.nickname || 'Bill', bill, amount: bill.amount });
}

function registerFlow() {
  const modal = openModal(`
    <div class="approval">
      ${modalHead('Link your SwampTag key')}
      ${TAP_ICON}
      <div class="approval-prompt">Tap the key fob you want to link</div>
      <p class="muted" style="margin-top:6px;font-size:0.9rem">From now on, payments from card ...4821 will need this key when something looks risky.</p>
      ${demoButtonsHtml({ wrong: false })}
    </div>`);
  wireDemoButtons(modal);
  link.send('WAIT');

  pending = {
    onTag(uid) {
      pending = null;
      link.send('OK');
      Store.set('keyUid', uid);
      Store.addAlert('good', 'SwampTag key linked', `Key ${uid} now protects card ...4821.`);
      renderAll();
      showResult('good', 'Key linked', `Key ${uid} now protects payments from card ...4821.`);
    },
  };
}

function unlinkKey() {
  if (!confirm('Unlink this key? Payments will no longer need a tap.')) return;
  Store.addAlert('info', 'SwampTag key unlinked', `Key ${state.keyUid} was removed.`);
  Store.set('keyUid', null);
  renderAll();
}

async function toggleConnection() {
  if (link.connected) {
    await link.disconnect();
    return;
  }
  try {
    await link.connect();
  } catch (err) {
    if (err.name !== 'NotFoundError') toast('Could not open the port. Is Serial Monitor still open?');
  }
}

// ---------- Wire up ----------

link.onLine = handleLine;
link.onStatus = (connected) => {
  if (!connected) readerError = false;
  toast(connected ? 'Reader connected' : 'Reader disconnected');
  renderKeyPanel();
};

$('#send-btn').addEventListener('click', sendFlow);
$('#shield-send').addEventListener('click', sendFlow);
$('#request-btn').addEventListener('click', requestFlow);
$('#pay-btn').addEventListener('click', payFlow);
$('#shield-pay').addEventListener('click', payFlow);
$('#shield-bills').addEventListener('click', () => $('#bills').scrollIntoView({ behavior: 'smooth' }));
$('#fraud-btn').addEventListener('click', fraudFlow);
$('#register-btn').addEventListener('click', registerFlow);
$('#unlink-btn').addEventListener('click', unlinkKey);
$('#connect-btn').addEventListener('click', toggleConnection);
$('#demo-toggle').addEventListener('change', (e) => {
  Store.set('demoMode', e.target.checked);
  renderKeyPanel();
});
$('#smart-toggle').addEventListener('change', (e) => {
  Store.set('alwaysTap', !e.target.checked);
  toast(e.target.checked ? 'Smart taps on: trusted small purchases skip the tap.' : 'Every payment now needs a tap.');
});
$('#reset-link').addEventListener('click', async (e) => {
  e.preventDefault();
  const note = Bank.live ? ' Nessie transactions stay; run "python tools/seed_nessie.py --fresh" for a clean bank account.' : '';
  if (!confirm('Reset the demo? This clears the linked key, alerts and blocked attempts.' + note)) return;
  closeModal();
  Store.reset();
  lastTap = null;
  await refresh();
});

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea')) return;
  if (e.key === 'Escape' && !modalLocked) closeModal();
  if (!pending) return;
  if (e.key === 't' || e.key === 'T') simulateTap(true);
  if (e.key === 'x' || e.key === 'X') simulateTap(false);
});

const hour = new Date().getHours();
$('#greeting').textContent = `${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}, Albert`;

(async () => {
  await Bank.init();
  await refresh();
  if (!Bank.live) toast(`Using offline demo data: ${Bank.offlineReason}`);
  link.reconnect();
})();
