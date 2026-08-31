/**
 * Design system tokens.
 *
 * Transcribed from the supplied sheets — Spacing, Inputs, Radio — so the
 * components read from one place instead of carrying numbers inline. That is
 * the difference between applying a design system and repainting: a value
 * that appears once here is a decision; a value typed into a component is a
 * coincidence waiting to drift.
 */

/* ── Spacing ─────────────────────────────────────────────────
 *
 * "Magic uses an 8px layout grid and a 4px baseline grid."
 * 1 unit = .5rem = 8px, with a half-step at 4px.
 *
 * The demo previously ran on 8 / 14 / 22 — two of those sit off the grid,
 * which is why nothing quite lined up without hand-set offsets.
 */
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

/* ── Radii ─────────────────────────────────────────────────── */

export const R = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

/* ── Control heights ─────────────────────────────────────────
 * Every value a multiple of 8, so controls sit on the layout grid.
 */
export const H = {
  field: 72,
  control: 48,
  action: 72,
  radio: 24,

  /**
   * Small pills: the network badge, Cancel.
   *
   * These are status and escape hatches, not actions you are meant to reach
   * for, so they sit a step below `control`. It exists as a token because the
   * two were drawn independently — the badge at 38 (padding, not height) and
   * Cancel at 40 — and two pills two centimetres apart being 2px different is
   * the kind of thing you see without being able to name.
   */
  chip: 40,
} as const;

/**
 * The one horizontal inset.
 *
 * The masthead was padded to 16, the console and screening panels to 48, and
 * the verdict to a clamp topping out at 56 — so nothing pinned to a right
 * edge lined up with anything above or below it. One value means two vertical
 * lines down the page: the mark, the headings and the verdict on the left;
 * the network badge, Cancel and the actions on the right.
 *
 * A clamp rather than a constant because 48 is too much of a 390px screen.
 */
export const INSET_X = "clamp(24px, 4vw, 48px)";

/* ── Type ────────────────────────────────────────────────────
 *
 * From the Inputs sheet's Styles block:
 *   Label   Medium (500)  14 / 20
 *   Value   Normal (400)  18 / 28  ·  16 / 24  ·  14 / 20
 *
 * These replace the 9–11px uppercase micro-labels the demo used previously.
 * The sheet's label is sentence case at 14px, so labels no longer shout —
 * uppercase tracking survives only where the sheet has no opinion and the
 * mark requires it (the masthead lockup).
 */
export const T = {
  label: { fontSize: 14, lineHeight: "20px", fontWeight: 500 },
  valueLg: { fontSize: 18, lineHeight: "28px", fontWeight: 400 },
  value: { fontSize: 16, lineHeight: "24px", fontWeight: 400 },
  valueSm: { fontSize: 14, lineHeight: "20px", fontWeight: 400 },

  /**
   * Headings, in the same grotesque as everything else.
   *
   * The sheets set their own titles this way — weight and size carry the
   * hierarchy, not a second family. The demo was running a serif display face
   * the system never mentions, which is why applying the system's tokens
   * changed the measurements without changing the voice.
   */
  h1: { fontSize: 72, lineHeight: "72px", fontWeight: 600, letterSpacing: "-0.03em" },
  h2: { fontSize: 40, lineHeight: "44px", fontWeight: 600, letterSpacing: "-0.02em" },
  h3: { fontSize: 24, lineHeight: "32px", fontWeight: 600, letterSpacing: "-0.01em" },

  /**
   * Addresses, hashes, timestamps.
   *
   * Two sizes, not the eight the demo had accumulated — 11, 11.5, 12, 12.5
   * and 13 were all in use, which is five decisions where there was only one
   * question.
   */
  mono: { fontSize: 13, lineHeight: "20px", fontWeight: 400 },
  monoSm: { fontSize: 12, lineHeight: "16px", fontWeight: 400 },
} as const;

/* ── Colour ──────────────────────────────────────────────────
 *
 * Greys stay as the demo's DIA-derived set. The verdict fills keep green and
 * orange — those are outcomes, not interaction, and the two vocabularies
 * should not borrow from each other.
 */
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

  /**
   * Interaction is ink, not a hue.
   *
   * The sheets specify indigo; it was tried and it fought the pastel verdict
   * fills, which are the only colour on this page that carries meaning. With
   * green and orange already spoken for, a third accent is one voice too
   * many.
   */
  accent: "#1B1B1B",
  accentHover: "#333333",
  accentTint: "#ECECEC",

  pass: "#3F6F55",
  flag: "#C2621A",
  error: "#8E2B1F",
} as const;

/** The sheets draw every control at 1px. */
export const BORDER = 1;

/*
 * Input states — Default · Hover · Pressed · Focused · Disabled · Error —
 * live in globals.css on `.pe-input` rather than here, because four of the
 * six are pseudo-classes that a style object cannot express. The tokens above
 * are what those rules are built from.
 */
