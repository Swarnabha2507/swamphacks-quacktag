"""Scam review for payments over the tap limit: Gemini first, offline phrase rules as a backup.

Built from the working learning scripts in learn/ (gemini_client.py, step1b_scam_review.py,
voice_check.py, rules_review.py). Only uses the Python standard library, so it works with a
plain `py server.py`.

    from scam_review import review
    review(amount=500, explanation="My grandson is in jail and needs bail", kind="transfer", payee="Jordan Lee")
    → {"risk": "high", "scamType": "grandparent scam", "reasons": [...], "spokenWarning": "...",
       "answeredBy": "gemini-flash-lite-latest", "note": "..."}

Try it without the website:
    py scam_review.py "A man from the IRS told me to buy gift cards"
    py scam_review.py --offline "Textbooks for my class"
"""

import json
import os
import socket
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
TIMEOUT_S = 15                        # a model that takes longer counts as busy → try the next one
MODEL_CHANGE_CODES = (503, 500, 504)  # Google's side is busy or broken: another model may work


def _settings():
    """GEMINI_* settings from the environment, then .env.local (personal) and .env (shared)."""
    found = {}
    for name in (".env.local", ".env"):          # .env.local first: your own key wins
        path = ROOT / name
        if path.exists():
            for line in path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    found.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    for key in ("GEMINI_API_KEY", "GEMINI_MODEL"):
        if os.environ.get(key):
            found[key] = os.environ[key]
    return found


SETTINGS = _settings()
API_KEY = SETTINGS.get("GEMINI_API_KEY", "")
if API_KEY == "paste-your-key-here":
    API_KEY = ""
MODELS_TO_TRY = list(dict.fromkeys([SETTINGS.get("GEMINI_MODEL", "gemini-flash-latest"),
                                    "gemini-flash-lite-latest", "gemini-3.5-flash"]))


# ---------------------------------------------------------------------------
# Gemini
# ---------------------------------------------------------------------------

SYSTEM_INSTRUCTION = """You are the scam check inside SwampTag, a banking app for older adults.
The customer is about to make a payment that is over their own safety limit (a card purchase
or a money transfer), and explains in their own words why.
Decide whether it matches a common scam: grandparent / family emergency, government or bank
impostor (IRS, police, tech support), romance scam, prize or lottery fee, gift-card scam, or investment scam.
Signs include urgency, secrecy, being told what to buy or where to send money by someone on the
phone, gift cards or crypto, someone met only online, and paying to receive a prize.
Ordinary reasons (groceries, textbooks, paying back a friend, splitting rent, a gift for someone
they know in person) are low risk.
Write spokenWarning as 1-2 short, calm sentences a worried grandparent can understand when read aloud.
If the risk is low, spokenWarning should simply say the payment looks fine."""

RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "risk": {"type": "STRING", "enum": ["low", "medium", "high"]},
        "scamType": {"type": "STRING", "description": "e.g. 'grandparent scam', or 'none'"},
        "reasons": {"type": "ARRAY", "items": {"type": "STRING"}, "description": "short red flags found"},
        "spokenWarning": {"type": "STRING"},
    },
    "required": ["risk", "scamType", "reasons", "spokenWarning"],
}


class ModelChangeError(Exception):
    """This model is busy, down or too slow: try a different model."""


class GeminiUnavailable(Exception):
    """Gemini can't be used at all right now (no key, no internet, bad key...): use the rules."""


def _ask_model(model, prompt):
    body = {
        "systemInstruction": {"parts": [{"text": SYSTEM_INSTRUCTION}]},
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json",
                             "responseSchema": RESPONSE_SCHEMA, "temperature": 0},
    }
    request = urllib.request.Request(f"{BASE_URL}/models/{model}:generateContent",
                                     data=json.dumps(body).encode("utf-8"), method="POST")
    request.add_header("x-goog-api-key", API_KEY)
    request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
            result = json.loads(response.read())
    except urllib.error.HTTPError as err:
        if err.code in MODEL_CHANGE_CODES:
            raise ModelChangeError(f"HTTP {err.code}") from err
        raise GeminiUnavailable(f"HTTP {err.code} from Gemini") from err   # e.g. 403 bad key, 429 quota
    except (TimeoutError, socket.timeout) as err:
        raise ModelChangeError(f"no answer in {TIMEOUT_S}s") from err
    except urllib.error.URLError as err:
        if isinstance(err.reason, (TimeoutError, socket.timeout)):
            raise ModelChangeError(f"no answer in {TIMEOUT_S}s") from err
        raise GeminiUnavailable(f"can't reach Gemini ({err.reason})") from err
    text = result["candidates"][0]["content"]["parts"][0]["text"]
    return json.loads(text)


def _ask_gemini(prompt):
    """Try each model in turn. Returns (review, model) or raises GeminiUnavailable."""
    if not API_KEY:
        raise GeminiUnavailable("no GEMINI_API_KEY in .env.local")
    busy = []
    for model in MODELS_TO_TRY:
        try:
            return _ask_model(model, prompt), model
        except ModelChangeError as err:
            busy.append(f"{model}: {err}")
            print(f"Scam review: {model} busy ({err}), trying the next model")
    raise GeminiUnavailable("every model was busy (" + "; ".join(busy) + ")")


# ---------------------------------------------------------------------------
# Offline backup: the same red-flag phrases as website/js/scamcheck.js
# ---------------------------------------------------------------------------

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


def rules_review(text, amount):
    """Phrase rules, no AI, no internet. Same shape as Gemini's answer."""
    said = text.lower()
    found = [(flag, scam, warning) for flag, scam, words, warning in RED_FLAGS if any(w in said for w in words)]
    if not found:
        return {"risk": "low", "scamType": "none", "reasons": [], "spokenWarning": "This payment looks fine."}
    reasons = [flag for flag, _, _ in found]
    if amount >= 1000:
        reasons.append(f"${amount:,} is a large amount")
    return {"risk": "high" if len(found) >= 2 else "medium", "scamType": found[0][1],
            "reasons": reasons, "spokenWarning": found[0][2]}


# ---------------------------------------------------------------------------
# The one function the server calls
# ---------------------------------------------------------------------------

def review(amount, explanation="", reason_label="", kind="transfer", payee=""):
    """Review one payment. Never raises: if Gemini can't answer, the offline rules do.

    Returns {risk, scamType, reasons, spokenWarning, answeredBy, note}. answeredBy is the
    Gemini model that answered, or "offline rules"; note says why the rules were used.
    """
    what = "Card purchase at" if kind == "purchase" else "Money transfer to"
    lines = [f"{what}: {payee or 'unknown'}", f"Amount: ${amount}"]
    if reason_label:
        lines.append(f"Reason they picked: {reason_label}")
    lines.append(f"Customer's explanation: {explanation or '(none given)'}")
    try:
        result, model = _ask_gemini("\n".join(lines))
        return {**result, "answeredBy": model, "note": ""}
    except GeminiUnavailable as err:
        print(f"Scam review: Gemini unavailable ({err}), using the offline rules")
        result = rules_review(f"{reason_label} {explanation}", amount)
        return {**result, "answeredBy": "offline rules", "note": str(err)}


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    args = sys.argv[1:]
    if "--offline" in args:
        args.remove("--offline")
        API_KEY = ""
    text = " ".join(args) or "My grandson called crying, he's in jail and needs bail. He said don't tell his parents."
    print(f"Models: {' → '.join(MODELS_TO_TRY)}   Key: {'found' if API_KEY else 'missing (offline rules only)'}\n")
    print(json.dumps(review(500, text, kind="purchase", payee="UF Bookstore"), indent=2))
