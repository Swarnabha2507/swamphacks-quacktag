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
Run `python server.py` from the project root (in the background), then open http://localhost:8000 in Chrome or Edge.
- `curl -s localhost:8000/api/config` should report `"live": true`.
- If it reports `false`, the `reason` field says why: no key, not seeded, or Nessie unreachable.

## Nessie
- The key is in `.env` (gitignored). Never print or commit it.
- `python tools/seed_nessie.py --fresh` creates a clean demo account. Run it before judging, so earlier test payments don't clutter the activity list.
- Check data through the proxy: `curl -s localhost:8000/api/nessie/accounts/<accountId>/purchases`. The `accountId` is in `nessie_ids.json`.
- API quirks (whole dollars, 404 for empty lists, P2P = transfer + deposit) are listed in CLAUDE.md.
- Quick check of the risk rules: `node -e "const {assessRisk}=require('./website/js/risk.js'); ..."`

## Demo checklist
1. The home page renders, and its links go to login → dashboard. The badge reads **Live · Capital One Nessie**.
2. Connect reader → the status dot turns green.
3. Simulate fraud *before* linking a key → the charge goes through (the "today's world" contrast).
4. Link a key → tap the fob → its UID shows and the key tile reads "Protected". The tap-limit box opens with $200 filled in → enter $50 and save.
5. Pay in store → Starbucks $6 → approved with **no tap** (Trusted chip).
6. Pay in store → UF Bookstore $90 → "Over your $50 tap limit" shows → tap the fob → ✓ on the matrix, and the row reads "Verified with SwampTag".
7. Simulate fraud → the reasons show distance and spend → tap the white card → ✗ on the matrix, Blocked row, Shield count +1.
8. Send $25 → no tap (under the $50 limit). Pay the $64 Duke Energy bill → needs a tap, and the bill disappears from Upcoming bills.
9. Send $500 → choose "A family member says they are in trouble" → the warning is read aloud, the fraud line shows, and Cancel keeps the money. Demo code 2468 lets it continue to the tap.
10. With Auth0 configured: sign in, link a key, then sign in from another browser profile. The key is already linked.
11. Stop the server (or use `python server.py --offline`) or unplug the Arduino → the offline badge and the T/X keys still work.
10. Reset demo clears the key, alerts and blocked rows. Nessie data needs `--fresh`.

## Troubleshooting
| Symptom | Fix |
|---|---|
| `ERROR:READER` / ✗ at boot | RC522 wiring. Check 3.3V (not 5V), GND, SDA→D10, RST→D9. Unsoldered header pins are a common cause. |
| No `TAG:` lines but `READY` printed | Hold the tag flat on the reader for about 1 s. Check MISO→D12 and MOSI→D11 aren't swapped. |
| "Could not open the port" in the site | Serial Monitor or `arduino-cli monitor` is still open. Close it. |
| Connect button disabled | Not Chrome or Edge, or the page isn't on localhost/https. |
| Upload fails "port busy" | Close the browser tab or click Disconnect, then upload. |
| Tag taps don't approve | The linked UID is different from the tag being tapped. Re-link the key. |
| Badge says "Offline demo data" | Hover over it for the reason. Check `.env`, `nessie_ids.json`, and `curl localhost:8000/api/config`. |
| Fob doesn't read through the printed lid | Hold the fob flat on TAP HERE. Lower `rc_gap` or `tap_t` in `cad/swamptag_reader.scad` and reprint the lid. |
| Auth0 login loops back to the login page | Check that the Callback, Logout and Web Origin URLs include `http://localhost:8000` and `/login.html`. Also check the `AUTH0_DOMAIN` and `AUTH0_CLIENT_ID` values in `.env`. |
| Auth0 error "not authorized to access resource server" | APIs → Auth0 Management API → Application Access → give the SPA user access with `read:current_user` and `update:current_user_metadata`. |
| Warning isn't read aloud | The browser has no voice installed, or the tab is muted. The text is still on screen. |
| Nessie returns HTTP 400 | Field names changed. Probe with an extra field `{"zzz":1}`: the error lists required and rejected fields. |
| Upload fails or the board isn't detected | Double-tap the R4's RESET button to enter bootloader mode, then upload again. |
