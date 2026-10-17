# SwampTag self-quiz

Short questions on everything we've built so far. Try to answer out loud or on paper first, then click **Answer** to check.
New sections get added as we build more.

---

## 1. The big picture

**1.1** What problem does the SwampTag key fob solve? Who has the card and PIN, and why does that matter?
<details><summary>Answer</summary>
A thief can copy a debit card with a skimmer and watch you type your PIN. The fob is a third thing they don't have, so risky payments stay blocked until the real owner taps it.
</details>

**1.2** The Arduino reads a tag. Who decides whether it's the *right* key: the Arduino or the website?
<details><summary>Answer</summary>
The website. The Arduino only reports `TAG:<id>` and shows what it's told (`OK`/`DENY`). Keeping decisions in one place (the website) keeps the hardware simple.
</details>

**1.3** Why does `server.py` sit between the browser and the Nessie bank API, instead of the browser calling Nessie directly?
<details><summary>Answer</summary>
To keep the API key secret. The server adds the key to each request, so it never reaches the browser, where anyone could see it.
</details>

---

## 2. Tap limit

**2.1** With the tap limit at $200, which of these need a tap: a $200 purchase, a $201 purchase, a $25 transfer?
<details><summary>Answer</summary>
Only the $201 purchase. "At or under" the limit skips the tap (`amount > tapLimit` is the rule), and transfers follow the same limit.
</details>

**2.2** Where is the tap limit saved, and what happens to it when you press **Reset demo**?
<details><summary>Answer</summary>
In the browser's `localStorage` (`Store.state.tapLimit`). Reset demo puts it back to the default, $200.
</details>

**2.3** "New merchant" and "96 mi from home" still show up on the tap screen. Do they decide whether a tap is needed?
<details><summary>Answer</summary>
No. Only the amount decides. Those reasons just explain why the payment looks unusual.
</details>

---

## 3. Hardware and serial

**3.1** Name the four messages the website can send to the reader, and what each one shows.
<details><summary>Answer</summary>
`WAIT` (waiting for a tap), `OK` (approved), `DENY` (blocked), `IDLE` (back to resting).
</details>

**3.2** What does "serial port busy" mean, and the two most common causes?
<details><summary>Answer</summary>
Another program already has the USB port open, and only one can use it at a time. Usually Arduino IDE's **Serial Monitor**, or a SwampTag tab in the browser that's connected to the reader.
</details>

**3.3** Why did **Disconnect → Connect** fail before the fix?
<details><summary>Answer</summary>
The port was never actually closed. The code cleared its references before closing, and a port can't close while its data pipes are still attached. The fix closes things in order: stop reading → wait → close writer → wait → close port.
</details>

**3.4** Why does the reader ignore the same tag tapped twice within 1.5 seconds?
<details><summary>Answer</summary>
So one tap isn't counted twice while the fob is still near the reader (`REPEAT_IGNORE_MS`).
</details>

**3.5** The UNO R4 sketch didn't work on the Feather RP2040 even though the pin numbers matched. Why?
<details><summary>Answer</summary>
It used the UNO R4's built-in LED matrix (`Arduino_LED_Matrix`), which the Feather doesn't have. The Feather version uses its onboard colour LED (NeoPixel) instead.
</details>

**3.6** Can the RC522 act as a key fob that another reader taps? Can it change what's stored on a fob?
<details><summary>Answer</summary>
No to the first: it can only read and write tags, not pretend to be one. Yes to the second: it can write new data into the fob's memory (a rolling code), but it can't change the fob's ID number.
</details>

---

## 4. Git and secrets

**4.1** What's the difference between a commit and a push?
<details><summary>Answer</summary>
A commit saves a snapshot on your computer. A push uploads your commits to GitHub so others can see them.
</details>

**4.2** Your branch is `feature/tap-limit`. Is your work on the main branch just because you pushed?
<details><summary>Answer</summary>
No. It's on GitHub, but on its own branch. It only reaches `main` when it's merged, usually through a pull request.
</details>

**4.3** `.env.local` is git-ignored. Does that mean it's encrypted? Name two ways the key could still leak.
<details><summary>Answer</summary>
No, it's plain text on your laptop. It could leak by copying the file under another name (like `.env copy`), force-adding it (`git add -f`), or pasting the key into a chat or screenshot.
</details>

**4.4** What should you do if an API key leaks?
<details><summary>Answer</summary>
Delete it in the provider's dashboard (AI Studio for Gemini) and create a new one. The old key stops working immediately.
</details>

---

## 5. APIs and Gemini (steps 1 and 1b)

**5.1** In plain words, what is an API call?
<details><summary>Answer</summary>
Your program visits a web address like a browser does, but sends and receives JSON (structured text) instead of a web page.
</details>

**5.2** What's the difference between a `GET` and a `POST` request? Which one does `--models` use?
<details><summary>Answer</summary>
`GET` asks for something; `POST` sends data. `--models` uses `GET`; asking Gemini a question uses `POST`.
</details>

**5.3** What are headers for? Name the two the script sends.
<details><summary>Answer</summary>
Information about the request, like the label on an envelope: `x-goog-api-key` (who you are) and `Content-Type: application/json` (what you're sending).
</details>

**5.4** Explain this line: `result["candidates"][0]["content"]["parts"][0]["text"]`
<details><summary>Answer</summary>
Take the list of answers → the first one → its content → its first part → its text. Gemini can return several answers and parts, which is why there are lists.
</details>

**5.5** Why did 1b ask Gemini for JSON instead of a normal sentence?
<details><summary>Answer</summary>
Code can't reliably make decisions from a sentence, but it can from fields: `if review["risk"] == "high"`.
</details>

**5.6** What do these do? (a) the system instruction, (b) the response schema, (c) `"temperature": 0`
<details><summary>Answer</summary>
(a) Gemini's job description and rules, sent separately from the customer's words. (b) The exact shape of JSON to return (fields, types, allowed values). (c) Makes answers as consistent as possible, which is what you want for a safety check.
</details>

**5.7** Gemini's reply is text that *looks* like JSON. What turns it into something Python can use?
<details><summary>Answer</summary>
`json.loads(text)`, which turns the text into a Python dictionary.
</details>

**5.8** Does Gemini approve or block the payment?
<details><summary>Answer</summary>
No. Gemini only judges the risk and fills in the form. Your code decides what happens, and the fob tap is still required.
</details>

**5.9** Why did `gemini_client.py` get created?
<details><summary>Answer</summary>
So the key loading and `call_gemini()` live in one place and other scripts import them instead of copying them.
</details>

**5.10** Why use `gemini-flash-latest` instead of a specific version like `gemini-2.5-flash`?
<details><summary>Answer</summary>
It always points to the newest Flash model, so the code doesn't break when an old version is retired.
</details>

---

## 6. The voice loop

**6.1** Put these in order and say what each one does: Gemini, browser voice, Whisper, microphone.
<details><summary>Answer</summary>
Microphone (records audio) → Whisper (speech → plain text) → Gemini (text → JSON with risk and warning) → browser voice (reads `spokenWarning` aloud).
</details>

**6.2** Does Whisper produce JSON?
<details><summary>Answer</summary>
No, just plain text. Gemini is what turns that text into JSON.
</details>

**6.3** Why run Whisper on the laptop instead of sending the audio to a cloud service?
<details><summary>Answer</summary>
It's free and private: the voice recording never leaves the computer, and only the words are sent to Gemini.
</details>

---

## 7. Installing Python packages

**7.1** What's the difference between `git clone https://github.com/openai/whisper.git` and `pip install openai-whisper`?
<details><summary>Answer</summary>
`git clone` only downloads the source code as a folder. `pip install` downloads the package *and* sets it up so Python can `import` it.
</details>

**7.2** What is a virtual environment, and give two reasons to use one.
<details><summary>Answer</summary>
A separate box of packages (and a chosen Python version) for one project. Reasons: projects can need different versions without breaking each other; your main Python stays clean; you can pick the Python version (3.12 for faster-whisper).
</details>

**7.3** You type `pip install faster-whisper` and get "pip is not recognized". What are the two likely causes on this PC?
<details><summary>Answer</summary>
The virtual environment isn't created or turned on (no `(.venv)` in the prompt), and/or the terminal isn't in the project folder. `pip` lives inside the environment's `Scripts` folder, which activating adds to the search path.
</details>

**7.4** What does "activating" a virtual environment actually do?
<details><summary>Answer</summary>
It tells the terminal to use that environment's `python` and `pip` first (by putting its `Scripts` folder at the front of the PATH). The `(.venv)` in the prompt shows it's on.
</details>

**7.5** faster-whisper crashed with `open() got an unexpected keyword argument 'metadata_errors'`. What was wrong and how was it fixed?
<details><summary>Answer</summary>
pip installed the newest PyAV (19), which removed an option faster-whisper 1.2.1 still uses. The fix was **pinning** PyAV to an older version that works: `pip install av==16.1.0`.
</details>

**7.6** Where do you start reading a Python error (traceback)?
<details><summary>Answer</summary>
At the bottom. The last line is the actual error; the lines above show the chain of function calls that led there.
</details>

**7.7** Why should `.venv` never be committed to git? How do teammates get the same packages instead?
<details><summary>Answer</summary>
It's large and specific to your computer. Teammates create their own from a list of packages, usually `requirements.txt` (`pip install -r requirements.txt`).
</details>

---

## 8. Whisper (step 2)

**8.1** What is a Whisper "model", and what's the trade-off between `tiny.en`, `base.en` and `small.en`?
<details><summary>Answer</summary>
The trained "brain": a big file of numbers learned from lots of speech. Bigger = more accurate but slower and more memory. `.en` = English-only, which is faster and more accurate for English.
</details>

**8.2** What do `device="cpu"` and `compute_type="int8"` mean?
<details><summary>Answer</summary>
Run on the processor (no graphics card needed), and store the model's numbers in a smaller format so it's faster and uses less memory, with a tiny accuracy cost.
</details>

**8.3** What is a segment? What does each one contain?
<details><summary>Answer</summary>
A chunk of the speech (roughly a sentence). Each has `.start` and `.end` (seconds in the recording) and `.text` (the words).
</details>

**8.4** Why is the model loaded only once, even when there are many recordings?
<details><summary>Answer</summary>
Loading is the slow part (reading a big file into memory). `load_model()` keeps it in `_model` and reuses it for every recording.
</details>

**8.5** How does the script know which recordings it already transcribed?
<details><summary>Answer</summary>
`already_transcribed()` reads `transcripts.txt` and collects the names on lines starting with `=== `. `find_new_recordings()` skips those.
</details>

**8.6** Why does the script open `transcripts.txt` with `"a"`? What would `"w"` do?
<details><summary>Answer</summary>
`"a"` = append: add to the end and keep everything already there. `"w"` = write: erase the file and start over, losing the history.
</details>

**8.7** What does `--watch` do, and how does it stop?
<details><summary>Answer</summary>
It loops forever: check the folder for new recordings, transcribe them, sleep 3 seconds, repeat. Ctrl+C raises `KeyboardInterrupt`, which the script catches to stop cleanly.
</details>

**8.8** Why skip a file modified less than 2 seconds ago?
<details><summary>Answer</summary>
It might still be copying or saving. Reading a half-written audio file would fail or give a wrong transcript, so it waits for the next check.
</details>

**8.9** Between Whisper and Gemini, does the transcript need to be JSON?
<details><summary>Answer</summary>
No. Whisper gives plain text, and that text goes into Gemini's request as a string. The request *body* is JSON, but that's just the envelope. JSON matters where code needs to read structured data: Gemini's answer (`risk`, `reasons`), and later when the server sends the transcript back to the browser.
</details>

---

## 9. Connecting programs (step 3)

**9.1** Does Gemini receive `transcripts.txt`? What does step 3 actually send?
<details><summary>Answer</summary>
No. Step 3 opens the file, pulls out each `Text:` line, and sends only that sentence (a string) inside the request. Gemini never knows a file existed.
</details>

**9.2** What does `if __name__ == "__main__":` do, and why did step 1b need it before step 3 could import it?
<details><summary>Answer</summary>
Code under it only runs when the file is started directly. Importing a file runs all its loose code, so without it, `from step1b_scam_review import review_transfer` would also run the demo and call Gemini.
</details>

**9.3** What is `sys.path`, and why does `voice_check.py` add two folders to it?
<details><summary>Answer</summary>
The list of folders Python searches for `import`. Whisper's code is in `learn/whisper/` and Gemini's in `learn/gemini/`, so both folders are added before importing from them.
</details>

**9.4** What's the difference between Way A (step 3) and Way B (`voice_check.py`)?
<details><summary>Answer</summary>
Way A connects them through files (`transcripts.txt` → `reviews.txt`), so you can see each handoff and run each half separately. Way B passes the text directly in a variable: `text = transcribe(...)`, then `review_transfer(text, ...)`.
</details>

**9.5** Why will the real app use Way B, not Way A?
<details><summary>Answer</summary>
A person is waiting at the checkout: it should be one quick call that returns the answer, with no other program needing to run and no files to read or get out of sync. (Way B still writes a log, but only for you to read; nothing depends on it.)
</details>

**9.6** Why does step 3 skip recordings already in `reviews.txt`?
<details><summary>Answer</summary>
So running it again doesn't send the same text to Gemini twice, which wastes your free-tier quota and adds duplicate entries.
</details>

---

## 10. Errors and the model safety switch

**10.1** Which HTTP code means a Gemini model is overloaded?
<details><summary>Answer</summary>
503 (`UNAVAILABLE`). The switch also treats 500 (`INTERNAL`) and 504 (`DEADLINE_EXCEEDED`) as "try another model".
</details>

**10.2** Why does the switch change models on 5xx codes but stop on 403 or 400?
<details><summary>Answer</summary>
5xx = Google's side is busy or broken, so a different model may work. 4xx = your request is the problem (wrong key, bad request, unknown model), so every model would fail the same way.
</details>

**10.3** Why did `raise(modelchange)` with `modelchange = True` fail?
<details><summary>Answer</summary>
`raise` only accepts an exception object (a class built on `Exception`), not `True`/`False`. That's why `ModelChangeError` was created: it carries the same "change the model" meaning, plus the error code.
</details>

**10.4** `call_gemini()` raises `ModelChangeError`, but `voice_check.py` catches it. Why not handle it inside `call_gemini()`?
<details><summary>Answer</summary>
`call_gemini()` doesn't know which models to try or what the caller wants. Errors should travel up to the code that knows what to do about them; there, `review_with_fallback()` owns the list of models.
</details>

**10.5** What does `raise ModelChangeError(err.code) from err` add with `from err`?
<details><summary>Answer</summary>
It links the new error to the original `HTTPError`, so if it's ever printed, you see both: the "change the model" signal and the real HTTP error underneath.
</details>

**10.6** What happens if every model in `MODELS_TO_TRY` is busy?
<details><summary>Answer</summary>
The loop finishes without returning, so the line after it runs: `raise RuntimeError("Every Gemini model was busy...")`, a clear message instead of a confusing crash.
</details>

**10.7** Why does `review_transfer()` have `model=MODEL` instead of just `model`?
<details><summary>Answer</summary>
`=MODEL` is a default value: the fallback can pass a different model, while older calls like `review_transfer(text, 500)` keep working unchanged.
</details>

**10.8** How were the switches tested without waiting for Google to actually be busy?
<details><summary>Answer</summary>
The internet call (`urlopen`) was swapped for a fake that returned chosen errors (503 for one model, 403 for another). This is called mocking: testing your own logic without depending on the outside service.
</details>

---

## 11. Making it demo-proof

**11.1** What does `learn/demo_check.py` do, and when should you run it?
<details><summary>Answer</summary>
It tests every piece in order (packages, key, Whisper, offline rules, model switch, backup, live Gemini, full voice check) and prints PASS / FAIL / SKIP for each. Run it before every demo; `--offline` skips the 3 live Gemini requests.
</details>

**11.2** If the internet goes down, what decides whether a transfer is a scam?
<details><summary>Answer</summary>
The offline rules in `rules_review.py`: the same red-flag phrases as the website's `scamcheck.js` (like "bail", "jail", "gift card"). The result says `"offline rules"` so it's honest about who decided.
</details>

**11.3** Why does `rules_review()` return the same shape as Gemini (`risk`, `scamType`, `reasons`, `spokenWarning`)?
<details><summary>Answer</summary>
So the rest of the code works the same no matter which one answered: it just reads `review["risk"]`. Swapping one for the other needs no other changes.
</details>

**11.4** In `review_text()`, which errors switch to the offline rules, and why both?
<details><summary>Answer</summary>
`RuntimeError` (every Gemini model was busy) and `OSError` (no internet or a timeout; `URLError` is a kind of `OSError`). Both mean "Gemini can't answer right now".
</details>

**11.5** Why do the tests put the real `urlopen` back in a `finally:` block?
<details><summary>Answer</summary>
`finally` runs even if the test fails or crashes. Without it, a failed test could leave the fake internet in place, and every later check would talk to the fake instead of Gemini.
</details>

**11.6** What's the difference between a check that FAILs and one that's SKIPped?
<details><summary>Answer</summary>
FAIL = it ran and something was wrong (fix it before the demo). SKIP = it didn't run (e.g. `--offline`), so it's untested, not broken.
</details>

---

## 12. The troubleshooting demo page

**12.1** Why does the demo page run on port 8001 instead of 8000?
<details><summary>Answer</summary>
Port 8000 is already used by the SwampTag site (`server.py`). Two servers can't listen on the same port.
</details>

**12.2** You type text instead of recording. Which stage is skipped, and why is that useful for troubleshooting?
<details><summary>Answer</summary>
Stage 1 (Whisper). It isolates Gemini: if typed text works but a recording doesn't, the problem is in recording or Whisper, not Gemini.
</details>

**12.3** Which simulations use no Gemini requests at all?
<details><summary>Answer</summary>
"No internet" and "Every model busy": both fake the failure before anything is sent, then the offline rules answer. "First model busy" fakes only the first model, so the next model makes a real request.
</details>

**12.4** How does the browser record your voice, and what format does it send?
<details><summary>Answer</summary>
`getUserMedia` asks for the microphone and `MediaRecorder` records it into chunks, joined into a Blob, usually `audio/webm` (Opus). The page POSTs those bytes to `/api/voice-check`, and the server saves them in `learn/demo_recordings/` before Whisper reads them.
</details>

**12.5** Why does the server catch `BaseException` (not just `Exception`) in `run_check()`?
<details><summary>Answer</summary>
A bad key makes `call_gemini()` call `sys.exit()`, which raises `SystemExit`, which is not an `Exception`. Without catching it, one bad request would shut the whole demo server down instead of showing the error on the page.
</details>

**12.6** The page shows a red "Error: this is where it broke" box. How do you read it?
<details><summary>Answer</summary>
It's the Python traceback: read the last line first (the actual error, e.g. `InvalidDataError` for a broken audio file), then look up the lines to see which file and function it came from.
</details>

---

## 13. The customer-service option (demo only)

**13.1** Name the four ways the demo page leads to customer service.
<details><summary>Answer</summary>
(0) Before starting: the "Talk to a representative" button at the top, with no recording needed. After a check: (1) the "person asks for customer service" setting is on; (2) what they said or typed includes a phrase like "customer service" or "talk to a person"; (3) the AI isn't working, meaning the offline rules answered or the check failed.
</details>

**13.2** What actually happens when you press "Call customer service"?
<details><summary>Answer</summary>
Nothing is called. The page waits 2 seconds to pretend to dial, sends the request to `/api/customer-service`, which only writes it to `learn/voice_checks.txt`, then shows and reads "Customer service isn't connected in this demo."
</details>

**13.3** Why log the request to a file if no call is made?
<details><summary>Answer</summary>
So you can see afterwards when and why it was triggered, and what the person said. That's the "always save to a file" rule, and it's useful for checking the triggers work.
</details>

**13.4** Why does the phone number use 555?
<details><summary>Answer</summary>
555 numbers are reserved for fiction, so a demo can't accidentally show (or dial) a real person's number.
</details>

**13.5** Why does the customer-service box disappear when a new check starts?
<details><summary>Answer</summary>
Each check decides again whether it's needed. Otherwise an old offer would stay on screen for a check that worked fine.
</details>

**13.6** What's different about the "Talk to a representative" button at the top?
<details><summary>Answer</summary>
It doesn't need a check first: no recording, no Whisper, no Gemini. It opens the customer-service box and starts the pretend call straight away, and the log says "asked for a representative before starting".
</details>

---

## 14. From learning scripts to the app

**14.1** Why were `scam_review.py` and `transcriber.py` written as new files instead of importing straight from `learn/`?
<details><summary>Answer</summary>
`learn/` is for learning: step-by-step, lots of printing, and some scripts quit with `sys.exit()`. App code must never stop the server, needs one clear function to call (`review()`, `transcribe_bytes()`), and lives next to the other app modules like `terminal.py`.
</details>

**14.2** `review()` "never raises". What does it do instead when Gemini fails?
<details><summary>Answer</summary>
It catches every Gemini failure (no key, no internet, bad key, every model busy) as `GeminiUnavailable` and answers with the offline phrase rules, setting `answeredBy: "offline rules"` and a `note` saying why.
</details>

**14.3** What counts as "busy, try the next model" now, and what stops Gemini completely?
<details><summary>Answer</summary>
Next model: HTTP 503/500/504, or no answer within 15 seconds. Stop and use the rules: anything else, such as 403 (bad key), 429 (quota), 400, or no internet.
</details>

**14.4** Why is `transcriber.py` "optional", and how does the website know?
<details><summary>Answer</summary>
faster-whisper is only installed in `.venv`. The import is wrapped in `try/except ImportError`, so under plain `py` it sets `WhisperModel = None` and `available()` returns False. The server reports that in `/api/config`, and the page hides the 🎤 button.
</details>

**14.5** Why does `transcriber.py` use a lock (`threading.Lock`)?
<details><summary>Answer</summary>
The server handles each request in its own thread. The lock makes recordings wait their turn, so two people talking at once don't run the heavy Whisper model at the same time.
</details>

**14.6** Why are there two branches, `voice-pipeline` and `voice-website`?
<details><summary>Answer</summary>
Only the pipeline code (`learn/`, `scam_review.py`, `transcriber.py`) is shared on GitHub. The website and server changes stay on your computer until you decide to share them, so they live on a branch that's never pushed.
</details>

**14.7** Why were `Recording.m4a`, `demo_recordings/` and the transcript logs left out of the commit?
<details><summary>Answer</summary>
They contain your real voice and what you said: personal data that doesn't belong in a shared repo. They're listed in `.git/info/exclude` (a local-only ignore list). `sample.wav` is a computer voice, so it's fine to share for tests.
</details>
