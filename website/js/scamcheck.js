// Scam check: before a large transfer, SwampTag asks "Why are you sending this money?"
// Red-flag answers match common scams that target older adults (grandparent,
// government impostor, romance and prize scams). A flagged transfer:
//   - shows a plain-language warning and reads it aloud (browser text-to-speech)
//   - alerts a trusted contact
//   - can only continue after the person calls the fraud line and enters the code
//
// The "AI review" is SIMULATED for the demo: no model or API is called.
// reviewTransfer() pauses, checks the answer and note against known scam patterns,
// and writes findings the way a fraud model would. A real model could replace it later.

const SCAM_CHECK_FROM = 200; // ask why for transfers of this many dollars or more

const TRUSTED_CONTACT = { name: 'Maya Patel', relation: 'granddaughter' };

// Fictional 555 number for the demo. The agent on the call reads out DEMO_VERIFY_CODE.
const FRAUD_LINE = { label: '(352) 555-0147', tel: '+13525550147', spoken: '3 5 2. 5 5 5. 0 1 4 7' };
const DEMO_VERIFY_CODE = '2468';

const TRANSFER_REASONS = [
  { id: 'payback', label: 'Paying back a friend or family member' },
  { id: 'split', label: 'Splitting a bill, rent or a meal' },
  { id: 'gift', label: 'A gift for someone I know in person' },
  {
    id: 'grandparent', label: 'A family member says they are in trouble and needs money fast',
    flag: 'Family emergency request', pattern: 'grandparent scam',
    warning: 'Scammers pretend to be a grandchild or relative in trouble, often crying or asking you to keep it secret. Hang up and call that person back on a number you already have.',
  },
  {
    id: 'impostor', label: 'Someone from my bank, the IRS, police or tech support told me to',
    flag: 'Caller told you to send money', pattern: 'government or bank impostor scam',
    warning: 'Banks, the IRS, police and tech support never ask you to send money to protect it or to pay a fine. That request alone means it is a scam.',
  },
  {
    id: 'romance', label: 'Someone I met online or on a dating app',
    flag: 'Online-only contact', pattern: 'romance scam',
    warning: "People you have only met online who ask for money are almost always scammers, even after weeks of friendly messages. Never send money to someone you haven't met in person.",
  },
  {
    id: 'prize', label: 'To claim a prize, lottery win or refund',
    flag: 'Prize or refund fee', pattern: 'prize scam',
    warning: 'Real prizes and refunds never make you pay first. Anyone asking for a fee to release winnings is a scammer.',
  },
];

// Phrases scammers commonly use, looked for in the optional explanation.
const RED_FLAG_PHRASES = [
  { flag: 'Gift card or crypto payment', words: ['gift card', 'itunes', 'google play card', 'bitcoin', 'crypto', 'wire transfer'],
    warning: 'Real businesses and government offices never ask to be paid with gift cards, crypto or wire transfers.' },
  { flag: 'Urgent or secret request', words: ['keep it secret', "don't tell", 'dont tell', 'right now', 'urgent', 'immediately', 'bail', 'arrested', 'jail', 'warrant'],
    warning: 'Pressure to act fast or keep a payment secret is the most common sign of a scam. Talk to someone you trust first.' },
  { flag: 'Prize or refund fee', words: ['prize', 'lottery', 'sweepstakes', 'refund', 'winnings', 'inheritance'],
    warning: 'Real prizes and refunds never make you pay first.' },
  { flag: 'Caller told you to send money', words: ['irs', 'social security', 'tech support', 'microsoft', 'fraud department', 'police'],
    warning: 'Government agencies, banks and tech support never ask you to move money over the phone.' },
];

function needsScamCheck(amount) {
  return amount >= SCAM_CHECK_FROM;
}

// Simulated review. Returns { flag, warning, findings[], confidence }, or { flag: null, findings[] } when nothing looks wrong.
async function reviewTransfer(reasonId, explanation = '', amount = 0, { delayMs = 1400 } = {}) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));

  const signals = [];
  const reason = TRANSFER_REASONS.find((r) => r.id === reasonId);
  if (reason && reason.flag) {
    signals.push({ flag: reason.flag, warning: reason.warning, finding: `Your answer matches a common ${reason.pattern} pattern.` });
  }

  const text = explanation.toLowerCase();
  for (const p of RED_FLAG_PHRASES) {
    const word = p.words.find((w) => text.includes(w));
    if (word) signals.push({ flag: p.flag, warning: p.warning, finding: `Your note mentions "${word}", which scammers often bring up.` });
  }

  if (!signals.length) return { flag: null, findings: ['No scam patterns found in your answer.'] };

  const findings = signals.map((s) => s.finding);
  if (amount >= 1000) findings.push(`$${amount.toLocaleString('en-US')} is a large amount to send to one person.`);
  findings.push('Scammers often ask for money to be sent quickly, before you can talk to anyone.');

  const confidence = Math.min(97, 74 + signals.length * 8 + (amount >= 1000 ? 6 : 0));
  return { flag: signals[0].flag, warning: signals[0].warning, findings, confidence };
}

if (typeof module !== 'undefined') module.exports = { reviewTransfer, needsScamCheck, TRANSFER_REASONS, SCAM_CHECK_FROM, DEMO_VERIFY_CODE };
