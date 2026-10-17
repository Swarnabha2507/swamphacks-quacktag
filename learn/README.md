# Voice → Whisper → Gemini scam check (learning folder)

Step-by-step scripts that build the voice scam check, plus the two app modules made from them.

## The pipeline
```
🎤 recording ─▶ Whisper (on this computer) ─▶ text ─▶ Gemini (scam review, JSON) ─▶ 🔊 warning read aloud
                                                         └─ busy/slow model → next model
                                                         └─ no Gemini at all → offline phrase rules
```

## Setup (once)
```bash
py -3.12 -m venv .venv
.venv\Scripts\python.exe -m pip install -r learn/requirements.txt
```
- Put your Gemini key in **`.env.local`** (git-ignored on your computer): `GEMINI_API_KEY=...`. Get one at https://aistudio.google.com/apikey.
- Whisper needs `.venv` (Python 3.12). The Gemini parts use only Python's standard library, so plain `py` works for them.

## App modules (repo root)
| File | What it does | Try it |
|---|---|---|
| `scam_review.py` | `review(amount, explanation, reason_label, kind, payee)` → `{risk, scamType, reasons, spokenWarning, answeredBy, note}`. Gemini with a model switch (503/500/504 or no answer in 15 s → next model), then offline rules. Never crashes the caller. | `py scam_review.py "A man from the IRS told me to buy gift cards"` (add `--offline` to skip Gemini) |
| `transcriber.py` | `available()`, `transcribe_bytes(data, suffix)`, `transcribe_file(path)`. Optional: off when faster-whisper isn't installed. | `.venv\Scripts\python.exe transcriber.py learn/whisper/sample.wav` |

## Learning steps (`learn/`)
| Step | File | Run |
|---|---|---|
| 1 | `gemini/step1_hello_gemini.py`: first API call | `py learn/gemini/step1_hello_gemini.py` |
| 1b | `gemini/step1b_scam_review.py`: JSON answers with a schema | `py learn/gemini/step1b_scam_review.py "..."` |
| 2 | `whisper/step2_transcribe.py`: recordings → `transcripts.txt` (`--watch` for new files) | `.venv\Scripts\python.exe learn/whisper/step2_transcribe.py` |
| 3 | `gemini/step3_review_transcripts.py`: Way A, through files → `reviews.txt` | `.venv\Scripts\python.exe learn/gemini/step3_review_transcripts.py` |
| B | `voice_check.py`: Way B, direct, with model switch and offline backup | `.venv\Scripts\python.exe learn/voice_check.py learn/whisper/sample.wav` |
| ✓ | `demo_check.py`: self-check, PASS / FAIL / SKIP | `.venv\Scripts\python.exe learn/demo_check.py --offline` |
| 🖥 | `demo_server.py` + `demo.html`: troubleshooting page on port 8001 | `.venv\Scripts\python.exe learn/demo_server.py` |

`QUIZ.md` has short questions on everything here.

## Not in git
Personal files stay on your computer only: `.env.local`, `.venv/`, your own recordings (`whisper/Recording*.m4a`, `demo_recordings/`) and the run logs (`transcripts.txt`, `reviews.txt`, `voice_checks.txt`, `demo_report.txt`). `whisper/sample.wav` is a computer-generated voice and is included for tests.
