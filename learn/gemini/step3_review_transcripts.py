"""Step 3 (Way A): connect Whisper and Gemini THROUGH FILES.

    learn/whisper/transcripts.txt  ──▶  this script  ──▶  learn/gemini/reviews.txt
       (written by step 2)              sends each new        (Gemini's JSON answer
                                        "Text:" to Gemini      for each recording)

    .venv\\Scripts\\python.exe learn/gemini/step3_review_transcripts.py
    .venv\\Scripts\\python.exe learn/gemini/step3_review_transcripts.py --amount 1200

Gemini never sees the file: we read the sentence out of it and send only the text.
Recordings already in reviews.txt are skipped, so it's safe to run again.
"""

import json
import sys
from datetime import datetime
from pathlib import Path

from gemini_client import MODEL
from step1b_scam_review import review_transfer  # works because step 1b's demo is under __main__

FOLDER = Path(__file__).resolve().parent                     # learn/gemini/
TRANSCRIPTS = FOLDER.parent / "whisper" / "transcripts.txt"  # learn/whisper/transcripts.txt
REVIEWS = FOLDER / "reviews.txt"


def read_transcripts():
    """Read transcripts.txt and return [(recording name, text), ...] in the order they were added."""
    if not TRANSCRIPTS.exists():
        return []
    entries = []
    name = None
    for line in TRANSCRIPTS.read_text(encoding="utf-8").splitlines():
        if line.startswith("=== "):           # "=== Recording.m4a ===" starts a new entry
            name = line.removeprefix("=== ").removesuffix(" ===")
        elif line.startswith("Text: ") and name:
            entries.append((name, line.removeprefix("Text: ")))
    return entries


def already_reviewed():
    """Return the recording names that are already in reviews.txt."""
    if not REVIEWS.exists():
        return set()
    return {
        line.removeprefix("=== ").removesuffix(" ===")
        for line in REVIEWS.read_text(encoding="utf-8").splitlines()
        if line.startswith("=== ")
    }


def add_to_reviews(name, text, amount, review):
    """Append one entry to the bottom of reviews.txt ("a" = append, keep the history)."""
    lines = [
        f"=== {name} ===",
        f"Reviewed: {datetime.now():%Y-%m-%d %H:%M:%S}   Amount: ${amount}   Model: {MODEL}",
        f"Sent to Gemini: {text}",
        "Gemini answered:",
        json.dumps(review, indent=2),
        "",
    ]
    with REVIEWS.open("a", encoding="utf-8") as file:
        file.write("\n".join(lines) + "\n")


def review_new_transcripts(amount):
    """Send every transcript that isn't reviewed yet to Gemini, and save each answer."""
    done = already_reviewed()
    new = [(name, text) for name, text in read_transcripts() if name not in done]
    for name, text in new:
        print(f"\nReviewing {name}: \"{text}\"")
        review = review_transfer(text, amount)   # ← the handoff: text from the file → Gemini
        add_to_reviews(name, text, amount, review)
        print(f"  → risk: {review['risk']}   scam: {review['scamType']}")
        print(f"  Added to {REVIEWS.name}")
    return len(new)


if __name__ == "__main__":
    amount = 500
    if "--amount" in sys.argv:
        amount = int(sys.argv[sys.argv.index("--amount") + 1])

    if not TRANSCRIPTS.exists():
        sys.exit(f"No {TRANSCRIPTS.name} yet. Run step 2 first: .venv\\Scripts\\python.exe learn/whisper/step2_transcribe.py")

    count = review_new_transcripts(amount)
    print(f"\nDone: {count} new review(s)." if count else f"Nothing new: every transcript is already in {REVIEWS.name}.")
