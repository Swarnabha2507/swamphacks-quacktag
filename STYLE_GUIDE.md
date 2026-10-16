# SwampTag style guide

The look follows modern banking apps: gradient account tiles, navy text, blue actions, and a lot of quiet white space. **Red is only for the logo swoosh, fraud and danger.** It's SwampTag-branded, so don't use any real bank's logo or product names.

The cleanup pass followed the `redesign-existing-projects` checklist (installed in `.claude/skills/`, from the MIT-licensed taste-skill). Where that checklist conflicted with the banking reference, the reference won: we kept the blue gradients and account tiles.

All tokens live in `:root` at the top of [website/css/styles.css](website/css/styles.css). Use the variables and never hard-code hex values in components.

## Color

| Token | Hex | Use for |
|---|---|---|
| `--brand` | `#004977` | logo tile, dark buttons (`.btn-navy`) |
| `--brand-dark` | `#13294b` | headings, tile footers, toasts |
| `--link` | `#0276b1` | primary buttons, links, focus rings, active tab, switches |
| `--accent` | `#d03027` | logo swoosh, hero highlight, the Simulate fraud icon |
| `--green` / `--green-soft` | `#2a7a17` / `#e8f3e4` | verified, approved, live data |
| `--danger` / `--danger-soft` | `#c4262a` / `#fbeceb` | blocked, fraud, at-risk bar |
| `--amber` / `--amber-soft` | `#8f5a0b` / `#fbf2e2` | offline data, medium-risk reasons |
| `--surface-2` / `--surface-3` | `#f3f5f7` / `#e8ecef` | app background / dividers, skeletons |
| `--border` | `#d9dee3` | card borders |
| `--text` / `--muted` | `#1f2a33` / `#5b6670` | body text / secondary text (one cool gray family) |

**Gradient tiles:** at most **one per column**.
- `--tile-checking`: the bank account.
- `--tile-shield`: fraud blocked, with a `--brand-dark` footer bar.
- Both add a soft radial highlight from the top right, so they aren't flat 45° fades.

## Type
- **Geist** for UI and **Geist Mono** for key UIDs (Google Fonts).
- Weights: 300 (big Shield number), 400–450 (money on tiles), 500 (list names), 600 (labels and buttons), 650 (headlines). We don't use 800.
- **Every money amount uses `font-variant-numeric: tabular-nums`** (`.num` helper, built into the amount classes).
- Headlines use negative tracking (−0.02 to −0.035em) and `text-wrap: balance`. Paragraphs are capped at about 46–65ch.
- Sentence case everywhere. No all-caps labels.

## Shape, surfaces and spacing
- **Radius scale:** tiles and modals 14px, cards 12px, buttons and inputs 8px, badges 6px. Avatars are rounded squares (12px), not circles.
- **Cards get a border, not a shadow.** Only tiles, modals and toasts have shadows, and those shadows are tinted navy.
- **Spacing:** sections use 96px top and 104px bottom padding. Card padding is 24px (20px on phones). Stacks have a 16px gap.
- **Z-index scale:** `--z-nav` 20, `--z-tabbar` 30, `--z-modal` 50, `--z-toast` 60.
- **Phones (≤ 640px):** single column, 16px gutter, and a fixed bottom tab bar (Home · Activity · Key · Security) with 48px targets.

## Components
| Class | What it is |
|---|---|
| `.tile` + `.tile-checking` / `.tile-shield` | gradient tiles |
| `.key-strip` | slim white row: key status dot, text, Link / Connect buttons |
| `.row-button` | quiet full-width action (Pay in store, Simulate fraud) |
| `.btn-primary` / `-outline` / `-navy` / `-ghost` / `-danger` / `-on-dark` | buttons. Use `.text-btn` for tertiary text actions |
| `.badge` (+ `-live` / `-offline` / `-red` / `-amber` / `-blue`, `.badge-dot`) | square-cornered status labels (not pills) |
| `.tx-status` (+ `.verified` / `.blocked`) | the status line under an amount. Only Verified and Blocked get color |
| `.skeleton` (+ `-amount` / `-row`) | shimmer placeholders while Nessie loads |
| `.score-number` + `.score-bar` | big light number with a progress bar |
| `.risk-box` | "Why we're asking" reasons in the approval modal |
| `confirmModal()` in dashboard.js | in-page confirmation (never `window.confirm`) |

## States
- **Focus:** every interactive element shows a 2px `--link` focus ring through `:focus-visible`.
- **Hover and press:** 200–300ms transitions using `--ease`. Press feedback is `translateY(1px)`.
- **Loading:** skeletons for the balance, activity and bills.
- **Empty states:** "No activity yet…" and "You're all paid up."
- **Errors:** inline form errors (`.form-error`, `aria-invalid`) and toasts. No `alert()`.
- **Reduced motion:** animations and smooth scrolling turn off with `prefers-reduced-motion`.

## Voice
- Short, plain, active sentences addressed to the user ("your card", "your key").
- No exclamation marks, and none of "seamless", "elevate", or "unleash".
- Say what happened and what's safe: "Payment blocked. Your $390.00 stayed in your account."
- **Status words are fixed:**
  - Verified with SwampTag
  - Trusted · no tap needed
  - No SwampTag check
  - Blocked
  - Received
  - Requested
