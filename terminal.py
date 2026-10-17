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
        if self.counters_file and self.counters_file.exists():
            try:
                self.counters = json.loads(self.counters_file.read_text(encoding="utf-8"))
            except ValueError:
                self.counters = {}

    def expected_code(self, key_id, counter):
        msg = f"{key_id}:{counter}".encode()
        return hmac.new(self.secret.encode(), msg, hashlib.sha256).hexdigest()[:8].upper()

    def check(self, serial="", texts=()):
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
