# SwampTag

**Tap-to-approve two-factor authentication for debit cards.** Built at SwampHacks (University of Florida) for the *Hardware & Physical Computing* and *First Timers* tracks.

## The problem
Debit fraud needs only two things: a copy of your card and your PIN.
- **Skimmers** on gas pumps and ATMs copy the card.
- **Shoulder-surfing**, from a person or a pinhole camera, captures the PIN.

Debit pulls money straight from checking, so the victim is out that money while the bank investigates.

## The solution
SwampTag links the card to a physical RFID key fob. Every payment or transfer is held until the owner taps that fob on a reader.
- A thief with a cloned card and your PIN still doesn't have the fob, so the payment is **blocked** and logged as a fraud alert.
- The owner taps once (under a second) and the payment goes through.

## How it's built
```
RC522 reader ──SPI──▶ Arduino UNO R4 WiFi ──USB serial──▶ Chrome (Web Serial API) ──▶ SwampTag bank site
                       LED matrix ✓ / ✗  ◀── OK / DENY ──┘
```
- `arduino/SwampTag/SwampTag.ino`: reads tag UIDs, prints `TAG:<uid>`, and shows ✓ / ✗ / waiting on the LED matrix.
- `website/`: plain HTML/CSS/JS with no server and no build step.
  - `index.html`: marketing home page
  - `login.html`: demo sign-in
  - `dashboard.html`: the bank, with key linking, payments, fraud simulation and Security Center
- Wiring and setup are in [arduino/SETUP.md](arduino/SETUP.md).

## Run it
1. Wire and flash the Arduino ([arduino/SETUP.md](arduino/SETUP.md)), then **close Serial Monitor**.
2. Serve the website:
   ```powershell
   cd website
   python -m http.server 8000
   ```
   Or right-click `index.html` → "Open with Live Server" in VS Code.
3. Open **http://localhost:8000** in **Chrome or Edge**. Web Serial doesn't work in Firefox or Safari.
4. Log in, then click **Connect reader** and pick the Arduino's COM port.

## Demo script (about 2 minutes)
1. **Without protection:** click **Simulate fraud**. The charge goes through, because a cloned card and a PIN are enough today.
2. **Link a key:** click **Link a key** and tap the **blue fob**. The card now shows "SwampTag on".
3. **Normal payment:** **Pay in store** → Publix → tap the **fob**. The LED matrix shows ✓ and the payment is verified.
4. **The attack:** **Simulate fraud**, then the "thief" taps the **white card**. The LED matrix shows ✗, the payment is blocked, and a Security Center alert appears.
5. **Lost key:** **Unlink key** shows how a lost fob is revoked in one click.

Backup if the hardware acts up: turn on **Demo mode**. You can then press **T** (correct tap) or **X** (wrong tap) on the keyboard, or click the simulate buttons.

Reset everything with **Reset demo** in the Security Center.

## Honest limitations and next steps
- The prototype checks the tag's **UID**, which cheap tools can copy. A real product would use **challenge-response** tags such as MIFARE DESFire EV3, or the phone's secure element. The tag would then prove it holds a secret key without ever revealing it.
- Verification happens in the browser for the demo. In production, the bank's server checks the tag and the terminal only relays it.
- Next steps:
  - Put the reader in the card terminal itself.
  - Let a fob protect several cards.
  - Allow small, trusted purchases (like coffee) without a tap.
