// Where the money data comes from: Capital One's Nessie API (through server.py),
// or the offline demo data in Store when Nessie isn't available.
//
// Both backends return the same snapshot:
//   { balance, transactions, bills, merchants, contacts, home, history }
// and support pay(), transfer() and payBill(). `mode` is how the payment was
// authorized: 'verified' (key tapped), 'trusted' (smart tap skipped) or 'unverified' (no key linked).
//
// Nessie notes (checked against the live API, Oct 2026):
//   - amounts are whole dollars
//   - list endpoints answer 404 when the list is empty
//   - transfers have no payee, so P2P = transfer out of sender + deposit into receiver
//   - purchases don't change the account balance, so we add it up from the transactions

const AUTH_TAGS = { verified: 'SwampTag verified', trusted: 'SwampTag trusted', unverified: 'No SwampTag check' };

function describe(mode, ...parts) {
  return [AUTH_TAGS[mode], ...parts].filter(Boolean).join(' · ');
}

function parseDescription(desc = '') {
  const parts = desc.split(' · ');
  const mode = Object.keys(AUTH_TAGS).find((k) => AUTH_TAGS[k] === parts[0]) || null;
  return { mode, parts: mode ? parts.slice(1) : parts };
}

function initialsOf(name) {
  return name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 'YYYY-MM-DD' at local noon, so it doesn't slip to the previous day in Florida.
function fromDateOnly(s) {
  const [y, m, d] = (s || todayIso()).split('-').map(Number);
  return new Date(y, m - 1, d, 12).toISOString();
}

const roundDollars = (amount) => Math.max(1, Math.round(amount));

// ---------- Nessie ----------

const NessieBank = {
  source: 'nessie',
  cfg: null,

  async api(path, { method = 'GET', body, list = false } = {}) {
    const res = await fetch('/api/nessie/' + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    if (list && res.status === 404) return [];
    if (!res.ok) throw new Error(`Nessie HTTP ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
    return data;
  },

  // Nessie only stores dates, so remember the exact time of payments made here for nicer ordering.
  remember(created) {
    const id = created && (created.objectCreated || created)._id;
    if (!id) return;
    Store.state.liveTimes = { ...(Store.state.liveTimes || {}), [id]: new Date().toISOString() };
    Store.save();
  },

  async load() {
    const { accountId, merchants, contacts, openingBalance, home } = this.cfg;
    const [purchases, deposits, transfers, bills] = await Promise.all([
      this.api(`accounts/${accountId}/purchases`, { list: true }),
      this.api(`accounts/${accountId}/deposits`, { list: true }),
      this.api(`accounts/${accountId}/transfers`, { list: true }),
      this.api(`accounts/${accountId}/bills`, { list: true }),
    ]);

    const times = Store.state.liveTimes || {};
    const merchantById = Object.fromEntries(merchants.map((m) => [m.id, m]));
    const contactByName = Object.fromEntries(contacts.map((c) => [c.name, c]));
    const rows = [];
    let order = 0;
    const when = (item, dateField) => {
      const id = item._id || item.id;
      return { id, date: times[id] || fromDateOnly(item[dateField] || item.transaction_date), dateOnly: !times[id], order: order++ };
    };

    for (const p of purchases) {
      const m = merchantById[p.merchant_id];
      const { mode } = parseDescription(p.description);
      rows.push({
        ...when(p, 'purchase_date'),
        name: m ? m.name : 'Card purchase', initials: m ? m.initials : '$', sub: m ? m.place : (p.description || ''),
        merchantId: p.merchant_id, amount: -p.amount,
        status: p.status === 'cancelled' ? 'blocked' : 'approved',
        verified: mode === 'verified', trusted: mode === 'trusted',
      });
    }

    for (const d of deposits) {
      const [from = 'Deposit', note = ''] = (d.description || '').split(' · ');
      const name = from.replace(/^From /, '');
      rows.push({ ...when(d, 'transaction_date'), name, initials: contactByName[name]?.initials || initialsOf(name), sub: note || 'Deposit', amount: d.amount, status: 'received' });
    }

    for (const t of transfers) {
      const { mode, parts } = parseDescription(t.description);
      const isBill = parts[0] === 'Bill';
      const name = isBill ? parts[1] || 'Bill' : (parts[0] || 'Transfer').replace(/^To /, '');
      rows.push({
        ...when(t, 'transaction_date'),
        name, initials: contactByName[name]?.initials || initialsOf(name),
        sub: isBill ? 'Bill payment' : parts[1] || 'Sent', amount: -t.amount,
        status: 'approved', verified: mode === 'verified', trusted: mode === 'trusted',
      });
    }

    const spent = purchases.filter((p) => p.status !== 'cancelled').reduce((s, p) => s + p.amount, 0);
    const received = deposits.reduce((s, d) => s + d.amount, 0);
    const sent = transfers.reduce((s, t) => s + t.amount, 0);

    return {
      balance: openingBalance + received - spent - sent,
      transactions: rows,
      bills: bills
        .filter((b) => b.status !== 'completed' && b.status !== 'cancelled')
        .map((b) => ({ id: b._id, payee: b.payee, nickname: b.nickname, amount: b.payment_amount, due: fromDateOnly(b.upcoming_payment_date || b.payment_date), status: b.status })),
      merchants,
      contacts,
      home,
      history: purchases.filter((p) => p.status !== 'cancelled').map((p) => ({ merchantId: p.merchant_id, amount: p.amount })),
    };
  },

  async pay(merchant, amount, mode) {
    const created = await this.api(`accounts/${this.cfg.accountId}/purchases`, {
      method: 'POST',
      body: { merchant_id: merchant.id, medium: 'balance', purchase_date: todayIso(), status: 'completed', amount: roundDollars(amount), description: describe(mode) },
    });
    this.remember(created);
  },

  async transfer(contact, amount, note, mode) {
    const date = todayIso();
    const created = await this.api(`accounts/${this.cfg.accountId}/transfers`, {
      method: 'POST',
      body: { transaction_date: date, status: 'completed', amount: roundDollars(amount), description: describe(mode, `To ${contact.name}`, note) },
    });
    this.remember(created);
    // Credit the friend's Nessie account too. If this half fails, the payment above still stands.
    await this.api(`accounts/${contact.accountId}/deposits`, {
      method: 'POST',
      body: { medium: 'balance', transaction_date: date, status: 'completed', amount: roundDollars(amount), description: `From Albert Gator · ${note}` },
    }).catch((err) => console.warn('Deposit to contact failed', err));
  },

  async payBill(bill, mode) {
    await this.api(`bills/${bill.id}`, { method: 'PUT', body: { status: 'completed' } });
    const created = await this.api(`accounts/${this.cfg.accountId}/transfers`, {
      method: 'POST',
      body: { transaction_date: todayIso(), status: 'completed', amount: roundDollars(bill.amount), description: describe(mode, 'Bill', bill.payee) },
    });
    this.remember(created);
  },
};

// ---------- Offline ----------

const LocalBank = {
  source: 'offline',

  async load() {
    const s = Store.state;
    return {
      balance: s.balance,
      transactions: s.transactions,
      bills: s.bills.filter((b) => b.status !== 'completed'),
      merchants: MERCHANTS,
      contacts: CONTACTS,
      home: HOME,
      history: s.transactions.filter((t) => t.merchantId && t.status === 'approved').map((t) => ({ merchantId: t.merchantId, amount: -t.amount })),
    };
  },

  async pay(merchant, amount, mode) {
    Store.addTransaction({
      name: merchant.name, initials: merchant.initials, sub: merchant.place, merchantId: merchant.id,
      amount: -roundDollars(amount), status: 'approved', verified: mode === 'verified', trusted: mode === 'trusted',
    });
  },

  async transfer(contact, amount, note, mode) {
    Store.addTransaction({
      name: contact.name, initials: contact.initials, sub: note,
      amount: -roundDollars(amount), status: 'approved', verified: mode === 'verified', trusted: mode === 'trusted',
    });
  },

  async payBill(bill, mode) {
    const stored = Store.state.bills.find((b) => b.id === bill.id);
    if (stored) stored.status = 'completed';
    Store.addTransaction({
      name: bill.payee, initials: initialsOf(bill.payee), sub: 'Bill payment',
      amount: -roundDollars(bill.amount), status: 'approved', verified: mode === 'verified', trusted: mode === 'trusted',
    });
  },
};

// ---------- Picker ----------

const Bank = {
  backend: LocalBank,
  offlineReason: '',

  get live() {
    return this.backend === NessieBank;
  },

  async init() {
    let cfg;
    try {
      const res = await fetch('/api/config', { cache: 'no-store' });
      cfg = await res.json();
    } catch {
      cfg = { live: false, reason: 'Start the site with "python server.py" to use Nessie' };
    }
    if (cfg.live) {
      NessieBank.cfg = cfg;
      this.backend = NessieBank;
    } else {
      this.backend = LocalBank;
      this.offlineReason = cfg.reason || 'Nessie unavailable';
    }
  },

  // Loads a snapshot. If Nessie fails, switch to offline data for the rest of the session.
  async load() {
    try {
      return await this.backend.load();
    } catch (err) {
      if (!this.live) throw err;
      console.warn(err);
      this.backend = LocalBank;
      this.offlineReason = 'Nessie stopped responding';
      return LocalBank.load();
    }
  },

  pay(merchant, amount, mode) { return this.backend.pay(merchant, amount, mode); },
  transfer(contact, amount, note, mode) { return this.backend.transfer(contact, amount, note, mode); },
  payBill(bill, mode) { return this.backend.payBill(bill, mode); },
};
