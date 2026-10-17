"""Way B, the app version: recording → Whisper → Gemini, DIRECTLY (no files in between).

    .venv\\Scripts\\python.exe learn/voice_check.py learn/whisper/Recording.m4a
    .venv\\Scripts\\python.exe learn/voice_check.py learn/whisper/Recording.m4a --amount 1200

check_recording() is the function server.py will call later: the website records the
person, sends the audio, and gets back the transcript plus Gemini's verdict in one go.
The demo at the bottom also appends each result to learn/voice_checks.txt so you can
read what happened, but the handoff from Whisper to Gemini is a plain variable.
"""

import json
import sys
import time
from datetime import datetime
from pathlib import Path

# sys.path is the list of folders Python searches when you write `import something`.
# Our two halves live in different folders, so we add both before importing them.
LEARN = Path(__file__).resolve().parent
sys.path.insert(0, str(LEARN / "whisper"))
sys.path.insert(0, str(LEARN / "gemini"))

from gemini_client import MODEL, ModelChangeError  # noqa: E402
from rules_review import rules_review            # noqa: E402  offline backup: phrase rules
from step1b_scam_review import review_transfer  # noqa: E402  Gemini: text → JSON
from step2_transcribe import transcribe          # noqa: E402  Whisper: audio → text

LOG = LEARN / "voice_checks.txt"

# Safety switch: models to try, in order, when one is busy (HTTP 503/500/504).
# Your GEMINI_MODEL from .env.local goes first; dict.fromkeys() drops duplicates but keeps the order.
MODELS_TO_TRY = list(dict.fromkeys([MODEL, "gemini-flash-lite-latest", "gemini-3.5-flash"]))


def review_with_fallback(text, amount):
    """Ask Gemini, switching to the next model whenever one is busy. Returns (review, model used)."""
    for model in MODELS_TO_TRY:
        try:
            return review_transfer(text, amount, model), model
        except ModelChangeError as err:   # the "modelchange" signal from gemini_client.py
            print(f"   {model} is busy (HTTP {err.code}), trying the next model...")
    raise RuntimeError(f"Every Gemini model was busy: {', '.join(MODELS_TO_TRY)}. Try again in a minute.")


def review_text(text, amount):
    """Gemini (with the model switch) first; if Gemini can't be reached at all, the offline rules.

    RuntimeError = every model was busy. OSError = no internet or a timeout
    (urllib's URLError and TimeoutError are both kinds of OSError).
    Returns (review, who answered), so it's always honest about which one decided.
    """
    try:
        return review_with_fallback(text, amount)
    except (RuntimeError, OSError) as err:
        print(f"   Gemini unavailable ({err}), using the offline rules instead.")
        return rules_review(text, amount), "offline rules"


def check_recording(audio_path, amount):
    """Transcribe one recording and review it. Returns a dictionary the website can use."""
    started = time.time()
    text, _segments, _duration = transcribe(audio_path)   # Whisper
    whisper_seconds = time.time() - started

    started = time.time()
    review, model = review_text(text, amount)             # Gemini (or the rules), given the text directly
    gemini_seconds = time.time() - started

    return {
        "text": text,
        "review": review,
        "model": model,                                   # which model actually answered
        "seconds": {"whisper": round(whisper_seconds, 1), "gemini": round(gemini_seconds, 1)},
    }


def add_to_log(audio_path, amount, result):
    """Append one result to voice_checks.txt, only so you can see what happened."""
    lines = [
        f"=== {Path(audio_path).name} ===",
        f"Checked: {datetime.now():%Y-%m-%d %H:%M:%S}   Amount: ${amount}",
        json.dumps(result, indent=2),
        "",
    ]
    with LOG.open("a", encoding="utf-8") as file:
        file.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:]]
    amount = 500
    if "--amount" in args:
        i = args.index("--amount")
        amount = int(args[i + 1])
        del args[i:i + 2]
    if not args:
        sys.exit("Give a recording: .venv\\Scripts\\python.exe learn/voice_check.py learn/whisper/Recording.m4a")
    audio_path = args[0]

    print(f"Checking {audio_path} for a ${amount} transfer...\n")
    result = check_recording(audio_path, amount)
    review = result["review"]

    print(f"1. Whisper heard ({result['seconds']['whisper']}s):  {result['text']}")
    print(f"2. Gemini ({result['model']}) decided ({result['seconds']['gemini']}s):  risk = {review['risk']}, scam = {review['scamType']}")
    for reason in review["reasons"]:
        print(f"     - {reason}")
    print(f"3. Would be read aloud:  {review['spokenWarning']}")

    if review["risk"] == "high":
        print("\n🚨 The app would PAUSE this transfer.")
    elif review["risk"] == "medium":
        print("\n⚠️  The app would ask a follow-up question.")
    else:
        print("\n✅ The app would continue to the key tap.")

    add_to_log(audio_path, amount, result)
    print(f"\nSaved to {LOG.relative_to(LEARN.parent)}")
