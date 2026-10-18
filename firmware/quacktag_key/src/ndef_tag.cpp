#include "ndef_tag.h"

namespace NdefTag {

namespace {

// ---------- NDEF message: one Text record in a TLV ----------

// TLV 03 <len> [D1 01 <payloadLen> 'T' 02 'e' 'n' <text>] FE
size_t buildTlv(const String &text, uint8_t *out, size_t cap) {
  const size_t payloadLen = 3 + text.length();  // status byte + "en" + text
  const size_t recordLen = 4 + payloadLen;      // header + type length + payload length + 'T'
  const size_t total = 2 + recordLen + 1;
  if (payloadLen > 255 || recordLen > 254 || total > cap) return 0;
  size_t i = 0;
  out[i++] = 0x03;
  out[i++] = (uint8_t)recordLen;
  out[i++] = 0xD1;  // MB | ME | SR, TNF = well-known
  out[i++] = 0x01;  // type length
  out[i++] = (uint8_t)payloadLen;
  out[i++] = 'T';
  out[i++] = 0x02;  // UTF-8, language code is 2 bytes
  out[i++] = 'e';
  out[i++] = 'n';
  for (size_t k = 0; k < text.length(); k++) out[i++] = (uint8_t)text[k];
  out[i++] = 0xFE;  // terminator
  return i;
}

// Finds the first Text record in raw tag memory that starts with a TLV area.
bool parseTlv(const uint8_t *data, size_t len, String &out) {
  size_t i = 0;
  while (i < len) {
    const uint8_t t = data[i];
    if (t == 0x00) { i++; continue; }        // NULL TLV
    if (t == 0xFE) return false;             // end, no NDEF found
    if (i + 1 >= len) return false;
    size_t l = data[i + 1];
    size_t start = i + 2;
    if (l == 0xFF) {                         // 3-byte length form
      if (i + 3 >= len) return false;
      l = ((size_t)data[i + 2] << 8) | data[i + 3];
      start = i + 4;
    }
    if (t != 0x03) { i = start + l; continue; }
    if (start + l > len || l < 4) return false;
    const uint8_t *rec = data + start;
    const uint8_t header = rec[0];
    if (!(header & 0x10)) return false;      // only short records
    const uint8_t typeLen = rec[1];
    const uint8_t payloadLen = rec[2];
    const uint8_t idLen = (header & 0x08) ? rec[3] : 0;
    const size_t typeAt = 3 + ((header & 0x08) ? 1 : 0);
    const size_t payloadAt = typeAt + typeLen + idLen;
    if (typeLen != 1 || rec[typeAt] != 'T' || payloadAt + payloadLen > l) return false;
    const uint8_t langLen = rec[payloadAt] & 0x3F;
    out = "";
    for (size_t k = payloadAt + 1 + langLen; k < payloadAt + payloadLen; k++) out += (char)rec[k];
    return true;
  }
  return false;
}

// ---------- NTAG21x / Ultralight ----------

bool ultralightWrite(MFRC522 &rfid, const String &text, String &err) {
  uint8_t buf[144];
  const size_t n = buildTlv(text, buf, sizeof(buf));
  if (!n) { err = "record too long"; return false; }

  // Capability container (page 3). NTAG ships with one; plain Ultralight may not.
  uint8_t cc[18];
  uint8_t size = sizeof(cc);
  if (rfid.MIFARE_Read(3, cc, &size) != MFRC522::STATUS_OK) { err = "can't read page 3"; return false; }
  if (cc[0] != 0xE1) {
    uint8_t newCc[4] = {0xE1, 0x10, 0x06, 0x00};  // 48-byte data area (Ultralight)
    if (rfid.MIFARE_Ultralight_Write(3, newCc, 4) != MFRC522::STATUS_OK) { err = "can't write capability container"; return false; }
  }

  for (size_t off = 0; off < n; off += 4) {
    uint8_t page[4] = {0, 0, 0, 0};
    for (size_t k = 0; k < 4 && off + k < n; k++) page[k] = buf[off + k];
    if (rfid.MIFARE_Ultralight_Write(4 + off / 4, page, 4) != MFRC522::STATUS_OK) {
      err = "write failed at page " + String(4 + off / 4);
      return false;
    }
  }
  return true;
}

bool ultralightRead(MFRC522 &rfid, String &out, String &err) {
  uint8_t data[64];
  for (uint8_t p = 0; p < 16; p += 4) {  // pages 4..19
    uint8_t buf[18];
    uint8_t size = sizeof(buf);
    if (rfid.MIFARE_Read(4 + p, buf, &size) != MFRC522::STATUS_OK) { err = "read failed"; return false; }
    memcpy(data + p * 4, buf, 16);
  }
  if (!parseTlv(data, sizeof(data), out)) { err = "no text record"; return false; }
  return true;
}

// ---------- MIFARE Classic 1K (NFC Forum layout) ----------
// Sector 0 = MAD saying "sectors 1 and 2 hold NDEF". Sectors 1-2 hold the TLV.
// Key B stays FFFFFFFFFFFF everywhere, so this firmware can rewrite the card any time.

MFRC522::MIFARE_Key keyOf(const uint8_t b[6]) {
  MFRC522::MIFARE_Key k;
  for (uint8_t i = 0; i < 6; i++) k.keyByte[i] = b[i];
  return k;
}

const uint8_t KEY_FACTORY[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
const uint8_t KEY_MAD_A[6] = {0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5};
const uint8_t KEY_NDEF_A[6] = {0xD3, 0xF7, 0xD3, 0xF7, 0xD3, 0xF7};
const uint8_t NDEF_SECTORS = 2;  // sectors 1 and 2 → 6 data blocks = 96 bytes

uint8_t madCrc(const uint8_t *data, size_t len) {
  uint8_t crc = 0xC7;  // CRC-8, poly 0x1D (checked against the NFC Forum example: 0x14)
  for (size_t i = 0; i < len; i++) {
    crc ^= data[i];
    for (uint8_t b = 0; b < 8; b++) crc = (crc & 0x80) ? (uint8_t)((crc << 1) ^ 0x1D) : (uint8_t)(crc << 1);
  }
  return crc;
}

bool auth(MFRC522 &rfid, MFRC522::PICC_Command cmd, uint8_t block, const uint8_t key[6]) {
  MFRC522::MIFARE_Key k = keyOf(key);
  return rfid.PCD_Authenticate(cmd, block, &k, &rfid.uid) == MFRC522::STATUS_OK;
}

// A failed authentication drops the tag, so select it again before the next try.
bool authOrReselect(MFRC522 &rfid, MFRC522::PICC_Command cmd, uint8_t block, const uint8_t key[6]) {
  if (auth(rfid, cmd, block, key)) return true;
  rfid.PCD_StopCrypto1();
  select(rfid);
  return false;
}

bool writeBlock(MFRC522 &rfid, uint8_t block, const uint8_t data[16]) {
  uint8_t copy[16];
  memcpy(copy, data, 16);
  return rfid.MIFARE_Write(block, copy, 16) == MFRC522::STATUS_OK;
}

bool writeTrailer(MFRC522 &rfid, uint8_t block, const uint8_t keyA[6], uint8_t a0, uint8_t a1, uint8_t a2, uint8_t gpb) {
  uint8_t t[16];
  memcpy(t, keyA, 6);
  t[6] = a0; t[7] = a1; t[8] = a2; t[9] = gpb;
  memcpy(t + 10, KEY_FACTORY, 6);  // key B
  return writeBlock(rfid, block, t);
}

// How a sector opens: Fresh = factory key A (FF..FF), Ours = already formatted by us
// (key B is still FF..FF), Locked = neither.
enum class Unlock { Fresh, Ours, Locked };

Unlock unlockSector(MFRC522 &rfid, uint8_t trailer) {
  if (authOrReselect(rfid, MFRC522::PICC_CMD_MF_AUTH_KEY_A, trailer, KEY_FACTORY)) return Unlock::Fresh;
  if (authOrReselect(rfid, MFRC522::PICC_CMD_MF_AUTH_KEY_B, trailer, KEY_FACTORY)) {
    // On a factory sector key B is readable and "opens" without granting anything.
    // Our trailers can be read with key B, so a successful read proves the sector is ours.
    uint8_t t[18];
    uint8_t size = sizeof(t);
    if (rfid.MIFARE_Read(trailer, t, &size) == MFRC522::STATUS_OK) return Unlock::Ours;
    rfid.PCD_StopCrypto1();
    select(rfid);
  }
  return Unlock::Locked;
}

// Makes sectors 0-2 an NDEF card. Safe to run again on a card that was lifted off halfway
// through: fresh sectors get formatted, sectors we already formatted are left alone.
bool classicFormat(MFRC522 &rfid, String &err) {
  // Sector 0: MAD (rewritten either way; key A and key B may both write it)
  const Unlock mad0 = unlockSector(rfid, 3);
  if (mad0 == Unlock::Locked) { err = "sector 0 is locked with an unknown key"; return false; }
  uint8_t mad[32] = {0};  // block 1 + block 2
  mad[1] = 0x01;          // info byte
  for (uint8_t s = 1; s <= NDEF_SECTORS; s++) { mad[s * 2] = 0x03; mad[s * 2 + 1] = 0xE1; }  // AID 0xE103 = NDEF
  mad[0] = madCrc(mad + 1, 31);
  if (!writeBlock(rfid, 1, mad) || !writeBlock(rfid, 2, mad + 16)) { err = "MAD write failed"; return false; }
  if (mad0 == Unlock::Fresh && !writeTrailer(rfid, 3, KEY_MAD_A, 0x78, 0x77, 0x88, 0xC1)) { err = "MAD trailer write failed"; return false; }

  // Sectors 1..2: empty NDEF area + NDEF trailers
  for (uint8_t s = 1; s <= NDEF_SECTORS; s++) {
    const uint8_t first = s * 4;
    const Unlock u = unlockSector(rfid, first + 3);
    if (u == Unlock::Locked) { err = "sector " + String(s) + " is locked with an unknown key"; return false; }
    if (u == Unlock::Ours) continue;
    static const uint8_t ZERO[16] = {0};
    uint8_t empty[16] = {0};
    if (s == 1) { empty[0] = 0x03; empty[1] = 0x00; empty[2] = 0xFE; }  // empty NDEF TLV
    for (uint8_t b = 0; b < 3; b++) {
      if (!writeBlock(rfid, first + b, b == 0 ? empty : ZERO)) { err = "data write failed"; return false; }
    }
    if (!writeTrailer(rfid, first + 3, KEY_NDEF_A, 0x7F, 0x07, 0x88, 0x40)) { err = "NDEF trailer write failed"; return false; }
  }
  return true;
}

// Writes the TLV into sectors 1..2 with key B. Fails on a card that isn't fully formatted yet.
bool classicWriteSectors(MFRC522 &rfid, const uint8_t *buf, String &err) {
  for (uint8_t s = 1; s <= NDEF_SECTORS; s++) {
    const uint8_t first = s * 4;
    if (!authOrReselect(rfid, MFRC522::PICC_CMD_MF_AUTH_KEY_B, first + 3, KEY_FACTORY)) {
      err = "can't unlock sector " + String(s) + " (not a QuackTag-formatted card?)";
      return false;
    }
    for (uint8_t b = 0; b < 3; b++) {
      if (!writeBlock(rfid, first + b, buf + ((s - 1) * 3 + b) * 16)) {
        err = "write failed at block " + String(first + b);
        rfid.PCD_StopCrypto1();
        select(rfid);
        return false;
      }
    }
  }
  rfid.PCD_StopCrypto1();
  return true;
}

bool classicWrite(MFRC522 &rfid, const String &text, String &err) {
  uint8_t buf[16 * 3 * NDEF_SECTORS];
  memset(buf, 0, sizeof(buf));
  const size_t n = buildTlv(text, buf, sizeof(buf));
  if (!n) { err = "record too long"; return false; }

  // Factory-fresh? (key A still FF..FF on sector 1) → format first.
  if (auth(rfid, MFRC522::PICC_CMD_MF_AUTH_KEY_A, 7, KEY_FACTORY)) {
    rfid.PCD_StopCrypto1();
    select(rfid);
    if (!classicFormat(rfid, err)) return false;
  } else {
    rfid.PCD_StopCrypto1();
    select(rfid);
  }
  if (classicWriteSectors(rfid, buf, err)) return true;

  // A sector is still fresh (an earlier format was cut short): finish formatting, try once more.
  if (!classicFormat(rfid, err)) return false;
  return classicWriteSectors(rfid, buf, err);
}

bool classicRead(MFRC522 &rfid, String &out, String &err) {
  uint8_t data[16 * 3 * NDEF_SECTORS];
  for (uint8_t s = 1; s <= NDEF_SECTORS; s++) {
    const uint8_t first = s * 4;
    if (!authOrReselect(rfid, MFRC522::PICC_CMD_MF_AUTH_KEY_A, first + 3, KEY_NDEF_A)) { err = "not NDEF-formatted"; return false; }
    for (uint8_t b = 0; b < 3; b++) {
      uint8_t blk[18];
      uint8_t size = sizeof(blk);
      if (rfid.MIFARE_Read(first + b, blk, &size) != MFRC522::STATUS_OK) { err = "read failed"; return false; }
      memcpy(data + ((s - 1) * 3 + b) * 16, blk, 16);
    }
  }
  rfid.PCD_StopCrypto1();
  if (!parseTlv(data, sizeof(data), out)) { err = "no text record"; return false; }
  return true;
}

}  // namespace

// ---------- Public API ----------

// A card that was just authenticated ignores the first wake-up (it drops back to idle
// instead), so try a few times.
bool select(MFRC522 &rfid) {
  for (uint8_t attempt = 0; attempt < 3; attempt++) {
    uint8_t atqa[2];
    uint8_t size = sizeof(atqa);
    const MFRC522::StatusCode s = rfid.PICC_WakeupA(atqa, &size);
    if ((s == MFRC522::STATUS_OK || s == MFRC522::STATUS_COLLISION) && rfid.PICC_ReadCardSerial()) return true;
  }
  return false;
}

String uidHex(const MFRC522 &rfid) {
  String s;
  for (uint8_t i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) s += '0';
    s += String(rfid.uid.uidByte[i], HEX);
  }
  s.toUpperCase();
  return s;
}

Kind kindOf(MFRC522 &rfid) {
  switch (rfid.PICC_GetType(rfid.uid.sak)) {
    case MFRC522::PICC_TYPE_MIFARE_UL: return Kind::Ultralight;  // NTAG21x reports as Ultralight
    case MFRC522::PICC_TYPE_MIFARE_1K: return Kind::Classic1K;
    default: return Kind::Unsupported;
  }
}

const char *kindName(Kind kind) {
  switch (kind) {
    case Kind::Ultralight: return "NTAG/Ultralight";
    case Kind::Classic1K: return "MIFARE Classic 1K";
    default: return "unsupported";
  }
}

bool writeText(MFRC522 &rfid, const String &text, String &err) {
  switch (kindOf(rfid)) {
    case Kind::Ultralight: return ultralightWrite(rfid, text, err);
    case Kind::Classic1K: return classicWrite(rfid, text, err);
    default: err = "unsupported tag type"; return false;
  }
}

bool readText(MFRC522 &rfid, String &out, String &err) {
  switch (kindOf(rfid)) {
    case Kind::Ultralight: return ultralightRead(rfid, out, err);
    case Kind::Classic1K: return classicRead(rfid, out, err);
    default: err = "unsupported tag type"; return false;
  }
}

}  // namespace NdefTag
