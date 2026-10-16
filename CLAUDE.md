# SwampTag (SwampHacks 2026 project)

RFID tap-to-approve 2FA for debit payments. Tracks: Hardware & Physical Computing, First Timers. The user is a first-time hackathon participant and wants the hardware kept as simple as possible.

## Layout
- `arduino/SwampTag/SwampTag.ino`: UNO R4 WiFi + RC522 sketch. LED matrix feedback, no other parts.
- `arduino/SETUP.md`: wiring table, upload steps, serial protocol.
- `website/`: static site, no build step and no backend.
  - `index.html` (home), `login.html` (demo login), `dashboard.html` (bank UI)
  - `css/styles.css`: all styles. Colors are CSS variables in `:root`: navy `#0b2a6f`, UF orange `#fa4616`.
  - `js/serial.js`: `SerialLink` Web Serial wrapper. `js/store.js`: `Store` (localStorage state, `CONTACTS`, `MERCHANTS`, `FRAUD_ATTEMPTS`). `js/dashboard.js`: rendering, modals, `requestApproval()` flow.
- `.claude/skills/swamptag-demo/SKILL.md`: flash, serve, demo checklist, troubleshooting.

## Serial protocol (115200 baud, newline-terminated)
- Arduino → site: `READY`, `ERROR:READER`, `TAG:<HEX UID>`
- site → Arduino: `WAIT`, `OK`, `DENY`, `IDLE`
- The site decides validity (compares the UID with `Store.state.keyUid`). The Arduino never decides.

## Wiring
RC522 → R4: SDA→D10, SCK→D13, MOSI→D11, MISO→D12, RST→D9, GND→GND, **3.3V→3.3V**, IRQ unconnected.

## Commands
- Arduino CLI (bundled with the IDE): `"$env:LOCALAPPDATA\Programs\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe"`
  - FQBN `arduino:renesas_uno:unor4wifi`. Core 1.6.0 and MFRC522 1.4.12 are installed. The "may be incompatible" warning for MFRC522 is harmless.
- Serve: `python -m http.server 8000` in `website/` → http://localhost:8000 (Chrome/Edge only, because of Web Serial).

## Conventions
- Plain HTML/CSS/vanilla JS, no frameworks or bundlers. Scripts load as classic `<script>` tags in order serial → store → dashboard.
- Pass user/serial text through `escapeHtml()` before putting it in `innerHTML`.
- Keep the demo-mode fallback working: T/X keys and the simulate buttons must work with no Arduino.
