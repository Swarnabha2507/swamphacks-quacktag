# How QuackTag works

This guide walks through the whole project: the big picture first, then each part in the order a payment flows through it. For setup steps, see the [README](../README.md).

---

## 1. The big picture

QuackTag adds a **physical key** to a debit card. When a payment looks risky (by default, anything over **$200**), it waits until the owner taps an RFID key fob on a small reader. A thief with a copied card and your PIN doesn't have the fob, so the payment is blocked.

```
 Key fob ──radio──▶ RC522 reader ──SPI──▶ Arduino UNO R4 WiFi
                                             │  ▲
                                   TAG:<id>  │  │  WAIT / OK / DENY / IDLE
                                    (USB)    ▼  │
                         Chrome / Edge  ── Web Serial (serial.js)
                                             │
                     dashboard.js  ◀── decides: is this the right key? does this payment need a tap?
                                             │
                   server.py (localhost:8000) ──▶ Capital One Nessie API (the "bank")
                                             └──▶ Auth0 settings (optional sign-in)
```

**Who decides what:**

| Part | Its job | What it does *not* do |
|---|---|---|
| Arduino | Reads tags and shows icons on its LED grid | Never decides whether a key is right |
| Website (browser) | Decides when a tap is needed and whether the tapped key matches | Never sees the Nessie API key |
| `server.py` | Serves the website and passes Nessie requests through, adding the secret key | Makes no payment decisions |
| Nessie | Stores the account, purchases, transfers and bills | Knows nothing about keys |

---

## 2. The hardware: `arduino/QuackTag/QuackTag.ino`

`arduino/TagReader/TagReader.ino` is an identical copy.

### Wiring (RC522 → UNO R4 WiFi)
SDA→D10, SCK→D13, MOSI→D11, MISO→D12, RST→D9, GND→GND, **3.3V→3.3V** (not 5V). IRQ isn't used.

### What the sketch does
- **`setup()`:** starts USB serial (115200 baud), SPI, the RC522 and the LED grid.
  - It reads the RC522's version register to check the reader is really there. If so, it prints `READY`; if not, it prints `ERROR:READER`.
- **`loop()`** does three jobs, over and over:
  1. **`readSerial()`:** collects characters from the website until a newline, then runs the command:
     - `WAIT` shows the ripple animation.
     - `OK` shows ✓ for 3 seconds.
     - `DENY` shows ✕ for 3 seconds.
     - `IDLE` shows the lock.
  2. **`readTag()`:** when a tag comes near, it reads the tag's ID bytes, turns them into hex text (e.g. `04A1B2C3`) and prints `TAG:04A1B2C3`.
     - The same tag tapped again within 1.5 seconds is ignored (`REPEAT_IGNORE_MS`), so one tap isn't sent twice.
  3. **Animation and timers:** it grows the ripple every 0.18 seconds while waiting, and goes back to the lock after a result.
- **Optional buzzer** on D8: set `USE_BUZZER` to `1`.

### The serial protocol (one message per line, 115200 baud)

| Direction | Message | Meaning |
|---|---|---|
| Arduino → site | `READY` | Reader works (only sent when the board starts) |
| Arduino → site | `ERROR:READER` | RC522 not found: check the wiring |
| Arduino → site | `TAG:<HEX>` | A tag was tapped |
| site → Arduino | `WAIT` | Show "tap your key" |
| site → Arduino | `OK` / `DENY` | Show ✓ / ✕ |
| site → Arduino | `IDLE` | Show the lock |

---

## 3. The bridge: `website/js/serial.js` (`SerialLink`)

The browser talks to the Arduino with **Web Serial**, which only Chrome and Edge support. `SerialLink` wraps it:

```js
const link = new SerialLink();
link.onLine   = (line) => { ... };      // every line the Arduino prints
link.onStatus = (connected) => { ... }; // connected / disconnected
await link.connect();                   // opens the port picker (must come from a click)
link.send('OK');
await link.disconnect();
```

**How data flows:**
- **Incoming:** the port's raw bytes go through a `TextDecoderStream` into text. `_readLoop()` splits the text into lines and calls `onLine` for each one.
- **Outgoing:** `send()` writes `text + '\n'` into a `TextEncoderStream`, which feeds the port.

### Connecting and disconnecting safely
A Web Serial port **can't be closed while anything is still attached to its streams**. If closing fails, the port stays open, and the next connect fails with *"The port is already open"*. `_shutdown()` therefore always goes in this order:

1. Cancel the reader, so the read loop stops.
2. Wait for the port → decoder pipe to finish (`_readDone`).
3. Close the writer.
4. Wait for the encoder → port pipe to finish (`_writeDone`).
5. Close the port.
6. Clear the saved references and tell the page (`onStatus(false)`).

**Other cases it handles:**
- **One step at a time:** a `_busy` flag stops two opens or closes from overlapping, for example after a double click on **Connect**.
- **Cable pulled out:** the browser fires a `disconnect` event, or the read loop errors. Either way `_shutdown()` cleans up, so **Connect** works again.
- **Cable plugged back in:** the browser fires a `connect` event for a port this page was allowed before, and the link reopens it automatically (`autoReconnect`).
- **Page load:** `reconnect()` reopens a previously allowed port without showing the picker.
- **Port busy:** if Arduino IDE's **Serial Monitor** has the port, opening fails. Only one program can use a serial port at a time.

---

## 4. The website

Plain HTML, CSS and JavaScript, with no build step. The dashboard loads scripts in this order: `config.js → serial.js → store.js → risk.js → scamcheck.js → bank.js → auth.js → dashboard.js`.

| File | What it does |
|---|---|
| `index.html` | Landing page |
| `login.html` | Auth0 sign-in, or the demo login |
| `dashboard.html` | The banking app |
| `reader-test.html` | Small page to check the reader works (shows each tap's ID and says when the same key is tapped twice) |
| `js/config.js` | `loadConfig()`: asks `server.py` (`/api/config`) whether Nessie is live and for the Auth0 settings |
| `js/store.js` | `Store`: everything saved in the browser (`localStorage`). See below. |
| `js/risk.js` | `assessRisk()`: does this payment need a tap? |
| `js/scamcheck.js` | Scam check for transfers of $200 or more |
| `js/bank.js` | `Bank`: talks to Nessie, or to offline demo data |
| `js/auth.js` | `Auth`: optional Auth0 login; saves the linked key to the user's profile |
| `js/dashboard.js` | Draws the page and runs every flow (payments, linking a key, settings) |

### What `Store` keeps
- The linked key (`keyUid`).
- Settings: the tap limit (`tapLimit`, default $200), Smart taps on/off (`alwaysTap`), Scam check on/off, Demo mode.
- Alerts and blocked attempts.
- When Nessie is offline, the whole demo bank account.

### Linking a key (`registerFlow`)
1. The site sends `WAIT` and asks you to tap the fob you want to link.
2. The first `TAG:` that arrives becomes `keyUid`. It's saved in `Store`, and in your Auth0 profile if you signed in with Auth0.
3. The **tap-limit box** asks *"How much can you spend before a tap is needed?"*, with $200 filled in. You can change the limit later under **Security → Smart taps → Change**.

### Paying (the core flow)
```
payFlow / sendFlow / payBillFlow / fraudFlow
        │
        ▼
startPayment(payment)
  ├─ no key linked ──────────▶ payWithoutKey(): goes straight through (like a normal card today)
  ├─ assessRisk(): amount ≤ tap limit ─▶ approveTrusted(): sends OK, records it as "QuackTag trusted"
  └─ amount > tap limit (or Smart taps off) ─▶ requestApproval():
        sends WAIT, shows the reasons, starts a 30-second countdown
        then waits for a TAG:
           ├─ same ID as keyUid ─▶ sends OK, commit(... 'verified'), ✓
           ├─ any other ID ──────▶ sends DENY, recordBlocked(), ✕ (no money moves)
           └─ cancel / timeout ──▶ sends IDLE, nothing happens
```
- **Transfers of $200 or more** first go through `scamCheckFlow()`, which asks why you're sending the money. Red-flag answers show a spoken warning and alert the trusted contact. After that, the normal tap rules apply.
- **`commit()`** writes approved payments to the bank. How each payment was approved is saved in its description: `QuackTag verified`, `QuackTag trusted` or `No QuackTag check`.
- **Blocked payments** are never sent to the bank; they're only logged on this device.

### `assessRisk()` in `risk.js`
- **The amount decides:** a tap is needed when `amount > tapLimit`, or when Smart taps is off.
- **Reasons explain:** when a tap is needed, the tap screen also lists why the payment looks unusual, using purchase history and merchant locations: "New merchant", "96 mi from home", "15× your usual spend". These reasons don't decide whether a tap is needed.

### Demo mode
With no Arduino, turn on **Demo mode** in Security settings. When a payment waits for a tap, press **T** (correct key) or **X** (wrong key), or use the on-screen buttons.

---

## 5. The server: `server.py`

Uses only Python's standard library.
- **Serves `website/`** at http://localhost:8000. Pages are never cached, so edits show on refresh.
- **`/api/config`:** tells the page whether Nessie is live and gives it the account IDs and the Auth0 settings.
- **`/api/nessie/<path>`:** passes the request on to `https://api.nessieisreal.com/<path>`, adding `?key=` from `.env`. The key never reaches the browser.
- **`--offline`:** ignores the Nessie key, so the site uses the built-in demo data.

On this PC, use `py` instead of `python`:
```
py server.py             # http://localhost:8000
py server.py --offline   # demo data only
py tools/seed_nessie.py  # create the demo account in Nessie (needs NESSIE_API_KEY in .env)
```

`tools/seed_nessie.py` creates Albert Gator's account, three friends, the merchants, past purchases and bills in Nessie. It saves their IDs to `nessie_ids.json`, which `server.py` hands to the page.

---

## 6. Other folders
- **`.claude/skills/`:** helper instructions for Claude Code (demo checklist and UI audit).

---

## 7. Troubleshooting the reader

| Problem | Fix |
|---|---|
| **Connect** fails: "port is already open" / "Could not open the port" | Close Arduino IDE's Serial Monitor; only one program can use the port. |
| Connected but nothing happens when tapping | Check the wiring (3.3V, D9–D13). The reader test page shows `ERROR:READER` if the RC522 isn't found. |
| No `READY` after reconnecting | Normal: `READY` only prints when the board starts. Press the board's reset button to see it again. |
| Second tap of the same fob not detected | Wait about 1.5 seconds between taps; quicker repeats are ignored on purpose. |
| The **Connect** button does nothing | Use Chrome or Edge; other browsers don't support Web Serial. |
