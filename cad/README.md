# SwampTag 3D-printed parts

| File | What it is |
|---|---|
| **`swamptag_terminal.scad`** | **The phone terminal: a card-scanner case for the Pixel 6a.** This is the one for the demo. |
| **`swamptag_keybox.scad`** | **The key dock: a small case for the Feather RP2040 + RC522 + 7 jumper wires**, with a fob cradle on the lid. |
| `swamptag_reader.scad` | The old Arduino + RC522 reader box (see the bottom of this page). |

Printer: **Prusa CORE One+** (250 × 220 × 270 mm). Slice in PrusaSlicer with the CORE One profile.

---

# Phone terminal (`swamptag_terminal.scad`)

A countertop card terminal, styled like a Square terminal, with your **Pixel 6a as the screen**. The key goes into a slot under the screen, and the phone reads it with NFC.

```
 side view (cut through the slot)              front view
           ______  127 mm                         ┌──────────────┐
          /      |                                │ ┌──────────┐ │
         / Pixel |  phone face-up, portrait,      │ │  $90.00  │ │
        / (upside|  UPSIDE DOWN so its NFC spot   │ │  ((•))   │ │
       /  down)  |  is right above the slot       │ │ Insert   │ │
      / ═══════  |  30° tilt                      │ │ key ▼    │ │
 30mm/[slot]_____|                                │ └──────────┘ │
     front                USB-C out the top-back  │ ▔▔[ slot ]▔▔ │
                                                  └──────────────┘
```

| Part | What it is | Print time (CORE One+, approx.) |
|---|---|---|
| `body` | Rounded wedge (96 × 168 × 127 mm) with the key slot built in | ~3 h |
| `tray` | The screen frame the phone sits in. It drops into the body flush with the face | ~1.5 h |
| `fit_test` | The phone's top end of the tray (pocket corners + camera channel) and a slot gauge | ~15 min |
| `assembly` | Preview only, with a phone and a card in place | — |

## How it works
- **Phone placement:** the Pixel's NFC antenna is on its **back, near the camera**, so the phone sits **upside down**. That puts the camera end, and the NFC spot, at the bottom of the screen, right over the slot.
- **Picture orientation:** the terminal page (`website/terminal.html`) turns itself right side up.
- **The slot:** it runs **under the phone at the same 30° angle**, so the key ends up **2.4 mm under the phone's back** at the NFC spot.
- **Which key to use:**
  - **A card works best:** it sticks out of the slot like in a real terminal.
  - **A fob slides in all the way:** hold it by its keyring and let it slide back out.
  - In both cases, hold the key in for a second while the phone reads it.
- **Buttons and cable:**
  - The side buttons end up on the left, over a small groove, so the frame doesn't press them.
  - USB-C ends up at the top. The cable lies in a notch and leaves over the top-back corner.

## 1. Measure first (5 minutes, free **NFC Tools** app)
Open `swamptag_terminal.scad`. These settings are at the top:

| Setting | Default | How to measure |
|---|---|---|
| `nfc_from_top` | 45 | Open NFC Tools → Read. Slide the key slowly down the **back** of the phone from the top edge, and note where it reads best. |
| `cam_from_top`, `cam_len`, `cam_h` | 8, 22, 1.6 | Where the camera bar starts, its height, and how far it sticks out. |
| `btn_from`, `btn_to` | 35, 100 | Where the side buttons start and end, measured from the top edge. |
| `slot_h` | 7.5 | Key thickness + 1 mm. |

In NFC Tools, also check that the phone can read the **data** the key device wrote, not just the serial number. If it can't, see [docs/KEY_FORMAT.md](../docs/KEY_FORMAT.md) (switch to NTAG215 tags).

## 2. Export and print
1. In OpenSCAD, set `part` to `"fit_test"`, press **F6**, then **File → Export → Export as STL**.
2. **Print it and check the fit:**
   - The phone's top end drops into the pocket with the camera bar clearing the channel.
   - Your key and a card slide through the slot gauge.
3. Adjust `fit`, `slot_h` or the camera settings if needed.
4. Export and print `"body"` (**white PLA**) and `"tray"` (any color; dark grey looks like a screen frame).

| PrusaSlicer setting | Value |
|---|---|
| Printer / filament | Original Prusa CORE One+ / Prusament PLA |
| Layer height | 0.20 mm SPEED (or STRUCTURAL) |
| Perimeters | 3 |
| Infill | 15% gyroid |
| Supports | **None** |
| Orientation | Use the STLs as exported (body standing on its base, tray flat with the pocket facing up) |

## 3. Put it together
1. Drop the tray into the body's face. Its rim sits flush.
2. Plug the USB-C cable into the phone and lay it in the notch at the top.
3. Set the phone in the pocket **upside down**, camera end toward the slot.
4. Set up the phone as described in the main [README](../README.md): port forwarding, open `localhost:8000/terminal.html`, tap **Start terminal**.
5. Insert a key: the screen shows ✓ or ✗ and says it out loud.

## Troubleshooting
| Problem | Fix |
|---|---|
| The phone doesn't react to the key in the slot | Hold the key all the way in for a second. Re-measure `nfc_from_top`, and check the key in NFC Tools on the bare phone. |
| The phone rocks in the pocket | The camera bar is hitting the floor: raise `cam_h` or widen `cam_len`. |
| The side buttons get pressed | Increase `btn_relief`, or adjust `btn_from` / `btn_to`. |
| The tray is tight in the body | Increase `tray_fit` by 0.1 mm. |
| The picture is upside down | Tap the ⟲ button in the corner of the terminal page. |

---

# Key dock (`swamptag_keybox.scad`)

A small, clean case for the **key device**: the **Adafruit Feather RP2040** and the **RC522** side by side, with the **7 female-to-female jumpers** tidied underneath. The key fob rests in a cradle on the lid, right over the RC522's antenna, so it can be rewritten.

```
 top view (65 × 73 mm)                     side view (28.5 mm tall)
┌─────────────────────────────┐            ┌───────── lid + fob cradle ─────────┐
│  ╭─────────╮                │            │ RC522 ▔▔▔▔▔▔▔▔   Feather ▔▔▔▔▔▔    │
│  │ fob     │   RC522        │ ◄ front    │   ▼▼ female plugs ▼▼  ▼▼▼▼        │
│  │ cradle  │   (header ▶)   │            │  ═══ wires in the comb ═══  ◄USB-C │
│  ╰──   ───╯                 │            └────────────────────────────────────┘
│  ▔▔ comb (7 slots) ▔▔ clips │
│ ◄USB-C  Feather RP2040      │
└─────────────────────────────┘
```

| Part | What it is | Print time (CORE One+, approx.) |
|---|---|---|
| `base` | The box: Feather standoffs with press-fit pegs, RC522 corner posts, wire comb and clips, USB-C opening | ~1.5 h |
| `lid` | Flat lid that sits flush, with the fob cradle and a "SwampTag KEY" label | ~25 min |
| `fit_test` | Feather peg pattern, RC522 corner posts and a USB-C opening gauge | ~15 min |

- **Size:** 65 × 73 × 28.5 mm (2.57 × 2.87 × 1.12 in), with room inside for an RC522 of **59.4 × 39.1 mm (2.34 × 1.54 in)**.
- **Why 28.5 mm and not 25.4 mm (1 in):** both boards' pins point down, and a female plug hangs about 17 mm below each board (2.5 mm header plastic + 14 mm plug). 28.5 mm is the smallest box that fits that. To go thinner:
  - Re-solder the Feather's headers pins-up, or use right-angle headers.
  - Or solder the wires directly to the boards.
  - Then lower `under_clear`.
- **Wires:** plug the jumpers onto both boards **before** putting the boards in. Then lay the 7 wires through the slots of the comb on the floor, and tuck any spare length under the two clips.
- **Fob:** it sits 6.3 mm above the RC522 (well inside its range). The front opening of the cradle lets you slide it out.
- **Printing:** no supports. Print the base standing on its floor and the lid flat, cradle up. White PLA for the base matches the terminal.

**Measure before printing:**

| Setting | Default | What to measure |
|---|---|---|
| `rc_l`, `rc_w` | 59.4, 39.1 | The RC522 board size (your 2.34 × 1.54 in) |
| `fe_top_clear` | 6.5 | Height of the tallest part on top of the Feather (the battery connector) + 0.5 |
| `rc_top_clear` | 4.5 | Height of the tallest part on top of the RC522 (the crystal) + 0.5 |
| `under_clear` | 17 | Header plastic + the length of your female plug + 0.5 |
| `fob_l`, `fob_w` | 41, 32 | Your key fob |

---

# Old: Arduino reader box (`swamptag_reader.scad`)

The original design, from before the phone became the reader. Keep it for the USB reader or the key device.

An angled card terminal that holds the **Arduino UNO R4 WiFi** and the **RC522 RFID reader** from the Super Starter Kit.
- No screws.
- No changes to the wiring or the sketch.
- The LED matrix's ✓ / ✗ shows through a window on top.

```
 side view                                      top view (112 × 84 mm)
          ________________________ 54 mm        ┌───────────────┬───────────┐
         /  [LED window]   ((•))  |             │  LED window   │   ((•))   │  back
        /                         |  12° slope  │   (✓ / ✗)     │ TAP HERE  │
 36 mm /__________________________|             │  UNO R4 WiFi  │  RC522    │
       front          USB-C out the back ─►     │  "SwampTag"   │           │  front
                                                └───────────────┴───────────┘
```

| Part | What it is | Print time (approx.) |
|---|---|---|
| `base` | Tray with 4 press-fit pegs for the R4, and a USB-C opening in the back wall | ~2 h |
| `lid` | Sloped top: RC522 clip frame under a thin tap zone, LED window with a light tunnel, debossed logo | ~3 h |
| `diffuser` | 0.8 mm plate that sits in the window from inside, so the LEDs glow evenly | ~10 min |
| `fit_test` | Peg ring + USB-C opening + RC522 clip frame, to check your measurements | ~25 min |

Every part fits a 180 × 180 mm bed.

## 1. Measure first (5 minutes, with a ruler or calipers)

Open [swamptag_reader.scad](swamptag_reader.scad). Every measurement is at the top. Hold the R4 **components up, with the USB-C edge on the LEFT**:
- **x** = distance from that left edge
- **y** = distance from the **bottom** edge (the edge with the POWER / ANALOG headers)

| Setting | Default | What to measure |
|---|---|---|
| `uno_l`, `uno_w` | 68.6, 53.3 | Board length (left to right) and width |
| `usb_center_y` | 38.0 | y of the middle of the USB-C port |
| `matrix_center` | [41, 26] | x and y of the middle of the 12 × 8 LED grid |
| `matrix_size` | [26, 18] | Size of the LED grid (along x, along y) |
| `rc_w`, `rc_l` | 39, 60 | RC522 short side (the header side) and long side |
| `rc_gap` | 4 | Space above the RC522 for its tallest part or pin tips. Raise it if your header pins poke out the "wrong" side |

The mounting holes (`uno_holes`) are the standard Uno pattern and usually don't need changing.

## 2. Export the STL files

1. Install OpenSCAD (free): https://openscad.org/downloads.html
2. Open `cad/swamptag_reader.scad`. Press **F5** for a quick preview of the full assembly.
3. Change the first setting, `part = "assembly";`, to `"fit_test"`. You can also use the Customizer panel (Window → Customizer).
4. Press **F6** (render). Larger parts take a minute or two.
5. Choose **File → Export → Export as STL**.
6. Repeat for `"base"`, `"lid"` and `"diffuser"`.

The `lid` part comes out **already flipped** so its sloped top lies flat on the bed.

## 3. Print

| Setting | Value |
|---|---|
| Material | PLA. Lid in a dark color, diffuser in **white or natural** |
| Layer height | 0.2 mm |
| Walls | 3 |
| Infill | 15% gyroid |
| Supports | **None** |
| Orientation | Use the STLs as exported: base floor down, lid top down, diffuser flat |

1. **Print `fit_test` first.** Check that:
   - the R4 presses onto the 4 pegs snugly
   - a USB-C plug fits through the opening
   - the RC522 snaps into the frame
2. Adjust `peg_d`, `usb_cut` or the RC522 sizes if anything is off.
3. Then print the full parts.

There's no printer at your table? Ask the SwampHacks hardware desk, or a UF makerspace such as Marston Science Library's.

## 4. Assemble (5 minutes)

1. **R4:** press the board onto the 4 pegs in the base, with USB-C toward the back opening.
2. **RC522:**
   1. Flip the lid upside down.
   2. Push the reader into the clip frame until it snaps past the two small lips, with the **8-pin header toward the back**, where the frame has an opening.
   3. If it's loose, add a dab of hot glue or a strip of tape.
3. **Wires:** connect the 7 jumpers exactly as in [arduino/SETUP.md](../arduino/SETUP.md) (3.3V, not 5V). Leave a little slack.
4. **Diffuser:** press it into the window recess from the inside.
5. **Close:** lower the lid onto the base. The lip slides inside the walls and two small bumps click into place.
6. **Test:** plug in USB-C. You should see the lock icon through the window, and tapping the fob on **TAP HERE** should show ✓.

## Troubleshooting

| Problem | Fix |
|---|---|
| The tag doesn't read through the lid | Hold the fob flat on TAP HERE. Lower `rc_gap` (if your board allows) or `tap_t` (min 0.8). |
| LEDs look blurry or dim | Use a white diffuser, or print without it. Check `matrix_center` against your board. |
| USB-C plug doesn't reach | Lower `board_gap_back` (keep the barrel jack clear), or enlarge `usb_cut`. |
| Lid is too tight or loose | Change `fit` (clearance) in steps of 0.1 mm. |
| Pegs are too tight or loose | Change `peg_d` in steps of 0.1 mm. |
| Jumper plugs hit the lid | Raise `H_f` (front height) by a few mm. |

The model uses only built-in OpenSCAD features, with no libraries. It hasn't been rendered or printed yet, so print the fit test before committing to the ~5 hours of full parts.
