# SwampTag key format

This is the agreement between the **key device** (Arduino + RC522 that rewrites the fob) and the **phone terminal** (the Pixel in the card-scanner case, which reads the fob). The format below is a **proposal**; the key-device builder should confirm it or tell us what to change.

## What the key device writes

One **NDEF Text record** on the tag:

```
ST1:<keyId>:<counter>:<code>
```

| Field | Rules | Example |
|---|---|---|
| `ST1` | Format version. Always `ST1`. | `ST1` |
| `keyId` | 1–32 letters, digits or `-`. Stays the same for this key. This is what gets linked to the card. | `A1B2C3` |
| `counter` | Whole number, 0–9999999999. **Goes up by at least 1 every time the tag is rewritten.** Store it in EEPROM so it survives a reset. | `42` |
| `code` | First **8 hex characters** (uppercase) of HMAC-SHA256 with the key `KEY_SECRET`, over the message `<keyId>:<counter>`. | `3F9A0C1D` |

Example record: `ST1:A1B2C3:42:3F9A0C1D`

## What the terminal checks
`terminal.py` → `KeyChecker.check()`:
1. **The code matches** the HMAC for that key ID and counter. Otherwise the key is blocked with "Key code doesn't match".
2. **The counter is higher** than the last one accepted for that key. Otherwise it's blocked with "Old key code, possibly a copied key". A copied tag carries an old code, and the real key has moved on.
3. If both pass, the dashboard gets `TAG:<keyId>` and compares it with the linked key.

**Fallbacks, so the demo works before the key firmware is ready:**
- **No `KEY_SECRET` in `.env`:** `ST1` codes are accepted without checking.
- **No `ST1` record on the tag:** the tag's **serial number** is used as the key ID, like the old USB reader.

`KEY_SECRET` goes in `.env` on the laptop and in the key device's firmware. Use the same random string in both, at least 16 characters.

## Notes for the key device
- **Tag type:** the Pixel 6a must be able to read the NDEF data.
  - Check this first with the NFC Tools app.
  - Kit fobs are usually **MIFARE Classic**, which many Android phones can't read beyond the serial number. If the Pixel can't read your record, use **NTAG213/215** tags. The RC522 can write those through the MFRC522 library's Ultralight functions.
- **Turn the RC522's antenna off between writes** (`PCD_AntennaOff()`). An active reader field can stop the phone from reading the tag.
- **Write the full NDEF message each time.** Use the standard text record with an `en` language code, so Chrome's Web NFC decodes it as text.

## Test without the key device
Send a fake read to the running server:
```
curl -X POST localhost:8000/api/terminal/read -H "Content-Type: application/json" -d "{\"texts\":[\"ST1:A1B2C3:42:3F9A0C1D\"]}"
```
The response is the line the dashboard receives (`TAG:…` or `BADTAG:…`).
