---
name: swamptag-demo
description: Flash the SwampTag Arduino sketch, serve the SwampTag website, run the end-to-end demo checklist, and troubleshoot RFID/Web Serial problems. Use when asked to upload, test, run, demo, or debug the SwampTag hardware or site.
---

# SwampTag demo runbook

## Paths
- CLI: `$cli = "$env:LOCALAPPDATA\Programs\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe"`
- FQBN: `arduino:renesas_uno:unor4wifi`
- Sketch: `arduino/SwampTag`
- Site root: `website/`

## Flash the Arduino
1. `& $cli board list`: find the UNO R4 WiFi COM port. If none is listed, the board is unplugged or the cable is charge-only.
2. `& $cli compile --fqbn arduino:renesas_uno:unor4wifi arduino/SwampTag`
3. `& $cli upload -p COMx --fqbn arduino:renesas_uno:unor4wifi arduino/SwampTag`
4. Ask the user to tap the fob and card while `& $cli monitor -p COMx -c baudrate=115200` runs. This needs the user at the hardware, so run it in the background or have the user run it. Expect `TAG:` lines.
5. Stop the monitor before the website connects. The port is exclusive.

## Serve the site
Run `python -m http.server 8000` from `website/` (in the background), then open http://localhost:8000 in Chrome or Edge.

## Demo checklist
1. Home page renders; links go to login → dashboard.
2. Connect reader → status dot turns green.
3. Simulate fraud *before* linking a key → the charge goes through (the "today's world" contrast).
4. Link a key → tap the fob → its UID shows and the card badge reads "SwampTag on".
5. Pay in store → tap the fob → ✓ on the matrix, Approved row "Verified with SwampTag".
6. Simulate fraud → tap the white card → ✗ on the matrix, Blocked row, Security Center alert.
7. Unplug the Arduino → the demo buttons and T/X keys still work.
8. Reset demo returns to the seeded state.

## Troubleshooting
| Symptom | Fix |
|---|---|
| `ERROR:READER` / ✗ at boot | RC522 wiring. Check 3.3V (not 5V), GND, SDA→D10, RST→D9. Unsoldered header pins are a common cause. |
| No `TAG:` lines but `READY` printed | Hold the tag flat on the reader for about 1 s. Check MISO→D12 and MOSI→D11 aren't swapped. |
| "Could not open the port" in the site | Serial Monitor or `arduino-cli monitor` is still open. Close it. |
| Connect button disabled | Not Chrome or Edge, or the page isn't on localhost/https. |
| Upload fails "port busy" | Close the browser tab or click Disconnect, then upload. |
| Tag taps don't approve | The linked UID is different from the tag being tapped. Re-link the key. |
| Upload fails or the board isn't detected | Double-tap the R4's RESET button to enter bootloader mode, then upload again. |
