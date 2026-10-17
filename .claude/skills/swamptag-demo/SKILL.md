---
name: swamptag-demo
description: Run the SwampTag demo end to end. Serve the site, connect the Pixel phone terminal (Web NFC over USB port forwarding), check key codes, run the demo checklist, and troubleshoot the phone terminal, Nessie, Auth0 and the old Arduino reader. Use when asked to run, test, demo or debug SwampTag.
---

# SwampTag demo runbook

## Paths
- Site root: `website/`. Phone terminal page: `website/terminal.html`.
- Server: `server.py`, with the relay and key check in `terminal.py`.
- Case: `cad/swamptag_terminal.scad`. Guide: `cad/README.md`.
- Old Arduino reader: CLI `$cli = "$env:LOCALAPPDATA\Programs\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe"`, FQBN `arduino:renesas_uno:unor4wifi`, sketch `arduino/SwampTag`.

## Serve the site
Run `python server.py` from the project root (in the background), then open http://localhost:8000 in Chrome or Edge.
- `curl -s localhost:8000/api/config` should report `"live": true`.
- If it reports `false`, the `reason` field says why: no key, not seeded, or Nessie unreachable.
- `python server.py --offline` gives demo data with no Nessie calls. Use it for tests.

## Connect the phone terminal (Pixel 6a)
1. On the phone, turn on USB debugging: Settings → About phone → tap Build number 7 times → Developer options.
2. Plug the phone into the laptop and allow debugging.
3. On the laptop, open `edge://inspect/#devices` → **Port forwarding** → `8000` → `localhost:8000`. Keep the tab open.
4. On the phone, open Chrome at `localhost:8000/terminal.html` and tap **Start terminal**.
5. The dashboard's **Terminal** row shows "Phone terminal connected".
- **Check the relay without a phone:**
  - `curl -s localhost:8000/api/terminal/state` (calling this marks the "phone" as online).
  - `curl -s -X POST localhost:8000/api/terminal/read -H "Content-Type: application/json" -d "{\"serialNumber\":\"04:A1:B2:C3\"}"`

## Nessie
- The key is in `.env`, which is committed to the private repo on purpose. Never print it.
- `python tools/seed_nessie.py --fresh` creates a clean demo account. Only do it if the team agrees, then commit the new `nessie_ids.json`.
- Check data through the proxy: `curl -s localhost:8000/api/nessie/accounts/<accountId>/purchases`. The `accountId` is in `nessie_ids.json`.
- API quirks are in CLAUDE.md.

## Demo checklist
1. The home page renders, and its links go to login → dashboard. The badge reads **Live · Capital One Nessie**.
2. The phone terminal is connected: the dashboard's Terminal row is green, and the phone shows "Ready for payment".
3. Simulate fraud *before* linking a key → the charge goes through (the "today's world" contrast).
4. Link a key: click Link a key → the phone says "Insert the key you want to link" → insert the key → its ID shows on the dashboard. In the tap-limit box, enter $50.
5. Pay in store → Starbucks $6 → approved with **no tap**. The phone shows "Within your tap limit".
6. Pay in store → UF Bookstore $90 → the phone shows $90.00 and "Insert your SwampTag key ▼" → insert the key → ✓ on the phone and the dashboard.
7. Simulate fraud → insert a copied key or a different key → ✗ on the phone with the reason, a Blocked row, and the Shield count goes up by 1.
8. Pay the $64 Duke Energy bill → needs the key, and the bill disappears from Upcoming bills.
9. Send $500 → choose "A family member says they are in trouble" → the warning is read aloud and the fraud line shows. Cancel keeps the money; demo code 2468 continues to the key.
10. With Auth0 configured: sign in, link a key, then sign in from another browser profile. The key is already linked.
11. **Fallbacks:** unplug the phone → the dashboard's T/X keys still work. On a laptop with no NFC, the terminal page shows Correct / Wrong key buttons.
12. Reset demo clears the key, alerts and blocked rows. Nessie data needs `--fresh`.

## Troubleshooting
| Symptom | Fix |
|---|---|
| Phone can't open `localhost:8000` | Port forwarding is off, or the inspect tab is closed. Re-add `8000 → localhost:8000` in edge://inspect, and make sure the server is running. |
| Terminal says "No Web NFC here" | It's not running in Chrome on Android, or NFC is off (Settings → Connected devices → NFC). Use the demo buttons meanwhile. |
| The phone doesn't react to the key | Hold it in the slot for a second. Check the key in the NFC Tools app on the bare phone. If the phone sees only the serial number, the key needs NTAG215 tags (`docs/KEY_FORMAT.md`). Re-measure `nfc_from_top` for the case. |
| Every key is blocked with "Key code doesn't match" | `KEY_SECRET` in `.env` doesn't match the key device's. Restart `server.py` after changing `.env`. |
| A good key is blocked with "Old key code" | The key device didn't raise its counter, or `key_counters.json` holds a higher counter from testing. Delete that file and restart the server. |
| Terminal picture is upside down | Tap the ⟲ button in the terminal's corner. The choice is remembered. |
| Badge says "Offline demo data" | Hover over it for the reason. Check `.env`, `nessie_ids.json`, and `curl localhost:8000/api/config`. |
| Auth0 login loops back to the login page | Check that the Callback, Logout and Web Origin URLs include `http://localhost:8000` and `/login.html`. Also check the `AUTH0_DOMAIN` and `AUTH0_CLIENT_ID` values in `.env`. |
| Auth0 error "not authorized to access resource server" | APIs → Auth0 Management API → Application Access → give the SPA user access with `read:current_user` and `update:current_user_metadata`. |
| Warning isn't read aloud | The device has no voice installed, or it's muted. The text is still on screen. |
| Nessie returns HTTP 400 | Field names changed. Probe with an extra field `{"zzz":1}`: the error lists required and rejected fields. |
| Old Arduino reader: `ERROR:READER` or no `TAG:` lines | RC522 wiring: 3.3V (not 5V), SDA→D10, RST→D9, MISO→D12, MOSI→D11. Close Serial Monitor before the site connects. |
