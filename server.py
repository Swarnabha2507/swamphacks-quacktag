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
import sys
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit

ROOT = Path(__file__).resolve().parent
WEB_DIR = ROOT / "website"
IDS_FILE = ROOT / "nessie_ids.json"
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
if API_KEY == "paste-your-key-here" or (__name__ == "__main__" and "--offline" in sys.argv):
    API_KEY = ""


def nessie_request(method, path, body=None, query=None):
    """Calls Nessie and returns (status, parsed_json_or_text). Raises OSError if unreachable."""
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
        return {"live": False, "reason": "No Nessie API key yet (add it to .env)"}
    ids = load_ids()
    if not ids:
        return {"live": False, "reason": "Nessie not seeded yet (run python tools/seed_nessie.py)"}
    try:
        status, _ = nessie_request("GET", f"accounts/{ids['accountId']}")
    except OSError as err:
        return {"live": False, "reason": f"Nessie unreachable ({err.__class__.__name__})"}
    if status != 200:
        return {"live": False, "reason": f"Nessie returned HTTP {status}"}
    return {"live": True, **ids}


def build_config():
    config = nessie_config()
    auth0 = auth0_config()
    if auth0:
        config["auth0"] = auth0
    return config


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def end_headers(self):
        # Always serve fresh files while editing during the hackathon.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        if self.path.startswith("/api/"):
            super().log_message(fmt, *args)

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
        if not parts.path.startswith("/api/nessie/"):
            return self.send_json(404, {"error": "Unknown API route"})
        if not API_KEY:
            return self.send_json(503, {"error": "No Nessie API key configured"})

        body = None
        length = int(self.headers.get("Content-Length") or 0)
        if length:
            try:
                body = json.loads(self.rfile.read(length))
            except ValueError:
                return self.send_json(400, {"error": "Body must be JSON"})

        path = parts.path[len("/api/nessie/"):]
        query = [(k, v) for k, v in parse_qsl(parts.query) if k != "key"]
        try:
            status, payload = nessie_request(method, path, body, query)
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
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
