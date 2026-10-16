// Demo account state, saved in localStorage so it survives page reloads.

const STORE_KEY = 'swamptag-demo-v1';

const CONTACTS = [
  { name: 'Jordan Lee', initials: 'JL' },
  { name: 'Maya Patel', initials: 'MP' },
  { name: 'Chris Nguyen', initials: 'CN' },
  { name: 'Mom', initials: 'M' },
];

const MERCHANTS = [
  { name: 'Publix Super Market', initials: 'PX', place: 'Gainesville, FL', amount: 42.10 },
  { name: 'Starbucks · Reitz Union', initials: 'SB', place: 'Gainesville, FL', amount: 6.45 },
  { name: 'Chipotle', initials: 'CH', place: 'W University Ave', amount: 13.85 },
  { name: 'UF Bookstore', initials: 'UF', place: 'Gainesville, FL', amount: 89.99 },
];

const FRAUD_ATTEMPTS = [
  { name: 'QuickFuel Gas #2291', initials: '??', place: 'Orlando, FL', amount: 389.99 },
  { name: 'ATM Withdrawal', initials: '??', place: 'Miami, FL', amount: 500.00 },
  { name: 'ElectroMart Online', initials: '??', place: 'Unknown location', amount: 1249.00 },
];

function daysAgo(n, hour = 12) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, 15, 0, 0);
  return d.toISOString();
}

function seedState() {
  return {
    balance: 2450.00,
    keyUid: null,
    demoMode: false,
    transactions: [
      { id: 't4', name: 'Jordan Lee', initials: 'JL', sub: 'Dinner split', amount: 40.00, status: 'received', date: daysAgo(1, 19) },
      { id: 't3', name: 'Publix Super Market', initials: 'PX', sub: 'Gainesville, FL', amount: -62.18, status: 'approved', date: daysAgo(2, 17) },
      { id: 't2', name: 'Mom', initials: 'M', sub: 'Books money', amount: 200.00, status: 'received', date: daysAgo(4, 10) },
      { id: 't1', name: 'Sweetwater Apartments', initials: 'SA', sub: 'Rent · October', amount: -725.00, status: 'approved', date: daysAgo(15, 9) },
    ],
    alerts: [
      { level: 'info', title: 'Debit card ending 4821 added', detail: 'Link a SwampTag key to protect it.', date: daysAgo(15, 9) },
    ],
  };
}

const Store = {
  state: null,

  load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      this.state = raw ? JSON.parse(raw) : seedState();
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

  addTransaction(tx) {
    const full = { id: 't' + Date.now(), date: new Date().toISOString(), ...tx };
    this.state.transactions.unshift(full);
    if (tx.status === 'approved' || tx.status === 'received') this.state.balance += tx.amount;
    this.save();
    return full;
  },

  addAlert(level, title, detail) {
    this.state.alerts.unshift({ level, title, detail, date: new Date().toISOString() });
    this.save();
  },

  setKey(uid) {
    this.state.keyUid = uid;
    this.save();
  },

  setDemoMode(on) {
    this.state.demoMode = on;
    this.save();
  },
};
