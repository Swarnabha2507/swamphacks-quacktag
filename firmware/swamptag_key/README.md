# SwampTag key device firmware (Feather RP2040 + RC522)

Two programs in one PlatformIO project:

| Environment | What it does |
|---|---|
| **`key`** (default) | Rest the key fob on the reader. It writes a **fresh code onto the fob right away and then every 15 s** while the fob stays there. |
| **`card`** | Writes the **fake debit card** once. Tap the fob first (the card remembers which key it belongs to), then the card. |

The phone reads both tags at the gas pump (`website/pump.html`). Record formats are in [docs/KEY_FORMAT.md](../../docs/KEY_FORMAT.md).

## Wiring (RC522 → Feather RP2040)
Same as Diego's port:

| RC522 | Feather |
|---|---|
| SDA (SS) | 10 |
| SCK | SCK |
| MOSI | MO |
| MISO | MI |
| RST | 9 |
| GND | GND |
| 3.3V | **3V** (not USB/5V) |
| IRQ | not connected |

## Secret
`include/secrets.h` (gitignored) holds `KEY_SECRET`, and it **must equal `KEY_SECRET` in the project's `.env`**, or the pump says "Key code doesn't match". If `secrets.h` is missing, the build uses `secrets.example.h` and warns you. The card's last 4 digits and holder name are set in the same file.

## Build and flash in VS Code
1. **Open the workspace:** File → **Open Workspace from File…** → `SwampTag.code-workspace` (in the project root). PlatformIO only finds projects at the top of a workspace folder, and this file adds `firmware/swamptag_key` as one.
2. **Pick the program:** click the environment name in the blue status bar (it says `env:key`) and choose **`env:key`** (key device) or **`env:card`** (card writer).
3. **Build and upload:** use the status bar's **✓ Build** and **→ Upload** buttons.
   - Upload needs **no extra driver**. `tools/uf2_upload.py` reboots the Feather into its bootloader, waits for the **RPI-RP2** drive and copies `firmware.uf2` onto it.
   - If no Feather is found, hold **BOOT**, tap **RESET**, release BOOT, and press Upload again.
4. **Watch it:** click the **🔌 Serial Monitor** button (115200 baud). Close the monitor before uploading, since only one program can use the port.

**Command line:** the same from this folder, with `%USERPROFILE%\.platformio\penv\Scripts\pio.exe`:
```
pio run -e card -t upload   # card writer
pio run -e key -t upload    # key device
pio device monitor          # watch it
```

## What you'll see

**Key mode** (`key`):

| NeoPixel | Meaning |
|---|---|
| dim blue | waiting for the fob |
| blue | fob on the reader |
| green blink | new code written and checked (`WROTE ST1:...` in the monitor) |
| red blinks | write failed (the monitor shows why) |
| purple blinks | that tag type isn't supported |
| solid red at start | RC522 not found: check 3V, GND, SDA→10, RST→9 |

**Card mode** (`card`):

| NeoPixel | Meaning |
|---|---|
| blue | tap the **key fob** this card belongs to |
| purple | now tap the **card** |
| green | card written (`WROTE CARD <uid> SC1:...`); after 5 s it's ready for another |

## How the code works
- `src/main.cpp`: the key mode and the card mode (switched by the `CARD_WRITER` build flag).
  - The counter is saved in flash *before* each write, so a code is never reused.
  - The antenna is only on while it looks for a tag, so it doesn't interfere with the phone.
- `src/ndef_tag.cpp`: writes and reads one NDEF Text record on NTAG/Ultralight or MIFARE Classic 1K.
  - A factory-fresh Classic tag is formatted the NFC Forum way: a MAD in sector 0, and NDEF in sectors 1–2.
  - Key B stays `FFFFFFFFFFFF`, so the firmware can always rewrite it.

## Troubleshooting
| Problem | Fix |
|---|---|
| `ERROR:write failed: sector 0 isn't factory-fresh` | That tag was formatted by something else. Use a fresh tag, or reset it with a MIFARE tool. |
| `ERROR:unsupported tag type` | Use the kit's fob/card (MIFARE Classic 1K) or NTAG213/215 tags. |
| Writes work but the phone sees no data | The phone can't read MIFARE Classic data. Use the pump's ⚙ setup to pair by ID, or switch to NTAG215 tags. |
| Pump says "Key code doesn't match" | `KEY_SECRET` in `secrets.h` and `.env` differ. Fix it, rebuild, reflash, and restart `server.py`. |
