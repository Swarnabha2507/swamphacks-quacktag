// SwampTag — RFID second factor for debit payments
// Board: Arduino UNO R4 WiFi   Reader: RC522 (SPI)
//
// Serial protocol (115200 baud, one message per line):
//   Arduino -> website:  READY            reader is up
//                        ERROR:READER     RC522 not detected (check wiring)
//                        TAG:04A1B2C3     a tag was tapped (UID in hex)
//   website -> Arduino:  WAIT             show "tap your key" animation
//                        OK               show check mark
//                        DENY             show X
//                        IDLE             back to the lock icon

#include <SPI.h>
#include <MFRC522.h>
#include "Arduino_LED_Matrix.h"

const uint8_t SS_PIN = 10;
const uint8_t RST_PIN = 9;

// Optional: wire a piezo buzzer to D8 + GND and set this to 1.
#define USE_BUZZER 0
const uint8_t BUZZER_PIN = 8;

const unsigned long REPEAT_IGNORE_MS = 1500;  // ignore the same tag tapped twice quickly
const unsigned long RESULT_SHOW_MS = 3000;    // how long to show the check / X
const unsigned long ANIM_STEP_MS = 180;       // speed of the "tap" ripple

MFRC522 rfid(SS_PIN, RST_PIN);
ArduinoLEDMatrix matrix;

enum Mode { MODE_IDLE, MODE_WAITING, MODE_RESULT };
Mode mode = MODE_IDLE;

uint8_t frame[8][12];
unsigned long resultUntil = 0;
unsigned long lastAnimAt = 0;
uint8_t animStep = 0;

String lastUid = "";
unsigned long lastUidAt = 0;
String inbox = "";

// ---------- LED matrix icons (8 rows x 12 columns) ----------

const uint8_t ICON_LOCK[8][12] = {
  {0,0,0,0,1,1,1,1,0,0,0,0},
  {0,0,0,1,0,0,0,0,1,0,0,0},
  {0,0,0,1,0,0,0,0,1,0,0,0},
  {0,0,1,1,1,1,1,1,1,1,0,0},
  {0,0,1,1,1,1,1,1,1,1,0,0},
  {0,0,1,1,1,0,0,1,1,1,0,0},
  {0,0,1,1,1,1,1,1,1,1,0,0},
  {0,0,1,1,1,1,1,1,1,1,0,0},
};

const uint8_t ICON_CHECK[8][12] = {
  {0,0,0,0,0,0,0,0,0,0,0,0},
  {0,0,0,0,0,0,0,0,0,0,1,0},
  {0,0,0,0,0,0,0,0,0,1,1,0},
  {0,0,0,0,0,0,0,0,1,1,0,0},
  {0,1,0,0,0,0,0,1,1,0,0,0},
  {0,1,1,0,0,0,1,1,0,0,0,0},
  {0,0,1,1,0,1,1,0,0,0,0,0},
  {0,0,0,1,1,1,0,0,0,0,0,0},
};

const uint8_t ICON_X[8][12] = {
  {0,0,1,0,0,0,0,0,0,1,0,0},
  {0,0,0,1,0,0,0,0,1,0,0,0},
  {0,0,0,0,1,0,0,1,0,0,0,0},
  {0,0,0,0,0,1,1,0,0,0,0,0},
  {0,0,0,0,0,1,1,0,0,0,0,0},
  {0,0,0,0,1,0,0,1,0,0,0,0},
  {0,0,0,1,0,0,0,0,1,0,0,0},
  {0,0,1,0,0,0,0,0,0,1,0,0},
};

void showIcon(const uint8_t icon[8][12]) {
  memcpy(frame, icon, sizeof(frame));
  matrix.renderBitmap(frame, 8, 12);
}

// Draws a square ring around the centre of the matrix. size 1..4.
void showRing(uint8_t size) {
  memset(frame, 0, sizeof(frame));
  int top = 4 - size, bottom = 3 + size;
  int left = 6 - size, right = 5 + size;
  for (int r = top; r <= bottom; r++) {
    for (int c = left; c <= right; c++) {
      if (r == top || r == bottom || c == left || c == right) frame[r][c] = 1;
    }
  }
  matrix.renderBitmap(frame, 8, 12);
}

void beep(unsigned int hz, unsigned long ms) {
#if USE_BUZZER
  tone(BUZZER_PIN, hz, ms);
#endif
}

// ---------- modes ----------

void enterIdle() {
  mode = MODE_IDLE;
  showIcon(ICON_LOCK);
}

void enterWaiting() {
  mode = MODE_WAITING;
  animStep = 0;
  lastAnimAt = 0;
}

void enterResult(bool approved) {
  mode = MODE_RESULT;
  resultUntil = millis() + RESULT_SHOW_MS;
  if (approved) {
    showIcon(ICON_CHECK);
    beep(1800, 120);
  } else {
    showIcon(ICON_X);
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

// ---------- main ----------

void setup() {
  Serial.begin(115200);
  SPI.begin();
  rfid.PCD_Init();
  matrix.begin();

  byte version = rfid.PCD_ReadRegister(MFRC522::VersionReg);
  if (version == 0x00 || version == 0xFF) {
    Serial.println("ERROR:READER");
    showIcon(ICON_X);
  } else {
    Serial.println("READY");
    enterIdle();
  }
}

void loop() {
  readSerial();
  readTag();

  unsigned long now = millis();
  if (mode == MODE_WAITING && now - lastAnimAt >= ANIM_STEP_MS) {
    lastAnimAt = now;
    showRing(animStep % 4 + 1);
    animStep++;
  } else if (mode == MODE_RESULT && now >= resultUntil) {
    enterIdle();
  }
}
