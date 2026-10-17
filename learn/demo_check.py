"""Self-check: test every piece of the voice → Whisper → Gemini pipeline and report what works.

    .venv\\Scripts\\python.exe learn/demo_check.py             # everything (uses 3 Gemini requests)
    .venv\\Scripts\\python.exe learn/demo_check.py --offline   # skip the live Gemini checks (0 requests)

Each check prints PASS, FAIL or SKIP with a short reason, and the whole report is
appended to learn/demo_report.txt so you can compare runs.
"""

import io
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

LEARN = Path(__file__).resolve().parent
sys.path.insert(0, str(LEARN))
sys.path.insert(0, str(LEARN / "whisper"))
sys.path.insert(0, str(LEARN / "gemini"))
sys.stdout.reconfigure(encoding="utf-8")

REPORT = LEARN / "demo_report.txt"
SCAM = "My grandson called crying. He is in jail and needs bail money, and he told me not to tell his parents."
NORMAL = "Paying Jordan back for the concert tickets he bought us last week."
OFFLINE = "--offline" in sys.argv

results = []  # (status, name, detail)


def check(name, test):
    """Run one test function. It returns a detail string (PASS), or raises AssertionError (FAIL)."""
    try:
        detail = test()
        results.append(("PASS", name, detail))
    except AssertionError as err:
        results.append(("FAIL", name, str(err)))
    except Exception as err:  # any other crash also counts as a failure, with its type
        results.append(("FAIL", name, f"{type(err).__name__}: {err}"))
    status, _, detail = results[-1]
    print(f"[{status}] {name}: {detail}")


def skip(name, why):
    results.append(("SKIP", name, why))
    print(f"[SKIP] {name}: {why}")


def fake_urlopen(behaviour):
    """Replace the real internet call. behaviour(model) returns an HTTP code to fail with, an exception, or None."""
    answer = {"risk": "high", "scamType": "grandparent scam", "reasons": ["test"], "spokenWarning": "test"}
    body = json.dumps({"candidates": [{"content": {"parts": [{"text": json.dumps(answer)}]}}]}).encode()

    class FakeResponse(io.BytesIO):
        def __enter__(self): return self
        def __exit__(self, *args): pass

    def urlopen(request, timeout=30):
        model = request.full_url.split("models/")[1].split(":")[0]
        outcome = behaviour(model)
        if isinstance(outcome, int):
            raise urllib.error.HTTPError(request.full_url, outcome, "fake", {}, io.BytesIO(b"{}"))
        if isinstance(outcome, Exception):
            raise outcome
        return FakeResponse(body)
    return urlopen


# ---------------------------------------------------------------------------
print(f"QuackTag voice check self-test ({'offline' if OFFLINE else 'live'}), {datetime.now():%Y-%m-%d %H:%M:%S}\n")


def packages():
    import av
    import faster_whisper
    assert av.__version__ == "16.1.0", f"PyAV is {av.__version__}, needs 16.1.0 (pip install av==16.1.0)"
    return f"faster-whisper {faster_whisper.__version__}, PyAV {av.__version__}, Python {sys.version.split()[0]}"


check("1. Python packages", packages)

voice_check = None
try:
    import voice_check  # also loads the Gemini key; exits if it's missing
    check("2. Gemini key", lambda: "found in .env.local (not shown)")
except SystemExit as err:
    results.append(("FAIL", "2. Gemini key", str(err)))
    print(f"[FAIL] 2. Gemini key: {err}")


def whisper_sample():
    from step2_transcribe import transcribe
    text, _, duration = transcribe(str(LEARN / "whisper" / "sample.wav"))
    assert "grandson" in text.lower() and "bail" in text.lower(), f"unexpected text: {text!r}"
    return f'heard "{text}" ({duration:.1f}s of audio)'


check("3. Whisper transcribes sample.wav", whisper_sample)


def offline_rules():
    from rules_review import rules_review
    scam, normal = rules_review(SCAM, 500), rules_review(NORMAL, 500)
    assert scam["risk"] == "high", f"scam sentence got risk={scam['risk']}"
    assert normal["risk"] == "low", f"normal sentence got risk={normal['risk']}"
    return f"scam → high ({', '.join(scam['reasons'])}), normal → low"


check("4. Offline rules (backup)", offline_rules)

if voice_check:
    real_urlopen = urllib.request.urlopen

    def model_switch():
        busy = voice_check.MODELS_TO_TRY[0]
        urllib.request.urlopen = fake_urlopen(lambda model: 503 if model == busy else None)
        try:
            _, model = voice_check.review_text(SCAM, 500)
        finally:
            urllib.request.urlopen = real_urlopen   # always put the real internet back
        assert model == voice_check.MODELS_TO_TRY[1], f"answered by {model}"
        return f"{busy} returned 503 (simulated) → {model} answered"

    check("5. Model switch on 503", model_switch)

    def no_internet():
        urllib.request.urlopen = fake_urlopen(lambda model: urllib.error.URLError("no internet (simulated)"))
        try:
            review, model = voice_check.review_text(SCAM, 500)
        finally:
            urllib.request.urlopen = real_urlopen
        assert model == "offline rules", f"answered by {model}"
        assert review["risk"] == "high", f"risk={review['risk']}"
        return "no internet (simulated) → offline rules answered, risk high"

    check("6. Backup when Gemini is unreachable", no_internet)

    if OFFLINE:
        for name in ("7. Gemini flags a scam", "8. Gemini passes a normal payment", "9. Full voice check on Recording.m4a"):
            skip(name, "--offline")
    else:
        def gemini_scam():
            review, model = voice_check.review_text(SCAM, 500)
            assert model != "offline rules", "Gemini couldn't be reached; the offline rules answered instead"
            assert review["risk"] == "high", f"risk={review['risk']} ({review['scamType']})"
            return f"{model}: risk high, {review['scamType']}"

        def gemini_normal():
            review, model = voice_check.review_text(NORMAL, 500)
            assert model != "offline rules", "Gemini couldn't be reached; the offline rules answered instead"
            assert review["risk"] == "low", f"risk={review['risk']} ({review['reasons']})"
            return f"{model}: risk low"

        def full_check():
            recording = LEARN / "whisper" / "Recording.m4a"
            assert recording.exists(), "learn/whisper/Recording.m4a not found"
            result = voice_check.check_recording(str(recording), 500)
            assert result["model"] != "offline rules", "Gemini couldn't be reached; the offline rules answered instead"
            assert result["review"]["risk"] in ("high", "medium"), f"risk={result['review']['risk']}"
            return (f'heard "{result["text"]}" → {result["model"]}: risk {result["review"]["risk"]} '
                    f'(Whisper {result["seconds"]["whisper"]}s, Gemini {result["seconds"]["gemini"]}s)')

        check("7. Gemini flags a scam", gemini_scam)
        check("8. Gemini passes a normal payment", gemini_normal)
        check("9. Full voice check on Recording.m4a", full_check)
else:
    for name in ("5. Model switch on 503", "6. Backup when Gemini is unreachable", "7. Gemini flags a scam",
                 "8. Gemini passes a normal payment", "9. Full voice check on Recording.m4a"):
        skip(name, "needs the Gemini key (check 2)")

# ---------------------------------------------------------------------------
counts = {s: sum(1 for r in results if r[0] == s) for s in ("PASS", "FAIL", "SKIP")}
summary = f"{counts['PASS']} passed, {counts['FAIL']} failed, {counts['SKIP']} skipped"
print(f"\n{summary}")
if counts["FAIL"]:
    print("❌ Fix the FAIL lines above before the demo.")
elif counts["SKIP"]:
    print("✅ Everything tested works. Run without --offline to also test live Gemini.")
else:
    print("✅ Ready to demo.")

with REPORT.open("a", encoding="utf-8") as file:
    file.write(f"=== {datetime.now():%Y-%m-%d %H:%M:%S} ({'offline' if OFFLINE else 'live'}) ===\n")
    file.writelines(f"[{status}] {name}: {detail}\n" for status, name, detail in results)
    file.write(f"{summary}\n\n")
print(f"Saved to {REPORT.relative_to(LEARN.parent)}")
