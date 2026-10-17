"""Phone terminal relay and SwampTag key check (used by server.py).

The Pixel phone is the payment terminal: it shows the amount and reads the key fob
with Web NFC. The laptop dashboard decides whether the key is the linked one.
This module passes messages between them, using the same words as the old USB
reader protocol:

    dashboard → phone:  WAIT (+ payment details), OK, DENY, IDLE
    phone → dashboard:  TAG:<key id>, BADTAG:<reason>, SIM:GOOD / SIM:BAD (demo buttons)

Key format (agreed with the key-device teammate, see docs/KEY_FORMAT.md):
    NDEF text record  ST1:<keyId>:<counter>:<code>
    code = first 8 hex chars of HMAC-SHA256(KEY_SECRET, "<keyId>:<counter>")
    The counter must go up every time, so a copied (older) code is refused.
"""

import hashlib
import hmac
import json
import re
import threading
import time
from pathlib import Path

PHONE_ONLINE_S = 3.0      # phone counts as connected if it checked in this recently
MAX_EVENTS = 200

ST1 = re.compile(r"ST1:([A-Za-z0-9-]{1,32}):(\d{1,10}):([0-9A-Fa-f]{8})")


class KeyChecker:
    """Turns what the phone read into an event line for the dashboard."""

    def __init__(self, secret="", counters_file=None):
        self.secret = secret
        self.counters_file = Path(counters_file) if counters_file else None
        self.counters = {}
        self.lock = threading.Lock()  # the server handles requests on several threads
        if self.counters_file and self.counters_file.exists():
            try:
                self.counters = json.loads(self.counters_file.read_text(encoding="utf-8"))
            except ValueError:
                self.counters = {}

    def expected_code(self, key_id, counter):
        msg = f"{key_id}:{counter}".encode()
        return hmac.new(self.secret.encode(), msg, hashlib.sha256).hexdigest()[:8].upper()

    def check(self, serial="", texts=()):
        with self.lock:
            return self._check(serial, texts)

    def _check(self, serial, texts):
        for text in texts:
            match = ST1.fullmatch(text.strip())
            if not match:
                continue
            key_id, counter, code = match.group(1), int(match.group(2)), match.group(3).upper()
            if self.secret:
                if not hmac.compare_digest(self.expected_code(key_id, counter), code):
                    return "BADTAG:Key code doesn't match"
                if counter <= self.counters.get(key_id, -1):
                    return "BADTAG:Old key code, possibly a copied key"
                self.counters[key_id] = counter
                self._save()
            return f"TAG:{key_id.upper()}"

        # No SwampTag code on the tag (or the phone can only see its serial number):
        # fall back to the tag's serial number, like the old USB reader.
        uid = re.sub(r"[^0-9A-Fa-f]", "", serial or "").upper()
        if uid:
            return f"TAG:{uid}"
        return "BADTAG:Couldn't read a SwampTag code from this key"

    def _save(self):
        if self.counters_file:
            self.counters_file.write_text(json.dumps(self.counters, indent=2), encoding="utf-8")


class TerminalRelay:
    """In-memory state shared by the dashboard (laptop) and the terminal page (phone)."""

    def __init__(self, checker):
        self.checker = checker
        self.lock = threading.Lock()
        self.request = None     # payment details while the dashboard waits for a key
        self.result = None      # "OK" / "DENY" after the dashboard decides
        self.seq = 0            # bumps on every change, so the phone knows to redraw
        self.events = []        # [(n, line)] for the dashboard
        self.next_event = 1
        self.phone_seen = 0.0

    def _changed(self):
        self.seq += 1

    def command(self, cmd, details=None):
        """From the dashboard."""
        cmd = (cmd or "").upper()
        with self.lock:
            if cmd == "WAIT":
                self.request = details or {}
                self.result = None
            elif cmd in ("OK", "DENY"):
                if details:  # e.g. the amount for a no-tap approval, or why it was blocked
                    self.request = {**(self.request or {}), **details}
                self.result = cmd
            elif cmd == "IDLE":
                self.request = None
                self.result = None
            else:
                return False
            self._changed()
            return True

    def state(self):
        """For the phone. Polling it also marks the phone as connected."""
        with self.lock:
            self.phone_seen = time.time()
            return {"seq": self.seq, "request": self.request, "result": self.result}

    def read(self, serial="", texts=(), simulate=None):
        """From the phone: a key was read (or a demo button was pressed)."""
        if simulate in ("good", "bad"):
            line = "SIM:GOOD" if simulate == "good" else "SIM:BAD"
        else:
            line = self.checker.check(serial, texts)
        with self.lock:
            self.phone_seen = time.time()
            self.events.append((self.next_event, line))
            self.next_event += 1
            self.events = self.events[-MAX_EVENTS:]
        return line

    def events_since(self, since):
        """For the dashboard. since < 0 (first poll) skips old events."""
        with self.lock:
            return {
                "events": [] if since < 0 else [{"n": n, "line": line} for n, line in self.events if n > since],
                "next": self.next_event - 1,
                "phoneOnline": time.time() - self.phone_seen < PHONE_ONLINE_S,
            }


# ---------- Gas-station checkout (website/pump.html) ----------
# The fake debit card holds a static record written by firmware/swamptag_key (env:card):
#     SC1:<last4>:<holder>:<keyId>      keyId = UID of the key fob the card is paired with
# Checkout = card → PIN → key. The key must carry a fresh ST1 code (KeyChecker) AND be
# the card's paired key. If the phone can only see tag serial numbers (no NDEF data),
# cards are paired with keys through pairings.json instead (pump setup screen).

SC1 = re.compile(r"SC1:(\d{4}):([^:]{1,40}):([0-9A-Fa-f]{4,20})")
DEMO_CARD = "SC1:4821:ALBERT GATOR:DE0DE001"
MAX_PIN_TRIES = 3


def clean_uid(serial):
    return re.sub(r"[^0-9A-Fa-f]", "", serial or "").upper()


class PumpAuthorizer:
    def __init__(self, checker, pin="1234", pairings_file=None):
        self.checker = checker
        self.pin = pin
        self.pairings_file = Path(pairings_file) if pairings_file else None
        self.pairings = {}  # card UID -> key UID (serial-number mode only)
        if self.pairings_file and self.pairings_file.exists():
            try:
                self.pairings = json.loads(self.pairings_file.read_text(encoding="utf-8"))
            except ValueError:
                self.pairings = {}
        self.wrong_pins = {}
        self.demo_counter = 0
        self.lock = threading.Lock()

    # -- card --

    def read_card(self, serial="", texts=(), simulate=None):
        """Returns {ok, last4, holder, keyId, mode, cardId} or {ok: False, reason}."""
        if simulate == "card":
            texts, serial = [DEMO_CARD], "DE:MO:CA:RD"
        for text in texts:
            m = SC1.fullmatch(text.strip())
            if m:
                return {"ok": True, "last4": m.group(1), "holder": m.group(2).strip().title(),
                        "keyId": m.group(3).upper(), "mode": "ndef", "cardId": clean_uid(serial) or m.group(1)}
        uid = clean_uid(serial)
        if uid and uid in self.pairings:
            return {"ok": True, "last4": uid[-4:], "holder": "SwampTag cardholder",
                    "keyId": self.pairings[uid], "mode": "serial", "cardId": uid}
        if uid and not texts:
            return {"ok": False, "reason": "This phone can only see the card's ID. Pair the card with its key in pump setup (⚙).", "serial": uid}
        return {"ok": False, "reason": "That isn't a SwampTag card. Write it with the card-writer firmware first."}

    def pair(self, card_serial, key_serial):
        card, key = clean_uid(card_serial), clean_uid(key_serial)
        if not card or not key:
            return False
        with self.lock:
            self.pairings[card] = key
            if self.pairings_file:
                self.pairings_file.write_text(json.dumps(self.pairings, indent=2), encoding="utf-8")
        return True

    # -- key (demo buttons build a read the same way the real key device would) --

    def demo_key_texts(self, kind, key_id):
        if kind == "wrong":  # someone else's fob: a genuine code, but not this card's key
            other = "BADBADBA"
            counter = int(time.time())
            code = self.checker.expected_code(other, counter) if self.checker.secret else "00000000"
            return [f"ST1:{other}:{counter}:{code}"], "BA:DB:AD:BA"
        with self.lock:
            if kind == "good":
                self.demo_counter = max(self.demo_counter + 1, self.checker.counters.get(key_id, 0) + 1)
            counter = self.demo_counter  # "copied" replays the last code
        code = self.checker.expected_code(key_id, counter) if self.checker.secret else "00000000"
        return [f"ST1:{key_id}:{counter}:{code}"], ""

    # -- checkout --

    def authorize(self, card, pin, key, total=0, items=()):
        card = card or {}
        key = key or {}
        c = self.read_card(card.get("serialNumber", ""), card.get("texts", []), card.get("simulate"))
        if not c["ok"]:
            return {"approved": False, "reason": c["reason"], "step": "card"}
        card_id = c["cardId"]

        with self.lock:
            if self.wrong_pins.get(card_id, 0) >= MAX_PIN_TRIES:
                return {"approved": False, "reason": "Card locked after 3 wrong PINs", "step": "pin"}
            if str(pin) != str(self.pin):
                self.wrong_pins[card_id] = self.wrong_pins.get(card_id, 0) + 1
                left = MAX_PIN_TRIES - self.wrong_pins[card_id]
                return {"approved": False, "reason": f"Wrong PIN ({left} {'try' if left == 1 else 'tries'} left)" if left else "Card locked after 3 wrong PINs", "step": "pin"}
            self.wrong_pins.pop(card_id, None)

        texts, serial = key.get("texts", []), key.get("serialNumber", "")
        if key.get("simulate"):
            if key["simulate"] == "copied" and not self.checker.secret:
                # Without KEY_SECRET the server doesn't track counters, so say what would happen.
                return {"approved": False, "reason": "Old key code, possibly a copied key", "step": "key"}
            texts, serial = self.demo_key_texts(key["simulate"], c["keyId"])
        has_code = any(ST1.fullmatch(t.strip()) for t in texts)
        if c["mode"] == "ndef" and not has_code:
            return {"approved": False, "reason": "This key has no SwampTag code. Rest it on its key dock first", "step": "key"}

        line = self.checker.check(serial, texts)
        if line.startswith("BADTAG:"):
            return {"approved": False, "reason": line[len("BADTAG:"):], "step": "key"}
        if line[len("TAG:"):] != c["keyId"].upper():
            return {"approved": False, "reason": "This key isn't paired with this card", "step": "key"}

        return {"approved": True, "reason": "", "card": {"last4": c["last4"], "holder": c["holder"]},
                "total": total, "items": list(items)[:20], "verified": has_code}
