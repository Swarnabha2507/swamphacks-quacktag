// Smart taps: decides whether a payment needs a QuackTag tap. The user's tap limit
// decides; purchase history and merchant locations (from Nessie when live) only
// explain on the tap screen why a payment looks unusual.

const RISK = {
  DEFAULT_TAP_LIMIT: 200, // payments up to this amount skip the tap unless the user picks another limit
  FAR_MILES: 25,          // farther than this from home = suspicious
  UNUSUAL_MULTIPLE: 3,    // this many times the usual purchase = unusual
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
// A tap is required only when the amount is over tapLimit (or alwaysTap is on).
function assessRisk(payment, history, home, { alwaysTap = false, tapLimit = RISK.DEFAULT_TAP_LIMIT } = {}) {
  const tapRequired = alwaysTap || payment.amount > tapLimit;
  if (!tapRequired) return { level: 'low', reasons: [], tapRequired };

  const reasons = [];
  if (payment.amount > tapLimit) reasons.push(`Over your $${tapLimit} tap limit`);

  if (payment.kind === 'transfer') {
    reasons.push('Sending money to a person');
    if (payment.scamFlag) reasons.push(`Scam check: ${payment.scamFlag}`);
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
    }
  }

  const level = reasons.length >= 2 ? 'high' : 'medium';
  return { level, reasons, tapRequired };
}

if (typeof module !== 'undefined') module.exports = { assessRisk, milesBetween, RISK };
