"""Upload for PlatformIO's Upload button without extra Windows drivers.

picotool (PlatformIO's default for the RP2040) needs a WinUSB driver from Zadig on
Windows. This does what the Arduino IDE does instead:
  1. If the RPI-RP2 boot drive isn't there yet, open the board's serial port at
     1200 baud, which reboots the Feather into its bootloader.
  2. Wait for the RPI-RP2 drive and copy firmware.uf2 onto it. The board flashes
     itself and restarts.

Called by platformio.ini:  python tools/uf2_upload.py <firmware.uf2> [port]
"""

import os
import shutil
import string
import sys
import time

BOARD_USB_IDS = {0x239A, 0x2E8A}  # Adafruit, Raspberry Pi


def find_boot_drive():
    for letter in string.ascii_uppercase:
        info = f"{letter}:\\INFO_UF2.TXT"
        try:
            with open(info, encoding="utf-8", errors="replace") as f:
                if "RPI-RP2" in f.read():
                    return f"{letter}:\\"
        except OSError:
            continue
    return None


def find_port(requested):
    if requested:
        return requested
    try:
        from serial.tools import list_ports
    except ImportError:
        return None
    for p in list_ports.comports():
        if p.vid in BOARD_USB_IDS:
            return p.device
    return None


def reboot_to_bootloader(port):
    import serial

    print(f"Rebooting the board on {port} into its bootloader (1200 baud touch)...")
    try:
        with serial.Serial(port, 1200) as s:
            s.dtr = False
    except (serial.SerialException, OSError) as err:
        # The board drops off USB while rebooting, which can show up as an error here.
        print(f"  ({err.__class__.__name__}: that's normal while it reboots)")


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: uf2_upload.py <firmware.uf2> [port]")
    uf2 = sys.argv[1]
    if not os.path.exists(uf2):
        sys.exit(f"{uf2} not found. Build first.")

    drive = find_boot_drive()
    if not drive:
        port = find_port(sys.argv[2] if len(sys.argv) > 2 else None)
        if not port:
            sys.exit("No Feather found. Plug it in, or hold BOOT, tap RESET and release BOOT, then upload again.")
        reboot_to_bootloader(port)
        for _ in range(40):  # up to 10 s
            time.sleep(0.25)
            drive = find_boot_drive()
            if drive:
                break
    if not drive:
        sys.exit("The RPI-RP2 drive didn't appear. Hold BOOT, tap RESET, release BOOT, then upload again.")

    print(f"Copying {os.path.basename(uf2)} to {drive} ...")
    shutil.copyfile(uf2, os.path.join(drive, "firmware.uf2"))
    print("Done. The Feather flashes itself and restarts (its COM port number may change).")


if __name__ == "__main__":
    main()
