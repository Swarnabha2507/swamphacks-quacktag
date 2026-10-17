# SwampTag

**Tap-to-approve protection for debit cards, built on Capital One's Nessie API.**

Built at SwampHacks (University of Florida) for these tracks:
- Hardware & Physical Computing
- First Timers
- Capital One – Best Use of Nessie
- Best Use of Auth0

## The problem
- **Card fraud:** debit fraud needs only a copy of your card (from a **skimmer**) and your PIN (from **shoulder-surfing**). Debit pulls money straight from checking, so the victim is out that money while the bank investigates.
- **Scams on older adults:** grandparent, fake IRS and romance scams push people to send money to a stranger fast.

## The solution
**1. A physical key.**
- SwampTag links the card to an RFID key fob.
- Risky payments are held until the owner taps the fob on a reader.
- A thief with a cloned card and your PIN doesn't have the fob, so the payment is **blocked** and logged.

**2. Smart taps with your own tap limit.**
- Right after linking the fob, SwampTag asks *"How much can you spend before a tap is needed?"* It starts at **$200**, and you can change it any time under **Security → Smart taps → Change**.
- Payments at or under the limit go straight through. Anything over it needs the fob. This applies to card payments, sending money and bills alike.
- When a tap is needed, Nessie purchase history and merchant locations explain what looks off.

| Payment (limit $200) | What happens |
|---|---|
| $6 coffee at the usual Starbucks | goes through with no tap |
| $90 at the UF Bookstore | goes through with no tap (asks for a tap if the limit is under $90) |
| $390 at a gas station in Orlando | asks for a tap ("Over your $200 tap limit · New merchant · 96 mi from home · 15× your usual spend") |
| Sending $500 or paying $725 rent | asks for a tap |

**3. Scam check, built for older adults.** Before any transfer of **$200 or more**, SwampTag asks *"Why are you sending this money?"*
- **Safe answers** (paying back a friend, splitting rent) go straight to the tap.
- **Red-flag answers** pause the transfer: a family member "in trouble", "the IRS told me to", someone met online, or a prize fee.
  - A scam review explains the danger in plain words and **reads it aloud** (browser text-to-speech).
  - A trusted family contact gets a heads-up.
  - To send anyway, the person must **call the fraud line** and enter the code they're given. Then the key is still required.
- The scam review is **simulated** for the demo: rules and canned findings, no AI API. Next step: a real model (Gemini API) reading the full explanation.

**4. Real sign-in.** Auth0 handles login (Google, MFA, passkeys). The linked fob is saved in the user's Auth0 profile, so it follows them to any browser.

*Pitch line: Auth0 protects who you are. SwampTag protects what you pay, and how you pay it.*

## How it's built
```
RC522 ──SPI──▶ UNO R4 WiFi ──USB──▶ Chrome (Web Serial) ──▶ SwampTag site ──▶ server.py ──▶ Nessie API
               LED matrix ✓/✗ ◀── OK / DENY ──┘                    │
                                                                 └──▶ Auth0 (login + user_metadata)
```

| Part | Files |
|---|---|
| Hardware | [arduino/SwampTag/SwampTag.ino](arduino/SwampTag/SwampTag.ino). Wiring: [arduino/SETUP.md](arduino/SETUP.md) |
| Enclosure | [cad/swamptag_reader.scad](cad/swamptag_reader.scad), a 3D-printable angled terminal. Guide: [cad/README.md](cad/README.md) |
| Server | [server.py](server.py): serves the site, forwards `/api/nessie/*` with the key, and passes the Auth0 settings (Python standard library only) |
| Nessie setup | [tools/seed_nessie.py](tools/seed_nessie.py) |
| Website | [website/](website/), with one file per job in `js/`: |
| | • [bank.js](website/js/bank.js): Nessie |
| | • [risk.js](website/js/risk.js): smart taps |
| | • [scamcheck.js](website/js/scamcheck.js): Scam check |
| | • [auth.js](website/js/auth.js): Auth0 |
| | • [serial.js](website/js/serial.js): the reader |
| Look and feel | [STYLE_GUIDE.md](STYLE_GUIDE.md) |

### How SwampTag uses Nessie
| Nessie | SwampTag feature |
|---|---|
| Customers + Accounts | Albert Gator's checking account plus three friends' accounts |
| Merchants (with `geocode`) | Pay in store options. Distance from home feeds the risk check |
| Purchases | Card payments. History decides what's a "known merchant" and "usual spend" |
| Transfers + Deposits | Peer-to-peer payments: a transfer out of Albert plus a deposit into the friend's account |
| Bills (`PUT /bills/{id}`) | Upcoming bills. Paying one needs a tap and marks it completed |

Only **approved** payments are written to Nessie. Blocked money never moves.

## Run it
1. **Nessie:** copy `.env.example` to `.env` and paste your key. Then run `python tools/seed_nessie.py` once (`--fresh` gives a clean account).
2. **Auth0 (optional, about 10 min, free):**
   1. Create a **Single Page Application**.
   2. Add `http://localhost:8000/login.html`, `http://localhost:8000/dashboard.html` and `http://localhost:8000` to **Allowed Callback URLs**, **Allowed Logout URLs** and **Allowed Web Origins**.
   3. Under **Authentication → Social**, enable Google. Under **Security → Multi-factor Auth**, enable One-time Password (and optionally Passkeys).
   4. Add the app's `AUTH0_DOMAIN` and `AUTH0_CLIENT_ID` to `.env`. These are public values, not secrets.
   5. If sign-in says the app isn't authorized for the Management API: go to **APIs → Auth0 Management API → Application Access**, and give your SPA **user access** with `read:current_user` and `update:current_user_metadata`.
3. **Start the server:** run `python server.py`, then open **http://localhost:8000** in **Chrome or Edge**.
4. **Hardware:** wire and flash the Arduino ([arduino/SETUP.md](arduino/SETUP.md)) and close Serial Monitor. Then click **Connect reader** on the dashboard.

**Backups:**
- No internet? Run `python server.py --offline` for demo data.
- No Auth0? The demo login still works.
- No Arduino? Turn on **Demo mode** and press **T** (correct key) or **X** (wrong key).

## Demo script (about 4 minutes)
1. **Sign in** with Auth0 (Google + MFA). The dashboard shows your name and the **Live · Capital One Nessie** badge.
2. **Without protection:** click **Simulate fraud**. The charge goes through.
3. **Link a key:** tap the **blue fob**. The key is saved to your Auth0 profile. When asked how much you can spend before a tap is needed, enter **$50**.
4. **Smart tap:** Pay in store → Starbucks $6. Approved with no tap.
5. **Tap needed:** Pay in store → UF Bookstore $90 → "Over your $50 tap limit" → tap the fob. ✓ on the reader, and the purchase lands in Nessie.
6. **The attack:** Simulate fraud. The screen shows "96 mi from home · 15× your usual spend". The thief taps the **white card** → ✗, blocked.
7. **Scam check:** Send **$500** to Jordan. Choose "A family member says they are in trouble", then type "keep it secret".
   - The warning is read aloud and Maya gets a heads-up.
   - Show the fraud-line number, then click **Cancel this transfer**. The money stays.
8. **Bills:** pay Duke Energy with a tap. The bill is marked completed in Nessie.

## Honest limitations and next steps
- **Cloneable UIDs.** The prototype checks the tag's UID, which can be cloned. Production would use challenge-response tags such as MIFARE DESFire, or a phone's secure element.
- **Where checks run.** Tag and risk checks run in the browser for the demo. In production the bank's server does them.
- **Simulated scam review.** The fraud line, trusted-contact alert and scam review are simulated.
- **Next steps:**
  - A Gemini-powered review of the full explanation.
  - Real SMS or calls to the trusted contact.
  - The reader built into the card terminal.
