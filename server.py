"""SwampTag dev server.

Serves the website/ folder and forwards /api/nessie/* to Capital One's Nessie API,
adding the API key on the server so it never reaches the browser.

    python server.py            # http://localhost:8000
    python server.py 8080       # pick another port
    python server.py --offline  # ignore the Nessie key and use offline demo data

Only uses the Python standard library.
"""

import json
import os
import re
import sys
import threading
import time
from collections import deque
import urllib.error
import urllib.request
from datetime import date, datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit

import scam_review   # Gemini scam review with model switch + offline rules (standard library only)
import transcriber   # Whisper speech-to-text; only available when run from .venv
from terminal import KeyChecker, PumpAuthorizer, TerminalRelay

ROOT = Path(__file__).resolve().parent
WEB_DIR = ROOT / "website"
IDS_FILE = ROOT / "nessie_ids.json"
COUNTERS_FILE = ROOT / "key_counters.json"
PAIRINGS_FILE = ROOT / "pairings.json"       # card ↔ key pairs, serial-number mode only
LOCAL_STATE_FILE = ROOT / "local_state.json"  # e.g. the gas station merchant ID in Nessie
SCAM_LOG_FILE = ROOT / "scam_reviews.txt"     # every voice transcription, scam review and representative request
AUDIO_TYPES = {"audio/webm": ".webm", "audio/ogg": ".ogg", "audio/wav": ".wav", "audio/mp4": ".m4a", "audio/mpeg": ".mp3"}
TIMEOUT_S = 8


def load_env():
    env_file = ROOT / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        os.environ.setdefault(name.strip(), value.strip().strip('"').strip("'"))


load_env()
NESSIE_BASE = os.environ.get("NESSIE_BASE", "https://api.nessieisreal.com").rstrip("/")
API_KEY = os.environ.get("NESSIE_API_KEY", "").strip()
OFFLINE = __name__ == "__main__" and "--offline" in sys.argv
if API_KEY == "paste-your-key-here" or OFFLINE:
    API_KEY = ""

# Shared secret for the rotating key codes (docs/KEY_FORMAT.md). Blank = accept codes unchecked.
KEY_SECRET = os.environ.get("KEY_SECRET", "").strip()
CHECKER = KeyChecker(KEY_SECRET, COUNTERS_FILE)  # one checker, so key counters are shared
RELAY = TerminalRelay(CHECKER)
PUMP = PumpAuthorizer(CHECKER, os.environ.get("CARD_PIN", "1234").strip() or "1234", PAIRINGS_FILE)
GAS_MERCHANT = {"name": "Swamp Gas & Go", "initials": "SG", "place": "Gainesville, FL", "category": "Gas",
                "lat": 29.6516, "lng": -82.3248, "role": "pump",
                "address": {"street_number": "1300", "street_name": "SW 13th St", "city": "Gainesville", "state": "FL", "zip": "32608"}}
QUIET_PATHS = ("/api/terminal/state", "/api/terminal/events", "/api/nessie-log", "/api/sale-times")  # polled several times a second


# Recent Nessie API calls, shown live on the dashboard ("Capital One Nessie" panel).
NESSIE_LOG = deque(maxlen=40)
NESSIE_LOG_LOCK = threading.Lock()
_log_seq = 0


def log_nessie_call(method, path, status, source, body):
    global _log_seq
    short = re.sub(r"([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", lambda m: m.group(1)[:4] + "..", path.lstrip("/"))
    if method == "GET" and status == 404 and short.rsplit("/", 1)[-1] in ("purchases", "deposits", "transfers", "bills", "withdrawals"):
        status = "empty"  # Nessie answers 404 for an empty list
    detail = ""
    if isinstance(body, dict):
        if "amount" in body:
            detail = f"${body['amount']}"
        if body.get("description"):
            detail += f" · {body['description']}"
        elif body.get("name"):
            detail += f"{body['name']}"
        elif body.get("status"):
            detail += f" status → {body['status']}"
    with NESSIE_LOG_LOCK:
        _log_seq += 1
        NESSIE_LOG.append({"n": _log_seq, "at": time.strftime("%H:%M:%S"), "method": method, "path": short,
                           "status": status, "source": source, "detail": detail.strip(" ·")})


def nessie_request(method, path, body=None, query=None, source="server"):
    """Calls Nessie and returns (status, parsed_json_or_text). Raises OSError if unreachable."""
    try:
        status, payload = _nessie_call(method, path, body, query)
    except OSError:
        log_nessie_call(method, path, "offline", source, body)
        raise
    log_nessie_call(method, path, status, source, body)
    return status, payload


def _nessie_call(method, path, body=None, query=None):
    params = list(query or []) + [("key", API_KEY)]
    url = f"{NESSIE_BASE}/{path.lstrip('/')}?{urlencode(params)}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Accept", "application/json")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
            status, raw = resp.status, resp.read()
    except urllib.error.HTTPError as err:
        status, raw = err.code, err.read()
    try:
        return status, json.loads(raw or b"null")
    except ValueError:
        return status, raw.decode("utf-8", "replace")


def load_ids():
    if not IDS_FILE.exists():
        return None
    return json.loads(IDS_FILE.read_text(encoding="utf-8"))


def auth0_config():
    """Public Auth0 SPA settings (not secrets), or None when Auth0 isn't set up."""
    domain = os.environ.get("AUTH0_DOMAIN", "").strip().removeprefix("https://").rstrip("/")
    client_id = os.environ.get("AUTH0_CLIENT_ID", "").strip()
    if not domain or not client_id or "paste" in domain or "paste" in client_id:
        return None
    return {"domain": domain, "clientId": client_id}


def nessie_config():
    """What the dashboard needs to know to talk to Nessie, or why it can't."""
    if not API_KEY:
        reason = "Started with --offline" if OFFLINE else "No Nessie API key yet (add it to .env)"
        return {"live": False, "reason": reason}
    ids = load_ids()
    if not ids:
        return {"live": False, "reason": "Nessie not seeded yet (run python tools/seed_nessie.py)"}
    try:
        status, _ = nessie_request("GET", f"accounts/{ids['accountId']}", source="live check")
    except OSError as err:
        return {"live": False, "reason": f"Nessie unreachable ({err.__class__.__name__})"}
    if status != 200:
        return {"live": False, "reason": f"Nessie returned HTTP {status}"}
    return {"live": True, **ids}


def load_local_state():
    if not LOCAL_STATE_FILE.exists():
        return {}
    try:
        return json.loads(LOCAL_STATE_FILE.read_text(encoding="utf-8"))
    except ValueError:
        return {}


def gas_merchant(create=False):
    """The pump's Nessie merchant (created once, ID cached in local_state.json)."""
    state = load_local_state()
    if state.get("gasMerchantId"):
        return {"id": state["gasMerchantId"], **{k: v for k, v in GAS_MERCHANT.items() if k != "address"}}
    if not create:
        return None
    status, data = nessie_request("POST", "merchants", source="pump", body={
        "name": GAS_MERCHANT["name"], "category": GAS_MERCHANT["category"], "address": GAS_MERCHANT["address"],
        "geocode": {"lat": GAS_MERCHANT["lat"], "lng": GAS_MERCHANT["lng"]}})
    merchant_id = (data.get("objectCreated") or {}).get("_id") if isinstance(data, dict) else None
    if status not in (200, 201) or not merchant_id:
        raise OSError(f"Nessie refused the merchant (HTTP {status})")
    state["gasMerchantId"] = merchant_id
    LOCAL_STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")
    return gas_merchant()


def remember_sale_time(purchase_id):
    """Nessie only stores a date, so keep the exact time of each pump sale. The dashboard uses it
    to put the sale at the top of Recent activity instead of at "noon"."""
    state = load_local_state()
    times = state.setdefault("saleTimes", {})
    times[purchase_id] = datetime.now(timezone.utc).isoformat()
    for old in list(times)[:-50]:  # keep the last 50
        del times[old]
    LOCAL_STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")


def nessie_list(path):
    """GET a Nessie list. Nessie answers 404 for an empty list."""
    status, data = nessie_request("GET", path, source="pump")
    if status == 404:
        return []
    if status != 200 or not isinstance(data, list):
        raise OSError(f"Nessie GET {path.split('/')[-1]} returned HTTP {status}")
    return data


def nessie_balance(ids):
    """Available balance, worked out from the account's Nessie transactions the same way
    the dashboard does (Nessie doesn't change account.balance when purchases are posted)."""
    account_id = ids["accountId"]
    purchases = nessie_list(f"accounts/{account_id}/purchases")
    deposits = nessie_list(f"accounts/{account_id}/deposits")
    transfers = nessie_list(f"accounts/{account_id}/transfers")
    spent = sum(p.get("amount", 0) for p in purchases if p.get("status") != "cancelled")
    return ids.get("openingBalance", 0) + sum(d.get("amount", 0) for d in deposits) - spent - sum(t.get("amount", 0) for t in transfers)


def settle_pump_sale(result, total):
    """After the card, PIN and key pass: the bank (Nessie) has the final say.
    Declines when the balance is too low; otherwise posts the purchase at Swamp Gas & Go
    and adds its Nessie ID and the new balance to the receipt. Offline: approve as is."""
    ids = load_ids()
    if not API_KEY or not ids or total <= 0:
        result["nessie"] = {"recorded": False, "note": "Offline demo: not sent to Nessie"}
        return result
    try:
        balance = nessie_balance(ids)
        if total > balance:
            return {"approved": False, "step": "funds",
                    "reason": f"Insufficient funds. Your balance is ${balance:,.0f}"}
        merchant = gas_merchant(create=True)
        status, data = nessie_request("POST", f"accounts/{ids['accountId']}/purchases", source="pump", body={
            "merchant_id": merchant["id"], "medium": "balance", "purchase_date": date.today().isoformat(),
            "status": "completed", "amount": int(round(total)),
            "description": "SwampTag verified · Pump" if result.get("verified") else "No SwampTag check · Pump"})
        purchase_id = (data.get("objectCreated") or {}).get("_id") if isinstance(data, dict) else None
        if status not in (200, 201) or not purchase_id:
            raise OSError(f"Nessie refused the purchase (HTTP {status})")
        result["nessie"] = {"recorded": True, "purchaseId": purchase_id, "merchant": merchant["name"],
                            "balanceAfter": balance - int(round(total))}
        remember_sale_time(purchase_id)
    except OSError as err:
        print(f"Pump sale not recorded in Nessie: {err}")
        result["nessie"] = {"recorded": False, "note": "Nessie didn't answer, so the sale wasn't recorded"}
    return result


def build_config():
    config = nessie_config()
    merchant = gas_merchant() if config.get("live") else None
    if merchant:
        config["merchants"] = [*config.get("merchants", []), merchant]
    auth0 = auth0_config()
    if auth0:
        config["auth0"] = auth0
    config["voice"] = transcriber.available()      # the page shows 🎤 only when Whisper can run
    config["scamAI"] = bool(scam_review.API_KEY)   # False = scam reviews use the offline rules
    return config


def log_scam(kind, details):
    """Append one entry to scam_reviews.txt so you can see what happened (kept on this computer only)."""
    lines = [f"=== {kind} · {datetime.now():%Y-%m-%d %H:%M:%S} ==="]
    lines += [f"{key}: {value}" for key, value in details.items()]
    with SCAM_LOG_FILE.open("a", encoding="utf-8") as file:
        file.write("\n".join(lines) + "\n\n")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def end_headers(self):
        # Always serve fresh files while editing during the hackathon.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        if self.path.startswith("/api/") and not self.path.startswith(QUIET_PATHS):
            super().log_message(fmt, *args)

    def read_json_body(self):
        """Returns the parsed JSON body (None if empty). Raises ValueError for bad JSON."""
        length = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(length)) if length else None

    def handle_voice(self, method, parts):
        """Voice scam check for payments over the tap limit (scam_review.py + transcriber.py)."""
        if method != "POST":
            return self.send_json(405, {"error": "POST only"})

        if parts.path == "/api/voice/transcribe":           # body = the browser's audio recording
            if not transcriber.available():
                return self.send_json(503, {"error": "Voice isn't set up: run the server with .venv\\Scripts\\python.exe"})
            data = self.rfile.read(int(self.headers.get("Content-Length") or 0))
            if not data:
                return self.send_json(400, {"error": "The recording was empty"})
            suffix = AUDIO_TYPES.get(self.headers.get("Content-Type", "").split(";")[0].strip(), ".webm")
            try:
                text, seconds = transcriber.transcribe_bytes(data, suffix)
            except Exception as err:  # a broken recording must not stop the server
                print(f"Voice: transcription failed: {err}")
                return self.send_json(500, {"error": f"Couldn't understand the recording ({type(err).__name__})"})
            log_scam("voice transcription", {"Audio": f"{seconds:.1f}s", "Text": text or "(nothing heard)"})
            print(f"Voice: heard {seconds:.1f}s: {text!r}")
            return self.send_json(200, {"text": text, "seconds": round(seconds, 1)})

        try:
            body = self.read_json_body() or {}
        except ValueError:
            return self.send_json(400, {"error": "Body must be JSON"})

        if parts.path == "/api/voice/review":
            try:
                amount = int(body.get("amount", 0))
            except (TypeError, ValueError):
                amount = 0
            explanation = str(body.get("explanation", ""))[:500]
            result = scam_review.review(amount, explanation, str(body.get("reasonLabel", ""))[:200],
                                        "purchase" if body.get("kind") == "purchase" else "transfer",
                                        str(body.get("payee", ""))[:80])
            log_scam("scam review", {"Payment": f"{body.get('kind')} ${amount} · {body.get('payee', '')}",
                                     "Reason": body.get("reasonLabel") or "-", "Said": explanation or "-",
                                     "Answered by": result["answeredBy"], "Risk": result["risk"],
                                     "Scam type": result["scamType"], "Note": result["note"] or "-"})
            print(f"Scam review: {result['answeredBy']}: risk {result['risk']} ({result['scamType']})")
            return self.send_json(200, result)

        if parts.path == "/api/voice/representative":    # demo only: nothing is called
            log_scam("representative request (demo only, no call made)",
                     {"Why": str(body.get("reason", "-"))[:200], "Payment": str(body.get("payment", "-"))[:120]})
            print(f"Representative requested ({body.get('reason')}). Demo only: no call made.")
            return self.send_json(200, {"connected": False,
                                        "message": "Customer service isn't connected in this demo. No call was made."})

        return self.send_json(404, {"error": "Unknown voice route"})

    def handle_pump(self, method, parts):
        """Gas-station checkout on the phone (website/pump.html): card, PIN, key."""
        if method != "POST":
            return self.send_json(405, {"error": "POST only"})
        try:
            body = self.read_json_body() or {}
        except ValueError:
            return self.send_json(400, {"error": "Body must be JSON"})
        route = parts.path[len("/api/pump/"):]

        def read(field):
            obj = body.get(field) or {}
            texts = [t for t in obj.get("texts", []) if isinstance(t, str)][:8]
            return {"serialNumber": str(obj.get("serialNumber", "")), "texts": texts, "simulate": obj.get("simulate")}

        if route == "card":
            c = read("card")
            return self.send_json(200, PUMP.read_card(c["serialNumber"], c["texts"], c["simulate"]))
        if route == "authorize":
            try:
                total = int(body.get("total", 0))
            except (TypeError, ValueError):
                total = 0
            result = PUMP.authorize(read("card"), str(body.get("pin", "")), read("key"), total, body.get("items", []))
            if result["approved"]:
                result = settle_pump_sale(result, total)
            print(f"Pump: {'APPROVED' if result['approved'] else 'DECLINED'} ${total} {result.get('reason', '')}")
            return self.send_json(200, result)
        if route == "pair":
            ok = PUMP.pair(read("card")["serialNumber"], read("key")["serialNumber"])
            return self.send_json(200 if ok else 400, {"ok": ok})
        return self.send_json(404, {"error": "Unknown pump route"})

    def handle_terminal(self, method, parts):
        """Relay between the dashboard and the phone terminal (terminal.py)."""
        route = parts.path[len("/api/terminal/"):]
        try:
            body = self.read_json_body() or {}
        except ValueError:
            return self.send_json(400, {"error": "Body must be JSON"})

        if route == "state" and method == "GET":
            return self.send_json(200, RELAY.state())
        if route == "events" and method == "GET":
            query = dict(parse_qsl(parts.query))
            try:
                since = int(query.get("since", "-1"))
            except ValueError:
                since = -1
            return self.send_json(200, RELAY.events_since(since))
        if route == "command" and method == "POST":
            ok = RELAY.command(body.get("cmd"), body.get("details"))
            return self.send_json(200 if ok else 400, {"ok": ok})
        if route == "read" and method == "POST":
            texts = [t for t in body.get("texts", []) if isinstance(t, str)][:8]
            line = RELAY.read(str(body.get("serialNumber", "")), texts, body.get("simulate"))
            return self.send_json(200, {"line": line})
        return self.send_json(404, {"error": "Unknown terminal route"})

    def send_json(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_api(self, method):
        parts = urlsplit(self.path)
        if parts.path == "/api/config" and method == "GET":
            return self.send_json(200, build_config())
        if parts.path == "/api/sale-times" and method == "GET":
            return self.send_json(200, load_local_state().get("saleTimes", {}))
        if parts.path == "/api/nessie-log" and method == "GET":
            with NESSIE_LOG_LOCK:
                return self.send_json(200, {"calls": list(NESSIE_LOG)})
        if parts.path.startswith("/api/terminal/"):
            return self.handle_terminal(method, parts)
        if parts.path.startswith("/api/pump/"):
            return self.handle_pump(method, parts)
        if parts.path.startswith("/api/voice/"):
            return self.handle_voice(method, parts)
        if not parts.path.startswith("/api/nessie/"):
            return self.send_json(404, {"error": "Unknown API route"})
        if not API_KEY:
            return self.send_json(503, {"error": "No Nessie API key configured"})

        try:
            body = self.read_json_body()
        except ValueError:
            return self.send_json(400, {"error": "Body must be JSON"})

        path = parts.path[len("/api/nessie/"):]
        query = [(k, v) for k, v in parse_qsl(parts.query) if k != "key"]
        try:
            status, payload = nessie_request(method, path, body, query, source="dashboard")
        except OSError as err:
            return self.send_json(502, {"error": f"Nessie unreachable: {err}"})
        self.send_json(status, payload)

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self.handle_api("GET")
        super().do_GET()

    def do_POST(self):
        self.handle_api("POST")

    def do_PUT(self):
        self.handle_api("PUT")

    def do_DELETE(self):
        self.handle_api("DELETE")


def main():
    ports = [a for a in sys.argv[1:] if a.isdigit()]
    port = int(ports[0]) if ports else 8000
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"SwampTag running at http://localhost:{port}  (Ctrl+C to stop)")
    print("Nessie key:", "found" if API_KEY else "missing (offline demo data)")
    print("Nessie IDs:", "found" if IDS_FILE.exists() else "missing (run python tools/seed_nessie.py)")
    print("Auth0:", "on" if auth0_config() else "off (demo login; add AUTH0_DOMAIN and AUTH0_CLIENT_ID to .env)")
    print("Key codes:", "checked with KEY_SECRET" if KEY_SECRET else "not checked (no KEY_SECRET in .env)")
    print(f"Phone terminal: http://localhost:{port}/terminal.html   Gas pump: http://localhost:{port}/pump.html")
    print(f"  (on the phone: adb reverse tcp:{port} tcp:{port}, or edge://inspect port forwarding)")
    print("Card PIN:", "set in .env" if os.environ.get("CARD_PIN") else "1234 (default)")
    # Plain characters only: Windows terminals may not be able to print arrows or emoji.
    print("Scam review:", f"Gemini ({' -> '.join(scam_review.MODELS_TO_TRY)}), offline rules as backup"
          if scam_review.API_KEY else "offline rules only (add GEMINI_API_KEY to .env.local)")
    print("Voice:", "on, loading Whisper in the background" if transcriber.available()
          else "off (run with .venv\\Scripts\\python.exe to turn it on)")
    if transcriber.available():
        threading.Thread(target=transcriber.warm_up, daemon=True).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
