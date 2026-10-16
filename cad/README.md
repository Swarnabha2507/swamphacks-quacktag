# SwampTag reader enclosure

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
