// SwampTag local state, saved in localStorage so it survives page reloads.
// Two jobs:
//   1. Offline demo data when Nessie isn't available (balance, transactions, bills).
//   2. Things Nessie doesn't track, in both modes: the linked key, settings,
//      Security Center alerts, and "local rows" (blocked attempts, money requests).

const STORE_KEY = 'swamptag-demo-v2';

const HOME = { lat: 29.6436, lng: -82.3549 }; // University of Florida

// Same people and merchants that tools/seed_nessie.py creates in Nessie.
// Amounts are whole dollars because Nessie stores whole dollars.
const CONTACTS = [
  { name: 'Diego', initials: 'DI', accountId: 'local-diego' },
  { name: 'Swarnabha', initials: 'SW', accountId: 'local-swarnabha' },
  { name: 'Angel', initials: 'AN', accountId: 'local-angel' },
];

const MERCHANTS = [
  { id: 'm-publix', name: 'Publix Super Market', initials: 'PX', place: 'Gainesville, FL', lat: 29.6524, lng: -82.3410, amount: 42, role: 'store' },
  { id: 'm-starbucks', name: 'Starbucks · Reitz Union', initials: 'SB', place: 'UF campus', lat: 29.6463, lng: -82.3478, amount: 6, role: 'store' },
  { id: 'm-chipotle', name: 'Chipotle', initials: 'CH', place: 'W University Ave', lat: 29.6519, lng: -82.3389, amount: 14, role: 'store' },
  { id: 'm-bookstore', name: 'UF Bookstore', initials: 'UF', place: 'UF campus', lat: 29.6467, lng: -82.3477, amount: 90, role: 'store' },
  { id: 'm-quickfuel', name: 'QuickFuel Gas #2291', initials: 'QF', place: 'Orlando, FL', lat: 28.5384, lng: -81.3789, amount: 390, role: 'fraud' },
  { id: 'm-sunshine', name: 'Sunshine Electronics', initials: 'SE', place: 'Miami, FL', lat: 25.7617, lng: -80.1918, amount: 1249, role: 'fraud' },
];

function daysFromNow(n, hour = 12) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(hour, 15, 0, 0);
  return d.toISOString();
}

function merchantRow(merchantId, amount, daysAgo) {
  const m = MERCHANTS.find((x) => x.id === merchantId);
  return { id: `seed-${merchantId}-${daysAgo}`, name: m.name, initials: m.initials, sub: m.place, merchantId, amount: -amount, status: 'approved', date: daysFromNow(-daysAgo, 17) };
}

function seedState() {
  return {
    // Local-only (both modes)
    keyUid: null,
    demoMode: false,
    alwaysTap: false,
    tapLimit: 200, // payments up to this many dollars skip the tap (risk.js); asked after linking a key
    autoPayRequests: true, // demo: anyone you request money from pays you instantly (bank.js requestPaid)
    scamCheck: true, // ask "why are you sending this?" before large transfers (scamcheck.js)
    localRows: [],
    alerts: [
      { level: 'info', title: 'Debit card ending 4821 added', detail: 'Link a SwampTag key to protect it.', date: daysFromNow(-15, 9) },
    ],
    // Offline backend data (mirrors the Nessie seed)
    balance: 2312,
    transactions: [
      { id: 'seed-diego', name: 'Diego', initials: 'DI', sub: 'Dinner split', amount: 40, status: 'received', date: daysFromNow(-1, 19) },
      merchantRow('m-starbucks', 6, 1),
      merchantRow('m-publix', 62, 2),
      merchantRow('m-starbucks', 5, 4),
      merchantRow('m-starbucks', 7, 6),
      merchantRow('m-publix', 38, 8),
      merchantRow('m-starbucks', 6, 10),
      merchantRow('m-publix', 54, 12),
    ],
    bills: [
      { id: 'b-duke', payee: 'Duke Energy', nickname: 'Electric', amount: 64, due: daysFromNow(5), status: 'pending' },
      { id: 'b-rent', payee: 'Sweetwater Apartments', nickname: 'Rent', amount: 725, due: daysFromNow(16), status: 'pending' },
    ],
  };
}

const Store = {
  state: null,

  load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      this.state = raw ? { ...seedState(), ...JSON.parse(raw) } : seedState();
    } catch {
      this.state = seedState();
    }
    return this.state;
  },

  save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.state));
    } catch {
      // Private window or storage blocked: the demo still works for this session.
    }
  },

  // Resets in place so code holding a reference to Store.state stays in sync.
  reset() {
    for (const k of Object.keys(this.state)) delete this.state[k];
    Object.assign(this.state, seedState());
    this.save();
  },

  // Offline ledger entry. Approved and received rows change the balance.
  addTransaction(tx) {
    const full = { id: 't' + Date.now(), date: new Date().toISOString(), ...tx };
    this.state.transactions.unshift(full);
    if (tx.status === 'approved' || tx.status === 'received') this.state.balance += tx.amount;
    this.save();
    return full;
  },

  // Rows Nessie doesn't hold: blocked attempts, requests, and payments saved while Nessie was down.
  addLocalRow(row) {
    const full = { id: 'l' + Date.now(), date: new Date().toISOString(), ...row };
    this.state.localRows.unshift(full);
    this.save();
    return full;
  },

  addAlert(level, title, detail) {
    this.state.alerts.unshift({ level, title, detail, date: new Date().toISOString() });
    this.save();
  },

  set(field, value) {
    this.state[field] = value;
    this.save();
  },
};
