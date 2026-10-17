# QuackTag

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
**1. A physical key with a rotating code.**
- QuackTag links the card to an RFID key. A small Arduino device attached to the key **rewrites a fresh code onto it at intervals**.
- Risky payments are held until the owner holds the key to the **QuackTag terminal**: a Pixel phone that acts as the terminal's screen and NFC reader.
- A thief with a cloned card and your PIN doesn't have the key. A **copied** key carries an old code that the terminal refuses, so the payment is **blocked** and logged.

**2. Smart taps with your own tap limit.**
- Right after linking the fob, QuackTag asks *"How much can you spend before a tap is needed?"* It starts at **$200**, and you can change it any time under **Security → Smart taps → Change**.
- Payments at or under the limit go straight through. Anything over it needs the fob. This applies to card payments, sending money and bills alike.
- When a tap is needed, Nessie purchase history and merchant locations explain what looks off.

| Payment (limit $200) | What happens |
|---|---|
| $6 coffee at the usual Starbucks | goes through with no tap |
| $90 at the UF Bookstore | goes through with no tap (asks for a tap if the limit is under $90) |
| $390 at a gas station in Orlando | asks for a tap ("Over your $200 tap limit · New merchant · 96 mi from home · 15× your usual spend") |
| Sending $500 or paying $725 rent | asks for a tap |

**3. Voice scam check, built for older adults.** Before a payment over your tap limit, or any transfer of **$200 or more**, QuackTag asks *"What is this for?"*
- **Say it or type it.** Press 🎤 and explain out loud. **Whisper** (running on the laptop) turns the speech into text.
- **Gemini reviews the explanation** and answers with a risk level, the likely scam type and a plain-language warning.
  - If Gemini can't be reached, offline phrase rules take over, so the demo never gets stuck.
- **Safe answers** (paying back a friend, splitting rent) go straight to the key tap.
- **Red-flag answers** pause the payment: a family member "in trouble", "the IRS told me to", gift cards, someone met online, or a prize fee.
  - The warning is **read aloud** (browser text-to-speech), and a trusted family contact gets a heads-up.
  - **📞 Talk to a representative** is offered. In the demo it only logs the request; no call is made.
  - To send anyway, the person must **call the fraud line** and enter the code they're given. Then the key is still required.
- Every transcription and review is appended to `scam_reviews.txt` on the laptop (never committed).

**4. Real sign-in.** Auth0 handles login (Google, MFA, passkeys). The linked fob is saved in the user's Auth0 profile, so it follows them to any browser.

*Pitch line: Auth0 protects who you are. QuackTag protects what you pay, and how you pay it.*

## How it's built
For a full walkthrough of every part, see **[docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md)**.

```
 Key (fob or card) ◀── rewritten with a fresh code by the key device (Arduino + RC522)
      │ held to the back of the phone
      ▼
 Pixel 6a phone terminal ─────── Web NFC ──▶ terminal.html ──USB cable (port forwarding)──┐
      ▲  shows amount, ✓ / ✗ and speaks it                                                     ▼
      └──────────── OK / DENY ◀── laptop dashboard ◀── server.py relay (checks the key code) ──┘
                                        │                       └──▶ Nessie API
                                        └──▶ Auth0 (login + user_metadata)
```

| Part | Files |
|---|---|
| Gas pump (phone) | [website/pump.html](website/pump.html) + [js/pump.js](website/js/pump.js): pick items → card → PIN → key, on the Pixel with Web NFC |
| Key device | [firmware/quacktag_key](firmware/quacktag_key/README.md): Feather RP2040 + RC522 (PlatformIO). Rewrites the fob every 15 s; second build writes the fake debit card |
| Phone terminal | [website/terminal.html](website/terminal.html) + [js/terminal.js](website/js/terminal.js): runs on the Pixel, reads the key with Web NFC |
| Key format | [docs/KEY_FORMAT.md](docs/KEY_FORMAT.md): what the key device writes and how the terminal checks it |
| Old USB reader | [arduino/QuackTag/QuackTag.ino](arduino/QuackTag/QuackTag.ino), [arduino/SETUP.md](arduino/SETUP.md) |
| Server | [server.py](server.py): serves the site, forwards `/api/nessie/*` with the key, passes the Auth0 settings, and relays between the dashboard and the phone ([terminal.py](terminal.py), which also checks key codes). Python standard library only |
| Nessie setup | [tools/seed_nessie.py](tools/seed_nessie.py) |
| Website | [website/](website/), with one file per job in `js/`: |
| | • [bank.js](website/js/bank.js): Nessie |
| | • [risk.js](website/js/risk.js): smart taps |
| | • [scamcheck.js](website/js/scamcheck.js): Scam check |
| | • [auth.js](website/js/auth.js): Auth0 |
| | • [terminal-link.js](website/js/terminal-link.js): the phone terminal (the dashboard's reader) |
| | • [serial.js](website/js/serial.js): the old USB reader |
| Look and feel | [STYLE_GUIDE.md](STYLE_GUIDE.md) |

### How QuackTag uses Nessie
| Nessie | QuackTag feature |
|---|---|
| Customers + Accounts | Albert Gator's checking account plus three friends' accounts |
| Merchants (with `geocode`) | Pay in store options. Distance from home feeds the risk check |
| Purchases | Card payments. History decides what's a "known merchant" and "usual spend" |
| Transfers + Deposits | Peer-to-peer payments: a transfer out of Albert plus a deposit into the friend's account |
| Bills (`PUT /bills/{id}`) | Upcoming bills. Paying one needs a tap and marks it completed |
| Gas pump (`pump.html`) | Before approving, the server reads the account's purchases, deposits and transfers from Nessie to get the balance. **Nessie decides "Insufficient funds"**. Approved sales are posted as Nessie purchases at the "Swamp Gas & Go" merchant. The receipt shows the Nessie purchase ID and the new balance |
| Accounts + Customers (GET) | The dashboard's account tile (nickname, last 4 of the account number) and greeting come from Nessie |

**See it live:** the dashboard's **Capital One Nessie** panel lists every Nessie API call as it happens (method, endpoint, status, and which part of the app made it). A sale on the phone's pump shows up there and in Recent activity within a few seconds.

Only **approved** payments are written to Nessie. Blocked money never moves.

## Run it
1. **Nessie:** already set up for the team. `.env` (the key) and `nessie_ids.json` (the shared demo account) are committed to this **private** repo, so cloning is enough.
   - Don't run `python tools/seed_nessie.py --fresh` unless the team agrees. It creates a new account, and everyone needs the new `nessie_ids.json`.
   - Never make this repo public without rotating the key first.
2. **Auth0 (optional, about 10 min, free):**
   1. Create a **Single Page Application**.
   2. Add `http://localhost:8000/login.html`, `http://localhost:8000/dashboard.html` and `http://localhost:8000` to **Allowed Callback URLs**, **Allowed Logout URLs** and **Allowed Web Origins**.
   3. Under **Authentication → Social**, enable Google. Under **Security → Multi-factor Auth**, enable One-time Password (and optionally Passkeys).
   4. Add the app's `AUTH0_DOMAIN` and `AUTH0_CLIENT_ID` to `.env`. These are public values, not secrets.
   5. If sign-in says the app isn't authorized for the Management API: go to **APIs → Auth0 Management API → Application Access**, and give your SPA **user access** with `read:current_user` and `update:current_user_metadata`.
3. **Gemini (scam review):** get a free key at https://aistudio.google.com/apikey and put it in a file called **`.env.local`** next to `server.py`:
   ```
   GEMINI_API_KEY=your-key-here
   ```
   `.env.local` is your personal file and is never committed. Without a key, the scam review uses the offline rules.
4. **Whisper (🎤 voice), one-time setup.** Needs Python 3.12:
   ```
   py -3.12 -m venv .venv
   .venv\Scripts\python.exe -m pip install -r learn/requirements.txt
   ```
   The first voice check downloads the speech model (about 150 MB).
5. **Start the server:**
   - **With voice:** `.venv\Scripts\python.exe server.py`
   - **Without voice:** `py server.py` (everything else works; the 🎤 button is hidden)

   Then open **http://localhost:8000** in **Chrome or Edge** on the laptop. The startup lines say whether Nessie, Gemini and voice are on.
6. **Phone terminal (Pixel 6a):**
   1. On the phone: **Settings → About phone**, tap **Build number** 7 times, then turn on **USB debugging** in Developer options.
   2. Plug the phone into the laptop and allow USB debugging.
   3. On the laptop, open **edge://inspect/#devices** (or chrome://inspect) → **Port forwarding** → add **8000 → localhost:8000**. Keep that tab open.
   4. On the phone, open **localhost:8000/terminal.html** in Chrome and tap **Start terminal**. The dashboard's Terminal row turns green.
   5. Hold the key flat against the **back of the phone, near the camera**, to read it. If the page shows upside down, tap **⟲**.
7. **Key codes (when the key device is ready):** put the same `KEY_SECRET` in `.env` and in the key device ([docs/KEY_FORMAT.md](docs/KEY_FORMAT.md)). Without it, the terminal accepts any `ST1` code or the tag's serial number.

**Backups:**
- No internet? Run `python server.py --offline` for demo data.
- No Auth0? The demo login still works.
- No phone or no NFC? The terminal page shows **Correct key / Wrong key** buttons, or turn on **Demo mode** on the dashboard and press **T** / **X**.

## Gas-station demo (about 2 minutes)
**Setup:**
- Flash the key device ([firmware/quacktag_key](firmware/quacktag_key/README.md)), write the fake debit card, and rest the fob on the key device.
- On the phone, open `localhost:8000/pump.html` and tap **Start pump**.

1. Pick **Regular $40** and a coffee, then **Charge $42**.
2. **Tap the debit card** on the back of the phone. It shows "QuackTag Debit •••• 4821".
3. Enter the **PIN** (1234). Only dots show, which matters because a shoulder-surfer is part of the story.
4. **Scan the key fob** → ✓ **Approved**. The sale lands in Nessie at "Swamp Gas & Go".
5. **The attack:** start a new sale and use the card and PIN, but scan the fob **without** putting it back on its key device. Its code is now old, like a copied fob → ✗ "Old key code, possibly a copied key".
6. **Different fob** → ✗ "This key isn't paired with this card".

## Demo script (about 4 minutes)
1. **Sign in** with Auth0 (Google + MFA). The dashboard shows your name and the **Live · Capital One Nessie** badge.
2. **Without protection:** click **Simulate fraud**. The charge goes through.
3. **Link a key:** click **Link a key**, then hold the key to the back of the phone. The key is saved to your Auth0 profile. When asked how much you can spend before a tap is needed, enter **$50**.
4. **Smart tap:** Pay in store → Starbucks $6. Approved with no tap.
5. **Tap needed:** Pay in store → UF Bookstore $90. The **phone terminal** shows $90.00 and "Hold your QuackTag key to the back of the phone". Hold the key there → ✓ on the phone (it says "Approved"), and the purchase lands in Nessie.
6. **The attack:** Simulate fraud. The thief holds up a **copied key** (an old code) → the terminal shows ✗ "Old key code, possibly a copied key", blocked.
7. **Scam check:** Send **$500** to Diego. Choose "A family member says they are in trouble", then type "keep it secret".
   - The warning is read aloud and Angel gets a heads-up.
   - Show the fraud-line number, then click **Cancel this transfer**. The money stays.
8. **Bills:** pay Duke Energy with a tap. The bill is marked completed in Nessie.

## Honest limitations and next steps
- **Rotating codes, not real cryptography on the tag.** The key device rewrites a signed code with a counter, so a copied tag goes stale, but anyone who reads the newest code first could use it once. Production would use challenge-response tags such as MIFARE DESFire, or a phone's secure element.
- **Where checks run.** Tag and risk checks run in the browser for the demo. In production the bank's server does them.
- **Partly simulated scam check.** Whisper and the Gemini review are real. The fraud line, the trusted-contact alert and "Talk to a representative" are simulated: nothing is sent and no call is made.
- **Next steps:**
  - Real SMS or calls to the trusted contact, and a real hand-off to a representative.
  - A purpose-built terminal with its own NFC reader instead of a phone.
