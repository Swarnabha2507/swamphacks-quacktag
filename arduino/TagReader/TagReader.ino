// SwampTag — RFID second factor for debit payments
// Board: Adafruit Feather RP2040   Reader: RC522 (SPI)
// (The UNO R4 WiFi version with the LED matrix is arduino/SwampTag/SwampTag.ino.)
//
// Wiring (RC522 -> Feather RP2040):
//   SDA  -> 10      (right header)        SCK  -> SCK  (left header)
//   MOSI -> MO      (left header)         MISO -> MI   (left header)
//   RST  -> 9       (right header)        GND  -> GND  (left header)
//   3.3V -> 3V      (left header)         IRQ  -> not connected
//
// Serial protocol (115200 baud, one message per line):
//   Feather -> website:  READY            reader is up
//                        ERROR:READER     RC522 not detected (check wiring)
//                        TAG:04A1B2C3     a tag was tapped (UID in hex)
//   website -> Feather:  WAIT             blue pulse: "tap your key"
//                        OK               green
//                        DENY             red
//                        IDLE             dim white
//
// The Feather has no LED matrix, so feedback uses its onboard NeoPixel (colour LED).

#include <SPI.h>
#include <MFRC522.h>
#include <Adafruit_NeoPixel.h>

const uint8_t SS_PIN = 10;
const uint8_t RST_PIN = 9;

#ifdef PIN_NEOPIXEL
const uint8_t PIXEL_PIN = PIN_NEOPIXEL;  // defined by the Feather RP2040 board package
#else
const uint8_t PIXEL_PIN = 16;            // GP16 on the Feather RP2040
#endif

// Optional: wire a piezo buzzer to D8 + GND and set this to 1.
#define USE_BUZZER 0
const uint8_t BUZZER_PIN = 8;

const unsigned long REPEAT_IGNORE_MS = 1500;  // ignore the same tag tapped twice quickly
const unsigned long RESULT_SHOW_MS = 3000;    // how long to show green / red
const unsigned long PULSE_STEP_MS = 20;       // speed of the blue "tap" pulse
const unsigned long ERROR_BLINK_MS = 400;     // red blink when the reader is missing

MFRC522 rfid(SS_PIN, RST_PIN);
Adafruit_NeoPixel pixel(1, PIXEL_PIN, NEO_GRB + NEO_KHZ800);

enum Mode { MODE_IDLE, MODE_WAITING, MODE_RESULT, MODE_ERROR };
Mode mode = MODE_IDLE;

bool readerOk = false;
bool usbWasOpen = false;
unsigned long resultUntil = 0;
unsigned long lastStepAt = 0;
uint8_t pulseLevel = 0;
int8_t pulseDir = 4;

String lastUid = "";
unsigned long lastUidAt = 0;
String inbox = "";

// ---------- NeoPixel ----------

void showColor(uint8_t r, uint8_t g, uint8_t b) {
  pixel.setPixelColor(0, pixel.Color(r, g, b));
  pixel.show();
}

void beep(unsigned int hz, unsigned long ms) {
#if USE_BUZZER
  tone(BUZZER_PIN, hz, ms);
#endif
}

// ---------- modes ----------

void enterIdle() {
  mode = readerOk ? MODE_IDLE : MODE_ERROR;
  if (readerOk) showColor(12, 12, 12);  // dim white
}

void enterWaiting() {
  mode = MODE_WAITING;
  pulseLevel = 0;
  pulseDir = 4;
  lastStepAt = 0;
}

void enterResult(bool approved) {
  mode = MODE_RESULT;
  resultUntil = millis() + RESULT_SHOW_MS;
  if (approved) {
    showColor(0, 120, 0);  // green
    beep(1800, 120);
  } else {
    showColor(150, 0, 0);  // red
    beep(300, 600);
  }
}

void handleCommand(String cmd) {
  cmd.trim();
  cmd.toUpperCase();
  if (cmd == "WAIT") enterWaiting();
  else if (cmd == "OK") enterResult(true);
  else if (cmd == "DENY") enterResult(false);
  else if (cmd == "IDLE") enterIdle();
}

void readSerial() {
  while (Serial.available()) {
    char ch = Serial.read();
    if (ch == '\n' || ch == '\r') {
      if (inbox.length() > 0) handleCommand(inbox);
      inbox = "";
    } else if (inbox.length() < 32) {
      inbox += ch;
    }
  }
}

void readTag() {
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) return;

  String uid = "";
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) uid += "0";
    uid += String(rfid.uid.uidByte[i], HEX);
  }
  uid.toUpperCase();

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();

  unsigned long now = millis();
  if (uid == lastUid && now - lastUidAt < REPEAT_IGNORE_MS) return;
  lastUid = uid;
  lastUidAt = now;

  beep(1200, 60);
  Serial.print("TAG:");
  Serial.println(uid);
}

// The Feather's USB serial drops anything printed before the website opens the
// port, so (re)announce the reader's status every time the port is opened.
void announceWhenUsbOpens() {
  bool open = (bool)Serial;
  if (open && !usbWasOpen) Serial.println(readerOk ? "READY" : "ERROR:READER");
  usbWasOpen = open;
}

// ---------- main ----------

void setup() {
  Serial.begin(115200);
  pixel.begin();
  pixel.setBrightness(80);
  SPI.begin();
  rfid.PCD_Init();

  byte version = rfid.PCD_ReadRegister(MFRC522::VersionReg);
  readerOk = !(version == 0x00 || version == 0xFF);
  enterIdle();
}

void loop() {
  announceWhenUsbOpens();
  readSerial();
  if (readerOk) readTag();

  unsigned long now = millis();
  if (mode == MODE_WAITING && now - lastStepAt >= PULSE_STEP_MS) {
    lastStepAt = now;
    pulseLevel += pulseDir;
    if (pulseLevel >= 160) pulseDir = -4;
    else if (pulseLevel <= 4) pulseDir = 4;
    showColor(0, pulseLevel / 4, pulseLevel);  // blue breathing
  } else if (mode == MODE_RESULT && now >= resultUntil) {
    enterIdle();
  } else if (mode == MODE_ERROR && now - lastStepAt >= ERROR_BLINK_MS) {
    lastStepAt = now;
    static bool on = false;
    on = !on;
    showColor(on ? 150 : 0, 0, 0);  // blinking red: RC522 not found
  }
}
