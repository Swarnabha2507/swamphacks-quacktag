# SwampTag style guide

The look follows modern banking apps: white cards with thin borders, gradient account tiles, navy text, and blue actions. **Red is only for the logo swoosh, fraud and danger.** It's SwampTag-branded, so don't use any real bank's logo or product names.

All tokens live in `:root` at the top of [website/css/styles.css](website/css/styles.css). Use the variables and never hard-code hex values in components.

## Color

| Token | Hex | Use for |
|---|---|---|
| `--brand` | `#004977` | headings, logo tile, dark buttons (`.btn-navy`) |
| `--brand-dark` | `#13294b` | tile footers, toasts, footer background |
| `--link` | `#0276b1` | primary buttons, links, active tab, switches, tap ripple |
| `--accent` | `#d03027` | logo swoosh, hero highlight, "Simulate fraud" icon |
| `--green` / `--green-soft` | `#25810e` / `#e9f5e6` | approved, verified, live data |
| `--danger` / `--danger-soft` | `#cc2427` / `#fcebea` | blocked, fraud alerts, at-risk bar |
| `--amber` / `--amber-soft` | `#9a5800` / `#fdf3e1` | unverified payments, offline data, medium risk |
| `--surface-2` | `#f4f6f7` | app background, inset boxes |
| `--border` | `#d4d8db` | card borders, list dividers |
| `--text` / `--muted` | `#25292d` / `#5d6872` | body text / secondary text |

**Gradient tiles** (white text on top):
- `--tile-checking`: teal-navy, the bank account
- `--tile-key`: steel gray, the SwampTag key
- `--tile-shield`: teal, the fraud-blocked total, with a `--brand-dark` footer bar

## Type
- **Figtree** (Google Fonts), weights 300–800.
- Money amounts use **weight 500** (tiles) or **300** (the big Shield number). They should read light and calm, not bold.
- Headings use 700–800 in `--brand`. Body text is 400.
- Account names on tiles: `SwampTag Checking...4821` (last 4 digits after three dots, smaller and lighter).

## Shape and spacing
- Cards and tiles: `--radius` (10px), 1px `--border`, `--shadow`. Buttons: 8px radius. Chips and pills: fully round.
- Card padding: 24px desktop, 20px phone. Gap between stacked cards: 16px.
- Phone width (≤ 640px): single column, 16px side gutter, and a fixed bottom tab bar (Home · Activity · Key · Security).

## Components
| Class | What it is |
|---|---|
| `.tile` + `.tile-checking` / `.tile-key` / `.tile-shield` | gradient account tiles |
| `.btn-on-dark` | outlined white button that sits on a tile |
| `.row-button` | full-width white row with icon + title + small subtitle ("+ Open a new account" style) |
| `.btn-primary` / `.btn-outline` / `.btn-navy` / `.btn-ghost` | blue / blue outline / navy / text button |
| `.chip-green` / `-red` / `-amber` / `-blue` | status chips: Verified, Blocked, No SwampTag check, Trusted or Received |
| `.source-pill` (+ `.live`) | "Live · Capital One Nessie" or "Offline demo data" |
| `.score-number` + `.score-bar` | big light number with a progress bar (SwampTag Shield) |
| `.risk-box` | "Why we're asking" chips in the approval modal |

## Voice
- Short, plain sentences. Talk to the user ("your card", "your key").
- Say what happened and what's safe: "Payment blocked. Your $390.00 stayed in your account."
- Statuses use the same words everywhere: **Verified with SwampTag**, **Trusted · no tap needed**, **No SwampTag check**, **Blocked**.
