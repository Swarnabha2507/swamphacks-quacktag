// SwampTag key device: Adafruit Feather RP2040 + RC522.
//
// env:key  (default)  While the key fob rests on the reader, writes a fresh code onto it
//                     every 15 s:  ST1:<keyId>:<counter>:<code>
//                       keyId   = the fob's UID (hex)
//                       counter = goes up on every write, saved in flash
//                       code    = first 8 hex of HMAC-SHA256(KEY_SECRET, "<keyId>:<counter>")
//                     The phone terminal refuses a code it has seen before, so a copied
//                     fob (an older code) is rejected. Format: docs/KEY_FORMAT.md.
//
// env:card            Writes the fake debit card, once: tap the fob (its UID becomes the
//                     paired key), then tap the card → SC1:<last4>:<holder>:<keyId>
//
// Wiring (RC522 → Feather RP2040): SDA→10, RST→9, SCK→SCK, MOSI→MO, MISO→MI, GND→GND, 3.3V→3V.
// Colours and troubleshooting: README.md in this folder.

#include <Arduino.h>
#include <SPI.h>
#include <MFRC522.h>
#include <Adafruit_NeoPixel.h>
#include <EEPROM.h>
#include <SHA256.h>

#if __has_include("secrets.h")
#include "secrets.h"
#else
#warning "include/secrets.h not found: using secrets.example.h (key codes won't match the server)"
#include "secrets.example.h"
#endif

#include "ndef_tag.h"

const uint8_t SS_PIN = 10;
const uint8_t RST_PIN = 9;
#ifdef PIN_NEOPIXEL
const uint8_t PIXEL_PIN = PIN_NEOPIXEL;
#else
const uint8_t PIXEL_PIN = 16;  // GP16 on the Feather RP2040
#endif

const unsigned long POLL_MS = 300;       // how often to look for a tag
const unsigned long REWRITE_MS = 15000;  // new code this often while the fob stays on
const uint8_t MISSES_TO_LEAVE = 3;       // polls without the tag before we call it removed

MFRC522 rfid(SS_PIN, RST_PIN);
Adafruit_NeoPixel pixel(1, PIXEL_PIN, NEO_GRB + NEO_KHZ800);

// ---------- NeoPixel ----------

void led(uint8_t r, uint8_t g, uint8_t b) {
  pixel.setPixelColor(0, pixel.Color(r, g, b));
  pixel.show();
}

void flash(uint8_t r, uint8_t g, uint8_t b, uint8_t times = 2) {
  for (uint8_t i = 0; i < times; i++) {
    led(r, g, b);
    delay(120);
    led(0, 0, 0);
    delay(90);
  }
}

// ---------- Tag polling ----------

// Turns the antenna on just long enough to look for a tag, so the reader's field doesn't
// sit on the fob all the time (the phone reads it better with the field off).
bool pollTag() {
  rfid.PCD_AntennaOn();
  delay(5);
  return NdefTag::select(rfid);
}

void releaseTag() {
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
  rfid.PCD_AntennaOff();
}

// Writes `text`, reads it back to check, and logs the result.
bool writeAndCheck(const String &text) {
  String err;
  const NdefTag::Kind kind = NdefTag::kindOf(rfid);
  if (kind == NdefTag::Kind::Unsupported) {
    Serial.println("ERROR:unsupported tag type (use MIFARE Classic 1K or NTAG)");
    flash(80, 0, 80, 3);
    return false;
  }
  if (!NdefTag::writeText(rfid, text, err)) {
    Serial.print("ERROR:write failed: ");
    Serial.println(err);
    flash(120, 0, 0, 3);
    return false;
  }
  NdefTag::select(rfid);  // fresh session for the read-back
  String back;
  if (!NdefTag::readText(rfid, back, err) || back != text) {
    Serial.print("ERROR:read-back didn't match: ");
    Serial.println(err.length() ? err : back);
    flash(120, 0, 0, 3);
    return false;
  }
  return true;
}

#ifndef CARD_WRITER
// =====================================================================================
// Key mode: rotate the fob's code every 15 s while it's on the reader
// =====================================================================================

struct Saved {
  uint32_t magic;
  uint32_t counter;
};
const uint32_t MAGIC = 0x53544B31;  // "STK1"

String currentUid;
uint8_t misses = 0;
unsigned long lastWrite = 0;
bool writeNow = false;

uint32_t nextCounter() {
  Saved s;
  EEPROM.get(0, s);
  if (s.magic != MAGIC) s = {MAGIC, 0};
  s.counter++;
  EEPROM.put(0, s);
  EEPROM.commit();  // saved before writing, so a counter value is never used twice
  return s.counter;
}

String codeFor(const String &keyId, uint32_t counter) {
  const String msg = keyId + ":" + String(counter);
  uint8_t mac[32];
  SHA256 sha;
  sha.resetHMAC(KEY_SECRET, strlen(KEY_SECRET));
  sha.update(msg.c_str(), msg.length());
  sha.finalizeHMAC(KEY_SECRET, strlen(KEY_SECRET), mac, sizeof(mac));
  String hex;
  for (uint8_t i = 0; i < 4; i++) {
    if (mac[i] < 0x10) hex += '0';
    hex += String(mac[i], HEX);
  }
  hex.toUpperCase();
  return hex;
}

void rotate() {
  const uint32_t counter = nextCounter();
  const String text = "ST1:" + currentUid + ":" + String(counter) + ":" + codeFor(currentUid, counter);
  if (writeAndCheck(text)) {
    Serial.print("WROTE ");
    Serial.println(text);
    flash(0, 140, 0);
  }
  led(0, 0, 60);  // back to "fob present"
}

void setup() {
  Serial.begin(115200);
  pixel.begin();
  pixel.setBrightness(60);
  led(0, 0, 8);
  EEPROM.begin(256);
  SPI.begin();
  rfid.PCD_Init();
  delay(50);
  const byte version = rfid.PCD_ReadRegister(MFRC522::VersionReg);
  if (version == 0x00 || version == 0xFF) {
    Serial.println("ERROR:READER RC522 not found, check the wiring (3.3V, SDA→10, RST→9)");
    led(120, 0, 0);
  } else {
    Serial.println("READY key mode: rest the fob on the reader, a new code is written every 15 s");
  }
  rfid.PCD_AntennaOff();
}

void loop() {
  static unsigned long lastPoll = 0;
  if (millis() - lastPoll < POLL_MS) return;
  lastPoll = millis();

  if (!pollTag()) {
    if (currentUid.length() && ++misses >= MISSES_TO_LEAVE) {
      Serial.print("REMOVED ");
      Serial.println(currentUid);
      currentUid = "";
      led(0, 0, 8);
    }
    rfid.PCD_AntennaOff();
    return;
  }

  misses = 0;
  const String uid = NdefTag::uidHex(rfid);
  if (uid != currentUid) {
    currentUid = uid;
    writeNow = true;
    Serial.print("PLACED ");
    Serial.print(uid);
    Serial.print(" (");
    Serial.print(NdefTag::kindName(NdefTag::kindOf(rfid)));
    Serial.println(")");
    led(0, 0, 60);
  }
  if (writeNow || millis() - lastWrite >= REWRITE_MS) {
    writeNow = false;
    lastWrite = millis();
    rotate();
  }
  releaseTag();
}

#else
// =====================================================================================
// Card mode: tap the fob, then the card → static SC1 record paired with that fob
// =====================================================================================

enum class Step { WaitFob, WaitCard, Done };
Step step = Step::WaitFob;
String keyId;
unsigned long doneAt = 0;

void prompt() {
  if (step == Step::WaitFob) {
    Serial.println("Tap the KEY FOB this card belongs to");
    led(0, 0, 60);
  } else if (step == Step::WaitCard) {
    Serial.println("Now tap the CARD to write");
    led(60, 0, 60);
  }
}

void setup() {
  Serial.begin(115200);
  pixel.begin();
  pixel.setBrightness(60);
  SPI.begin();
  rfid.PCD_Init();
  delay(50);
  const byte version = rfid.PCD_ReadRegister(MFRC522::VersionReg);
  if (version == 0x00 || version == 0xFF) {
    Serial.println("ERROR:READER RC522 not found, check the wiring (3.3V, SDA→10, RST→9)");
    led(120, 0, 0);
  } else {
    Serial.println("READY card writer");
  }
  rfid.PCD_AntennaOff();
  prompt();
}

void loop() {
  static unsigned long lastPoll = 0;
  static unsigned long lastPrompt = 0;
  if (millis() - lastPoll < POLL_MS) return;
  lastPoll = millis();

  if (step == Step::Done) {
    if (millis() - doneAt > 5000) {  // ready for another card
      step = Step::WaitFob;
      prompt();
    }
    return;
  }
  if (millis() - lastPrompt > 5000) {  // repeat the prompt for anyone who opens the monitor late
    lastPrompt = millis();
    prompt();
  }

  if (!pollTag()) {
    rfid.PCD_AntennaOff();
    return;
  }
  const String uid = NdefTag::uidHex(rfid);

  if (step == Step::WaitFob) {
    keyId = uid;
    Serial.print("FOB ");
    Serial.println(keyId);
    flash(0, 0, 140);
    step = Step::WaitCard;
    releaseTag();
    delay(1500);  // time to take the fob away
    prompt();
    return;
  }

  // Step::WaitCard: ignore the fob if it's still there
  if (uid == keyId) {
    releaseTag();
    return;
  }
  const String text = "SC1:" + String(CARD_LAST4) + ":" + String(CARD_HOLDER) + ":" + keyId;
  if (writeAndCheck(text)) {
    Serial.print("WROTE CARD ");
    Serial.print(uid);
    Serial.print(" ");
    Serial.println(text);
    led(0, 140, 0);
    step = Step::Done;
    doneAt = millis();
  }
  releaseTag();
}
#endif
