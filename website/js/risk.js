// Smart taps: decides whether a payment needs a SwampTag tap, using the account's
// purchase history and merchant locations (from Nessie when live).

const RISK = {
  FAR_MILES: 25,       // farther than this from home = suspicious
  TAP_FREE_LIMIT: 25,  // trusted purchases up to this amount skip the tap
  LARGE_AMOUNT: 200,
  UNUSUAL_MULTIPLE: 3, // this many times the usual purchase = unusual
};

function milesBetween(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

// payment: { kind: 'purchase' | 'transfer' | 'bill', amount, merchant?: { id, lat, lng } }
// history: past purchases [{ merchantId, amount }] (amount positive)
// Returns { level: 'low' | 'medium' | 'high', reasons: [], tapRequired }
function assessRisk(payment, history, home, { alwaysTap = false } = {}) {
  const reasons = [];

  if (payment.kind === 'transfer') {
    reasons.push('Sending money to a person');
  } else if (payment.kind === 'bill') {
    reasons.push('Bill payment');
  } else {
    const m = payment.merchant;
    if (!history.some((h) => h.merchantId === m.id)) reasons.push('New merchant');

    if (home && m.lat != null && m.lng != null) {
      const miles = milesBetween(home, m);
      if (miles > RISK.FAR_MILES) reasons.push(`${Math.round(miles)} mi from home`);
    }

    const avg = history.length ? history.reduce((sum, h) => sum + h.amount, 0) / history.length : 0;
    if (avg && payment.amount > avg * RISK.UNUSUAL_MULTIPLE) {
      reasons.push(`${Math.round(payment.amount / avg)}× your usual spend`);
    } else if (payment.amount > RISK.LARGE_AMOUNT) {
      reasons.push('Large amount');
    }

    if (reasons.length === 0 && payment.amount > RISK.TAP_FREE_LIMIT) {
      reasons.push(`Over your $${RISK.TAP_FREE_LIMIT} tap-free limit`);
    }
  }

  const level = reasons.length === 0 ? 'low' : reasons.length >= 2 ? 'high' : 'medium';
  return { level, reasons, tapRequired: alwaysTap || level !== 'low' };
}

if (typeof module !== 'undefined') module.exports = { assessRisk, milesBetween, RISK };
