# SwampTag

**Tap-to-approve two-factor authentication for debit cards, built on Capital One's Nessie API.** Built at SwampHacks (University of Florida) for the *Hardware & Physical Computing*, *First Timers* and *Capital One – Best Use of Nessie* tracks.

## The problem
Debit fraud needs only two things: a copy of your card and your PIN.
- **Skimmers** on gas pumps and ATMs copy the card.
- **Shoulder-surfing**, from a person or a pinhole camera, captures the PIN.

Debit pulls money straight from checking, so the victim is out that money while the bank investigates.

## The solution
SwampTag links the card to a physical RFID key fob.
- **Risky payments are held until the owner taps the fob** on a reader.
- A thief with a cloned card and your PIN doesn't have the fob, so the payment is **blocked** and logged.
- **Smart taps** use your Nessie purchase history and merchant locations to decide when to ask:

| Payment | What happens |
|---|---|
| $6 coffee at the usual Starbucks | goes through with no tap |
| First time at Chipotle | asks for a tap ("New merchant") |
| $390 at a gas station in Orlando | asks for a tap ("New merchant · 96 mi from home · 15× your usual spend") |
| Sending money or paying a bill | always asks for a tap |

## How it's built
```
RC522 reader ──SPI──▶ Arduino UNO R4 WiFi ──USB──▶ Chrome (Web Serial) ──▶ SwampTag site ──▶ server.py ──▶ Nessie API
                      LED matrix ✓ / ✗  ◀── OK / DENY ──┘                                 (adds API key)
```

| Part | Files |
|---|---|
| Hardware | [arduino/SwampTag/SwampTag.ino](arduino/SwampTag/SwampTag.ino) reads tags and shows ✓ / ✗ on the LED matrix. Wiring: [arduino/SETUP.md](arduino/SETUP.md) |
| Server | [server.py](server.py) serves the site and forwards `/api/nessie/*` to Nessie with the key (Python standard library only) |
| Nessie setup | [tools/seed_nessie.py](tools/seed_nessie.py) creates the demo customer, friends, merchants (with map locations), purchase history and bills |
| Website | [website/](website/): home, login, dashboard. [js/bank.js](website/js/bank.js) talks to Nessie, [js/risk.js](website/js/risk.js) holds the smart-tap rules, [js/serial.js](website/js/serial.js) talks to the reader |
| Look and feel | [STYLE_GUIDE.md](STYLE_GUIDE.md) |

### How SwampTag uses Nessie
| Nessie | SwampTag feature |
|---|---|
| Customers + Accounts | Albert Gator's checking account and three friends' accounts |
| Merchants (with `geocode`) | Pay in store options. Distance from home feeds the risk check |
| Purchases | card payments. History says which merchants are "known" and what's "usual spend" |
| Transfers + Deposits | peer-to-peer: a transfer out of Albert plus a deposit into the friend's account |
| Bills (`PUT /bills/{id}`) | Upcoming bills. Paying one needs a tap, marks it completed and records a transfer |

Only **approved** payments are written to Nessie. **Blocked** money never moves, so blocked attempts live in SwampTag Shield.

## Run it
1. **Nessie key:** copy `.env.example` to `.env` and paste your key from nessieisreal.com.
2. **Seed once:** `python tools/seed_nessie.py`. Use `--fresh` later for a clean account.
3. **Start:** `python server.py`, then open **http://localhost:8000** in **Chrome or Edge**.
4. **Hardware:** wire and flash the Arduino ([arduino/SETUP.md](arduino/SETUP.md)), close Serial Monitor, then click **Connect reader** on the dashboard.

There's no key, no internet and no Arduino on stage? It still works. The site falls back to offline demo data (amber badge), and **Demo mode** gives you simulated taps (**T** = correct key, **X** = wrong key).

## Demo script (about 3 minutes)
1. Point out the green **Live · Capital One Nessie** badge. The balance, activity and bills come from Nessie.
2. **Without protection:** click **Simulate fraud**. The charge goes through, because a cloned card and a PIN are enough today.
3. **Link a key:** tap the **blue fob**. The key tile reads "Protected".
4. **Smart tap skip:** Pay in store → **Starbucks $6**. Approved with no tap, because it's a known merchant near home.
5. **Tap needed:** Pay in store → **Chipotle**. The screen explains "New merchant". Tap the fob → ✓ on the LED matrix, and the purchase lands in Nessie.
6. **The attack:** **Simulate fraud**. The screen shows "New merchant · 96 mi from home · 15× your usual spend". The thief taps the **white card** → ✗, blocked, nothing sent to Nessie, and SwampTag Shield counts it.
7. **P2P and bills:** send $25 to Jordan (tap) → a Nessie transfer plus deposit. Pay the Duke Energy bill (tap) → the bill is marked completed in Nessie.

## Honest limitations and next steps
- **Cloneable UIDs.** The prototype checks the tag's UID, which cheap tools can copy. A real product would use challenge-response tags such as MIFARE DESFire EV3, or the phone's secure element.
- **Where verification runs.** Tag checks run in the browser for the demo. In production, the bank's server checks the tag and the terminal only relays it.
- **Whole dollars only.** Nessie stores amounts in whole dollars, so demo prices are whole dollars.
- **Next steps:**
  - Build the reader into the card terminal.
  - Let one fob protect several cards.
  - Learn each person's tap-free limit from their history.
