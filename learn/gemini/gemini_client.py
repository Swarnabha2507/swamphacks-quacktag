"""The reusable parts of step 1: load the key and send a request to Gemini.

Step 1 had these inline so you could read everything in one file. From step 1b on,
other scripts import them instead of copying them:

    from gemini_client import call_gemini, MODEL
"""

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[2]
BASE_URL = "https://generativelanguage.googleapis.com/v1beta"

sys.stdout.reconfigure(encoding="utf-8")


def load_settings():
    settings = {}
    for name in (".env", ".env.local"):
        path = PROJECT / name
        if path.exists():
            for line in path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    settings[key.strip()] = value.strip()
    return settings


settings = load_settings()
API_KEY = settings.get("GEMINI_API_KEY", "")
MODEL = settings.get("GEMINI_MODEL", "gemini-flash-latest")

if not API_KEY or API_KEY == "paste-your-key-here":
    sys.exit("No Gemini key yet. Paste yours into .env.local (GEMINI_API_KEY=...).")


# 5xx codes mean "Google's side is busy or broken right now", so another model may work.
# 4xx codes (bad key, bad request, unknown model) would fail on every model, so we stop.
MODEL_CHANGE_CODES = (503, 500, 504)


class ModelChangeError(Exception):
    """Raised when this model is busy or down, meaning: try a different model.

    `raise` needs an exception object (not True/False), so this class is our
    "modelchange" signal. It travels up to whoever called call_gemini().
    """

    def __init__(self, code):
        super().__init__(f"Gemini model busy or down (HTTP {code})")
        self.code = code


def call_gemini(method, path, body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(f"{BASE_URL}/{path}", data=data, method=method)
    request.add_header("x-goog-api-key", API_KEY)
    request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as err:
        if err.code in MODEL_CHANGE_CODES:
            raise ModelChangeError(err.code) from err  # caller can switch models
        sys.exit(f"Gemini answered with an error: HTTP {err.code}\n{err.read().decode('utf-8', 'replace')}")
