// Wiring finder (pio run -e wiring -t upload, then open the Serial Monitor).
// Talks to the RC522 by bit-banging SPI on every plausible pin combination and reports
// which Feather pins the SDA (chip select), SCK, MOSI, MISO and RST wires are really on.
#ifdef WIRING_TEST

#include <Arduino.h>
#include <Adafruit_NeoPixel.h>

#ifdef PIN_NEOPIXEL
Adafruit_NeoPixel pixel(1, PIN_NEOPIXEL, NEO_GRB + NEO_KHZ800);
#else
Adafruit_NeoPixel pixel(1, 16, NEO_GRB + NEO_KHZ800);
#endif

// Header pins on the Feather RP2040 (GPIO number → printed label)
struct Pin { uint8_t gpio; const char *label; };
const Pin PINS[] = {
  {0, "TX"}, {1, "RX"}, {2, "SDA"}, {3, "SCL"}, {7, "5"}, {8, "6"}, {9, "9"}, {10, "10"},
  {11, "11"}, {12, "12"}, {13, "13"}, {24, "24"}, {25, "25"}, {26, "A0"}, {27, "A1"},
  {28, "A2"}, {29, "A3"}, {18, "SCK"}, {19, "MO"}, {20, "MI"},
};

const char *label(uint8_t gpio) {
  for (const Pin &p : PINS) if (p.gpio == gpio) return p.label;
  return "?";
}

uint8_t sck, mosi, miso;

uint8_t xfer(uint8_t out) {  // SPI mode 0, slow
  uint8_t in = 0;
  for (int8_t i = 7; i >= 0; i--) {
    digitalWrite(mosi, (out >> i) & 1);
    delayMicroseconds(5);
    digitalWrite(sck, HIGH);
    delayMicroseconds(5);
    in |= (uint8_t)digitalRead(miso) << i;
    digitalWrite(sck, LOW);
  }
  return in;
}

bool isBus(uint8_t g) { return g == sck || g == mosi || g == miso; }

// Every non-bus pin is pulled up (not driven, so nothing can short): that releases
// RST and deselects the chip wherever those wires are.
void pullUpOthers() {
  for (const Pin &p : PINS) if (!isBus(p.gpio)) pinMode(p.gpio, INPUT_PULLUP);
}

uint8_t readVersion(uint8_t ss) {
  pinMode(ss, OUTPUT);
  digitalWrite(ss, LOW);
  delayMicroseconds(10);
  xfer(0x80 | (0x37 << 1));  // read VersionReg
  const uint8_t v = xfer(0x00);
  digitalWrite(ss, HIGH);
  pinMode(ss, INPUT_PULLUP);
  return v;
}

bool goodVersion(uint8_t v) { return v != 0x00 && v != 0xFF; }

// Where the SCK / MOSI / MISO wires might be: the Feather's SPI pins, or 13/11/12 if
// the wires followed the UNO numbering (SCK→13, MOSI→11, MISO→12).
const uint8_t BUS_CANDIDATES[6] = {18, 19, 20, 13, 11, 12};

bool report(uint8_t ssGpio, const char *ssLabel, uint8_t v) {
  Serial.printf("FOUND the RC522 (version 0x%02X):\n", v);
  Serial.printf("  SDA  wire is on pin %s %s\n", ssLabel, ssGpio == 10 ? "(correct)" : "<- should be on 10");
  Serial.printf("  SCK  wire is on pin %s %s\n", label(sck), sck == 18 ? "(correct)" : "<- should be on SCK");
  Serial.printf("  MOSI wire is on pin %s %s\n", label(mosi), mosi == 19 ? "(correct)" : "<- should be on MO");
  Serial.printf("  MISO wire is on pin %s %s\n", label(miso), miso == 20 ? "(correct)" : "<- should be on MI");
  // RST: pulling it low puts the chip in reset, so it stops answering.
  for (const Pin &r : PINS) {
    if (isBus(r.gpio) || r.gpio == ssGpio) continue;
    pinMode(r.gpio, OUTPUT);
    digitalWrite(r.gpio, LOW);
    delay(5);
    const bool silent = !goodVersion(readVersion(ssGpio));
    pinMode(r.gpio, INPUT_PULLUP);
    delay(60);  // the chip needs ~40 ms to restart after a reset
    if (silent) {
      Serial.printf("  RST  wire is on pin %s %s\n", r.label, r.gpio == 9 ? "(correct)" : "<- should be on 9");
      return true;
    }
  }
  Serial.println("  RST  wire: not found on any pin (loose or not connected) <- should be on 9");
  return true;
}

void scan() {
  Serial.println();
  Serial.println("=== SwampTag wiring finder (takes ~15 s) ===");
  const uint8_t n = sizeof(PINS) / sizeof(PINS[0]);
  for (uint8_t a = 0; a < 6; a++)
    for (uint8_t b = 0; b < 6; b++)
      for (uint8_t c = 0; c < 6; c++) {
        if (a == b || b == c || a == c) continue;
        sck = BUS_CANDIDATES[a]; mosi = BUS_CANDIDATES[b]; miso = BUS_CANDIDATES[c];
        pullUpOthers();
        pinMode(sck, OUTPUT); digitalWrite(sck, LOW);
        pinMode(mosi, OUTPUT); digitalWrite(mosi, LOW);
        pinMode(miso, INPUT_PULLUP);
        delay(45);  // in case the last try held the chip in reset
        // Two passes, forward then backward: if one of the tried "SDA" pins is really
        // RST, it resets the chip, and the pins after it read nothing until it restarts.
        for (uint8_t pass = 0; pass < 2; pass++) {
          for (uint8_t k = 0; k < n; k++) {
            const Pin &ss = PINS[pass == 0 ? k : n - 1 - k];
            if (isBus(ss.gpio)) continue;
            const uint8_t v = readVersion(ss.gpio);
            if (goodVersion(v)) {
              report(ss.gpio, ss.label, v);
              pixel.setPixelColor(0, pixel.Color(0, 120, 0));
              pixel.show();
              return;
            }
          }
          delay(45);
        }
      }
  Serial.println("No answer on any pin combination.");
  Serial.println("  -> Check the RC522's 3.3V wire goes to 3V and GND to GND.");
  Serial.println("  -> Push every jumper firmly onto both boards. Unsoldered RC522 header pins are a common cause:");
  Serial.println("     the pins must be soldered to the RC522, not just pushed through its holes.");
  pixel.setPixelColor(0, pixel.Color(120, 0, 0));
  pixel.show();
}

void setup() {
  Serial.begin(115200);
  const unsigned long start = millis();
  while (!Serial && millis() - start < 4000) delay(10);
  pixel.begin();
  pixel.setBrightness(60);
}

void loop() {
  scan();
  Serial.println("(scanning again in 5 s; fix a wire and watch)");
  delay(5000);
}

#endif
