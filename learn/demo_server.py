"""Troubleshooting demo: a small local web page to test voice → Whisper → Gemini step by step.

    .venv\\Scripts\\python.exe learn/demo_server.py
    then open http://localhost:8001 in Chrome or Edge

The page can record your voice, upload a recording, or skip Whisper and send typed text.
It can also SIMULATE problems (first model busy, no internet) so you can watch the
safety switch and the offline backup work. It shows each stage's result, timing, the
server's log lines and the full error if something breaks.

Uses port 8001 so it doesn't clash with the QuackTag site (server.py, port 8000).
"""

import contextlib
import io
import json
import subprocess
import sys
import threading
import time
import traceback
import urllib.error
import urllib.request
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

LEARN = Path(__file__).resolve().parent
sys.path.insert(0, str(LEARN))

import voice_check  # noqa: E402  (sets up the whisper/ and gemini/ imports, loads the key)

PORT = 8001
RECORDINGS = LEARN / "demo_recordings"     # every recording sent from the page is kept here
EXTENSIONS = {"audio/webm": ".webm", "audio/ogg": ".ogg", "audio/wav": ".wav", "audio/x-wav": ".wav",
              "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/x-m4a": ".m4a"}
REAL_URLOPEN = urllib.request.urlopen
LOCK = threading.Lock()  # one check at a time: simulations swap a shared function, and Whisper is heavy


# ---------------------------------------------------------------------------
# Simulations: temporarily replace the internet call, like demo_check.py does.
# ---------------------------------------------------------------------------

def simulated_urlopen(mode):
    """Return a replacement for urlopen that fakes a problem, or None for the real internet."""
    if mode == "first-busy":
        busy = voice_check.MODELS_TO_TRY[0]

        def urlopen(request, timeout=30):
            if f"models/{busy}:" in request.full_url:
                raise urllib.error.HTTPError(request.full_url, 503, "simulated busy", {}, io.BytesIO(b"{}"))
            return REAL_URLOPEN(request, timeout=timeout)   # other models use the real internet
        return urlopen
    if mode == "all-busy":
        def urlopen(request, timeout=30):
            raise urllib.error.HTTPError(request.full_url, 503, "simulated busy", {}, io.BytesIO(b"{}"))
        return urlopen
    if mode == "offline":
        def urlopen(request, timeout=30):
            raise urllib.error.URLError("no internet (simulated)")
        return urlopen
    return None


def run_check(text=None, audio_bytes=None, content_type="", amount=500, simulate="none"):
    """Run the pipeline and report every stage. Prints are captured so the page can show them."""
    report = {"ok": False, "simulate": simulate, "amount": amount, "stages": {}, "log": "", "error": None}
    captured = io.StringIO()
    fake = simulated_urlopen(simulate)
    with LOCK, contextlib.redirect_stdout(captured):
        try:
            # Stage 1: Whisper (skipped when text was typed)
            if audio_bytes is not None:
                RECORDINGS.mkdir(exist_ok=True)
                ext = EXTENSIONS.get(content_type.split(";")[0].strip(), ".webm")
                path = RECORDINGS / f"demo_{datetime.now():%Y%m%d_%H%M%S}{ext}"
                path.write_bytes(audio_bytes)
                print(f"Saved recording to {path.relative_to(LEARN.parent)} ({len(audio_bytes):,} bytes)")
                started = time.time()
                text, segments, duration = voice_check.transcribe(str(path))
                report["stages"]["whisper"] = {
                    "text": text, "seconds": round(time.time() - started, 1), "audioSeconds": round(duration, 1),
                    "file": str(path.relative_to(LEARN.parent)),
                    "segments": [f"[{s:.1f}s → {e:.1f}s] {t}" for s, e, t in segments],
                }
                print(f"Whisper heard: {text}")
                if not text.strip():
                    raise ValueError("Whisper heard nothing. Is the microphone muted, or the recording silent?")
            else:
                report["stages"]["whisper"] = {"skipped": "typed text"}
                print(f"Typed text: {text}")

            # Stage 2: Gemini (with the model switch and the offline backup)
            if fake:
                urllib.request.urlopen = fake
                print(f"Simulating: {simulate}")
            try:
                started = time.time()
                review, model = voice_check.review_text(text, amount)
            finally:
                urllib.request.urlopen = REAL_URLOPEN   # always put the real internet back
            report["stages"]["gemini"] = {"model": model, "review": review, "seconds": round(time.time() - started, 1)}
            print(f"Answered by {model}: risk {review['risk']}")
            report["ok"] = True
        except BaseException as err:  # includes SystemExit (e.g. HTTP 403 from a bad key) so the server keeps running
            report["error"] = "".join(traceback.format_exception(err))
            print(f"ERROR: {type(err).__name__}: {err}")
    report["log"] = captured.getvalue()
    sys.stdout.write(report["log"])  # also show it in the terminal running the server
    add_to_log(report, text)
    return report


def add_to_log(report, text):
    """Append each check to learn/voice_checks.txt, like voice_check.py does."""
    gemini = report["stages"].get("gemini", {})
    lines = [
        f"=== demo page ({'recording' if 'text' in report['stages'].get('whisper', {}) else 'typed text'}) ===",
        f"Checked: {datetime.now():%Y-%m-%d %H:%M:%S}   Amount: ${report['amount']}   Simulate: {report['simulate']}",
        f"Text: {text}",
        f"Answered by: {gemini.get('model', '-')}",
        json.dumps(gemini.get("review"), indent=2) if gemini else f"ERROR:\n{report['error']}",
        "",
    ]
    with voice_check.LOG.open("a", encoding="utf-8") as file:
        file.write("\n".join(lines) + "\n")


def log_customer_service(reason, text):
    """Customer service is DEMO ONLY: nothing is called. We just record that it was asked for."""
    lines = [
        "=== customer service request (demo only, no call made) ===",
        f"Requested: {datetime.now():%Y-%m-%d %H:%M:%S}   Why: {reason}",
        f"Text: {text or '-'}",
        "",
    ]
    with voice_check.LOG.open("a", encoding="utf-8") as file:
        file.write("\n".join(lines) + "\n")
    print(f"Customer service requested ({reason}). Demo only: no call made.")
    return {"ok": True, "connected": False, "message": "Customer service isn't connected in this demo. No call was made."}


def run_self_check(offline):
    """Run demo_check.py in a separate Python process and return its output."""
    args = [sys.executable, str(LEARN / "demo_check.py")] + (["--offline"] if offline else [])
    done = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600)
    lines = [l for l in (done.stdout + done.stderr).splitlines() if "huggingface" not in l and "warnings.warn" not in l]
    return {"output": "\n".join(lines)}


# ---------------------------------------------------------------------------
# The web server: serves demo.html and its API routes.
# ---------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    def send_json(self, payload, status=200):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path in ("/", "/demo.html"):
            body = (LEARN / "demo.html").read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
        elif path == "/api/info":
            self.send_json({"models": voice_check.MODELS_TO_TRY})
        else:
            self.send_json({"error": "not found"}, 404)

    def do_POST(self):
        parts = urlsplit(self.path)
        query = parse_qs(parts.query)
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        content_type = self.headers.get("Content-Type", "")

        if parts.path == "/api/voice-check":
            amount = int(query.get("amount", ["500"])[0])
            simulate = query.get("simulate", ["none"])[0]
            if content_type.startswith("application/json"):
                text = json.loads(body or b"{}").get("text", "").strip()
                if not text:
                    return self.send_json({"ok": False, "error": "Type some text first.", "stages": {}, "log": ""})
                return self.send_json(run_check(text=text, amount=amount, simulate=simulate))
            if not body:
                return self.send_json({"ok": False, "error": "The recording was empty.", "stages": {}, "log": ""})
            return self.send_json(run_check(audio_bytes=body, content_type=content_type, amount=amount, simulate=simulate))

        if parts.path == "/api/self-check":
            return self.send_json(run_self_check(offline=query.get("offline", ["1"])[0] == "1"))

        if parts.path == "/api/customer-service":
            data = json.loads(body or b"{}")
            return self.send_json(log_customer_service(data.get("reason", "unknown"), data.get("text", "")))

        self.send_json({"error": "not found"}, 404)

    def log_message(self, fmt, *args):  # keep the terminal quiet except for our own prints
        pass


if __name__ == "__main__":
    print(f"Voice demo running at http://localhost:{PORT}  (Ctrl+C to stop)")
    import step2_transcribe
    step2_transcribe.load_model()  # load Whisper now, so the first check from the page is fast
    print("Ready. Open the page in Chrome or Edge.")
    try:
        ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
