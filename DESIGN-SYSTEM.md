# Newton Policy Engine — Design System

Self-contained. Every value used by the demo is written out below; nothing here
points at a Figma file, an image, or a sheet you have to go and open. The
authoritative implementations are `lib/ds.ts` (tokens) and `app/globals.css`
(states and motion), and both are reproduced here in full at the end.

---

## 1. The rule the system exists to serve

This interface has one job: make a compliance decision legible. What was
checked, against what, and what happens next.

That produces three constraints which override any aesthetic preference:

1. **Detail about a decision must not rearrange the decision.** Evidence
   panels, history and raw responses are positioned out of flow (absolute,
   bottom-right) so that expanding them cannot move the verdict.
2. **The verdict never scrolls.** A decision you have to scroll to finish
   reading is not a decision you can take in at a glance. Padding gives way on
   short viewports; content does not.
3. **Colour carries meaning, so it cannot also carry interaction.** Green and
   orange are outcomes. Interaction is ink.

---

## 2. Spacing

An 8px layout grid on a 4px baseline. `1 unit = .5rem = 8px`, with a half-step
at 4px.

| Token    | px  | Typical use                                  |
| -------- | --- | -------------------------------------------- |
| `half`   | 4   | Label-to-value inside a stacked pair         |
| `x1`     | 8   | Label-to-control, chip gaps                  |
| `x1_5`   | 12  | Radio label offset, compact button padding   |
| `x2`     | 16  | Field internals, standard element gap        |
| `x3`     | 24  | Column gutter, gap between grouped blocks    |
| `x4`     | 32  | Section separation                           |
| `x5`     | 40  | Stage padding (vertical)                     |
| `x6`     | 48  | Stage padding (horizontal)                   |
| `x8`     | 64  | —                                            |
| `x10`    | 80  | Multiplied for card floors (`x10 * 2 = 160`) |

The demo previously ran on 8 / 14 / 22. Two of those sit off the grid, which is
why nothing lined up without hand-set offsets. If a number is not in this table,
it is a bug.

---

## 3. Radii

| Token  | px  | Use                          |
| ------ | --- | ---------------------------- |
| `sm`   | 8   | Inputs                       |
| `md`   | 12  | Inset panels, copy boxes     |
| `lg`   | 16  | Cards                        |
| `xl`   | 24  | Stage                        |
| `pill` | 999 | Actions, chips, radio marks  |

---

## 4. Control heights

Every value a multiple of 8, so controls sit on the layout grid.

| Token     | px | Use                                              |
| --------- | -- | ------------------------------------------------ |
| `field`   | 72 | Address input                                    |
| `control` | 48 | Secondary action (explorer link, disclosures)    |
| `action`  | 72 | Primary action — matches the field it submits    |
| `radio`   | 24 | Radio hit target and mark                        |

`action` equals `field` on purpose: the button is as tall as the thing it acts
on, so the two read as one unit rather than a form with a footer.

---

## 5. Type

One family throughout — Inter, self-hosted via `next/font/google`. Weight and
size carry hierarchy; there is no second family. (The demo previously ran
Instrument Serif for verdicts and Newsreader for prose, which is why adopting
the system's measurements barely showed: the tokens changed and the voice did
not.)

| Token     | Size | Line height | Weight | Tracking | Use                          |
| --------- | ---- | ----------- | ------ | -------- | ---------------------------- |
| `h1`      | 72   | 72px        | 600    | -0.03em  | Verdict headline             |
| `h2`      | 40   | 44px        | 600    | -0.02em  | Screening headline           |
| `h3`      | 24   | 32px        | 600    | -0.01em  | Card titles                  |
| `label`   | 14   | 20px        | 500    | —        | Field labels, section heads  |
| `valueLg` | 18   | 28px        | 400    | —        | Verdict reason               |
| `value`   | 16   | 24px        | 400    | —        | Body, input text             |
| `valueSm` | 14   | 20px        | 400    | —        | Small copy, radio labels     |
| `mono`    | 13   | 20px        | 400    | —        | Addresses, hashes            |
| `monoSm`  | 12   | 16px        | 400    | —        | Timestamps, chip text        |

Global tracking is `-0.006em`; display sizes tighten further per the table.

**Two mono sizes, not eight.** 11, 11.5, 12, 12.5 and 13 were all in use at one
point — five decisions where there was one question.

**Labels are sentence case at 14px.** They do not shout. Uppercase tracking
survives only in the OFAC lockup, where the mark requires it.

**A timestamp is not a hash.** "Decided" is set in sans, not mono, so it stops
competing with the addresses beside it.

---

## 6. Colour

Greys, no pure black. `#000` on `#F1F1F1` reads as a hole punched in the page;
`#1B1B1B` reads as ink.

### Neutrals

| Token      | Hex       | Use                                |
| ---------- | --------- | ---------------------------------- |
| `ink`      | `#1B1B1B` | Primary text, borders, fills       |
| `ink2`     | `#333333` | Hover state of ink                 |
| `field`    | `#F1F1F1` | Page background, inset panels      |
| `surface`  | `#FFFFFF` | Input fill, cards                  |
| `hairline` | `#E2E2E2` | (retained; not drawn in the demo)  |
| `control`  | `#CCCCCC` | Input and radio borders at rest    |
| `body`     | `#4A4A4A` | Secondary prose                    |
| `muted`    | `#6B6B6B` | Labels, hints                      |
| `muted2`   | `#A5A5A5` | Disabled text, resolved hints      |

### Interaction

| Token         | Hex       |
| ------------- | --------- |
| `accent`      | `#1B1B1B` |
| `accentHover` | `#333333` |
| `accentTint`  | `#ECECEC` |

**Indigo was specified and rejected.** It was tried and it fought the pastel
verdict fills, which are the only colour on the page that carries meaning. With
green and orange already spoken for, a third accent is one voice too many. Ink
does the same work and stays out of the way.

### Semantic

| Token   | Hex       | Meaning                          |
| ------- | --------- | -------------------------------- |
| `pass`  | `#3F6F55` | Compliant                        |
| `flag`  | `#C2621A` | Non-compliant, stale-data banner |
| `error` | `#8E2B1F` | Invalid input                    |

### Verdict fills

Pastel, not light — the fill has to hold 72px text at weight 600 without the
text going grey, and has to be unmistakable at a glance from across a room.
Headline text on every fill is `ink`, never white and never the semantic hue.

| Verdict       | Reads as                                        |
| ------------- | ----------------------------------------------- |
| `pass`        | Green                                           |
| `block`       | Orange                                          |
| `unavailable` | **Grey** — see below                            |
| `none`        | Salmon                                          |

`unavailable` is grey and separate on purpose. When the policy denies because
it *could not screen*, painting that orange beside the words "Non Compliant"
tells someone their counterparty is on a sanctions list when the truth is that
the list was too old to consult. A fail-closed denial must never read as an
accusation.

### Borders

`1px`, everywhere, no exceptions. The demo previously mixed 1px borders with
decorative hairlines at lower opacity; the hairlines are gone.

---

## 7. Components

### Input (`.pe-input`)

White fill, 1px `control` border, 8px radius, 72px tall, 16px horizontal
padding, mono at `value` size.

| State    | Treatment                                                     |
| -------- | ------------------------------------------------------------- |
| Default  | `1px solid #CCCCCC` on `#FFFFFF`                              |
| Hover    | Border `#A5A5A5` (only when not focused)                      |
| Focus    | Border `accent`, plus `0 0 0 2px accentTint` ring             |
| Error    | Border `error`, message below at `valueSm`                    |
| Disabled | `opacity: 0.36`, `pointer-events: none`                       |

The address is **truncated at rest and whole on focus** — a 42-character hash
should not dominate the panel, but a partial address is not editable.

The label is visible, not just `aria-label`. Two identical boxes with
placeholders that vanish on the first keystroke are indistinguishable the moment
they are filled, which is exactly when knowing which is which matters.

### Radio group

24px circular target, 1px `control` ring at rest, 2px `accent` ring with a 10px
`accent` fill when selected, label to the right at `valueSm`, 12px between mark
and label, 24px between options.

These were pill buttons, which read as actions — press to do something. They are
not: they are two mutually exclusive states of one field, which is what a radio
is for. The group carries a visible label ("Fill the recipient with"), so *which
field does this fill* stops being a question.

Keyboard: arrow keys move between options; only the selected option is tabbable
(roving tabindex).

### Primary action

Full width, 72px, pill radius, `label` type, flat `accent` fill.

Disabled is **outlined, not filled grey** — a filled grey block at this size
reads as a region, not as a control that is not ready. Border `control`, text
`muted2`, transparent background, `cursor: not-allowed`.

### Copy box

The pattern for evidence. 12/16 padding, `md` radius, `1px solid
rgba(27,27,27,0.22)`, translucent white fill, name on the left at `label`, a
pill-outlined "Copy" on the right at `monoSm`. Confirms as "Copied" for 1.4s.

Copy targets, not panels. Nobody reads a Rego policy in a drawer on a demo
screen — they take it somewhere with a scrollbar.

### Focus ring

`2px solid accent` with `2px` offset on every interactive element
(`:focus-visible`). Inputs additionally get the inset ring described above,
because the sheet draws field focus on the control itself.

Neutral rather than coloured: a green ring beside a green verdict was a second
green meaning something unrelated.

---

## 8. Layout

### Shell

`height: 100dvh`, `overflow: hidden`, flex column. A console, not a document —
the decision panel and the console trade the same frame without the page
growing.

Below `700px` tall it releases to `height: auto` and scrolls. Clipping a verdict
would be worse than scrolling to it.

### Console grid (`.pe-console`)

```
grid-template-columns: minmax(0, 0.85fr) minmax(0, 1fr);
align-items: stretch;
gap: 24px;
```

`stretch`, so the policy card matches the height of the step beside it — the two
are one row, not two floating panels.

**Alignment is arithmetic, not eyeballing.** The transfer column's height is
fully determined:

```
heading            20
+ gap              16
+ field           160   (label 20 + 8 + input 72 + 8 + pickers 52)
+ gap              16
+ action           72
= 284
```

The policy column carries a `minHeight` *below* that figure and `flex: 1` on the
card, so it absorbs the remainder rather than dictating the row. Any time a
field is added or removed, that floor is the number to recheck — a floor set for
a two-field column left a void in a one-field column.

### Corner reserve (`.pe-clear-corner`)

`max-width: min(1080px, calc(100% - 324px))` — 300px for the bottom-right
evidence boxes plus a 24px gutter. Below 1100px the corner stops being a corner
and the reserve is released.

### Breakpoints

| Width    | Change                                                                 |
| -------- | ---------------------------------------------------------------------- |
| ≤ 1100px | Corner boxes rejoin the flow; corner reserve released                   |
| ≤ 900px  | Console collapses to one column; padding 24/16                          |
| ≤ 640px  | Shell becomes a document (`height: auto`); radios stack; parties stack  |

At 390×844 a fixed-height console cannot hold two fields, radios, a 72px action
and three evidence tabs without `overflow: hidden` quietly clipping the bottom
of a compliance verdict. So below 640px the page stops being a console.

---

## 9. Motion

| Class        | Effect                                                            |
| ------------ | ----------------------------------------------------------------- |
| `.pe-wash`   | `clip-path: inset(0 100% 0 0)` → `inset(0)`, 0.66s, `(.22,1,.36,1)` |
| `.pe-reveal` | Same, 0.6s, 0.16s delay — headline uncovered behind the wash       |
| `.pe-seq`    | Children rise in reading order, 0.34s → 0.7s delays                |
| `.pe-rise`   | 6px rise + fade, 0.34s                                            |
| `.pe-sweep`  | Light band across a loading surface, 2.6s loop                     |
| `.pe-spin`   | 0.9s linear loop                                                   |
| `.pe-pulse`  | Opacity 1 → 0.3 → 1, 1.8s                                         |

**The fill is clipped, never scaled.** Scaling a gradient stretches it — the
angle changes mid-flight and the whole thing reads as cheap. Clipping moves an
edge across a gradient already at its final size.

**Nothing drops in from the top.** The panel used to, which read as one screen
being swapped for another — the motion a modal makes. But nothing is being
replaced: the stage is a single element that was holding the console a moment
ago. So the colour floods it instead.

**Sequence is reading order** — verdict, reason, lists, parties. That is the
order you would say it out loud. Landing them together gives the eye no route
through the panel.

`prefers-reduced-motion: reduce` disables all of the above, and explicitly
clears `clip-path` — a cancelled clip animation otherwise leaves the element
stuck at its `from` state, which is fully hidden.

---

## 10. Copy rules

- **"OFAC"**, not "AML / OFAC".
- **No per-list theatre.** The attestation carries no dataset information. An
  earlier build printed "OFAC no match · EU no match · UN no match · UK no
  match" directly beneath "Non Compliant" — four statements contradicting the
  headline, because the code filled a gap with defaults. Only regimes that
  actually matched are shown.
- **Nothing is prefilled.** A demo that arrives with an address already in the
  box invites you to press the button without reading the field.
- **Attribution is claimed only once it has come back.** A sentence naming a
  party we have not identified is a guess dressed as a finding.
- **A timestamp is mandatory.** "Was this address clean" is not answerable; only
  "was it clean *then*". A screenshot of this panel without a time is not
  evidence of anything.
- **Fail-closed states are framed as the system working**, because they are.
  Read cold, "blocked" looks like a fault.
- **Disagreement between sources is itself the finding.** The verdict is signed;
  the attribution below it is an unsigned lookup done afterwards. If they
  differ, the page says so rather than printing a denial above a party marked
  Clear and letting the reader reconcile it.
- **No numerals on the panels.** "01" and "02" implied an order nothing
  enforces.

---

## 11. `lib/ds.ts` — verbatim

```ts
export const SP = {
  half: 4,
  x1: 8,
  x1_5: 12,
  x2: 16,
  x3: 24,
  x4: 32,
  x5: 40,
  x6: 48,
  x8: 64,
  x10: 80,
} as const;

export const R = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

export const H = {
  field: 72,
  control: 48,
  action: 72,
  radio: 24,
} as const;

export const T = {
  label: { fontSize: 14, lineHeight: "20px", fontWeight: 500 },
  valueLg: { fontSize: 18, lineHeight: "28px", fontWeight: 400 },
  value: { fontSize: 16, lineHeight: "24px", fontWeight: 400 },
  valueSm: { fontSize: 14, lineHeight: "20px", fontWeight: 400 },

  h1: { fontSize: 72, lineHeight: "72px", fontWeight: 600, letterSpacing: "-0.03em" },
  h2: { fontSize: 40, lineHeight: "44px", fontWeight: 600, letterSpacing: "-0.02em" },
  h3: { fontSize: 24, lineHeight: "32px", fontWeight: 600, letterSpacing: "-0.01em" },

  mono: { fontSize: 13, lineHeight: "20px", fontWeight: 400 },
  monoSm: { fontSize: 12, lineHeight: "16px", fontWeight: 400 },
} as const;

export const C = {
  ink: "#1B1B1B",
  ink2: "#333333",
  field: "#F1F1F1",
  surface: "#FFFFFF",
  hairline: "#E2E2E2",
  control: "#CCCCCC",
  body: "#4A4A4A",
  muted: "#6B6B6B",
  muted2: "#A5A5A5",

  accent: "#1B1B1B",
  accentHover: "#333333",
  accentTint: "#ECECEC",

  pass: "#3F6F55",
  flag: "#C2621A",
  error: "#8E2B1F",
} as const;

export const BORDER = 1;
```

---

## 12. `app/globals.css` — the parts a token file cannot express

Four of the six input states are pseudo-classes, so they live in CSS rather than
in a style object. These rules are built from the tokens above.

```css
:root {
  color-scheme: light;

  --ink: #1b1b1b;
  --ink-2: #333333;
  --field: #f1f1f1;
  --surface: #ffffff;
  --hairline: #e2e2e2;
  --control: #bdbdbd;
  --control-2: #cccccc;
  --body: #4a4a4a;
  --muted: #6b6b6b;
  --muted-2: #a5a5a5;

  --pass: #3f6f55;
  --flag: #c2621a;
  --error: #8e2b1f;

  --accent: #1b1b1b;
  --accent-hover: #333333;
  --accent-tint: #ececec;

  --sans: var(--font-sans), -apple-system, BlinkMacSystemFont,
    "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
}

body {
  background: var(--field);
  color: var(--ink);
  font-family: var(--sans);
  -webkit-font-smoothing: antialiased;
  letter-spacing: -0.006em;
}

::selection {
  background: var(--accent-tint);
  color: var(--ink);
}

/* Shell */
.pe-shell {
  height: 100dvh;
  min-height: 700px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
@media (max-height: 700px) {
  .pe-shell { height: auto; min-height: 0; overflow: visible; }
}

/* Console grid */
.pe-console {
  display: grid;
  grid-template-columns: minmax(0, 0.85fr) minmax(0, 1fr);
  align-items: stretch;
  gap: 24px;
}

/* Corner reserve: 300px boxes + 24px gutter */
.pe-clear-corner { max-width: min(1080px, calc(100% - 324px)); }
@media (max-width: 1100px) {
  .pe-clear-corner { max-width: 100%; }
  .pe-corner { position: static !important; margin-top: 24px; }
}

@media (max-width: 900px) {
  .pe-console { grid-template-columns: minmax(0, 1fr); }
  .pe-pad { padding: 24px 16px !important; }
  .pe-mast { padding: 16px !important; }
  .pe-evidence { flex-wrap: wrap; }
}

@media (max-width: 640px) {
  .pe-shell { height: auto; min-height: 100dvh; overflow: visible; }
  .pe-stage, .pe-stage > * { overflow: visible !important; min-height: 0 !important; }
  .pe-pad { padding: 16px !important; }
  .pe-console { gap: 16px; }
  .pe-radios { flex-direction: column; gap: 12px !important; }
  .pe-parties { flex-direction: column; align-items: flex-start !important; gap: 16px !important; }
  .pe-evidence button { flex: 1 1 auto; }
}

/* Controls */
.pe-reset {
  appearance: none;
  border: none;
  background: none;
  margin: 0;
  font: inherit;
  color: inherit;
  text-align: inherit;
  cursor: pointer;
}

.pe-reset:focus-visible,
.pe-input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.pe-input {
  outline: none;
  transition: border-color 0.14s ease, box-shadow 0.14s ease;
}
.pe-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-tint);
}
.pe-input:hover:not(:focus) { border-color: var(--muted-2); }

.pe-hover:hover { border-color: var(--ink); }

.pe-dark { background: var(--accent); color: #fff; }
.pe-dark:hover { background: var(--accent-hover); }
.pe-dark:active { background: var(--accent-hover); transform: translateY(1px); }

.pe-disabled { opacity: 0.36; pointer-events: none; }

/* Motion */
@keyframes peWash {
  from { clip-path: inset(0 100% 0 0); }
  to   { clip-path: inset(0 0 0 0); }
}
.pe-wash   { animation: peWash 0.66s cubic-bezier(0.22, 1, 0.36, 1) both; }
.pe-reveal { animation: peWash 0.6s cubic-bezier(0.22, 1, 0.36, 1) 0.16s both; }

@keyframes peRise {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: none; }
}
.pe-rise > * { animation: peRise 0.34s cubic-bezier(0.22, 1, 0.36, 1) both; }

.pe-seq > * { animation: peRise 0.44s cubic-bezier(0.22, 1, 0.36, 1) both; }
.pe-seq > *:nth-child(1) { animation-delay: 0.34s; }
.pe-seq > *:nth-child(2) { animation-delay: 0.42s; }
.pe-seq > *:nth-child(3) { animation-delay: 0.5s; }
.pe-seq > *:nth-child(4) { animation-delay: 0.58s; }
.pe-seq > *:nth-child(5) { animation-delay: 0.64s; }
.pe-seq > *:nth-child(n + 6) { animation-delay: 0.7s; }

@keyframes peSweep {
  0%        { transform: translateX(-140%) skewX(-16deg); }
  70%, 100% { transform: translateX(560%) skewX(-16deg); }
}
.pe-sweep { position: relative; overflow: hidden; }
.pe-sweep::after {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  width: 22%;
  background: linear-gradient(
    90deg, transparent,
    rgba(255,255,255,0.16) 25%,
    rgba(255,255,255,0.6) 50%,
    rgba(255,255,255,0.16) 75%,
    transparent
  );
  animation: peSweep 2.6s cubic-bezier(0.45, 0, 0.3, 1) infinite;
  pointer-events: none;
}

@keyframes peSpin { to { transform: rotate(360deg); } }
.pe-spin { animation: peSpin 0.9s linear infinite; }

@keyframes pePulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
.pe-pulse { animation: pePulse 1.8s ease-in-out infinite; }

/* Scrollbar */
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.16);
  border: 3px solid transparent;
  background-clip: content-box;
  border-radius: 999px;
}

/* Everything above is decoration on top of a decision. Someone who has asked
   the OS for less motion still needs the decision. */
@media (prefers-reduced-motion: reduce) {
  .pe-wash, .pe-reveal, .pe-rise > *, .pe-seq > *,
  .pe-sweep::after, .pe-spin, .pe-pulse { animation: none; }
  .pe-wash, .pe-reveal { clip-path: none; }
}
```

---

## 13. Font

Inter, all weights used: 400, 500, 600. Loaded with `next/font/google`,
`subsets: ["latin"]`, `variable: "--font-sans"`, `display: "swap"`.

Self-hosted rather than linked: a page whose entire job is one legible verdict
should not wait on someone else's CDN to say it.

Mono is the system stack — `ui-monospace, SFMono-Regular, Menlo, monospace`. No
webfont; an address needs to be unambiguous, not branded.

---

## 14. Known gaps

Recorded so they are not mistaken for decisions:

- Not verified at 390px on a real device.
- Keyboard traversal verified per-component, not end to end.
- The stale screen has not been exercised against a genuinely stale feed
  (set `MAX_AGE_HOURS = 0` in `sanctions-api` to force it).
- The `hairline` token is retained but unused — hairlines were removed from the
  UI and one border weight now covers everything.
