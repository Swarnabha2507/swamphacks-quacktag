"""Step 1: send one message to Gemini and print its reply.

    py learn/gemini/step1_hello_gemini.py                 # ask the default question
    py learn/gemini/step1_hello_gemini.py "your question"  # ask your own
    py learn/gemini/step1_hello_gemini.py --models         # list models your key can use

Only uses Python's standard library: no pip install needed.
"""

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

# ---------------------------------------------------------------------------
# PART 1: Load the API key.
# The key is a password that tells Google "this request is from Diego's account".
# It lives in .env.local (git-ignored) so it never ends up on GitHub.
# ---------------------------------------------------------------------------

PROJECT = Path(__file__).resolve().parents[2]  # the swamphacks-swamptag folder

# Windows terminals don't always expect UTF-8, so characters like "—" print as "�".
sys.stdout.reconfigure(encoding="utf-8")


def load_settings():
    settings = {}
    for name in (".env", ".env.local"):  # .env.local wins because it's read last
        path = PROJECT / name
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                settings[key.strip()] = value.strip()
    return settings


settings = load_settings()
API_KEY = settings.get("GEMINI_API_KEY", "")
MODEL = settings.get("GEMINI_MODEL", "gemini-2.5-flash")
BASE_URL = "https://generativelanguage.googleapis.com/v1beta"

if not API_KEY or API_KEY == "paste-your-key-here":
    print("No Gemini key yet. Paste yours into .env.local (GEMINI_API_KEY=...).")
    print("Get one free at https://aistudio.google.com/apikey")
    sys.exit(1)


# ---------------------------------------------------------------------------
# PART 2: Send an HTTP request.
# An "API call" is just your program visiting a URL, like a browser does,
# but sending and receiving JSON (structured text) instead of a web page.
# ---------------------------------------------------------------------------

def call_gemini(method, path, body=None):
    url = f"{BASE_URL}/{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(url, data=data, method=method)
    request.add_header("x-goog-api-key", API_KEY)       # who we are
    request.add_header("Content-Type", "application/json")  # what we're sending
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as err:
        # Google explains what went wrong in the response body, so show it.
        print(f"Gemini answered with an error: HTTP {err.code}")
        print(err.read().decode("utf-8", "replace"))
        sys.exit(1)


# ---------------------------------------------------------------------------
# PART 3: Use it.
# ---------------------------------------------------------------------------

if "--models" in sys.argv:
    # GET /models returns every model this key can use.
    result = call_gemini("GET", "models")
    for model in result.get("models", []):
        if "generateContent" in model.get("supportedGenerationMethods", []):
            print(model["name"].removeprefix("models/"))
    sys.exit(0)

question = " ".join(sys.argv[1:]) or "In one sentence, what is a grandparent scam?"

# This is the shape Gemini expects: a list of "contents", each with "parts" of text.
body = {"contents": [{"parts": [{"text": question}]}]}

print(f"Asking {MODEL}: {question}\n")
result = call_gemini("POST", f"models/{MODEL}:generateContent", body)

# The reply is nested: candidates → first candidate → content → parts → text.
answer = result["candidates"][0]["content"]["parts"][0]["text"]
print(answer)
