# SwampTag hardware setup

You only need the board, the RFID reader, 7 jumper wires, and the fob and card that came with the reader. The ✓ / ✗ feedback uses the **built-in LED matrix** on the UNO R4 WiFi, so there's nothing else to wire.

## Parts

| Part | Notes |
|---|---|
| Arduino UNO R4 WiFi | with a USB-C data cable |
| RC522 RFID module | the blue board, usually sold with a white card and a blue key fob |
| 7 female-to-male jumper wires | |
| Key fob | the **real owner's** SwampTag key |
| White card | plays the **thief's tag** in the demo |
| *(optional)* piezo buzzer | + leg to D8, − leg to GND, then set `USE_BUZZER 1` in the sketch |

## Wiring (RC522 → UNO R4 WiFi)

Unplug USB before wiring.

| RC522 pin | UNO R4 WiFi pin | Wire tip |
|---|---|---|
| SDA (SS) | D10 | |
| SCK | D13 | |
| MOSI | D11 | |
| MISO | D12 | |
| IRQ | *not connected* | |
| GND | GND | |
| RST | D9 | |
| 3.3V | **3.3V** | ⚠️ **Not 5V.** 5V can damage the RC522. |

```
 RC522                     UNO R4 WiFi
 ┌──────────┐
 │ SDA  ────┼──────────── D10
 │ SCK  ────┼──────────── D13
 │ MOSI ────┼──────────── D11
 │ MISO ────┼──────────── D12
 │ IRQ      │  (empty)
 │ GND  ────┼──────────── GND
 │ RST  ────┼──────────── D9
 │ 3.3V ────┼──────────── 3.3V
 └──────────┘
```

If your RC522 came without headers soldered on, the jumpers won't make reliable contact. Ask the hardware table at SwampHacks for a soldering iron, or press the pins in firmly for testing.

## Software

**Option A, Arduino IDE (click-through):**
1. Tools → Board → Boards Manager → install **Arduino UNO R4 Boards** (already installed on this laptop).
2. Tools → Manage Libraries → install **MFRC522** by GithubCommunity (already installed). The IDE may warn that the library "may be incompatible" with the R4. You can ignore that because it works fine.
3. Open `arduino/SwampTag/SwampTag.ino`, select **Arduino UNO R4 WiFi** and its COM port, then click **Upload**.

**Option B, terminal (`arduino-cli` comes with the IDE):**
```powershell
$cli = "$env:LOCALAPPDATA\Programs\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe"
& $cli board list                                   # find the COM port, e.g. COM5
& $cli compile --fqbn arduino:renesas_uno:unor4wifi arduino/SwampTag
& $cli upload  -p COM5 --fqbn arduino:renesas_uno:unor4wifi arduino/SwampTag
& $cli monitor -p COM5 -c baudrate=115200           # Ctrl+C to quit
```

## Test it

1. Open Serial Monitor at **115200 baud**. Press the board's RESET button and you should see `READY`.
   - If you see `ERROR:READER` and an ✗ on the LED matrix, the RC522 isn't responding. Recheck the wiring, especially 3.3V and GND.
2. Tap the fob and you should see a line like `TAG:A1B2C3D4`. Tap the card and you should see a different UID.
3. Type `WAIT`, `OK`, `DENY` and `IDLE` into Serial Monitor to check the LED matrix animations.
4. **Close Serial Monitor.** Only one program can use the COM port at a time, and the website needs it.

## What the LED matrix shows

| Icon | Meaning |
|---|---|
| 🔒 lock | idle, ready |
| expanding square | waiting for a tap (a payment is pending) |
| ✓ | approved (3 s) |
| ✗ | blocked (3 s), or the reader wasn't found at startup |

## Serial protocol (115200 baud, newline-terminated)

| Direction | Message | Meaning |
|---|---|---|
| Arduino → site | `READY` | reader initialized |
| Arduino → site | `ERROR:READER` | RC522 not detected |
| Arduino → site | `TAG:<HEX UID>` | a tag was tapped |
| site → Arduino | `WAIT` / `OK` / `DENY` / `IDLE` | change the LED matrix |

The website decides whether a tag is allowed. The Arduino only reads tags and shows results.
