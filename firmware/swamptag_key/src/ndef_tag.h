// Write and read one NDEF Text record on the tag that's selected on the RC522.
// Works with NTAG21x / MIFARE Ultralight and MIFARE Classic 1K (the kit's fob and card).
// The phone reads the record with Chrome's Web NFC.
#pragma once

#include <Arduino.h>
#include <MFRC522.h>

namespace NdefTag {

enum class Kind { Unsupported, Ultralight, Classic1K };

// What kind of tag is selected right now (call after the tag is selected).
Kind kindOf(MFRC522 &rfid);
const char *kindName(Kind kind);

// Writes `text` as the tag's only NDEF record. Formats a factory-fresh MIFARE Classic
// card for NDEF first. Returns false and fills `err` on failure.
bool writeText(MFRC522 &rfid, const String &text, String &err);

// Reads the tag's first NDEF Text record into `out`.
bool readText(MFRC522 &rfid, String &out, String &err);

// Wakes and selects whatever tag is on the reader (also one that was halted).
bool select(MFRC522 &rfid);

// Tag UID as uppercase hex, e.g. "A1B2C3D4".
String uidHex(const MFRC522 &rfid);

}  // namespace NdefTag
