"use client";

/**
 * Newton AML/OFAC Policy Engine.
 *
 * Select a policy, give it a recipient, enforce it on-chain. Layout and type
 * are ported from the Policy Engine design file; the logic is not — that file
 * simulates verdicts, and every result here comes from a Newton operator
 * quorum evaluating the policy deployed on Sepolia.
 *
 * Two rules the layout obeys, both learned the hard way:
 *   - cards never change size between states, so nothing jumps mid-demo
 *   - both columns fit a normal viewport without scrolling
 */

import { useEffect, useMemo, useState } from "react";
import {
  GOALS,
  PROVIDERS,
  RULES,
  generateRego,
  defaultParams,
  rulesForProvider,
  SANCTIONED_TEST_ADDRESS,
  type Selection,
} from "@/lib/catalog";
import { SANCTIONED_POOL } from "@/lib/sanctioned-pool";

/**
 * A fresh address on every click, so the buttons do not look like a lookup of
 * two hardcoded cases.
 *
 * Sanctioned draws from a pool verified against the live feed — see
 * sanctions-api/emit-pool.mjs. Drawing from the static OFAC list instead would
 * risk offering a delisted address, which would come back COMPLIANT and make
 * the button contradict its own label.
 *
 * Ordinary is generated at random. A 20-byte address chosen at random is not
 * on any sanctions list, and generating one is more honest than curating a
 * list of "clean" addresses that belong to real people.
 */
function randomSanctioned(current: string): string {
  const pool = SANCTIONED_POOL.length ? SANCTIONED_POOL : [SANCTIONED_TEST_ADDRESS];
  const others = pool.filter((a) => a.toLowerCase() !== current.toLowerCase());
  const from = others.length ? others : pool;
  return from[Math.floor(Math.random() * from.length)];
}

function randomOrdinary(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const GOAL_ID = Object.keys(GOALS)[0];

const DISPLAY = "'GT Sectra Display',Georgia,serif";
const SERIF = "'GT Sectra',Georgia,serif";
const SANS = "-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,monospace";

/**
 * Shared by the policy card and every state of the decision card.
 * Sized for the tallest content — verdict headline, deny chips, explorer
 * button — so neither card resizes and the two columns stay level.
 */
const CARD_H = 138;

/**
 * One spacing scale for both columns, so boxes on the left and right land on
 * the same lines. Previously each column had its own gaps and they drifted
 * apart by a few pixels at every step.
 */
const PAD = "20px 48px 24px";

/**
 * Fixed row heights, so the two columns can be aligned by arithmetic instead
 * of by eye.
 *
 * Every row that either column can contain has a declared height here. That
 * is what makes the offsets below exact: without it the heights come from
 * font metrics, which differ between the serif labels on the left and the
 * mono field beside them, and "nearly aligned" is the best anyone can do.
 */
const ROW_H = 48; // every box in the tool is this tall
const FIELD_H = ROW_H; // named separately only because the offsets read better
const ACTION_H = ROW_H; // so the action and the last disclosure share both edges
const LINE_H = 14; // one line of helper text

/** Inside a box: icon to text, label to value. */
const TIGHT = 6;

/** Inside a group: head to first box, and between rows of one step. */
const HEAD_GAP = 10;

/**
 * Between groups — and, not coincidentally, between the disclosures opposite.
 *
 * Derived rather than chosen. The left column puts a line of helper text
 * between the field and the shortcuts; the right column has no such line, so
 * for the two to stay level the right-hand gap must equal everything that row
 * costs: the line itself plus the gap on either side of it.
 *
 * Solve for a single value that works as both, and it falls out exactly:
 * a uniform gap of LINE_H + 2·HEAD_GAP puts every box on the right level with
 * its counterpart on the left, with no bespoke offsets anywhere. Which is why
 * "Or try one of these" can come back — the space it needs is the same space
 * the layout now uses everywhere.
 */
const COL_GAP = LINE_H + 2 * HEAD_GAP; // 34

/**
 * One stroke weight for the whole tool.
 *
 * Frames were 3px, buttons 2px and separators 1px, which read as three
 * different systems on one screen. Everything that draws a line now draws
 * this one, and the hairline separators are gone rather than thinned —
 * boxes already have edges, so a rule between them was a second answer to a
 * question already settled.
 */
const BORDER = 2;
const RULE = `${BORDER}px solid #000000`;

/**
 * The one correction the uniform gap cannot express.
 *
 * An invalid address adds a row on the left that has no counterpart on the
 * right, so everything below it drops by the height of that row plus its
 * gap. Applied to the second disclosure only: margins accumulate, so the
 * third follows it down on its own.
 */
const INVALID_SHIFT = LINE_H + HEAD_GAP; // 34

type Outcome = {
  headline: string;
  reason: string;
  denies: string[];
  explorerUrl?: string | null;
  evidence: [string, string][];
  raw: unknown;
  tone: "ok" | "block" | "error";
};

/**
 * A run as the chain describes it.
 *
 * `pending` is a real third state, not a placeholder: the task manager's own
 * docs are explicit that a withheld response emits nothing, so "no denial" is
 * not the same as "allowed" and must not be drawn as though it were.
 */
type SharedRun = {
  taskId: string;
  address: string;
  verdict: "allowed" | "denied" | "pending";
  block: number;
};

type RunState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "result"; outcome: Outcome; stale?: boolean };

/** Never render an object into the DOM — that's where "[object Object]" comes from. */
function asText(v: unknown): string {
  if (typeof v === "string") return v;
  if (v == null) return "";
  if (v instanceof Error) return v.message;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

const shortAddr = (a: string) => (a && a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a || "—");

export default function Wizard() {
  const goal = GOALS[GOAL_ID];
  const providerId = goal.providers[0];
  const provider = PROVIDERS[providerId];

  const ruleIds = useMemo(
    () => rulesForProvider(GOAL_ID, providerId).filter((r) => RULES[r]?.defaultOn),
    [providerId],
  );
  const rego = useMemo(() => {
    const sel: Selection = { goalId: GOAL_ID, providerId, ruleIds, params: defaultParams(ruleIds) };
    return generateRego(sel);
  }, [providerId, ruleIds]);

  const [policySelected, setPolicySelected] = useState(false);
  const [to, setTo] = useState("");
  const [picked, setPicked] = useState<"clean" | "sanctioned" | null>(null);
  const [run, setRun] = useState<RunState>({ status: "idle" });

  /**
   * Previous verdicts, newest first — everyone's, not just this tab's.
   *
   * This matters for more than convenience. A policy that denies everything
   * looks identical to one that works, unless something is visibly allowed
   * alongside it; a list that resets on reload means most visitors see one
   * result and no contrast. Read from Sepolia via /api/history, so what is
   * listed here is the attestation record rather than a local account of it.
   */
  const [history, setHistory] = useState<SharedRun[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);

  async function loadHistory() {
    try {
      const res = await fetch("/api/history");
      const json = await res.json();
      if (json.ok) {
        setHistory(json.runs ?? []);
        setHistoryError(null);
      } else {
        setHistoryError(asText(json.error));
      }
    } catch (e) {
      setHistoryError(asText(e));
    }
  }

  // On arrival, and again after each run once the response has been indexed.
  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const valid = /^0x[a-fA-F0-9]{40}$/.test(to);
  const showInvalid = Boolean(to) && !valid;
  const busy = run.status === "running";
  const split = run.status !== "idle";
  const ready = valid && policySelected && !busy;

  /**
   * Inputs changed. Keep any verdict on screen, marked stale — resetting to
   * idle collapsed the whole right panel on every keystroke.
   */
  function invalidate() {
    setRun((r) => (r.status === "result" ? { ...r, stale: true } : { status: "idle" }));
  }

  /**
   * `explorerUrl` is optional because some failures happen before a task
   * exists — but when one does, the link is the most useful thing on screen:
   * it is the record this page failed to read.
   */
  function failWith(reason: string, raw: unknown, explorerUrl?: string | null) {
    setRun({
      status: "result",
      outcome: {
        headline: "Couldn't complete",
        reason,
        denies: [],
        evidence: extractEvidence(raw),
        raw,
        explorerUrl: explorerUrl ?? null,
        tone: "error",
      },
    });
  }

  async function verify() {
    setRun({ status: "running" });
    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "submit", to, policyDataAddress: provider.policyData, providerId }),
      });
      const json = await res.json();

      if (!res.ok || json.ok === false) {
        failWith(asText(json.error) || "The request failed before a decision was reached.", json.raw);
        return;
      }

      /**
       * An operator-level failure is not a verdict. The task can come back
       * with an error or a set of operator_errors and no attestation at all;
       * reading that as a decision would put a headline on nothing.
       */
      const taskError = json.result?.error ?? json.result?.operator_errors?.[0]?.message;
      if (taskError) {
        failWith(asText(taskError), json.result, json.explorerUrl);
        return;
      }

      const allow = extractAllow(json.result);

      /**
       * Fail closed on an unreadable response.
       *
       * This previously read `allow === false ? "Non Compliant" : "Compliant"`,
       * which quietly turned undefined — no verdict found — into a green
       * PASS. Combined with extractAllow not understanding createTask's
       * bytes32, that made every submitted task show Compliant while the
       * explorer showed the operators' actual answer. A screening tool that
       * says "allowed" when it does not know is worse than one that breaks.
       */
      if (allow === undefined) {
        failWith(
          "The operators answered, but no verdict could be read from the response. " +
            "Open the attestation in the explorer — that is the authoritative record.",
          json.result,
          json.explorerUrl,
        );
        return;
      }

      const headline = allow ? "Compliant" : "Non Compliant";
      const tone: Outcome["tone"] = allow ? "ok" : "block";

      /**
       * Re-read from chain rather than appending locally.
       *
       * Appending would put this run in the list on the page's authority; the
       * point of the shared feed is that it carries the chain's. The response
       * is usually indexed by the time this fires, and if it is not, the run
       * appears on the next load.
       */
      loadHistory();

      setRun({
        status: "result",
        outcome: {
          headline,
          reason: extractReason(json.result) ?? "",
          denies: extractDenies(json.result),
          explorerUrl: json.explorerUrl ?? null,
          evidence: extractEvidence(json.result),
          raw: json.result,
          tone,
        },
      });
    } catch (e) {
      failWith(asText(e), null);
    }
  }

  /**
   * Pastel fill, saturated type.
   *
   * The card is entirely the verdict's colour, but at low saturation so the
   * page stays readable — a full-strength block of orange next to a bone
   * background overwhelmed everything around it. The headline and chips then
   * carry the strong version of the same hue, which keeps the contrast where
   * the meaning is.
   */
  const fillColor = (t: Outcome["tone"]) =>
    t === "ok" ? "#A8C4AF" : t === "block" ? "#E8B587" : "#DFA79C";

  const inkColor = (t: Outcome["tone"]) =>
    t === "ok" ? "#2E5A44" : t === "block" ? "#C2621A" : "#8E2B1F";

  return (
    <div
      className="dc-page"
      style={{
        height: "100vh",
        overflow: "hidden",
        background: "#FAF9F6",
        color: "#000000",
        fontFamily: SERIF,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* ── Masthead ─────────────────────────────────────────── */}
      <div
        className="dc-mast"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: COL_GAP,
          padding: "16px 48px",
          borderBottom: RULE,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: HEAD_GAP }}>
          <img src="/newton-logo.svg" alt="Newton" style={{ height: 26, width: "auto", display: "block" }} />
          <div
            style={{
              background: "#000000",
              color: "#FAF9F6",
              fontFamily: SANS,
              fontSize: 13.5,
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              padding: "9px 14px",
            }}
          >
            AML / OFAC Policy Engine
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: TIGHT, border: RULE, padding: "6px 13px" }}>
          <span
            className="pulse"
            style={{ width: 8, height: 8, borderRadius: "50%", background: "#3F6F55", display: "block" }}
          />
          <div style={{ fontFamily: SANS, fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase" }}>
            Ethereum Sepolia
          </div>
        </div>
      </div>

      <div className="dc-split" style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "stretch" }}>
        {/* ── Left ───────────────────────────────────────────── */}
        <div
          className="dc-pad"
          style={{
            flex: 1,
            minWidth: 0,
            width: "100%",
            // Capped and centred while full-width: steps stretched across a
            // wide monitor stop reading as a sequence.
            maxWidth: split ? "none" : 700,
            marginInline: split ? undefined : "auto",
            padding: PAD,
            display: "flex",
            flexDirection: "column",
            gap: COL_GAP,
            overflowY: "auto",
            // Same curve and duration as the panel, so the two halves move as
            // one gesture instead of two overlapping ones.
            transition: "max-width 0.5s cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        >
          {/* 01 — the policy, before the address. The address is this
              module's input, not the subject of the page. */}
          <div style={{ display: "flex", flexDirection: "column", gap: HEAD_GAP }}>
            <StepHead n="01">Select a policy</StepHead>

            <button
              type="button"
              aria-pressed={policySelected}
              onClick={() => {
                setPolicySelected((v) => !v);
                invalidate();
              }}
              className={`dc-reset${policySelected ? "" : " dc-hover"}`}
              style={{
                border: RULE,
                background: policySelected ? "#000000" : "#FAF9F6",
                color: policySelected ? "#FAF9F6" : "#000000",
                display: "flex",
                flexDirection: "column",
                cursor: "pointer",
                minHeight: CARD_H,
                // Short enough to feel immediate, long enough that the card
                // does not snap. This is the most-clicked thing on the page.
                transition: "background 0.18s ease, color 0.18s ease",
              }}
            >
              <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: TIGHT, flex: 1 }}>
                <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 22, lineHeight: 1.1 }}>
                  Sanctions Screening
                </div>
                {/*
                  Recipient, not "either party". The deployed policy screens the
                  sender too and that is verified — but this page always sends
                  the same clean sender, so nothing here exercises it.
                */}
                <div style={{ fontSize: 15, lineHeight: 1.45, color: policySelected ? "#FAF9F6" : "#171714" }}>
                  Blocks a transaction if the recipient appears on a sanctions list.
                </div>
              </div>

              <div
                style={{
                  background: policySelected ? "#FAF9F6" : "transparent",
                  color: policySelected ? "#000000" : "#5C5C55",
                  transition: "background 0.18s ease, color 0.18s ease",
                  fontFamily: SANS,
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  padding: "6px 20px",
                }}
              >
                {policySelected ? "Applied" : "Select"}
              </div>
            </button>
          </div>

          {/* 02 — recipient */}
          <div style={{ display: "flex", flexDirection: "column", gap: HEAD_GAP }}>
            <StepHead n="02">Add a recipient</StepHead>

            <input
              value={to}
              onChange={(e) => {
                setTo(e.target.value.trim());
                // Typed by hand, so neither shortcut is the source any more.
                setPicked(null);
                invalidate();
              }}
              spellCheck={false}
              placeholder="0x…"
              className="dc-input"
              style={{
                // The same box as a disclosure opposite: same height, same
                // frame, same inset. Mono, because it holds an address —
                // sized to sit optically level with the serif labels rather
                // than to match their point size.
                width: "100%",
                height: FIELD_H,
                border: RULE,
                background: "transparent",
                color: "#000000",
                fontFamily: MONO,
                fontSize: 14.5,
                letterSpacing: "-0.015em",
                padding: "0 16px",
                outline: "none",
              }}
            />

            {/* Declared heights, because the right column measures itself
                against these rows. */}
            {showInvalid && (
              <div style={{ height: LINE_H, lineHeight: `${LINE_H}px`, fontSize: 12.5, color: "#8E2B1F" }}>
                Not a valid 20-byte address.
              </div>
            )}

            {/* Type sized to the 16px line box rather than the other way
                round, so the row costs exactly LINE_H and COL_GAP stays
                honest. */}
            <div style={{ height: LINE_H, lineHeight: `${LINE_H}px`, fontSize: 12.5, color: "#5C5C55" }}>
              Or try one of these:
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2,minmax(0,1fr))",
                gap: HEAD_GAP,
                height: ROW_H,
              }}
            >
              {/*
                Active state tracks which button last filled the field, not
                which address is in it — the addresses change every click, so
                comparing against a constant would never match.
              */}
              <Shortcut
                active={picked === "clean"}
                label="Ordinary wallet"
                onClick={() => {
                  setTo(randomOrdinary());
                  setPicked("clean");
                  invalidate();
                }}
              />
              <Shortcut
                active={picked === "sanctioned"}
                label="Sanctioned wallet"
                onClick={() => {
                  setTo(randomSanctioned(to));
                  setPicked("sanctioned");
                  invalidate();
                }}
              />
            </div>
          </div>

          {/* The action. No step number: the other two are decisions, this is
              what they lead to. */}
          <div style={{ display: "flex", flexDirection: "column", gap: HEAD_GAP }}>
            <button
              type="button"
              onClick={verify}
              disabled={!ready}
              className={`dc-reset dc-primary${!ready ? " dc-disabled" : run.status === "idle" ? " dc-ready" : ""}`}
              style={{
                height: ACTION_H,
                background: "#000000",
                color: "#FAF9F6",
                cursor: "pointer",
                fontFamily: SANS,
                fontSize: 14,
                fontWeight: 600,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                // Centred by flex rather than by padding, so the declared
                // height is the whole story.
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "0 24px",
              }}
            >
              Verify policy onchain
            </button>

            {/* A greyed primary button with no explanation reads as broken
                rather than waiting. */}
            {!ready && !busy && (
              <div style={{ height: LINE_H, lineHeight: `${LINE_H}px`, fontSize: 12.5, color: "#5C5C55" }}>
                {!policySelected && !valid
                  ? "Select a policy and enter an address."
                  : !policySelected
                    ? "Select a policy above."
                    : "Enter an address to screen."}
              </div>
            )}
          </div>
        </div>

        {/* ── Right ──────────────────────────────────────────── */}
        {/*
          Two elements on purpose.

          The outer one is the shutter: its width animates from 0 and it clips
          whatever is inside. The inner one is a fixed 50vw at all times, so
          the contents are laid out at their final size from the first frame
          and the reveal uncovers finished text instead of reflowing it.

          Putting that fixed width on the outer element — as I did first —
          makes min-width beat width:0 and the panel never closes at all.
        */}
        <div
          className="dc-rail"
          aria-hidden={!split}
          style={{
            width: split ? "50%" : 0,
            flexShrink: 0,
            overflow: "hidden",
            borderLeft: `${split ? BORDER : 0}px solid #000000`,
            // Decelerating curve — fast off the mark, settling gently. A
            // linear-feeling ease made the panel look dragged open.
            transition:
              "width 0.5s cubic-bezier(0.22, 1, 0.36, 1), border-left-width 0.5s cubic-bezier(0.22, 1, 0.36, 1)",
            background: "#FAF9F6",
          }}
        >
          <div
            className={`dc-rail-inner dc-pad${split ? " dc-rail-in" : ""}`}
            style={{
              width: "50vw",
              height: "100%",
              padding: PAD,
              display: "flex",
              flexDirection: "column",
              gap: COL_GAP,
              overflowY: "auto",
            }}
          >
          {/* An invisible copy of the step header opposite, so the two columns
              align by construction rather than by a computed offset. */}
          <div style={{ display: "flex", flexDirection: "column", gap: HEAD_GAP }}>
            <div aria-hidden style={{ visibility: "hidden" }}>
              <StepHead n="00">Spacer</StepHead>
            </div>

            {run.status !== "result" ? (
              <div
                style={{
                  border: RULE,
                  background: "#FAF9F6",
                  display: "flex",
                  flexDirection: "column",
                  minHeight: CARD_H,
                }}
              >
                <div
                  style={{
                    padding: "16px 20px",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    gap: TIGHT,
                    flex: 1,
                  }}
                >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: TIGHT,
                    fontFamily: SANS,
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: "#5C5C55",
                  }}
                >
                  {busy && (
                    <span
                      className="pulse"
                      style={{ width: 8, height: 8, borderRadius: "50%", background: "#000000", display: "block" }}
                    />
                  )}
                  {busy ? "Awaiting quorum" : "Pending decision"}
                </div>

                <div
                  style={{
                    fontFamily: DISPLAY,
                    fontWeight: 300,
                    fontSize: 34,
                    lineHeight: 1.02,
                    letterSpacing: "-0.02em",
                    color: busy ? "#000000" : "#5C5C55",
                  }}
                >
                  {busy ? "Screening" : "Not yet decided"}
                </div>

                {/* Indeterminate on purpose: there is no progress figure to
                    report from a quorum, and a moving percentage would be
                    invented information. */}
                {busy && (
                  <div style={{ height: 6, background: "rgba(0,0,0,0.12)", overflow: "hidden", marginTop: 2 }}>
                    <div
                      style={{
                        height: "100%",
                        width: "22%",
                        background: "#000000",
                        animation: "loadSlide 1.5s ease-in-out infinite",
                      }}
                    />
                  </div>
                )}
                </div>

                {/* Same foot the policy card has, in its unselected state. */}
                <div
                  style={{
                    color: "#5C5C55",
                    fontFamily: SANS,
                    fontSize: 10.5,
                    fontWeight: 700,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    padding: "6px 20px",
                  }}
                >
                  {busy ? "Running" : "Idle"}
                </div>
              </div>
            ) : (
              <div
                style={{
                  position: "relative",
                  overflow: "hidden",
                  border: RULE,
                  background: "#FAF9F6",
                  display: "flex",
                  flexDirection: "column",
                  minHeight: CARD_H,
                  // Faded, not removed: the verdict was real, it just no
                  // longer describes what is in the form.
                  opacity: run.stale ? 0.4 : 1,
                  transition: "opacity 0.2s ease",
                }}
              >
                {/*
                  The colour fills the whole card and wipes in from the left,
                  rather than sitting as a rule along the top. A verdict is not
                  a label on a neutral card — it is the state of the card.

                  Drawn as an absolute layer so it can animate independently of
                  the contents, which sit above it.
                */}
                <div
                  key={`${run.outcome.headline}-${run.outcome.tone}`}
                  className="dc-rule"
                  style={{ position: "absolute", inset: 0, background: fillColor(run.outcome.tone) }}
                />

                <div
                  className="dc-verdict"
                  style={{
                    position: "relative",
                    padding: "16px 20px",
                    display: "flex",
                    flexDirection: "column",
                    gap: TIGHT,
                    flex: 1,
                    color: "#171714",
                  }}
                >
                {run.stale && <Eyebrow>Inputs changed · run again</Eyebrow>}

                <div
                  style={{
                    fontFamily: DISPLAY,
                    fontWeight: 700,
                    fontSize: 38,
                    lineHeight: 0.95,
                    letterSpacing: "-0.03em",
                    // Black on the pastel fill. The colour is already saying
                    // which verdict this is; setting the headline in the same
                    // hue made it fight its own background.
                    color: "#000000",
                  }}
                >
                  {run.outcome.headline}
                </div>

                {/* Prose only where it is the sole explanation. For a verdict
                    the headline says it, and the deny chip says why. */}
                {run.outcome.tone === "error" && (
                  <div style={{ fontSize: 14.5, lineHeight: 1.45, maxWidth: "44ch" }}>
                    {run.outcome.reason}
                  </div>
                )}

                {run.outcome.denies.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: TIGHT }}>
                    {run.outcome.denies.map((d, i) => (
                      <span
                        key={d}
                        className="dc-chip"
                        style={{
                          fontFamily: MONO,
                          fontSize: 11.5,
                          // Drawn in the verdict's own darker hue. Cream had
                          // enough contrast against a saturated fill; against
                          // a pastel one it disappeared.
                          border: `${BORDER}px solid ${inkColor(run.outcome.tone)}`,
                          color: inkColor(run.outcome.tone),
                          padding: "4px 8px",
                          // Staggered after the headline so several reasons
                          // arrive one at a time rather than as a block.
                          animationDelay: `${0.34 + i * 0.05}s`,
                        }}
                      >
                        {d}
                      </span>
                    ))}
                  </div>
                )}

                </div>

                {/*
                  A foot bar, matching the policy card opposite. Both cards now
                  read the same way: content above, a black status strip along
                  the bottom. Previously the left card had a foot and the right
                  one did not, which is what made them look like two different
                  components.
                */}
                <div
                  style={{
                    position: "relative",
                    background: "#000000",
                    color: "#FAF9F6",
                    fontFamily: SANS,
                    fontSize: 10.5,
                    fontWeight: 700,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                  }}
                >
                  {run.outcome.explorerUrl ? (
                    <a
                      href={run.outcome.explorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: TIGHT,
                        padding: "6px 20px",
                        color: "#FAF9F6",
                      }}
                    >
                      <span>View attestation</span>
                      <span aria-hidden>Newton Explorer ↗</span>
                    </a>
                  ) : (
                    <div style={{ padding: "6px 20px" }}>Decided</div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/*
            The three disclosures, sitting on the left column's rows.

            An invisible head puts the top of the stack level with the top of
            the recipient field. The two margins below then place the second
            box level with the wallet shortcuts and the third level with the
            action button. Every number derives from the row heights declared
            at the top of this file, so the columns cannot drift: change a
            height and both sides move together.

            A spacer rather than a label, because the boxes name themselves
            and a heading would only be a fourth thing to align.
          */}
          <div style={{ display: "flex", flexDirection: "column", gap: HEAD_GAP }}>
            <div aria-hidden style={{ visibility: "hidden" }}>
              <StepHead n="00">Spacer</StepHead>
            </div>

            {/* One gap, the same everywhere. Because COL_GAP is derived from
                the helper-text row opposite, this lands each box on its
                counterpart without a single hand-set offset. */}
            <div style={{ display: "flex", flexDirection: "column", gap: COL_GAP }}>
            <Expander label="Raw operator response" disabled={run.status !== "result"}>
              <CodeBlock text={run.status === "result" ? asText(run.outcome.raw) : ""} wrap />
            </Expander>

            {/* Level with the wallet shortcuts. Drops by one row when the
                invalid-address message pushes the left column down. */}
            <Expander label="Policy source" offset={showInvalid ? INVALID_SHIFT : 0}>
              <CodeBlock
                text={rego}
                header={(
                  [
                    ["PolicyClient", process.env.NEXT_PUBLIC_POLICY_CLIENT ?? ""],
                    ["Oracle", provider?.policyData ?? ""],
                  ] as [string, string][]
                ).map(([k, addr]) => (
                  <div
                    key={k}
                    style={{ display: "flex", justifyContent: "space-between", gap: HEAD_GAP, padding: "3px 0" }}
                  >
                    <span style={{ fontFamily: MONO, fontSize: 11, color: "#5C5C55" }}>{k}</span>
                    {/* Linked, because "deployed" is the strongest claim this
                        page makes and was previously unverifiable text. */}
                    {addr ? (
                      <a
                        href={`https://sepolia.etherscan.io/address/${addr}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ fontFamily: MONO, fontSize: 11, textDecoration: "underline", textUnderlineOffset: 3 }}
                      >
                        {shortAddr(addr)} ↗
                      </a>
                    ) : (
                      <span style={{ fontFamily: MONO, fontSize: 11 }}>—</span>
                    )}
                  </div>
                ))}
              />
            </Expander>

            {/*
              Every run against this PolicyClient, by anyone, read from
              Sepolia. A clean result and a sanctioned one sitting together is
              what shows the policy discriminates rather than blanket-denying.
            */}
            {/* Openable when there is an error too, or the failure would be
                sealed inside a box that refuses to open. */}
            <Expander label="Earlier runs" disabled={history.length === 0 && !historyError}>
              <div style={{ padding: "2px 0" }}>
                {historyError && (
                  <div style={{ fontSize: 12, color: "#8E2B1F", padding: "6px 0" }}>
                    Couldn&rsquo;t read the chain: {historyError}
                  </div>
                )}

                {history.map((h) => (
                  <div
                    key={h.taskId}
                    style={{ display: "flex", alignItems: "center", gap: TIGHT, padding: "7px 0" }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        flexShrink: 0,
                        // Hollow for pending: no fill, because no verdict.
                        background:
                          h.verdict === "allowed"
                            ? "#3F6F55"
                            : h.verdict === "denied"
                              ? "#C2621A"
                              : "transparent",
                        border: h.verdict === "pending" ? "1px solid #5C5C55" : "none",
                      }}
                    />
                    <span style={{ fontFamily: MONO, fontSize: 11.5, color: "#5C5C55" }}>
                      {shortAddr(h.address)}
                    </span>
                    <span
                      style={{
                        marginLeft: "auto",
                        fontFamily: SANS,
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.12em",
                        textTransform: "uppercase",
                        color:
                          h.verdict === "allowed"
                            ? "#2E5A44"
                            : h.verdict === "denied"
                              ? "#C2621A"
                              : "#5C5C55",
                      }}
                    >
                      {h.verdict === "allowed"
                        ? "Compliant"
                        : h.verdict === "denied"
                          ? "Non Compliant"
                          : "Awaiting response"}
                    </span>
                    <a
                      href={`https://explorer.newton.xyz/testnet/task/${h.taskId}`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="View attestation"
                      style={{ fontFamily: MONO, fontSize: 11, color: "#5C5C55" }}
                    >
                      ↗
                    </a>
                  </div>
                ))}
              </div>
            </Expander>
            </div>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Pieces ────────────────────────────────────────────────── */

function StepHead({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: HEAD_GAP }}>
      <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 19, lineHeight: 1 }}>{n}</div>
      <div style={{ fontFamily: SANS, fontSize: 12, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase" }}>
        {children}
      </div>
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: SANS, fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#5C5C55" }}>
      {children}
    </div>
  );
}

/**
 * Selection changes the fill only. Varying border or padding made the button
 * resize on click, which reads as a layout glitch rather than a choice.
 */
function Shortcut({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`dc-reset${active ? "" : " dc-hover"}`}
      style={{
        height: ROW_H,
        border: RULE,
        background: active ? "#000000" : "transparent",
        color: active ? "#FAF9F6" : "#000000",
        padding: "0 16px",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 14.5,
        transition: "background 0.18s ease, color 0.18s ease",
      }}
    >
      {label}
    </button>
  );
}

/**
 * Scrollable code with a copy button in the corner.
 *
 * Short on purpose — these are references, not reading material, and a tall
 * block pushed the second expander off screen. Copy matters more than height:
 * the raw response is the thing you paste into an issue.
 */
function CodeBlock({
  text,
  wrap,
  /**
   * Rendered inside the frame, above the code.
   *
   * The PolicyClient and Oracle rows used to sit loose between the
   * disclosure header and this box, belonging to neither. They are part of
   * the same answer as the Rego — this is the policy, these are the
   * addresses it is deployed at — so they live in the same box.
   */
  header,
}: {
  text: string;
  wrap?: boolean;
  header?: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard needs a secure context and permission; failing silently is
      // better than an error the user cannot act on.
    }
  }

  return (
    <div style={{ border: RULE, background: "#FFFFFF" }}>
      {header && <div style={{ padding: "10px 12px 0" }}>{header}</div>}

      {/* The copy button is positioned against the code, not the whole box,
          so a header can use the full width without colliding with it. */}
      <div style={{ position: "relative" }}>
        <button
          type="button"
          onClick={copy}
          disabled={!text}
          className="dc-reset"
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            width: "auto",
            zIndex: 1,
            background: "#000000",
            color: "#FAF9F6",
            fontFamily: SANS,
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            padding: "5px 9px",
            cursor: "pointer",
            opacity: text ? 1 : 0.3,
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>

        <pre
          style={{
            margin: 0,
            maxHeight: 132,
            overflow: "auto",
            padding: 12,
            paddingTop: 28,
            fontFamily: MONO,
            fontSize: 11,
            lineHeight: 1.55,
            whiteSpace: wrap ? "pre-wrap" : "pre",
          }}
        >
          {text}
        </pre>
      </div>
    </div>
  );
}

/**
 * A disclosure that opens smoothly.
 *
 * `<details>` snaps, and animating it needs a measured height. The grid
 * `0fr → 1fr` trick avoids the measurement entirely: the row collapses to
 * nothing and expands to exactly its content, with the browser interpolating
 * between, so the content can be any height without JavaScript knowing it.
 *
 * The header wears the wallet shortcut's clothes — same 2px frame, same fill
 * inversion, same padding and type size. It was a hairline rule with small
 * grey caps, which made three interactive controls look like column headings.
 */
function Expander({
  label,
  children,
  disabled,
  /**
   * Space above this box, in pixels. Set by the caller from the left
   * column's row heights so each disclosure lands on the row opposite it —
   * which is why the stack has no gap of its own.
   */
  offset = 0,
}: {
  label: string;
  children: React.ReactNode;
  disabled?: boolean;
  offset?: number;
}) {
  const [open, setOpen] = useState(false);
  // A disabled expander must not stay open from an earlier run.
  const shown = open && !disabled;

  return (
    <div style={{ marginTop: offset, opacity: disabled ? 0.4 : 1, pointerEvents: disabled ? "none" : "auto" }}>
      <button
        type="button"
        aria-expanded={shown}
        onClick={() => setOpen((v) => !v)}
        className={`dc-reset${shown ? "" : " dc-hover"}`}
        style={{
          height: ROW_H,
          border: RULE,
          background: shown ? "#000000" : "transparent",
          color: shown ? "#FAF9F6" : "#000000",
          padding: "0 16px",
          cursor: "pointer",
          fontSize: 14.5,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: TIGHT,
          transition: "background 0.18s ease, color 0.18s ease",
        }}
      >
        <span>{label}</span>
        <span aria-hidden style={{ fontFamily: MONO }}>
          {shown ? "−" : "+"}
        </span>
      </button>

      <div
        style={{
          display: "grid",
          gridTemplateRows: shown ? "1fr" : "0fr",
          transition: "grid-template-rows 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        <div style={{ overflow: "hidden" }}>
          <div style={{ paddingTop: shown ? 10 : 0, transition: "padding 0.3s" }}>{children}</div>
        </div>
      </div>
    </div>
  );
}

/* ── Reading the operator response ─────────────────────────── */

/**
 * The decision, from either RPC.
 *
 * The two methods answer in different shapes, and missing that is what made
 * the page disagree with the explorer:
 *
 *   newt_simulatePolicy → evaluation_result.result, a boolean.
 *   newt_createTask     → task_response.evaluation_result, a BYTES32 —
 *                         all-zero for false, ...0001 for true.
 *
 * Only the first was handled. Every submitted task therefore parsed as
 * "no verdict found", and the caller was rendering that as Compliant, so a
 * sanctioned address the operators had correctly denied appeared green here
 * while the explorer showed the real attestation.
 *
 * Returning undefined rather than false still matters — an unreadable
 * response is not a denial — but the caller must not treat undefined as
 * permission. See the call site.
 */
function extractAllow(result: any): boolean | undefined {
  // createTask, quorum-signed. Checked first: it is the authoritative one,
  // and it is what the explorer displays.
  const attested = result?.task_response?.evaluation_result ?? result?.evaluation_result;
  const decoded = decodeBytes32Bool(attested);
  if (decoded !== undefined) return decoded;

  const er = result?.evaluation_result;
  if (typeof er?.result === "boolean") return er.result;
  if (typeof er?.result?.allow === "boolean") return er.result.allow;
  if (typeof result?.result?.allow === "boolean") return result.result.allow;
  if (typeof result?.allow === "boolean") return result.allow;
  if (typeof result?.result === "boolean") return result.result;
  return undefined;
}

/**
 * A solidity bool as bytes32, in the encodings the gateway uses.
 *
 * Strict on purpose: anything that is not exactly zero or exactly one is
 * undefined, not "truthy". A loose test — "ends in 1" — would read 0x…21 as
 * allowed, and a wrong ALLOW is the one error this page must never make.
 */
function decodeBytes32Bool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;

  if (Array.isArray(v) && v.every((b) => typeof b === "number")) {
    if (v.every((b) => b === 0)) return false;
    if (v.slice(0, -1).every((b) => b === 0) && v[v.length - 1] === 1) return true;
    return undefined;
  }

  if (typeof v === "string" && /^0x[0-9a-fA-F]+$/.test(v)) {
    const hex = v.slice(2);
    if (/^0*$/.test(hex)) return false;
    if (/^0*1$/.test(hex)) return true;
    return undefined;
  }

  return undefined;
}

function extractReason(result: any): string | undefined {
  return result?.evaluation_result?.reason ?? result?.result?.reason ?? result?.reason ?? undefined;
}

/** Named deny reasons, rendered only when the operator actually returns them. */
function extractDenies(result: any): string[] {
  const candidates = [
    result?.evaluation_result?.deny,
    result?.evaluation_result?.result?.deny,
    result?.result?.deny,
    result?.deny,
  ];
  for (const c of candidates) {
    if (Array.isArray(c) && c.every((x) => typeof x === "string")) return c;
  }
  return [];
}

/**
 * Just the task id.
 *
 * Reference block, expiry block and quorum threshold were also here. They are
 * real, but four rows of them pushed the Policy source expander below the
 * fold, and anyone who wants those numbers can open the raw response — where
 * they were all along. The task id earns its place because it is the handle
 * for the explorer link beside it.
 */
function extractEvidence(result: any): [string, string][] {
  const taskId = result?.task_id ?? result?.taskId;
  if (typeof taskId !== "string" || !taskId) return [];
  return [["Task", `${taskId.slice(0, 10)}…${taskId.slice(-6)}`]];
}
