// SwampTag dashboard: renders the account and runs the tap-to-approve flow.

const APPROVAL_SECONDS = 30;
const DEMO_GOOD_UID = 'D3E40A11';
const DEMO_BAD_UID = 'BADC0FFE';

const state = Store.load();
const link = new SerialLink();

let pending = null;      // { onTag(uid) } while a modal is waiting for a tap
let modalLocked = false; // true while a payment is mid-approval (Esc won't close it)
let lastTap = null;
let readerError = false;

const $ = (sel) => document.querySelector(sel);

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return 'Today, ' + time;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const TAP_ICON = `
  <div class="tap-ripple"><div class="core">
    <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round">
      <path d="M8.5 7.5a6 6 0 0 1 0 9"/><path d="M12 5a9.5 9.5 0 0 1 0 14"/><path d="M15.5 2.5a13 13 0 0 1 0 19"/>
      <circle cx="5" cy="12" r="1.5" fill="#fff" stroke="none"/>
    </svg>
  </div></div>`;

// ---------- Rendering ----------

function renderBalance() {
  $('#balance').textContent = money.format(state.balance);
}

function renderTransactions(highlightId) {
  $('#tx-list').innerHTML = state.transactions.map((tx) => {
    const amountClass = tx.status === 'blocked' ? 'blocked' : tx.amount > 0 ? 'in' : '';
    const sign = tx.amount > 0 ? '+' : '−';
    const chip = {
      approved: tx.verified ? '<span class="chip chip-green">✓ Verified with SwampTag</span>' : '<span class="chip chip-amber">No SwampTag check</span>',
      blocked: '<span class="chip chip-red">✕ Blocked</span>',
      received: '<span class="chip chip-blue">Received</span>',
      pending: '<span class="chip chip-amber">Requested</span>',
    }[tx.status] || '';
    return `
      <li class="tx${tx.id === highlightId ? ' new' : ''}">
        <div class="avatar">${escapeHtml(tx.initials)}</div>
        <div class="tx-main">
          <div class="tx-name">${escapeHtml(tx.name)}</div>
          <div class="tx-sub">${escapeHtml(tx.sub)} · ${formatDate(tx.date)}</div>
        </div>
        <div class="tx-right">
          <div class="tx-amount ${amountClass}">${sign}${money.format(Math.abs(tx.amount))}</div>
          ${chip}
        </div>
      </li>`;
  }).join('');
}

function renderAlerts() {
  const icons = { danger: '!', good: '✓', info: 'i' };
  $('#alert-list').innerHTML = state.alerts.slice(0, 6).map((a) => `
    <li class="alert ${a.level}">
      <div class="a-icon">${icons[a.level] || 'i'}</div>
      <div>
        <strong>${escapeHtml(a.title)}</strong>
        <span class="muted">${escapeHtml(a.detail)}</span>
        <div class="a-time">${formatDate(a.date)}</div>
      </div>
    </li>`).join('');
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

  $('#connect-btn').textContent = link.connected ? 'Disconnect' : 'Connect reader';
  $('#connect-btn').disabled = !SerialLink.supported();
  $('#serial-unsupported').classList.toggle('hidden', SerialLink.supported());

  const hasKey = Boolean(state.keyUid);
  $('#key-uid').textContent = hasKey ? state.keyUid : 'None';
  $('#register-btn').textContent = hasKey ? 'Replace key' : 'Link a key';
  $('#unlink-btn').classList.toggle('hidden', !hasKey);
  $('#last-tap').textContent = lastTap ? `${lastTap.uid} · ${formatDate(lastTap.date)}` : '—';

  const chip = $('#key-chip');
  chip.className = 'chip ' + (hasKey ? 'chip-green' : 'chip-red');
  chip.textContent = hasKey ? 'Protected' : 'Not protected';

  const badge = $('#protect-badge');
  badge.classList.toggle('on', hasKey);
  badge.textContent = hasKey ? '🔒 SwampTag on' : 'Unprotected';

  $('#demo-toggle').checked = state.demoMode;
}

function renderAll(highlightId) {
  renderBalance();
  renderTransactions(highlightId);
  renderAlerts();
  renderKeyPanel();
}

function toast(message) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 3500);
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

function showDemoButtons() {
  return state.demoMode || !link.connected;
}

function demoButtonsHtml({ wrong = true } = {}) {
  if (!showDemoButtons()) return '';
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

// ---------- Approval flow ----------

// Shows the "tap your key" screen and settles the payment.
// payment: { name, initials, place, amount, note, fraud }
function requestApproval(payment) {
  const modal = openModal(`
    <div class="approval">
      ${modalHead(payment.fraud ? 'Card payment at terminal' : 'Approve payment', false)}
      ${payment.fraud ? `<div class="fraud-banner">Simulation: a thief skimmed card ••4821, watched you type your PIN, and is now checking out. Tap the white card (the thief's tag).</div>` : ''}
      <div class="approval-merchant">${escapeHtml(payment.name)} · ${escapeHtml(payment.place)}</div>
      <div class="approval-amount">${money.format(payment.amount)}</div>
      ${TAP_ICON}
      <div class="approval-prompt">Tap your SwampTag key to approve</div>
      <div class="countdown"><div id="cd-bar"></div></div>
      <div class="muted" style="font-size:0.85rem" id="cd-text">Expires in ${APPROVAL_SECONDS}s</div>
      <button class="btn btn-ghost btn-sm" id="cancel-approval" style="margin-top:12px">Cancel</button>
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

  function finish(result, reason) {
    clearInterval(timer);
    pending = null;

    if (result === 'approved') {
      link.send('OK');
      const tx = Store.addTransaction({
        name: payment.name, initials: payment.initials,
        sub: payment.note || payment.place, amount: -payment.amount,
        status: 'approved', verified: true,
      });
      Store.addAlert('good', `Approved ${money.format(payment.amount)} with your key`, payment.name);
      renderAll(tx.id);
      showResult(true, 'Payment approved', `${money.format(payment.amount)} to ${payment.name}. Verified with your SwampTag key.`);
    } else if (result === 'blocked') {
      link.send('DENY');
      const tx = Store.addTransaction({
        name: payment.name, initials: payment.initials,
        sub: reason, amount: -payment.amount, status: 'blocked',
      });
      Store.addAlert('danger', `Blocked ${money.format(payment.amount)} at ${payment.name}`, `${reason}. Card ••4821 · ${payment.place}`);
      renderAll(tx.id);
      showResult(false, 'Payment blocked', `${reason}. Your ${money.format(payment.amount)} stayed in your account and we logged the attempt in your Security Center.`);
    } else {
      link.send('IDLE');
      closeModal();
      if (result === 'timeout') toast('Approval timed out. The payment was cancelled.');
    }
  }
}

function showResult(good, title, body, extraHtml = '') {
  const modal = openModal(`
    <div class="approval">
      <div class="result-icon ${good ? 'good' : 'bad'}">${good ? '✓' : '✕'}</div>
      <div class="result-title ${good ? 'good' : 'bad'}">${title}</div>
      <p class="muted" style="margin:10px 0 24px">${escapeHtml(body)}</p>
      ${extraHtml}
      <button class="btn btn-navy btn-block" data-close>Done</button>
    </div>`);
  return modal;
}

// Payments when no key is linked go straight through, like a normal debit card today.
function payWithoutKey(payment) {
  const tx = Store.addTransaction({
    name: payment.name, initials: payment.initials,
    sub: payment.fraud ? 'Card + PIN only' : (payment.note || payment.place),
    amount: -payment.amount, status: 'approved', verified: false,
  });
  if (payment.fraud) {
    Store.addAlert('danger', `Fraudulent charge: ${money.format(payment.amount)}`, `${payment.name} · ${payment.place}. Your card wasn't protected by SwampTag.`);
    renderAll(tx.id);
    const modal = showResult(false, 'The thief got through',
      `A skimmed card and a stolen PIN were enough to take ${money.format(payment.amount)}. Link a SwampTag key to stop this.`,
      '<button class="btn btn-primary btn-block" id="link-now" style="margin-bottom:10px">Link a key now</button>');
    modal.querySelector('#link-now').addEventListener('click', registerFlow);
  } else {
    renderAll(tx.id);
    toast(`Paid ${money.format(payment.amount)} to ${payment.name}. Not verified: link a key to protect payments.`);
    closeModal();
  }
}

function startPayment(payment) {
  if (payment.amount > state.balance && !payment.fraud) {
    toast('Insufficient funds for this payment.');
    return;
  }
  if (state.keyUid) requestApproval(payment);
  else payWithoutKey(payment);
}

// ---------- Flows ----------

function contactPicker() {
  return `<div class="contact-picker">${CONTACTS.map((c, i) => `
    <button type="button" class="contact-option${i === 0 ? ' selected' : ''}" data-i="${i}">
      <span class="avatar">${c.initials}</span>${c.name.split(' ')[0]}
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
  return () => CONTACTS[selected];
}

function sendFlow() {
  const modal = openModal(`
    ${modalHead('Send money')}
    ${contactPicker()}
    <form id="send-form">
      <input class="input amount-input" id="send-amount" inputmode="decimal" value="$25.00" aria-label="Amount">
      <div class="field" style="margin-top:12px">
        <input class="input" id="send-note" placeholder="What's it for? (optional)" maxlength="40">
      </div>
      <button class="btn btn-primary btn-block" type="submit">Continue</button>
    </form>`);
  const getContact = wireContactPicker(modal);
  modal.querySelector('#send-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = parseFloat(modal.querySelector('#send-amount').value.replace(/[^0-9.]/g, ''));
    if (!(amount > 0)) return toast('Enter an amount greater than $0.');
    const c = getContact();
    const note = modal.querySelector('#send-note').value.trim();
    startPayment({ name: c.name, initials: c.initials, place: 'Sent with SwampTag', note: note || 'Sent with SwampTag', amount });
  });
}

function requestFlow() {
  const modal = openModal(`
    ${modalHead('Request money')}
    ${contactPicker()}
    <form id="req-form">
      <input class="input amount-input" id="req-amount" inputmode="decimal" value="$15.00" aria-label="Amount">
      <button class="btn btn-primary btn-block" type="submit" style="margin-top:12px">Send request</button>
    </form>`);
  const getContact = wireContactPicker(modal);
  modal.querySelector('#req-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = parseFloat(modal.querySelector('#req-amount').value.replace(/[^0-9.]/g, ''));
    if (!(amount > 0)) return toast('Enter an amount greater than $0.');
    const c = getContact();
    const tx = Store.addTransaction({ name: c.name, initials: c.initials, sub: 'Request sent', amount, status: 'pending' });
    renderAll(tx.id);
    closeModal();
    toast(`Requested ${money.format(amount)} from ${c.name}.`);
  });
}

function payFlow() {
  const modal = openModal(`
    ${modalHead('Pay in store')}
    <p class="muted" style="margin-bottom:16px">Pick a checkout to simulate swiping card ••4821 and entering your PIN.</p>
    <div class="merchant-list">${MERCHANTS.map((m, i) => `
      <button class="merchant-option" data-i="${i}">
        <span class="avatar">${m.initials}</span>
        <span class="grow"><strong>${m.name}</strong><span class="muted" style="font-size:0.85rem">${m.place}</span></span>
        <strong>${money.format(m.amount)}</strong>
      </button>`).join('')}
    </div>`);
  modal.querySelectorAll('.merchant-option').forEach((b) => {
    b.addEventListener('click', () => startPayment({ ...MERCHANTS[Number(b.dataset.i)] }));
  });
}

let fraudIndex = 0;
function fraudFlow() {
  const attempt = FRAUD_ATTEMPTS[fraudIndex++ % FRAUD_ATTEMPTS.length];
  startPayment({ ...attempt, fraud: true });
}

function registerFlow() {
  const modal = openModal(`
    <div class="approval">
      ${modalHead('Link your SwampTag key')}
      ${TAP_ICON}
      <div class="approval-prompt">Tap the key fob you want to link</div>
      <p class="muted" style="margin-top:6px;font-size:0.9rem">From now on, payments from card ••4821 will need this key.</p>
      ${demoButtonsHtml({ wrong: false })}
    </div>`);
  wireDemoButtons(modal);
  link.send('WAIT');

  pending = {
    onTag(uid) {
      pending = null;
      link.send('OK');
      Store.setKey(uid);
      Store.addAlert('good', 'SwampTag key linked', `Key ${uid} now protects card ••4821.`);
      renderAll();
      showResult(true, 'Key linked', `Key ${uid} now protects every payment from card ••4821.`);
    },
  };
}

function unlinkKey() {
  if (!confirm('Unlink this key? Payments will no longer need a tap.')) return;
  Store.addAlert('info', 'SwampTag key unlinked', `Key ${state.keyUid} was removed.`);
  Store.setKey(null);
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
$('#request-btn').addEventListener('click', requestFlow);
$('#pay-btn').addEventListener('click', payFlow);
$('#fraud-btn').addEventListener('click', fraudFlow);
$('#register-btn').addEventListener('click', registerFlow);
$('#unlink-btn').addEventListener('click', unlinkKey);
$('#connect-btn').addEventListener('click', toggleConnection);
$('#demo-toggle').addEventListener('change', (e) => {
  Store.setDemoMode(e.target.checked);
  renderKeyPanel();
});
$('#reset-link').addEventListener('click', (e) => {
  e.preventDefault();
  if (!confirm('Reset the demo account? This clears the activity and the linked key.')) return;
  closeModal();
  Store.reset();
  lastTap = null;
  renderAll();
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

renderAll();
link.reconnect();
