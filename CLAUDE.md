# SwampTag (SwampHacks 2026 project)

RFID tap-to-approve 2FA for debit payments, with Capital One's Nessie API as the ledger.
- **Tracks:** Hardware & Physical Computing, First Timers, Capital One – Best Use of Nessie, Best Use of Auth0.
- **User:** a first-time hackathon participant who wants the hardware kept as simple as possible.
- **Current hardware (since 2026-10-17):**
  - **The reader is the user's Pixel 6a.** It runs `website/terminal.html` (Web NFC). (The 3D-printed cases were dropped on 2026-10-17.)
  - The Arduino + RC522 is now attached to the key and rewrites it at intervals. That **key device is a teammate's job**: don't build it, only agree the format (`docs/KEY_FORMAT.md`).

## Layout
- `arduino/SwampTag/SwampTag.ino`: UNO R4 WiFi + RC522 sketch. LED matrix feedback, no other parts.
- `arduino/SETUP.md`: wiring table, upload steps, serial protocol.
- `server.py`: stdlib server.
  - Serves `website/`. `/api/config` returns live status and the seeded IDs.
  - `/api/nessie/<path>` forwards to Nessie with `?key=`.
  - Binds 127.0.0.1:8000. Run it instead of `http.server`.
  - `/api/terminal/*` is the **phone terminal relay** (`terminal.py`):
    - `POST command {cmd, details}`: from the dashboard (WAIT / OK / DENY / IDLE).
    - `GET state`: polled by the phone. Polling marks the phone as online.
    - `POST read {serialNumber, texts[], simulate?}`: from the phone.
    - `GET events?since=N`: polled by the dashboard. `since=-1` skips old events.
  - `KEY_SECRET` (`.env`) turns on key-code checks.
- `terminal.py`:
  - **`KeyChecker`** checks `ST1:<keyId>:<counter>:<code>`: an HMAC-SHA256 code, and a counter that must go up. Counters are saved in `key_counters.json` (gitignored).
    - Falls back to the tag's serial number when there's no ST1 record.
    - Returns `TAG:<id>` or `BADTAG:<reason>`.
  - **`TerminalRelay`** holds the in-memory, thread-locked state shared by the dashboard and the phone.
- `tools/seed_nessie.py`: creates the demo data in Nessie and writes `nessie_ids.json`. Use `--fresh` for a new set.
- `.env` holds `NESSIE_API_KEY`, and `nessie_ids.json` holds the seeded account IDs.
  - Both are **committed to the private repo on purpose** (the user's decision), so teammates share one Nessie account.
- `website/`: static site, no build step.
  - `terminal.html` + `js/terminal.js`: the **phone terminal page**.
    - One "Start terminal" tap does all of these: `NDEFReader.scan()` **first** (its permission prompt needs the tap; full screen and the orientation lock would use the tap up), then full screen, a portrait lock and a wake lock. The ⟲ button flips the picture 180° (saved in localStorage).
    - It polls `/api/terminal/state` every 400 ms and posts reads.
    - It shows Correct key / Wrong key demo buttons when Web NFC isn't available.
  - `js/terminal-link.js`: `TerminalLink`. Same API as `SerialLink`, talking to the relay. **The dashboard uses it** (`const link = new TerminalLink()`).
    - `send('WAIT', details)` passes `{amount, name, place, reasons}` (or `{linking:true}`). `DENY` passes `{reason}`.
    - The dashboard handles `BADTAG:<reason>` (blocks with that reason) and `SIM:GOOD/BAD` (the phone's demo buttons).
  - `js/serial.js`: `SerialLink`, the Web Serial wrapper for the old USB reader. Still used by `reader-test.html`.
    - `_shutdown()` must close in order (cancel reader → await read pipe → close writer → await write pipe → close port), or the port stays open and the next connect fails with "already open".
    - A `_busy` flag stops overlapping opens/closes; it reopens allowed ports on page load (`reconnect()`) and on replug (`connect` event).
  - `reader-test.html`: standalone reader check (shows each tag ID, flags the same key tapped twice). Full walkthrough in `docs/HOW_IT_WORKS.md`.
  - `js/store.js`: `Store` (localStorage). Holds key/settings/alerts/`localRows` in both modes, plus the offline ledger, `CONTACTS`, `MERCHANTS`, `HOME`.
  - `js/risk.js`: `assessRisk()`, the smart-tap rules. Also runs in Node.
    - Only the amount decides: a tap is needed when `amount > tapLimit` (or Smart taps is off). New merchant / distance / usual-spend reasons are shown on the tap screen but don't trigger a tap.
    - `tapLimit` lives in `Store.state` (default $200). `tapLimitFlow()` in dashboard.js asks for it right after a key is linked; the Security panel's **Change** button reopens it.
  - `js/bank.js`: `Bank` chooses `NessieBank` or `LocalBank`. Both return `{balance, transactions, bills, merchants, contacts, home, history}` and support `pay/transfer/payBill(…, mode)`.
  - `js/dashboard.js`: rendering, modals, `startPayment()` → `assessRisk` → `requestApproval()` / `approveTrusted()` → `commit()`.
    - Transfers of $200 or more go through `scamCheckFlow()` → `reviewTransfer()` → `scamWarning()` first.
    - Warnings are read aloud with `speak()`, the browser's speechSynthesis.
    - `confirmModal()` replaces `window.confirm`.
  - `js/scamcheck.js`: Scam check for older adults.
    - Defines `TRANSFER_REASONS`, `RED_FLAG_PHRASES`, `FRAUD_LINE` (fictional 555 number), `DEMO_VERIFY_CODE` (2468) and `TRUSTED_CONTACT`.
    - `reviewTransfer()` is a **simulated** AI review. No API is called; the user said not to use the Gemini API for now.
  - `js/config.js`: `loadConfig()`, which fetches `/api/config` once per page.
  - `js/auth.js`: `Auth`, an optional Auth0 SPA login (SDK 2.27.0 from jsDelivr).
    - The Management API audience and scopes are requested at login.
    - The key is kept in `user_metadata.swamptag_key`.
    - A `sessionStorage` flag marks a demo-account session.
- `firmware/swamptag_key/`: **PlatformIO** project for the Adafruit Feather RP2040 + RC522 (Philhower core via maxgerhardt's platform).
  - `env:key` rewrites the fob with `ST1` every 15 s while it rests on the reader. `env:card` (`-D CARD_WRITER`) writes the fake debit card (`SC1`).
  - `src/ndef_tag.cpp`: NDEF Text read/write on NTAG/Ultralight and **MIFARE Classic 1K** (NFC Forum MAD format; key B stays FF…FF; MAD CRC-8 checked against the NFC Forum example).
  - `include/secrets.h` is gitignored and holds the same `KEY_SECRET` as `.env`.
  - **Build:** `%USERPROFILE%\.platformio\penv\Scripts\pio.exe run -d firmware/swamptag_key -e key -e card`.
  - **Flash:** `pio run -d firmware/swamptag_key -e <env> -t upload` works with **no Zadig driver**.
    - `upload_protocol = custom` runs `tools/uf2_upload.py`, which does a 1200-baud touch on the Feather's port (USB IDs 239A/2E8A), waits for the **RPI-RP2** drive (it was D:) and copies `firmware.uf2`.
    - **If the port is "busy" or "Access denied":** a serial logger or monitor still holds it. My old `scratchpad/serial_log.py` processes did this twice; stop them first.
  - **VS Code:** open `SwampTag.code-workspace`. Its second folder is `firmware/swamptag_key`, so the PlatformIO extension finds `platformio.ini` (it only checks workspace-folder roots). PlatformIO Core is at `~/.platformio` and the extension uses it.
  - The Feather's serial port moves between COM4 and COM5 after reflashing.
- `website/pump.html` + `js/pump.js`: the **gas-station checkout** on the phone.
  - Steps: items (fuel $20/$40/$60 or gallons at $3, store items) → Charge → card → PIN pad (dots only) → key → receipt or decline.
  - One `NDEFReader.scan()` is started by the Start tap, with NFC first. Demo buttons appear without NFC. ⚙ setup shows the raw reads and pairs card + key by ID.
- `terminal.py` → `PumpAuthorizer` (shares the `KeyChecker`) checks: `SC1` card (or `pairings.json` in ID-only mode) → `CARD_PIN` (3 tries) → the key's `ST1` code is fresh, and the key is the card's paired key.
- `server.py`: `/api/pump/card`, `/api/pump/authorize`, `/api/pump/pair`.
  - `settle_pump_sale()` runs after the card, PIN and key pass.
    - It computes the balance from Nessie (`nessie_balance()`), and declines with "Insufficient funds" if the sale is too large.
    - Otherwise it POSTs the purchase synchronously at "Swamp Gas & Go" (merchant created once and cached in gitignored `local_state.json`).
    - The result includes `nessie: {purchaseId, balanceAfter}` for the receipt.
  - Every Nessie call is logged in memory (`log_nessie_call`, with source dashboard / pump / live check). `GET /api/nessie-log` serves it to the dashboard's **Capital One Nessie** panel, which polls every 3 s and refreshes Recent activity when a pump sale is posted.
  - Nessie's empty-list 404 shows as "empty".
- `firmware/swamptag_key/src/wiring_test.cpp` (`env:wiring`): bit-bangs SPI over every plausible pin combination and reports which Feather pins the RC522 wires are on. The key and card firmware retry the RC522 every 2 s and print its version register: 0x00 / 0xFF means a wiring problem.
- `docs/KEY_FORMAT.md`: the ST1 key record, the SC1 card record, the checks, the MIFARE Classic layout.
- `.claude/skills/redesign-existing-projects/`: UI audit skill (MIT, from Leonxlnx/taste-skill), used for the cleanup pass.
- `STYLE_GUIDE.md`: tokens and components. Banking-app look: gradient tiles, navy/blue, red only for accents and danger. Geist font, square badges, tabular figures.

## Nessie facts (checked against the live API, 2026-10-16)
- **Base URL:** `https://api.nessieisreal.com`. Plain HTTP refuses connections. Docs are at https://prod.nessieisreal.com/docs; the OpenAPI JSON is 403.
- **Amounts are whole dollars** (floats get truncated). Bills keep floats, but we use whole dollars everywhere.
- **Empty list endpoints return 404** with a string body, so treat them as `[]` (`api(..., {list:true})`).
- **Transfer body:** `{transaction_date, status, amount, description}`, with no `medium` and no `payee_id`. P2P = a transfer on the sender plus a deposit on the receiver. GET items use `id`, not `_id`.
- **Purchase body:** `{merchant_id, medium, amount, purchase_date?, status?, description?}`.
- **Deposit body:** `{medium, transaction_date, status, amount, description}`.
- **Bills** need `recurring_date` on create, or GET fails server-side. `upcoming_payment_date` is rejected on create. `PUT /bills/{id} {status:"completed"}` works.
- **Purchases don't change `account.balance`.** The dashboard computes `openingBalance + deposits − purchases − transfers`.
- How a payment was authorized is stored in `description`: `SwampTag verified` / `SwampTag trusted` / `No SwampTag check`, joined with ` · ` (see `describe()` / `parseDescription()` in bank.js).

## Reader protocol
The same words are used over the phone relay and the old USB serial link (115200 baud, newline-terminated):
- **Reader → dashboard:** `TAG:<id>`, plus `BADTAG:<reason>` and `SIM:GOOD/BAD` from the phone. The old Arduino also sends `READY` and `ERROR:READER`.
- **Dashboard → reader:** `WAIT`, `OK`, `DENY`, `IDLE`.
- The dashboard decides whether the key is the linked one. The phone and Arduino never decide. The server only checks that the key's code is genuine and fresh.
- **Phone ↔ laptop:** the USB cable plus `edge://inspect` **port forwarding 8000 → localhost:8000**. To the phone, the page is then `localhost`, a secure context, so Web NFC works.

## Wiring
RC522 → R4: SDA→D10, SCK→D13, MOSI→D11, MISO→D12, RST→D9, GND→GND, **3.3V→3.3V**, IRQ unconnected.

## Commands
- Arduino CLI: `"$env:LOCALAPPDATA\Programs\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe"`, FQBN `arduino:renesas_uno:unor4wifi`. MFRC522 1.4.12 is installed; its "may be incompatible" warning is harmless.
- `python server.py` → http://localhost:8000 (Chrome/Edge only, because of Web Serial).
  - `python server.py 8001 --offline` ignores the Nessie key. Use it for tests that must not create Nessie transactions.
- **Browser smoke test:**
  1. Start headless Edge with `--remote-debugging-port`.
  2. Drive it over the Chrome DevTools Protocol from a Node script (Node 24 has a global `WebSocket`).
  3. Click through every flow on the `--offline` server.
  4. For the phone terminal: open `terminal.html` in a second target (`PUT /json/new`) and POST fake reads to `/api/terminal/read`. Start the server with `KEY_SECRET` set to test ST1 codes, then delete `key_counters.json` afterwards.
- `node --check website/js/*.js` checks syntax. `risk.js` can be `require`d in Node for quick rule tests.

## Conventions
- Plain HTML/CSS/vanilla JS.
- Dashboard script order: config → serial → terminal-link → store → risk → scamcheck → bank → auth → dashboard.
- Pass user/serial/Nessie text through `escapeHtml()` before putting it in `innerHTML`.
- Keep the offline fallback and demo mode working with no key, no internet and no phone: the T/X keys on the dashboard and the demo buttons on the terminal.
- The Nessie key lives in the committed `.env` because the repo is private (the user's choice). Never print it in chat or logs.
- Before the repo is ever made public, rotate the key at nessieisreal.com.
- Only one person should run `seed_nessie.py --fresh`, then commit the new `nessie_ids.json`.
