"""Step 2: turn every voice recording in learn/whisper/ into text with Whisper.

Drop recordings (.m4a, .wav, .mp3, .webm, .ogg) into learn/whisper/, then run:

    .venv\\Scripts\\python.exe learn/whisper/step2_transcribe.py           # transcribe new recordings once
    .venv\\Scripts\\python.exe learn/whisper/step2_transcribe.py --watch   # keep running, pick up new ones as you add them

Every transcription is ADDED to the bottom of learn/whisper/transcripts.txt, with the
time, file name, length and each segment, so the file is a running history.
Recordings already in that file are skipped.

The first run downloads the Whisper model (about 150 MB). After that it works offline.
"""

import sys
import time
from datetime import datetime
from pathlib import Path

from faster_whisper import WhisperModel

sys.stdout.reconfigure(encoding="utf-8")

FOLDER = Path(__file__).resolve().parent              # learn/whisper/
TRANSCRIPTS = FOLDER / "transcripts.txt"
AUDIO_TYPES = {".m4a", ".wav", ".mp3", ".webm", ".ogg"}
MODEL_SIZE = "base.en"  # tiny.en = fastest, base.en = balanced, small.en = more accurate but slower
WATCH_EVERY_SECONDS = 3

_model = None  # loaded the first time we need it, then reused


def load_model():
    """Load Whisper's "brain" (a big file of trained numbers). Only done once per run, because it's slow."""
    global _model
    if _model is None:
        print(f"Loading Whisper model '{MODEL_SIZE}'...")
        started = time.time()
        # device="cpu": use the processor. compute_type="int8": smaller numbers → faster, less memory.
        _model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")
        print(f"Loaded in {time.time() - started:.1f}s")
    return _model


def already_transcribed():
    """Read transcripts.txt and return the names of recordings it already contains."""
    if not TRANSCRIPTS.exists():
        return set()
    names = set()
    for line in TRANSCRIPTS.read_text(encoding="utf-8").splitlines():
        if line.startswith("=== "):               # each entry starts with "=== <file name> ==="
            names.add(line.removeprefix("=== ").removesuffix(" ==="))
    return names


def find_new_recordings():
    """List audio files in the folder that aren't in transcripts.txt yet."""
    done = already_transcribed()
    new = []
    for path in sorted(FOLDER.iterdir()):
        if path.suffix.lower() not in AUDIO_TYPES or path.name in done:
            continue
        if time.time() - path.stat().st_mtime < 2:  # still being copied or saved: try again next time
            continue
        new.append(path)
    return new


def transcribe(path):
    """Run Whisper on one recording. Returns (full text, list of segments, audio length in seconds)."""
    segments, info = load_model().transcribe(str(path), beam_size=5)
    # beam_size=5: compare 5 possible wordings and keep the most likely one.
    # `segments` is a generator: Whisper actually listens while we loop over it.
    pieces = []
    for segment in segments:
        pieces.append((segment.start, segment.end, segment.text.strip()))
    full_text = " ".join(text for _, _, text in pieces)
    return full_text, pieces, info.duration


def add_to_transcripts(path, full_text, pieces, duration, seconds_taken):
    """Append one entry to the bottom of transcripts.txt ("a" = append, never overwrite)."""
    lines = [
        f"=== {path.name} ===",
        f"Transcribed: {datetime.now():%Y-%m-%d %H:%M:%S}   Length: {duration:.1f}s   "
        f"Took: {seconds_taken:.1f}s   Model: {MODEL_SIZE}",
    ]
    lines += [f"  [{start:5.1f}s → {end:5.1f}s] {text}" for start, end, text in pieces]
    lines += [f"Text: {full_text}", ""]
    with TRANSCRIPTS.open("a", encoding="utf-8") as file:
        file.write("\n".join(lines) + "\n")


def process_new_recordings():
    """Transcribe every new recording and add each one to transcripts.txt. Returns how many were done."""
    new = find_new_recordings()
    for path in new:
        print(f"\nTranscribing {path.name}...")
        started = time.time()
        full_text, pieces, duration = transcribe(path)
        add_to_transcripts(path, full_text, pieces, duration, time.time() - started)
        print(f"  → {full_text}")
        print(f"  Added to {TRANSCRIPTS.name}")
    return len(new)


if __name__ == "__main__":
    if "--watch" in sys.argv:
        print(f"Watching {FOLDER} for new recordings (Ctrl+C to stop)...")
        try:
            while True:
                process_new_recordings()
                time.sleep(WATCH_EVERY_SECONDS)
        except KeyboardInterrupt:
            print("\nStopped watching.")
    else:
        count = process_new_recordings()
        print(f"\nDone: {count} new recording(s)." if count else f"No new recordings. Everything is already in {TRANSCRIPTS.name}.")
