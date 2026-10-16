# SwampTag (SwampHacks 2026 project)

RFID tap-to-approve 2FA for debit payments, with Capital One's Nessie API as the ledger.
- **Tracks:** Hardware & Physical Computing, First Timers, Capital One – Best Use of Nessie.
- **User:** a first-time hackathon participant who wants the hardware kept as simple as possible.

## Layout
- `arduino/SwampTag/SwampTag.ino`: UNO R4 WiFi + RC522 sketch. LED matrix feedback, no other parts.
- `arduino/SETUP.md`: wiring table, upload steps, serial protocol.
- `server.py`: stdlib server.
  - Serves `website/`. `/api/config` returns live status and the seeded IDs.
  - `/api/nessie/<path>` forwards to Nessie with `?key=`.
  - Binds 127.0.0.1:8000. Run it instead of `http.server`.
- `tools/seed_nessie.py`: creates the demo data in Nessie and writes `nessie_ids.json`. Use `--fresh` for a new set.
- `.env` (gitignored) holds `NESSIE_API_KEY`. `nessie_ids.json` is gitignored too.
- `website/`: static site, no build step.
  - `js/serial.js`: `SerialLink`, the Web Serial wrapper.
  - `js/store.js`: `Store` (localStorage). Holds key/settings/alerts/`localRows` in both modes, plus the offline ledger, `CONTACTS`, `MERCHANTS`, `HOME`.
  - `js/risk.js`: `assessRisk()`, the smart-tap rules. Also runs in Node.
  - `js/bank.js`: `Bank` chooses `NessieBank` or `LocalBank`. Both return `{balance, transactions, bills, merchants, contacts, home, history}` and support `pay/transfer/payBill(…, mode)`.
  - `js/dashboard.js`: rendering, modals, `startPayment()` → `assessRisk` → `requestApproval()` / `approveTrusted()` → `commit()`.
- `STYLE_GUIDE.md`: tokens and components. Banking-app look: gradient tiles, navy/blue, red only for accents and danger.

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

## Serial protocol (115200 baud, newline-terminated)
- Arduino → site: `READY`, `ERROR:READER`, `TAG:<HEX UID>`
- Site → Arduino: `WAIT`, `OK`, `DENY`, `IDLE`
- The site decides whether a tag is valid. The Arduino never decides.

## Wiring
RC522 → R4: SDA→D10, SCK→D13, MOSI→D11, MISO→D12, RST→D9, GND→GND, **3.3V→3.3V**, IRQ unconnected.

## Commands
- Arduino CLI: `"$env:LOCALAPPDATA\Programs\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe"`, FQBN `arduino:renesas_uno:unor4wifi`. MFRC522 1.4.12 is installed; its "may be incompatible" warning is harmless.
- `python server.py` → http://localhost:8000 (Chrome/Edge only, because of Web Serial).
- `node --check website/js/*.js` checks syntax. `risk.js` can be `require`d in Node for quick rule tests.

## Conventions
- Plain HTML/CSS/vanilla JS. Scripts load in order serial → store → risk → bank → dashboard.
- Pass user/serial/Nessie text through `escapeHtml()` before putting it in `innerHTML`.
- Keep the offline fallback and demo mode (T/X keys) working with no key, no internet and no Arduino.
- Never print or commit the Nessie key.
