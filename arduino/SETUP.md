# SwampTag hardware setup

You only need the board, the RFID reader, 7 jumper wires, and the fob and card that came with the reader. The ✓ / ✗ feedback uses the **built-in LED matrix** on the UNO R4 WiFi, so there's nothing else to wire.

> **Using an Adafruit Feather RP2040 instead?** Skip to [Feather RP2040 version](#feather-rp2040-version) at the bottom.

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
3. Open `arduino/SwampTag_UNO_R4_WiFi/SwampTag_UNO_R4_WiFi.ino`, select **Arduino UNO R4 WiFi** and its COM port, then click **Upload**.

**Option B, terminal (`arduino-cli` comes with the IDE):**
```powershell
$cli = "$env:LOCALAPPDATA\Programs\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe"
& $cli board list                                   # find the COM port, e.g. COM5
& $cli compile --fqbn arduino:renesas_uno:unor4wifi arduino/SwampTag_UNO_R4_WiFi
& $cli upload  -p COM5 --fqbn arduino:renesas_uno:unor4wifi arduino/SwampTag_UNO_R4_WiFi
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

---

## Feather RP2040 version

Sketch: `arduino/TagReader/TagReader.ino` (on the `feature/tap-limit` branch; this `uno-r4-wifi` branch has only the UNO sketch). It sends the same messages to the website, so nothing on the website changes. The Feather has no LED matrix, so feedback uses its **onboard colour LED (NeoPixel)**.

### Wiring (RC522 → Feather RP2040)

| RC522 pin | Feather pin | Where |
|---|---|---|
| SDA (SS) | 10 | right header |
| SCK | SCK | left header |
| MOSI | MO | left header |
| MISO | MI | left header |
| IRQ | *not connected* | |
| GND | GND | left header |
| RST | 9 | right header (earlier diagrams said 7) |
| 3.3V | **3V** | left header. ⚠️ Not USB/5V. |

SCK, MO and MI are the Feather's default SPI pins, so the sketch only sets SDA (10) and RST (9).

### Software
1. **Board package:** Earle Philhower's **Raspberry Pi Pico/RP2040/RP2350** package (already installed on this laptop). To install it elsewhere, add this URL under File → Preferences → *Additional boards manager URLs*, then install the package from the Boards Manager:
   `https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json`
2. **Libraries:** **MFRC522** and **Adafruit NeoPixel** (both already installed).
3. **Upload:** select **Tools → Board → Raspberry Pi Pico/RP2040/RP2350 → Adafruit Feather RP2040** and the board's COM port, then click **Upload**.
   - If no port shows up, hold **BOOT**, tap **RESET**, release BOOT, and upload again. The board then appears as a USB drive called `RPI-RP2`.

From the terminal:
```powershell
$cli = "$env:LOCALAPPDATA\Programs\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe"
$cfg = "$env:USERPROFILE\.arduinoIDE\arduino-cli.yaml"
& $cli --config-file $cfg compile --fqbn rp2040:rp2040:adafruit_feather arduino/TagReader
& $cli --config-file $cfg upload  -p COM8 --fqbn rp2040:rp2040:adafruit_feather arduino/TagReader
```

### What the colour LED shows

| Colour | Meaning |
|---|---|
| dim white | idle, ready |
| blue, pulsing | waiting for a tap (a payment is pending) |
| green (3 s) | approved |
| red (3 s) | blocked |
| red, blinking | the RC522 wasn't found: check the wiring |

The Feather's USB serial loses anything printed before a program opens the port. So the sketch sends `READY` (or `ERROR:READER`) **each time the website or Serial Monitor connects**, not only at startup.
