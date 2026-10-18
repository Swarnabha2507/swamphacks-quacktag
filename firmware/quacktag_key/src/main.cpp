// QuackTag key device: Adafruit Feather RP2040 + RC522.
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

#ifndef WIRING_TEST  // env:wiring builds src/wiring_test.cpp instead

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

// ---------- RC522 check ----------
// The reader's version register answers 0x91/0x92 (or 0x88/0x12/0xB2 on clones).
// 0x00 or 0xFF means nothing answered on SPI: a data wire is loose or on the wrong pin.

bool readerReady = false;
unsigned long lastReaderCheck = 0;

bool startReader(const char *readyMsg) {
  rfid.PCD_Init();
  delay(50);
  const byte version = rfid.PCD_ReadRegister(MFRC522::VersionReg);
  readerReady = version != 0x00 && version != 0xFF;
  if (readerReady) {
    Serial.print("READER OK (RC522 version 0x");
    Serial.print(version, HEX);
    Serial.println(")");
    Serial.println(readyMsg);
    rfid.PCD_AntennaOff();
  } else {
    Serial.print("ERROR:READER no answer from the RC522 (version 0x");
    Serial.print(version, HEX);
    Serial.println("). Check: SDA->10, SCK->SCK, MOSI->MO, MISO->MI, RST->9, 3.3V->3V, GND->GND");
    led(120, 0, 0);
  }
  return readerReady;
}

// Retries every 2 s, so fixing a wire works without pressing reset.
bool readerUp(const char *readyMsg) {
  if (readerReady) return true;
  if (millis() - lastReaderCheck < 2000) return false;
  lastReaderCheck = millis();
  return startReader(readyMsg);
}

void waitForMonitor() {
  const unsigned long start = millis();  // give a Serial Monitor a moment to connect
  while (!Serial && millis() - start < 1500) delay(10);
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

// Only the key gets rewritten. Without this, a debit card left on the reader was
// overwritten with a key code (2026-10-17). KEY_UID (secrets.h) pins the one fob this
// device may write; with it empty, any tag is allowed EXCEPT one holding a card record.
#ifndef KEY_UID
#define KEY_UID ""
#endif

String currentUid;
bool currentAllowed = false;
uint8_t misses = 0;

// Called once when a tag is placed. Returns false (and says why) for anything that isn't the key.
bool isTheKey(const String &uid) {
  const String pinned = String(KEY_UID);
  if (pinned.length() && !uid.equalsIgnoreCase(pinned)) {
    Serial.print("SKIP ");
    Serial.print(uid);
    Serial.print(": not this device's key (KEY_UID ");
    Serial.print(pinned);
    Serial.println("). Left untouched.");
    return false;
  }
  String text, err;
  const bool read = NdefTag::readText(rfid, text, err);
  rfid.PCD_StopCrypto1();
  NdefTag::select(rfid);  // fresh session for the write
  if (read && text.startsWith("SC1:")) {
    Serial.print("SKIP ");
    Serial.print(uid);
    Serial.println(": this is the debit card (SC1 record). Left untouched.");
    return false;
  }
  return true;
}
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

const char *KEY_READY = "READY key mode: rest the fob on the reader, a new code is written every 15 s";

void setup() {
  Serial.begin(115200);
  waitForMonitor();
  pixel.begin();
  pixel.setBrightness(60);
  EEPROM.begin(256);
  SPI.begin();
  if (startReader(KEY_READY)) led(0, 0, 8);
  rp2040.wdt_begin(8000);  // if the loop ever hangs (e.g. a stuck SPI transfer), reboot within 8 s
}

const unsigned long REINIT_MS = 60000;  // re-initialise an idle RC522 every minute (it can latch up after hours)

void loop() {
  rp2040.wdt_reset();
  if (!readerReady) {
    if (!readerUp(KEY_READY)) return;
    led(0, 0, 8);
  }
  static unsigned long lastPoll = 0;
  if (millis() - lastPoll < POLL_MS) return;
  lastPoll = millis();

  static unsigned long lastReinit = millis();
  if (!currentUid.length() && millis() - lastReinit >= REINIT_MS) {
    lastReinit = millis();
    rfid.PCD_Init();
    const byte version = rfid.PCD_ReadRegister(MFRC522::VersionReg);
    if (version == 0x00 || version == 0xFF) {
      readerReady = false;  // readerUp() retries and logs the wiring checklist
      Serial.println("ERROR:READER stopped answering; retrying");
      return;
    }
    rfid.PCD_AntennaOff();
  }

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
    currentAllowed = isTheKey(uid);
    if (!currentAllowed) flash(120, 50, 0, 3);  // orange blinks: not the key, nothing written
    led(currentAllowed ? 0 : 60, currentAllowed ? 0 : 25, currentAllowed ? 60 : 0);
  }
  if (currentAllowed && (writeNow || millis() - lastWrite >= REWRITE_MS)) {
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
  waitForMonitor();
  pixel.begin();
  pixel.setBrightness(60);
  SPI.begin();
  if (startReader("READY card writer")) prompt();
}

void loop() {
  if (!readerReady) {
    if (!readerUp("READY card writer")) return;
    prompt();
  }
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

#endif  // WIRING_TEST
