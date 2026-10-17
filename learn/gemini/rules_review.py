"""Offline backup for the scam check: simple phrase rules, no AI, no internet.

voice_check.py uses this when Gemini can't be reached (no internet, or every model busy),
so a demo never breaks. It returns the SAME shape as Gemini's JSON answer
({risk, scamType, reasons, spokenWarning}), so the rest of the code doesn't care which
one answered. The phrases are copied from the website's website/js/scamcheck.js.
"""

# (red flag, scam type, words to look for, warning to read aloud)
RED_FLAGS = [
    ("Family emergency request", "grandparent scam",
     ["grandson", "granddaughter", "grandchild", "nephew", "niece", "in trouble", "not to tell", "not to talk"],
     "Scammers pretend to be a grandchild or relative in trouble. Hang up and call that person back on a number you already have."),
    ("Urgent or secret request", "grandparent scam",
     ["keep it secret", "don't tell", "dont tell", "right now", "urgent", "immediately", "bail", "arrested", "jail", "warrant"],
     "Pressure to act fast or keep a payment secret is the most common sign of a scam. Talk to someone you trust first."),
    ("Gift card or crypto payment", "government or bank impostor scam",
     ["gift card", "itunes", "google play card", "bitcoin", "crypto", "wire transfer"],
     "Real businesses and government offices never ask to be paid with gift cards, crypto or wire transfers."),
    ("Caller told you to send money", "government or bank impostor scam",
     ["irs", "social security", "tech support", "microsoft", "fraud department", "police"],
     "Government agencies, banks and tech support never ask you to move money over the phone."),
    ("Prize or refund fee", "prize scam",
     ["prize", "lottery", "sweepstakes", "refund", "winnings", "inheritance"],
     "Real prizes and refunds never make you pay first."),
    ("Online-only contact", "romance scam",
     ["met online", "dating app", "never met", "online friend"],
     "People you have only met online who ask for money are almost always scammers."),
]


def rules_review(explanation, amount):
    """Check the explanation against known scam phrases. Same output shape as Gemini's review."""
    text = explanation.lower()
    found = [(flag, scam, warning) for flag, scam, words, warning in RED_FLAGS if any(w in text for w in words)]

    if not found:
        return {"risk": "low", "scamType": "none", "reasons": [],
                "spokenWarning": "This transfer looks fine."}

    reasons = [flag for flag, _, _ in found]
    if amount >= 1000:
        reasons.append(f"${amount:,} is a large amount to send to one person")
    return {
        "risk": "high" if len(found) >= 2 else "medium",
        "scamType": found[0][1],
        "reasons": reasons,
        "spokenWarning": found[0][2],
    }
