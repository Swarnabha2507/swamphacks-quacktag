// SwampTag dashboard: renders the account and runs the tap-to-approve flow.
// Money data comes from Bank (Nessie or offline). Key, settings, alerts and
// blocked attempts live in Store.

const APPROVAL_SECONDS = 30;
const DEMO_GOOD_UID = 'D3E40A11';
const DEMO_BAD_UID = 'BADC0FFE';

const state = Store.load();
// The Pixel phone terminal reads the key (terminal-link.js). SerialLink (serial.js)
// still works for the old USB reader if you swap it back in here.
const link = new TerminalLink();

let snap = null;         // latest Bank snapshot
let pending = null;      // { onTag(uid, reason) } while a modal is waiting for a tap
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
  if (snap.account) {
    $('#acct-name').textContent = snap.account.nickname;
    if (snap.account.last4) $('#acct-last4').textContent = `...${snap.account.last4}`;
  }
  if (snap.customer && snap.customer.firstName && !Auth.profile) greet(snap.customer.firstName);
}

// ---------- Capital One Nessie: live API calls (server.py logs every call) ----------

let nessieSeen = 0;
let nessieFirstPoll = true;

function nessieAccountLine() {
  if (!Bank.live) return `Offline: ${Bank.offlineReason || 'Nessie unavailable'}. Showing demo data.`;
  const a = snap && snap.account;
  const c = snap && snap.customer;
  return `${c ? `${c.firstName} ${c.lastName}` : 'Account'} · ${a ? `${a.type || 'Checking'} ••${a.last4}` : ''} · balance and activity read from Nessie`;
}

async function pollNessieLog() {
  let calls;
  try {
    calls = (await (await fetch('/api/nessie-log', { cache: 'no-store' })).json()).calls;
  } catch {
    return;
  }
  const badge = $('#nessie-badge');
  badge.className = `badge badge-dot ${Bank.live ? 'badge-live' : 'badge-offline'}`;
  badge.textContent = Bank.live ? 'Live' : 'Offline';
  $('#nessie-account').textContent = nessieAccountLine();

  const fresh = calls.filter((c) => c.n > nessieSeen);
  if (calls.length) nessieSeen = calls[calls.length - 1].n;
  // A sale from the phone's gas pump was written to Nessie: show it in Recent activity.
  if (!nessieFirstPoll && fresh.some((c) => c.source === 'pump' && c.method === 'POST' && c.path.endsWith('/purchases') && c.status === 201)) {
    toast('A gas pump sale was just recorded in Nessie.');
    refresh().then(() => renderAll(true));
  }
  nessieFirstPoll = false;

  const shown = calls.filter((c) => c.source !== 'live check').slice(-8).reverse();
  $('#nessie-log').innerHTML = shown.map((c) => `
    <li>
      <span class="nl-method nl-${escapeHtml(c.method.toLowerCase())}">${escapeHtml(c.method)}</span>
      <span class="nl-main"><span class="mono">/${escapeHtml(c.path)}</span>${c.detail ? `<small>${escapeHtml(c.detail)}</small>` : ''}</span>
      <span class="nl-meta"><b class="${c.status === 'empty' || (c.status >= 200 && c.status < 300) ? 'ok' : 'bad'}">${escapeHtml(String(c.status))}</b><small>${escapeHtml(c.source)} · ${escapeHtml(c.at)}</small></span>
    </li>`).join('') || '<li class="empty">No calls yet.</li>';
}

function renderTransactions(highlightNewest) {
  const rows = allRows().slice(0, 10);
  $('#tx-list').innerHTML = rows.map((tx, i) => {
    const amountClass = tx.status === 'blocked' ? 'blocked' : tx.amount > 0 ? 'in' : '';
    const sign = tx.amount > 0 ? '+' : '−';
    // Only Verified and Blocked get color; everything else is a quiet gray line.
    let status = '';
    if (tx.status === 'approved') {
      status = tx.verified ? '<div class="tx-status verified">✓ Verified with SwampTag</div>'
        : tx.trusted ? '<div class="tx-status">Trusted · no tap needed</div>'
        : '<div class="tx-status">No SwampTag check</div>';
    } else if (tx.status === 'blocked') status = '<div class="tx-status blocked">✕ Blocked</div>';
    else if (tx.status === 'received') status = '<div class="tx-status">Received</div>';
    else if (tx.status === 'pending') status = '<div class="tx-status">Requested</div>';
    return `
      <li class="tx${highlightNewest && i === 0 ? ' new' : ''}">
        <div class="avatar">${escapeHtml(tx.initials)}</div>
        <div class="tx-main">
          <div class="tx-name">${escapeHtml(tx.name)}</div>
          <div class="tx-sub">${escapeHtml(tx.sub)} · ${formatDate(tx.date, tx.dateOnly)}</div>
        </div>
        <div class="tx-right">
          <div class="tx-amount ${amountClass}">${sign}${money.format(Math.abs(tx.amount))}</div>
          ${status}
        </div>
      </li>`;
  }).join('') || '<li class="empty">No activity yet. Pay in store or send money to get started.</li>';
}

function renderBills() {
  $('#bill-list').innerHTML = snap.bills.map((b) => `
    <div class="bill">
      <div class="avatar">${escapeHtml(initialsOf(b.payee))}</div>
      <div class="grow">
        <strong>${escapeHtml(b.payee)}</strong>
        <span class="muted small">${escapeHtml(b.nickname || 'Bill')} · due ${formatDate(b.due, true)}</span>
      </div>
      <span class="bill-amount">${money.format(b.amount)}</span>
      <button class="btn btn-outline btn-sm" data-bill="${escapeHtml(b.id)}">Pay</button>
    </div>`).join('') || '<p class="empty">You\'re all paid up.</p>';
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
  pill.className = `badge badge-dot ${Bank.live ? 'badge-live' : 'badge-offline'}`;
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
    text.textContent = 'Phone terminal connected';
  } else {
    text.textContent = state.demoMode ? 'Demo mode' : 'Phone terminal offline';
  }

  $('#connect-btn').textContent = link.connected ? 'Terminal connected' : 'Set up phone';
  $('#serial-unsupported').classList.add('hidden');

  const hasKey = Boolean(state.keyUid);
  $('#key-uid').textContent = hasKey ? state.keyUid : 'None';
  $('#key-strip-dot').className = `status-dot ${hasKey ? 'on' : 'off'}`;
  $('#key-tile-status').textContent = hasKey ? `SwampTag key ...${state.keyUid.slice(-4)} linked` : 'No key linked';
  $('#key-tile-caption').textContent = hasKey ? 'Risky payments from card ...4821 need your tap' : 'Card ...4821 is unprotected';
  $('#register-btn').textContent = hasKey ? 'Replace key' : 'Link a key';
  $('#unlink-btn').classList.toggle('hidden', !hasKey);
  $('#last-tap').textContent = lastTap ? `${lastTap.uid} · ${formatDate(lastTap.date)}` : '—';

  $('#demo-toggle').checked = state.demoMode;
  $('#scam-toggle').checked = state.scamCheck;
  $('#smart-toggle').checked = !state.alwaysTap;
  $('#tap-limit-text').textContent = `$${state.tapLimit}`;
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
  stopSpeaking();
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

// In-page replacement for window.confirm(). Resolves true when the user confirms.
function confirmModal(title, text, confirmLabel, { danger = false } = {}) {
  return new Promise((resolve) => {
    const modal = openModal(`
      ${modalHead(escapeHtml(title))}
      <p class="modal-text">${escapeHtml(text)}</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" data-answer="no">Keep it</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-navy'}" data-answer="yes">${escapeHtml(confirmLabel)}</button>
      </div>`);
    let answered = false;
    const answer = (value) => {
      if (answered) return;
      answered = true;
      closeModal();
      resolve(value);
    };
    modal.querySelectorAll('[data-answer]').forEach((b) => b.addEventListener('click', () => answer(b.dataset.answer === 'yes')));
    modal.querySelector('[data-close]').addEventListener('click', () => answer(false));
  });
}

function showResult(kind, title, body, extraHtml = '') {
  const icon = { good: '✓', bad: '✕', busy: '…' }[kind];
  return openModal(`
    <div class="approval">
      <div class="result-icon ${kind}">${icon}</div>
      <div class="result-title ${kind}">${title}</div>
      <p class="result-body">${escapeHtml(body)}</p>
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
    if (/^[0-9A-Z-]{3,40}$/.test(uid)) onTag(uid);
    return;
  } else if (line.startsWith('BADTAG:')) {
    // The phone read a key, but its code was wrong or old (possibly a copy).
    onTag('INVALID', line.slice(7).trim() || 'Unreadable key');
    return;
  } else if (line === 'SIM:GOOD' || line === 'SIM:BAD') {
    simulateTap(line === 'SIM:GOOD'); // demo buttons on the phone
    return;
  }
  renderKeyPanel();
}

function onTag(uid, reason) {
  lastTap = { uid, date: new Date().toISOString() };
  renderKeyPanel();
  if (pending) pending.onTag(uid, reason);
  else toast(reason ? `Key rejected: ${reason}.` : `Key ${uid} tapped. No payment is waiting for approval.`);
}

// What the phone terminal shows while it waits for the key.
function terminalDetails(payment, extra = {}) {
  return { amount: payment.amount, name: payment.name, place: payment.place, ...extra };
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
  const risk = assessRisk(payment, snap.history, snap.home, { alwaysTap: state.alwaysTap, tapLimit: state.tapLimit });
  if (risk.tapRequired) requestApproval(payment, risk);
  else approveTrusted(payment);
}

async function approveTrusted(payment) {
  link.send('OK', terminalDetails(payment, { trusted: true }));
  showResult('busy', 'Approving…', `Checking ${payment.name} against your tap limit.`);
  await commit(payment, 'trusted');
  showResult('good', 'Approved, no tap needed',
    `${money.format(payment.amount)} is within your $${state.tapLimit} tap limit, so no tap was needed.`);
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
        ${reasons.map((r) => `<span class="badge ${risk.level === 'high' ? 'badge-red' : 'badge-amber'}">${escapeHtml(r)}</span>`).join('')}
      </div>
      ${TAP_ICON}
      <div class="approval-prompt">Tap your SwampTag key to approve</div>
      <div class="countdown"><div id="cd-bar"></div></div>
      <div class="countdown-text" id="cd-text">Expires in ${APPROVAL_SECONDS}s</div>
      <div class="cancel-row"><button class="btn btn-ghost btn-sm" id="cancel-approval">Cancel</button></div>
      ${demoButtonsHtml()}
    </div>`, { locked: true });

  wireDemoButtons(modal);
  link.send('WAIT', terminalDetails(payment, { reasons }));

  let remaining = APPROVAL_SECONDS;
  const timer = setInterval(() => {
    remaining -= 1;
    $('#cd-bar').style.transform = `scaleX(${remaining / APPROVAL_SECONDS})`;
    $('#cd-text').textContent = `Expires in ${remaining}s`;
    if (remaining <= 0) {
      if (payment.fraud) finish('blocked', 'No SwampTag key was tapped');
      else finish('timeout');
    }
  }, 1000);

  pending = {
    onTag(uid, reason) {
      if (reason) finish('blocked', reason);
      else if (uid === state.keyUid) finish('approved');
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
      link.send('DENY', { reason });
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
      '<button class="btn btn-primary btn-block stack-gap" id="link-now">Link a key now</button>');
    modal.querySelector('#link-now').addEventListener('click', registerFlow);
  } else {
    closeModal();
    toast(`Paid ${money.format(payment.amount)} to ${payment.name}. Not verified: link a key to protect payments.`);
  }
}

// ---------- Flows ----------

function contactPicker() {
  return `<div class="contact-picker">${snap.contacts.map((c, i) => `
    <button type="button" class="contact-option" aria-pressed="${i === 0}" data-i="${i}">
      <span class="avatar">${escapeHtml(c.initials)}</span>${escapeHtml(c.name.split(' ')[0])}
    </button>`).join('')}</div>`;
}

function wireContactPicker(modal) {
  let selected = 0;
  modal.querySelectorAll('.contact-option').forEach((b) => {
    b.addEventListener('click', () => {
      modal.querySelectorAll('.contact-option').forEach((x) => x.setAttribute('aria-pressed', 'false'));
      b.setAttribute('aria-pressed', 'true');
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
      <div class="field field-gap">
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
    const payment = { kind: 'transfer', name: c.name, initials: c.initials, place: 'Peer-to-peer', note, contact: c, amount };
    if (state.scamCheck && needsScamCheck(amount)) scamCheckFlow(payment);
    else startPayment(payment);
  });
}

// Large transfers: ask why first. Red-flag answers get a warning and alert the trusted contact.
function scamCheckFlow(payment) {
  const modal = openModal(`
    ${modalHead(`Before you send ${money.format(payment.amount)}`)}
    <p class="modal-text">For larger transfers, SwampTag asks why. Scammers often rush people, especially older adults, into sending money.</p>
    <form id="why-form" novalidate>
      <fieldset class="reason-list">
        <legend>Why are you sending this money to ${escapeHtml(payment.name)}?</legend>
        ${TRANSFER_REASONS.map((r) => `
          <label class="reason"><input type="radio" name="why" value="${r.id}"><span>${escapeHtml(r.label)}</span></label>`).join('')}
      </fieldset>
      <div class="field">
        <label for="why-text">Tell us a little more (optional)</label>
        <textarea class="input" id="why-text" maxlength="200" placeholder="e.g. My grandson called and needs bail money"></textarea>
      </div>
      <p class="form-error hidden" id="why-error" role="alert">Choose the reason that fits best.</p>
      <button class="btn btn-primary btn-block" type="submit">Continue</button>
    </form>`);

  modal.querySelector('#why-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const choice = modal.querySelector('input[name="why"]:checked');
    if (!choice) {
      modal.querySelector('#why-error').classList.remove('hidden');
      return;
    }
    const explanation = modal.querySelector('#why-text').value;
    showResult('busy', 'Reviewing your answer…', 'Checking it against common scams that target older adults.');
    const review = await reviewTransfer(choice.value, explanation, payment.amount);
    if (!review.flag) {
      closeModal();
      toast('Scam review: no red flags found.');
      startPayment(payment);
      return;
    }
    scamWarning(payment, review);
  });
}

// Reads text aloud with the browser's built-in voice (Web Speech API). Silent if unsupported.
function speak(text) {
  try {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    speechSynthesis.speak(utterance);
  } catch { /* no voice available */ }
}

function stopSpeaking() {
  try { if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch { /* ignore */ }
}

function scamWarning(payment, review) {
  Store.addAlert('danger', `Scam check flagged ${money.format(payment.amount)} to ${payment.name}`,
    `${review.flag}. We let ${TRUSTED_CONTACT.name}, your ${TRUSTED_CONTACT.relation}, know.`);
  renderShield();

  const spoken = `Stop. This looks like a scam. ${review.warning} If you still want to send this money, please call SwampTag fraud support first, at ${FRAUD_LINE.spoken}.`;
  const modal = openModal(`
    <div class="scam-warning">
      <div class="result-icon bad">!</div>
      <h2>Stop. This looks like a scam.</h2>
      <div class="review-box">
        <span class="risk-label">Scam review · ${review.confidence}% match</span>
        <ul>${review.findings.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
      </div>
      <p class="modal-text">${escapeHtml(review.warning)}</p>
      <div class="call-box">
        <strong>Still want to send ${money.format(payment.amount)}?</strong>
        <span>Call SwampTag fraud support first. We'll talk it through with you and give you a code.</span>
        <a class="call-number" href="tel:${FRAUD_LINE.tel}">${FRAUD_LINE.label}</a>
      </div>
      <p class="notice">We let <strong>${escapeHtml(TRUSTED_CONTACT.name)}</strong>, your ${escapeHtml(TRUSTED_CONTACT.relation)}, know about this transfer.</p>
      <button class="btn btn-navy btn-block stack-gap" id="scam-cancel">Cancel this transfer</button>
      <button class="btn btn-ghost btn-block stack-gap" id="scam-speak">🔊 Read this to me again</button>
      <form class="verify-form" id="verify-form" novalidate>
        <label for="verify-code">Code from your call</label>
        <div class="verify-row">
          <input class="input" id="verify-code" inputmode="numeric" maxlength="6" autocomplete="one-time-code">
          <button class="btn btn-outline" type="submit">Verify</button>
        </div>
        <p class="form-error hidden" id="verify-error" role="alert">That code doesn't match. Call ${FRAUD_LINE.label} to get one.</p>
        ${state.demoMode ? `<p class="panel-note">Demo code: ${DEMO_VERIFY_CODE}</p>` : ''}
      </form>
      <p class="fine-print">Simulated scam review for the demo.</p>
    </div>`, { locked: true });

  speak(spoken);
  modal.querySelector('#scam-speak').addEventListener('click', () => speak(spoken));

  modal.querySelector('#scam-cancel').addEventListener('click', () => {
    stopSpeaking();
    Store.addLocalRow({ name: payment.name, initials: payment.initials, sub: `Stopped by Scam check · ${review.flag}`, amount: -payment.amount, status: 'blocked' });
    Store.addAlert('good', `You stopped ${money.format(payment.amount)} from leaving`, 'Good call. When in doubt, talk to someone you trust first.');
    renderAll(true);
    showResult('good', 'Transfer cancelled', `Your ${money.format(payment.amount)} stayed in your account.`);
  });

  modal.querySelector('#verify-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = modal.querySelector('#verify-code');
    if (input.value.trim() !== DEMO_VERIFY_CODE) {
      input.setAttribute('aria-invalid', 'true');
      modal.querySelector('#verify-error').classList.remove('hidden');
      return;
    }
    closeModal();
    Store.addAlert('info', 'Fraud support verified a flagged transfer', `${money.format(payment.amount)} to ${payment.name}. Your key is still required.`);
    startPayment({ ...payment, scamFlag: review.flag });
  });
}

function requestFlow() {
  if (!snap) return;
  const modal = openModal(`
    ${modalHead('Request money')}
    ${contactPicker()}
    <form id="req-form">
      <input class="input amount-input" id="req-amount" inputmode="numeric" value="$15" aria-label="Amount in whole dollars">
      <button class="btn btn-primary btn-block field-gap" type="submit">Send request</button>
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
    <p class="modal-text">Pick a checkout to simulate swiping card ...4821 and entering your PIN.</p>
    <div class="merchant-list">${stores.map((m, i) => `
      <button class="merchant-option" data-i="${i}">
        <span class="avatar">${escapeHtml(m.initials)}</span>
        <span class="grow"><strong>${escapeHtml(m.name)}</strong><span class="muted small">${escapeHtml(m.place)}</span></span>
        <span class="price">${money.format(m.amount)}</span>
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
      <p class="approval-note">From now on, payments from card ...4821 will need this key when something looks risky.</p>
      ${demoButtonsHtml({ wrong: false })}
    </div>`);
  wireDemoButtons(modal);
  link.send('WAIT', { linking: true });

  pending = {
    onTag(uid, reason) {
      if (reason) {
        toast(`That key can't be linked: ${reason}. Try again.`);
        return; // keep waiting for a good read
      }
      pending = null;
      link.send('OK');
      Store.set('keyUid', uid);
      Store.addAlert('good', 'SwampTag key linked', `Key ${uid} now protects card ...4821.`);
      renderAll();
      tapLimitFlow({ afterLink: true });
      syncKeyToProfile(uid);
    },
  };
}

// Asks how much can be spent before a tap is needed. Closing without saving keeps the current limit.
function tapLimitFlow({ afterLink = false } = {}) {
  const modal = openModal(`
    ${afterLink ? '<div class="approval"><div class="result-icon good">✓</div><div class="result-title good">Key linked</div></div>' : ''}
    ${modalHead('How much can you spend before a tap is needed?')}
    <form id="limit-form">
      <input class="input amount-input" id="limit-amount" inputmode="numeric" value="$${state.tapLimit}" aria-label="Tap limit in whole dollars">
      <p class="modal-text">Payments of this amount or less go through without your key. Anything more needs a tap. Enter $0 to tap for every payment.</p>
      <button class="btn btn-primary btn-block" type="submit">Save limit</button>
    </form>`);
  const input = modal.querySelector('#limit-amount');
  input.select();
  modal.querySelector('#limit-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = readDollars(input);
    if (!(amount >= 0)) return toast('Enter a whole-dollar amount, like $200.');
    Store.set('tapLimit', amount);
    closeModal();
    renderKeyPanel();
    toast(amount === 0 ? 'Every payment now needs a tap.' : `Payments of $${amount} or less skip the tap.`);
  });
}

async function unlinkKey() {
  const ok = await confirmModal('Unlink this key?', 'Payments from card ...4821 will no longer need a tap until you link a key again.', 'Unlink key', { danger: true });
  if (!ok) return;
  Store.addAlert('info', 'SwampTag key unlinked', `Key ${state.keyUid} was removed.`);
  Store.set('keyUid', null);
  renderAll();
  syncKeyToProfile(null);
}

// Saves the linked key to the signed-in user's Auth0 profile (user_metadata.swamptag_key).
async function syncKeyToProfile(uid) {
  if (!Auth.enabled || Auth.usingDemo()) return;
  try {
    await Auth.saveKey(uid);
    Store.addAlert('good', uid ? 'Key saved to your Auth0 profile' : 'Key removed from your Auth0 profile', 'It follows you to any browser you sign in on.');
    renderShield();
  } catch (err) {
    console.warn(err);
    toast("Couldn't reach your Auth0 profile, so the key is saved on this device only.");
  }
}

// How to connect the Pixel phone terminal to this laptop.
function phoneSetupFlow() {
  const port = location.port || '80';
  openModal(`
    ${modalHead('Connect the phone terminal')}
    <p class="modal-text">${link.connected ? 'The phone terminal is connected.' : 'The phone terminal is not connected yet.'}</p>
    <ol class="setup-steps">
      <li>On the Pixel: <strong>Settings → About phone</strong>, tap <strong>Build number</strong> 7 times, then turn on <strong>USB debugging</strong> in Developer options.</li>
      <li>Plug the phone into this laptop with a USB-C data cable, and allow USB debugging on the phone (tick Always allow).</li>
      <li>On this laptop, open <strong>edge://inspect/#devices</strong> (or chrome://inspect). Click <strong>Port forwarding</strong> and add <strong>${port} → localhost:${port}</strong>. Keep that tab open.</li>
      <li>On the phone, open <strong>localhost:${port}/terminal.html</strong> in Chrome and tap <strong>Start terminal</strong>.</li>
    </ol>
    <button class="btn btn-navy btn-block" data-close>Done</button>`);
}

// ---------- Wire up ----------

link.onLine = handleLine;
link.onStatus = (connected) => {
  if (!connected) readerError = false;
  toast(connected ? 'Phone terminal connected' : 'Phone terminal disconnected');
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
$('#connect-btn').addEventListener('click', phoneSetupFlow);
$('#demo-toggle').addEventListener('change', (e) => {
  Store.set('demoMode', e.target.checked);
  renderKeyPanel();
});
$('#scam-toggle').addEventListener('change', (e) => {
  Store.set('scamCheck', e.target.checked);
  toast(e.target.checked ? `Scam check on: transfers of $${SCAM_CHECK_FROM} or more ask why first.` : 'Scam check off.');
});
$('#smart-toggle').addEventListener('change', (e) => {
  Store.set('alwaysTap', !e.target.checked);
  toast(e.target.checked ? `Smart taps on: payments of $${state.tapLimit} or less skip the tap.` : 'Every payment now needs a tap.');
});
$('#tap-limit-btn').addEventListener('click', (e) => {
  e.preventDefault(); // the button sits inside the Smart taps <label>; don't flip the toggle
  tapLimitFlow();
});
$('#reset-link').addEventListener('click', async () => {
  const note = Bank.live ? ' Nessie transactions stay. Run "python tools/seed_nessie.py --fresh" for a clean bank account.' : '';
  const ok = await confirmModal('Reset the demo?', 'This clears the linked key, alerts and blocked attempts on this device.' + note, 'Reset demo', { danger: true });
  if (!ok) return;
  Store.reset();
  lastTap = null;
  await refresh();
});
$('#signout-btn').addEventListener('click', () => Auth.logout());

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea')) return;
  if (e.key === 'Escape' && !modalLocked) closeModal();
  if (!pending) return;
  if (e.key === 't' || e.key === 'T') simulateTap(true);
  if (e.key === 'x' || e.key === 'X') simulateTap(false);
});

function greet(firstName) {
  const hour = new Date().getHours();
  $('#greeting').textContent = `${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}, ${firstName}`;
}

// Shows the Auth0 user in the header and loads their linked key from the profile.
async function signInWithAuth0() {
  const user = await Auth.user();
  const name = user.given_name || user.name || user.nickname || user.email || 'there';
  greet(name.split(/[\s@]/)[0]);
  $('#user-name').textContent = user.name || user.email || 'Signed in';
  $('#auth-badge').classList.remove('hidden');
  const avatar = $('#user-avatar');
  if (user.picture) {
    const img = document.createElement('img');
    img.src = user.picture;
    img.alt = '';
    avatar.replaceChildren(img);
  } else {
    avatar.textContent = initialsOf(user.name || user.email || '?');
  }

  try {
    const key = await Auth.getKey();
    if (key && key !== state.keyUid) {
      Store.set('keyUid', key);
      toast(`Loaded key ${key} from your Auth0 profile.`);
    }
  } catch (err) {
    console.warn(err);
  }
}

greet('Albert');

(async () => {
  // With Auth0 set up, the dashboard needs a signed-in user (or the demo account).
  if (await Auth.init()) {
    if (await Auth.isAuthenticated()) await signInWithAuth0();
    else if (!Auth.usingDemo()) {
      location.replace('login.html');
      return;
    }
  }
  await Bank.init();
  await refresh();
  pollNessieLog();
  setInterval(pollNessieLog, 3000);
  if (!Bank.live) toast(`Using offline demo data: ${Bank.offlineReason}`);
  link.reconnect();
})();
