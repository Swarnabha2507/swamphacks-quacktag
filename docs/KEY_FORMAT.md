# QuackTag key and card format

What the **key device** (Feather RP2040 + RC522, `firmware/quacktag_key`) writes onto the tags, and what the **phone** (the Pixel 6a reading with Web NFC at `pump.html` or `terminal.html`) and `server.py` check.

## The key fob: a rotating code

One **NDEF Text record** (`en`), rewritten **right away when the fob is placed on the key device and then every 15 s** while it stays there:

```
ST1:<keyId>:<counter>:<code>
```

| Field | Rules | Example |
|---|---|---|
| `ST1` | Format version. | `ST1` |
| `keyId` | The fob's **UID in hex**, uppercase. It never changes. | `A1B2C3D4` |
| `counter` | Whole number that **goes up by 1 on every write**. Saved in the Feather's flash before each write, so a value is never reused. | `42` |
| `code` | First **8 hex characters** (uppercase) of HMAC-SHA256 with `KEY_SECRET`, over `<keyId>:<counter>`. | `3F9A0C1D` |

`KEY_SECRET` is the same random string in `.env` (laptop) and `firmware/quacktag_key/include/secrets.h` (key device).

## The fake debit card: a static record

Written once by the card-writer firmware (`pio run -e card`). You tap the fob first, so the card remembers which key it belongs to:

```
SC1:<last4>:<holder>:<keyId>        e.g.  SC1:4821:ALBERT GATOR:A1B2C3D4
```

## What the pump checks (`terminal.py` → `PumpAuthorizer`)
1. **Card:** an `SC1` record gives the last 4 digits, the holder and the paired `keyId`.
2. **PIN:** must equal `CARD_PIN` in `.env` (default `1234`). Three wrong PINs lock the card until the server restarts.
3. **Key** (`KeyChecker`):
   - **The code matches** the HMAC for that key ID and counter. Otherwise: "Key code doesn't match".
   - **The counter is higher** than the last one accepted for that key. Otherwise: "Old key code, possibly a copied key". A copied fob carries an old code.
   - **The key is the card's paired key.** Otherwise: "This key isn't paired with this card".
   - **If the card has an SC1 record but the fob has no ST1 code:** "This key has no QuackTag code". The fob needs to rest on its key device first.

After an approved sale, the fob's code is used up. Put it back on the key device for a fresh one.

**If the phone can only read tag IDs** (no NDEF data from MIFARE Classic):
- The pump falls back to **tag serial numbers**.
- Cards are paired with keys in the pump's ⚙ setup screen (`pairings.json`).
- That still blocks a different fob, but it **can't** catch a copied fob. Use NTAG213/215 tags for that.

## Tag layout (`firmware/quacktag_key/src/ndef_tag.cpp`)
- **NTAG21x / Ultralight:** the TLV `03 <len> <record> FE` from page 4.
- **MIFARE Classic 1K** (the kit's fob and card), formatted the NFC Forum way on first write:
  - **Sector 0 (MAD):** key A `A0A1A2A3A4A5`, access bits `78 77 88`, GPB `C1`, AID `03E1` for sectors 1–2.
  - **Sectors 1–2 (NDEF):** key A `D3F7D3F7D3F7`, access bits `7F 07 88`, GPB `40`.
  - **Key B stays `FFFFFFFFFFFF`** everywhere, so the firmware can always rewrite.
- **The RC522's antenna is off** except while it looks for a tag, so it doesn't interfere with the phone.

## Test without hardware
With the server running:
```
curl -X POST localhost:8000/api/pump/card -H "Content-Type: application/json" -d "{\"card\":{\"simulate\":\"card\"}}"
```
On a laptop, `pump.html` shows demo buttons (Tap demo card, Right key, Copied key, Wrong key) in place of NFC.
