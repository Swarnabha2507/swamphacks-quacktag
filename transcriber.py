"""Speech to text with Whisper (faster-whisper), running on this computer.

Optional: it only works when the server runs from the virtual environment that has
faster-whisper installed (see learn/README.md):

    .venv\\Scripts\\python.exe server.py

With plain `py server.py`, available() is False and the website hides the 🎤 button.
Built from learn/whisper/step2_transcribe.py.

Try it without the website:
    .venv\\Scripts\\python.exe transcriber.py learn/whisper/sample.wav
"""

import os
import sys
import tempfile
import threading

MODEL_SIZE = "base.en"  # tiny.en = fastest, base.en = balanced, small.en = more accurate but slower

try:
    from faster_whisper import WhisperModel
except ImportError:      # plain `py server.py`: no voice, everything else still works
    WhisperModel = None

_model = None
_lock = threading.Lock()  # the server handles requests in threads; Whisper runs one at a time


def available():
    return WhisperModel is not None


def _load():
    global _model
    if _model is None:
        _model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")
    return _model


def warm_up():
    """Load the model now (slow the first time) so the first recording is fast."""
    if available():
        with _lock:
            _load()


def transcribe_file(path):
    """Audio file → (text, seconds of audio)."""
    if not available():
        raise RuntimeError("Voice isn't set up: run the server with .venv\\Scripts\\python.exe")
    with _lock:
        segments, info = _load().transcribe(str(path), beam_size=5)
        text = " ".join(segment.text.strip() for segment in segments)
    return text.strip(), info.duration


def transcribe_bytes(data, suffix=".webm"):
    """A recording sent by the browser → (text, seconds of audio). Uses a temporary file."""
    handle, path = tempfile.mkstemp(suffix=suffix)
    try:
        with os.fdopen(handle, "wb") as file:
            file.write(data)
        return transcribe_file(path)
    finally:
        os.remove(path)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    if not available():
        sys.exit("faster-whisper isn't installed here. Run with .venv\\Scripts\\python.exe")
    audio = sys.argv[1] if len(sys.argv) > 1 else "learn/whisper/sample.wav"
    text, seconds = transcribe_file(audio)
    print(f"{seconds:.1f}s of audio → {text}")
