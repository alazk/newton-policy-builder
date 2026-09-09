"use client";

/**
 * Newton Sanctions Demo.
 *
 * The deployed policy already decides correctly — that is verified in both
 * directions by sanctions-oracle/verify-both.mjs. What this page has to do is
 * make the decision legible: what was checked, against what, and what happens
 * next.
 *
 * Structure is two floating cards on a grey field: masthead and stage. The
 * stage is one element that changes state rather than three that take turns —
 * at rest it holds the console, in flight the screening, at the end the
 * verdict fills it edge to edge.
 *
 * Three rules it obeys, each of them paid for:
 *
 *   1. Never render a verdict the response did not contain. An unreadable
 *      answer is "no decision", not "compliant". This page once showed green
 *      for every submitted task because undefined fell through to the happy
 *      branch, while the explorer showed the operators' actual denial.
 *
 *   2. Never show work that did not happen. One lookup runs against the
 *      OpenSanctions consolidated collection. The verdict may report per-list
 *      outcomes — they are true readings of that one result — but the
 *      screening step does not animate four lists being queried in turn,
 *      because they are not.
 *
 *   3. Never label the composed policy as the enforced one. In submit mode the
 *      operators evaluate the policyCid bound on-chain, which currently
 *      carries two deny rules this project's builder does not emit.
 */

import { useEffect, useRef, useState } from "react";
import { GOALS, PROVIDERS, SANCTIONED_TEST_ADDRESS } from "@/lib/catalog";
import { SANCTIONED_POOL } from "@/lib/sanctioned-pool";
import { C, H, R, SP, T, BORDER, INSET_X } from "@/lib/ds";

/* ── Tokens ─────────────────────────────────────────────── */

const INK = C.ink;
const FIELD = C.field;
const SURFACE = C.surface;
const HAIRLINE = C.hairline;
const CONTROL = C.control;
const BODY = C.body;
const MUTED = C.muted;
const MUTED_2 = C.muted2;
const ACCENT = C.accent;
const PASS = C.pass;
const FLAG = C.flag;
const ERROR = C.error;

const SANS = "var(--sans)";
const MONO = "var(--mono)";

const R_CARD = R.xl;
const R_INSET = R.sm;
const R_PILL = R.pill;

const GAP = SP.x1_5;
const PAGE_PAD = SP.x2;

/**
 * Spacing, straight off the 8px grid.
 *
 * S1 inside a control group, S2 between groups. These were 8 / 14 / 22 — two
 * of them off the grid, which is why the columns needed hand-set offsets to
 * line up at all. Call sites now use SP directly; these two remain because
 * they name a role rather than a size.
 */
const S1 = SP.x1;
const S2 = SP.x2;

/**
 * The sheet's label: 14 / 20 at weight 500, sentence case.
 *
 * This replaces the 9–11px uppercase micro-labels the demo used everywhere.
 * They came from a different reference and were the loudest thing on a page
 * whose job is to state one quiet fact. Uppercase tracking survives only in
 * the masthead lockup, which is a mark rather than a label.
 */
const label = (): React.CSSProperties => ({
  fontFamily: SANS,
  ...T.label,
});

/** Small print: helper text, secondary detail. */
const small = (): React.CSSProperties => ({ fontFamily: SANS, ...T.valueSm });

/* ── Addresses ──────────────────────────────────────────── */

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

const isAddress = (a: string) => /^0x[a-fA-F0-9]{40}$/.test(a);
const middle = (a: string) => (a.length > 24 ? `${a.slice(0, 16)}…${a.slice(-12)}` : a);

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

/* ── Types ──────────────────────────────────────────────── */

type Pick = "clean" | "ofac" | null;

/** Per-party attribution, from the same feed the oracle queried. */
type Party = { address: string; screened: boolean; sanctioned: boolean | null; datasets: string[] };

/**
 * Four outcomes, because there are four.
 *
 *   pass        — the recipient is not designated
 *   block       — the recipient is designated
 *   unavailable — the policy denied because it could not screen. The transfer
 *                 is blocked and nobody is accused; painting this orange next
 *                 to the word "Non Compliant" would tell someone their
 *                 counterparty is on a sanctions list when the truth is that
 *                 the list was too old to consult.
 *   none        — no verdict could be read at all
 */
type Verdict = "pass" | "block" | "unavailable" | "none";

type Outcome = {
  verdict: Verdict;
  headline: string;
  reason: string;
  denies: string[];
  datasets: string[];
  explorerUrl?: string | null;
  raw: unknown;
  /** Filled in after the verdict, from the same feed the oracle queried. */
  parties?: { to?: Party; from?: Party };
  /**
   * When the decision was read.
   *
   * A sanctions verdict without a time is incomplete: "was this address clean"
   * is not a question anyone can answer, only "was it clean *then*". Set at
   * the moment the response is parsed, so it is never rendered on the server
   * and never disagrees with the run it describes.
   */
  decidedAt: string;
};

type RunState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; outcome: Outcome; stale?: boolean };

/*
 * SharedRun and DeployedPolicy lived here, describing the shapes of
 * /api/history and /api/policy-source. Nothing on the client reads either
 * route now, so the types went with the boxes that used them. Both routes are
 * still deployed and still correct; the shapes are documented there.
 */

type ScreeningHealth = {
  ok: boolean;
  stale: boolean;
  ageHours: number | null;
  count: number | null;
};

const FILL: Record<Verdict, string> = {
  pass: "linear-gradient(160deg, #D8FFCA, #A8DCB4)",
  block: "linear-gradient(160deg, #FFE0BF, #EDB887)",
  // Grey, deliberately. Not knowing is not a finding, and the palette should
  // not lend it the weight of one.
  unavailable: "linear-gradient(160deg, #ECECEC, #C9C9C9)",
  none: "linear-gradient(160deg, #FFD6CD, #DFA79C)",
};

/**
 * The four regimes the consolidated collection covers.
 *
 * One lookup runs against all of them, so reporting each on the verdict is a
 * true reading of a single result — not four queries. The distinction matters
 * for the screening step, which must not animate them being checked in turn.
 */
const REGIMES = ["US", "EU", "UN", "UK"] as const;

/**
 * Jurisdictions, not programme names.
 *
 * These chips only appear on a denial, and only for datasets that actually
 * matched — so this is the one place the page reports *which* list someone is
 * on, which is a finding rather than a label. It reads "US" instead of "OFAC"
 * to keep the four consistent: the others are already jurisdictions, and
 * mixing a US agency in with three countries made OFAC look like the point
 * rather than one source among several. The dataset ids underneath are
 * OpenSanctions' and are untouched.
 */
const DATASET_REGIME: Record<string, (typeof REGIMES)[number]> = {
  us_ofac_sdn: "US",
  us_ofac_cons: "US",
  eu_fsf: "EU",
  un_sc_sanctions: "UN",
  gb_hmt_sanctions: "UK",
};

const GOAL_ID = Object.keys(GOALS)[0];

/** "21 Aug 2026, 14:32 UTC" — unambiguous month, explicit zone. */
const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }) + " UTC";

/* ── Page ───────────────────────────────────────────────── */

export default function Wizard() {
  const goal = GOALS[GOAL_ID];
  const providerId = goal.providers[0];
  const provider = PROVIDERS[providerId];

  /**
   * Applied by default.
   *
   * There is one policy, it is mandatory, and nothing happens until it is
   * selected — a chooser with a single compulsory option is not a choice, it
   * is a speed bump in front of the thing people came to see. It stays
   * toggleable, because turning it off and watching the action go unavailable
   * is the clearest statement that the policy is what authorises the
   * transfer.
   */
  const [applied, setApplied] = useState(true);

  /**
   * Nothing is prefilled. A demo that arrives with an address already in the
   * box invites you to press the button without reading either field, and the
   * first thing this page has to establish is what it is screening.
   */
  const [to, setTo] = useState("");

  /*
   * There is no sender state, and no sender field.
   *
   * A transaction still has a sender — verify() generates fresh random 20
   * bytes — but the deployed policy no longer screens it. The payer rules were
   * removed in the redeploy that fixed the confidence gate, precisely because
   * this page had stopped asking for a sender: `payer_sanctioned` could never
   * fire against a generated address, while `payer_not_screened` and
   * `payer_address_mismatch` could still fire spuriously and deny a clean
   * recipient for a reason having nothing to do with the recipient.
   *
   * See sanctions-oracle/yente-policy-files/policy.rego.
   */

  /**
   * Which shortcut last filled the field, so the buttons can show state.
   * Cleared when the address is typed by hand — the shortcut is no longer the
   * source of what is in the box.
   */
  const [toPick, setToPick] = useState<Pick>(null);
  const [focus, setFocus] = useState<"to" | null>(null);
  const [run, setRun] = useState<RunState>({ status: "idle" });

  /*
   * Run history and the deployed policy source used to be fetched here, for
   * the two boxes in the bottom-right corner. Both boxes are gone, so both
   * fetches are too — a page that pulls the chain on mount to render nothing
   * is just a slower page.
   */
  const [health, setHealth] = useState<ScreeningHealth | null>(null);
  /** Set when the throttle refuses a run; cleared on the next attempt. */
  const [throttled, setThrottled] = useState<string | null>(null);

  /**
   * Back to a blank console.
   *
   * "New check" used to reset only the run, leaving both wallets in the
   * boxes — so the next check started from someone else's addresses and the
   * page looked like it had already decided something.
   */
  function reset() {
    setRun({ status: "idle" });
    setTo("");
    setToPick(null);
    setThrottled(null);
    window.history.replaceState(null, "", window.location.pathname);
  }

  const stageRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const toValid = isAddress(to);
  const busy = run.status === "running";
  const ready = applied && toValid && !busy;

  /**
   * Nothing restores the fields. They are empty on load, always.
   *
   * The page briefly wrote each run into the address bar and read it back on
   * mount, which meant a reload arrived with wallets already in the boxes —
   * the demo appearing to have an opinion before anyone gave it one. Both
   * halves are gone; a stale `?to=&from=` left in someone's tab is ignored
   * rather than honoured.
   */

  useEffect(() => {
    // Unknown freshness counts as stale, never as healthy-until-proven. This
    // is the only thing the page needs before a run: a confident ALLOW on a
    // week-old list looks exactly like a correct one.
    fetch("/api/screening-health")
      .then((r) => r.json())
      .then((j) => setHealth(j.ok ? j : { ok: false, stale: true, ageHours: null, count: null }))
      .catch(() => setHealth({ ok: false, stale: true, ageHours: null, count: null }));
  }, []);

  /** A verdict must never quietly outlive the inputs that produced it. */
  function invalidate() {
    setRun((r) => (r.status === "done" ? { ...r, stale: true } : { status: "idle" }));
  }

  function noDecision(reason: string, raw: unknown, explorerUrl?: string | null) {
    setRun({
      status: "done",
      outcome: {
        verdict: "none",
        headline: "No decision",
        reason,
        denies: [],
        datasets: [],
        explorerUrl: explorerUrl ?? null,
        raw,
        decidedAt: new Date().toISOString(),
      },
    });
  }

  async function verify() {
    /**
     * A fresh sender every run.
     *
     * Not for the policy — that no longer screens the payer. For the intent:
     * every transaction has a `from`, and the oracle refuses a request without
     * one. Random 20 bytes keeps the recipient the only thing under test.
     */
    const sendTo = to;
    const sendFrom = randomOrdinary();

    const ac = new AbortController();
    abortRef.current = ac;
    setThrottled(null);
    setRun({ status: "running" });

    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({
          mode: "submit",
          to: sendTo,
          from: sendFrom,
          policyDataAddress: provider.policyData,
          providerId,
        }),
      });
      const json = await res.json();

      if (!res.ok || json.ok === false) {
        /**
         * A throttled request never reached the operators, so it is not a
         * verdict of any kind — not even "no decision". Reported as the wait
         * it is, with the inputs left intact so the button works again in a
         * moment.
         */
        if (res.status === 429) {
          setRun({ status: "idle" });
          setThrottled(asText(json.error));
          return;
        }
        noDecision(asText(json.error) || "The request failed before a decision was reached.", json.raw);
        return;
      }

      const taskError = json.result?.error ?? json.result?.operator_errors?.[0]?.message;
      if (taskError) {
        noDecision(asText(taskError), json.result, json.explorerUrl);
        return;
      }

      const allow = extractAllow(json.result);

      /**
       * Fail closed on an unreadable response — the bug this page shipped
       * once. `allow === false ? block : pass` turned "no verdict found" into
       * a green pass, and every submitted task read Compliant while the
       * explorer showed the real answer.
       */
      if (allow === undefined) {
        noDecision(
          "The operators answered, but no verdict could be read from the response. " +
            "The transfer stays blocked. Open the attestation — that is the authoritative record.",
          json.result,
          json.explorerUrl,
        );
        return;
      }

      setRun({
        status: "done",
        outcome: {
          verdict: allow ? "pass" : "block",
          headline: allow ? "Compliant" : "Non Compliant",
          reason: allow
            ? "The recipient is not designated. The transfer may proceed."
            : "The transfer is blocked.",
          denies: extractDenies(json.result),
          datasets: extractDatasets(json.result),
          explorerUrl: json.explorerUrl ?? null,
          raw: json.result,
          decidedAt: new Date().toISOString(),
        },
      });

      /**
       * Attribution, after the fact.
       *
       * The attestation is one bit — it does not say which party tripped or
       * which list named them, and "a party to this transfer is designated"
       * is a useless sentence to read on a compliance screen. So we ask the
       * same feed the oracle asked, per address, and label it as the
       * explanation it is rather than as the signed claim.
       */
      try {
        const s = await fetch("/api/screen", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ addresses: [sendTo, sendFrom] }),
        });
        const sj = await s.json();

        if (sj.ok) {
          setRun((r) =>
            r.status === "done"
              ? { ...r, outcome: { ...r.outcome, parties: { to: sj.parties[0], from: sj.parties[1] } } }
              : r,
          );
        } else if (sj.stale && !allow) {
          /**
           * The denial was the policy failing closed, not a designation.
           *
           * The screening service refused this lookup for the same reason it
           * refused the operators' — the list is too old to consult — so
           * `screening_unavailable` fired. Reporting that as "Non Compliant"
           * would tell someone their counterparty is sanctioned when nobody
           * has been accused of anything.
           */
          setRun((r) =>
            r.status === "done"
              ? {
                  ...r,
                  outcome: {
                    ...r.outcome,
                    verdict: "unavailable",
                    headline: "Screening unavailable",
                    reason:
                      sj.ageHours != null
                        ? `The sanctions list is ${Math.round(sj.ageHours)} hours old, so the policy refused to screen against it. The transfer is blocked. Nobody has been found on a list.`
                        : "The policy could not screen against a current sanctions list, so it refused. The transfer is blocked. Nobody has been found on a list.",
                  },
                }
              : r,
          );
        }
      } catch {
        // The verdict stands on its own; attribution is a nicety.
      }
    } catch (e) {
      // A cancelled run is not a failed one, and must not render as a verdict.
      if (e instanceof DOMException && e.name === "AbortError") {
        setRun({ status: "idle" });
        return;
      }
      noDecision(asText(e), null);
    } finally {
      abortRef.current = null;
    }
  }

  useEffect(() => {
    if (run.status === "done") stageRef.current?.focus();
  }, [run.status]);

  const done = run.status === "done" ? run.outcome : null;

  return (
    <div
      className="pe-shell"
      style={{ background: FIELD, padding: PAGE_PAD, gap: GAP }}
    >
      <Masthead health={health} onHome={reset} />

      {/*
        Said out loud, not hidden in a title attribute — invisible on touch,
        invisible to a keyboard, and this is the one failure the system cannot
        fail closed on. A stale feed still returns a confident ALLOW.
      */}
      {health?.stale && (
        <div
          role="alert"
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: SP.x1,
            padding: `${SP.x1_5}px ${SP.x2}px`,
            borderRadius: R_CARD,
            border: `${BORDER}px solid ${FLAG}`,
            background: "#FFF3E6",
            color: "#7A3D0E",
            ...T.valueSm,
          }}
        >
          <span style={{ ...label(), color: FLAG }}>
            {health.ageHours === null ? "Data age unknown" : `Data ${Math.round(health.ageHours)}h old`}
          </span>
          <span>
            Screening may not reflect recent designations. A verdict returned now can be confidently
            wrong.
          </span>
        </div>
      )}

      {/* The stage. One element; the state changes what fills it. */}
      {/*
        The live region is scoped to the run, not the whole stage. Wrapping
        the console in role="status" meant every keystroke in an address field
        was announced as a status update.
      */}
      <div
        ref={stageRef}
        className="pe-stage"
        tabIndex={-1}
        role={run.status === "idle" ? undefined : "status"}
        aria-live={run.status === "idle" ? undefined : "polite"}
        aria-atomic={run.status === "idle" ? undefined : true}
        style={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          borderRadius: R_CARD,
          border: `${BORDER}px solid ${HAIRLINE}`,
          background: SURFACE,
          overflow: "hidden",
          outline: "none",
          opacity: run.status === "done" && run.stale ? 0.45 : 1,
          transition: "opacity 0.2s ease",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {run.status === "idle" && (
          <Console
            applied={applied}
            onApply={() => {
              setApplied((v) => !v);
              invalidate();
            }}
            to={to}
            focus={focus}
            setFocus={setFocus}
            onTo={(v) => {
              setTo(v);
              setToPick(null);
              invalidate();
            }}
            toPick={toPick}
            onPickTo={(kind) => {
              setTo(kind === "clean" ? randomOrdinary() : randomSanctioned(to));
              setToPick(kind);
              invalidate();
            }}
            ready={ready}
            onVerify={verify}
            toValid={toValid}
            throttled={throttled}
          />
        )}

        {run.status === "running" && (
          <Screening to={to} onCancel={() => abortRef.current?.abort()} />
        )}

        {done && (
          <Decision
            outcome={done}
            to={to}
            stale={run.status === "done" && Boolean(run.stale)}
            onReset={reset}
          />
        )}
      </div>
    </div>
  );
}

/* ── Masthead ───────────────────────────────────────────── */

function Masthead({ health, onHome }: { health: ScreeningHealth | null; onHome: () => void }) {
  const stale = health?.stale ?? false;

  return (
    <div
      className="pe-mast"
      style={{
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: SP.x3,
        // Shorter vertically — two elements did not need 16px of air on a
        // fixed-height console, and every pixel here is one the stage loses.
        // Horizontally it takes the shared inset, so the mark sits on the
        // same line as the headings below it and the badge on the same line
        // as Cancel and the verdict actions.
        padding: `${SP.x1_5}px ${INSET_X}`,
        background: SURFACE,
        border: `${BORDER}px solid ${HAIRLINE}`,
        borderRadius: R_CARD,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {/* The mark goes home, the way a masthead does everywhere else. */}
        <button
          type="button"
          onClick={onHome}
          className="pe-reset"
          aria-label="Start a new check"
          title="Start a new check"
          style={{ display: "block", lineHeight: 0 }}
        >
          <img src="/newton-logo.svg" alt="Newton" style={{ height: 18, display: "block" }} />
        </button>
        {/* The one place uppercase tracking survives: this is a lockup, not a
            field label, and the sheet has no opinion on marks.

            "Sanctions", not "OFAC". The policy screens a consolidated feed —
            US, EU, UN, UK and more — so naming one regime in the masthead
            undersold it and made the demo look US-only. */}
        <span
          style={{
            background: INK,
            color: SURFACE,
            fontFamily: SANS,
            ...T.monoSm,
            fontWeight: 600,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            borderRadius: R_PILL,
            padding: `${SP.x1}px ${SP.x2}px`,
          }}
        >
          Sanctions
        </span>
      </div>

      {/*
        Reports the freshness of the list, not just the network. A stale ALLOW
        is indistinguishable from a fresh one at the moment of the verdict;
        this is the only place the difference can surface.
      */}
      <div
        title={
          health === null
            ? "Checking how current the sanctions data is…"
            : health.ageHours === null
              ? "Could not determine how old the sanctions data is."
              : `Sanctions data is ${health.ageHours}h old.`
        }
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          // Height, not vertical padding. Padded, it came out at 38 — 2px
          // shorter than Cancel directly beneath it, and off the 8px grid.
          height: H.chip,
          border: `${BORDER}px solid ${stale ? FLAG : HAIRLINE}`,
          borderRadius: R_PILL,
          padding: `0 ${SP.x2}px`,
          background: FIELD,
        }}
      >
        <span
          className={health === null || stale ? undefined : "pe-pulse"}
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: health === null ? MUTED_2 : stale ? FLAG : PASS,
            display: "block",
          }}
        />
        <span style={{ ...label(), color: INK }}>Sepolia</span>
        {stale && (
          <span style={{ ...label(), color: FLAG }}>
            · {health?.ageHours === null ? "Age unknown" : `${Math.round(health!.ageHours!)}h old`}
          </span>
        )}
      </div>
    </div>
  );
}

/* ── Console ────────────────────────────────────────────── */

function Console(props: {
  applied: boolean;
  onApply: () => void;
  to: string;
  focus: "to" | null;
  setFocus: (v: "to" | null) => void;
  onTo: (v: string) => void;
  toPick: Pick;
  onPickTo: (k: "clean" | "ofac") => void;
  ready: boolean;
  onVerify: () => void;
  toValid: boolean;
  throttled: string | null;
}) {
  const { applied, onApply, to, focus, setFocus, onTo, toPick, onPickTo, ready, onVerify, toValid, throttled } = props;

  const hint = throttled
    ? throttled
    : !applied
      ? "No policy applied"
      : to && !toValid
        ? "Not a valid address"
        : !toValid
          ? "Enter a recipient"
          : "";

  return (
    <div
      className="pe-rise"
      style={{
        flex: 1,
        minHeight: 0,
        overflow: "auto",
        display: "flex",
        alignItems: "center",
        padding: `${SP.x5}px ${INSET_X}`,
      }}
    >
      {/*
        Capped but not centred.

        `margin: 0 auto` put the grid in the middle of the panel, so on a wide
        screen "Active policy" started 80-odd pixels right of the Newton mark
        directly above it. The cap stays — a 1300px address field is not a
        better address field — but the column now begins on the same line as
        everything else.
      */}
      <div className="pe-console" style={{ width: "100%", maxWidth: 1180 }}>
        {/* 01 */}
        <div style={{ display: "flex", flexDirection: "column", gap: S2 }}>
          {/* "Active policy", because it already is. A single compulsory
              option presented as a choice is a speed bump, not a decision. */}
          <Head>Active policy</Head>

          <button
            type="button"
            aria-pressed={applied}
            onClick={onApply}
            className="pe-reset"
            style={{
              background: FIELD,
              border: `${BORDER}px solid ${applied ? INK : "transparent"}`,
              borderRadius: R_INSET,
              padding: 26,
              /*
               * Fills its column rather than setting the row's height.
               *
               * The transfer column opposite is 284 by arithmetic: heading 20
               * + 16 + field 160 + 16 + action 72. This card is the only thing
               * under this column's heading now that the copy box is gone, so
               * `flex: 1` stretches it to whatever that leaves — 248 — and the
               * two bottom edges stay level without either side dictating the
               * height. The floor only matters if the opposite column ever
               * gets shorter than it.
               */
              flex: 1,
              minHeight: SP.x10 * 2, // 160
              display: "flex",
              flexDirection: "column",
              width: "100%",
              transition: "border-color 0.18s ease",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, width: "100%" }}>
              <span style={{ fontFamily: SANS, ...T.h3 }}>
                Sanctions Screening
              </span>
              <span
                aria-hidden
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  border: `${BORDER}px solid ${applied ? INK : CONTROL}`,
                  background: applied ? INK : SURFACE,
                  color: "#fff",
                  ...T.valueSm,
                  lineHeight: "20px",
                  textAlign: "center",
                  flexShrink: 0,
                  transition: "background 0.18s ease, border-color 0.18s ease",
                }}
              >
                {applied ? "✓" : ""}
              </span>
            </div>

            {/* Says "list", not "feed", while the denylist policy is bound.
                The screening is a fixed on-chain set of addresses right now,
                not a live consolidated lookup, and a card claiming otherwise
                would be the one kind of wrong this whole project is about. */}
            <div style={{ ...T.value, fontFamily: SANS, color: BODY, marginTop: SP.x2, maxWidth: "46ch" }}>
              Blocks the transfer if the recipient is on the sanctions list. Enforced by an operator
              quorum before it executes.
            </div>

            <div style={{ marginTop: "auto", paddingTop: SP.x3, ...label(), color: applied ? INK : FLAG }}>
              {applied ? "Applied · tap to remove" : "Removed · nothing will be enforced"}
            </div>
          </button>

        </div>

        {/* 02 */}
        <div style={{ display: "flex", flexDirection: "column", gap: S2 }}>
          {/*
            The hint keeps its line whether or not it has anything to say.
            Removing the element when the form became valid moved every row
            below it — the panel resized at the exact moment you were about to
            aim at the button.
          */}
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 20 }}>
            <Head>Transfer</Head>
            <span style={{ ...small(), color: MUTED, minHeight: 20 }}>{hint}</span>
          </div>

          {/*
            One field, because there is one question: is this address on a
            list. The deployed policy screens the recipient and nothing else —
            the payer rules were removed once this page stopped asking for a
            sender, rather than left in to be satisfied by an address the
            visitor never chose.
          */}
          <Field
            name="Recipient"
            raw={to}
            focused={focus === "to"}
            onFocus={() => setFocus("to")}
            onBlur={() => setFocus(null)}
            onChange={onTo}
            onEnter={() => ready && onVerify()}
            invalid={Boolean(to) && !toValid}
          >
            <Pickers picked={toPick} onPick={onPickTo} party="recipient" empty={!to} />
          </Field>

          {/*
            Last element, so its bottom edge is the column's bottom edge —
            level with the policy card opposite, which stretches to the same
            height.
          */}
          <button
            type="button"
            onClick={onVerify}
            disabled={!ready}
            className={`pe-reset ${ready ? "pe-dark" : ""}`}
            style={{
              marginTop: "auto",
              height: H.action,
              width: "100%",
              borderRadius: R_PILL,
              ...T.label,
              fontFamily: SANS,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              // Outlined rather than a grey slab. A filled grey block at this
              // size reads as a region, not as a control that is not ready.
              background: ready ? undefined : "transparent",
              border: `${BORDER}px solid ${ready ? "transparent" : CONTROL}`,
              color: ready ? undefined : MUTED_2,
              cursor: ready ? "pointer" : "not-allowed",
            }}
          >
            Check this transfer
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * No numerals.
 *
 * "01" and "02" were left from a wizard that no longer exists: there are two
 * panels side by side, not a sequence, and the first is applied by default.
 * Numbering them implied an order nothing enforces.
 */
function Head({ children }: { children: React.ReactNode }) {
  return <div style={{ ...label(), color: INK }}>{children}</div>;
}

function Field(props: {
  name: string;
  raw: string;
  focused: boolean;
  onFocus: () => void;
  onBlur: () => void;
  onChange: (v: string) => void;
  onEnter: () => void;
  invalid: boolean;
  hint?: string;
  children?: React.ReactNode;
}) {
  const { name, raw, focused, onFocus, onBlur, onChange, onEnter, invalid, hint, children } = props;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: S1 }}>
      {/*
        A visible label, not just aria-label. Two identical grey boxes with
        placeholders that vanish on the first keystroke are indistinguishable
        the moment they are filled — which is exactly when knowing which is
        which matters.
      */}
      <span style={{ ...label(), color: MUTED }}>{name}</span>

      <input
        // Truncated at rest so a 42-character hash does not dominate the
        // panel; whole on focus, because a partial address is not editable.
        value={focused ? raw : raw ? middle(raw) : ""}
        onChange={(e) => onChange(e.target.value.trim())}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={(e) => {
          if (e.key === "Enter") onEnter();
        }}
        spellCheck={false}
        placeholder="0x…"
        aria-label={name}
        aria-invalid={invalid}
        className="pe-input"
        style={{
          // Inputs sheet: white fill, 1px border, 8px radius. The demo drew
          // these as borderless grey insets, which gave a field and a
          // read-only panel the same treatment.
          width: "100%",
          height: H.field,
          borderRadius: R.sm,
          border: `${BORDER}px solid ${invalid ? ERROR : CONTROL}`,
          background: SURFACE,
          padding: `0 ${SP.x2}px`,
          fontFamily: MONO,
          fontSize: T.value.fontSize,
          color: INK,
        }}
      />
      {invalid ? (
        <span style={{ ...small(), color: ERROR }}>Not a valid 20-byte address.</span>
      ) : hint ? (
        <span style={{ ...small(), color: MUTED_2 }}>{hint}</span>
      ) : null}

      {children}
    </div>
  );
}

function Pickers({
  picked,
  onPick,
  party,
  empty,
}: {
  picked: Pick;
  onPick: (k: "clean" | "ofac") => void;
  party: string;
  /** Nothing typed yet, so these are the way in rather than a shortcut. */
  empty: boolean;
}) {
  /**
   * A radio group, per the Radio sheet.
   *
   * These were pill buttons, which read as actions — press to do something.
   * They are not: they are two mutually exclusive states of one field, which
   * is exactly what a radio is for. The sheet's pattern also gives the pair a
   * visible group label, so "which field does this fill" stops being a
   * question.
   *
   * Arrow keys move between them and only the selected one is tabbable — the
   * roving tabindex a radiogroup is expected to have.
   */
  const opts: { value: "clean" | "ofac"; text: string; hint: string }[] = [
    {
      value: "clean",
      text: "Clean address",
      hint: `A randomly generated address, which is on no list`,
    },
    {
      value: "ofac",
      text: "Sanctioned address",
      hint: `A real sanctioned wallet, present in the deployed list`,
    },
  ];

  function onKeyDown(e: React.KeyboardEvent) {
    const i = opts.findIndex((o) => o.value === picked);
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      onPick(opts[(Math.max(i, 0) + 1) % opts.length].value);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      onPick(opts[(Math.max(i, 0) - 1 + opts.length) % opts.length].value);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: S1 }}>
      <span style={{ ...small(), color: empty ? C.body : MUTED_2 }}>Fill the {party} with</span>
      <div
        role="radiogroup"
        aria-label={`Fill the ${party} with`}
        onKeyDown={onKeyDown}
        className="pe-radios"
        style={{ display: "flex", gap: SP.x3, flexWrap: "wrap" }}
      >
        {opts.map((o) => (
          <Radio
            key={o.value}
            checked={picked === o.value}
            onSelect={() => onPick(o.value)}
            title={o.hint}
          >
            {o.text}
          </Radio>
        ))}
      </div>
    </div>
  );
}

/**
 * Radio sheet: 24px hit target, 1px grey ring, indigo ring and fill when
 * selected, label to the right at the sheet's 14/20.
 */
function Radio({
  checked,
  onSelect,
  title,
  children,
}: {
  checked: boolean;
  onSelect: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      tabIndex={checked ? 0 : -1}
      onClick={onSelect}
      title={title}
      className="pe-reset"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: SP.x1_5,
        minHeight: H.radio,
        ...T.valueSm,
        fontFamily: SANS,
        color: INK,
      }}
    >
      <span
        aria-hidden
        style={{
          width: H.radio,
          height: H.radio,
          borderRadius: "50%",
          border: `${checked ? 2 : BORDER}px solid ${checked ? ACCENT : CONTROL}`,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          transition: "border-color 0.14s ease",
        }}
      >
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: checked ? ACCENT : "transparent",
            transition: "background 0.14s ease",
          }}
        />
      </span>
      {children}
    </button>
  );
}

/* ── Screening ──────────────────────────────────────────── */

/**
 * Three steps, because there are three: the gateway takes the task, the oracle
 * performs ONE lookup against the consolidated collection, and a quorum signs.
 *
 * An earlier design ticked OFAC, EU, UN and UK off in sequence. That is four
 * animations for one query. The verdict can still report all four, because one
 * result covers all four — but showing them being *checked* one at a time
 * would be claiming work the backend never did.
 *
 * The bar is indeterminate on purpose: there is no percentage to read from a
 * quorum, and a moving number would be invented.
 */
function Screening({ to, onCancel }: { to: string; onCancel: () => void }) {
  /*
   * Indicative phase progress. Step 1 is true immediately — we did submit the
   * task. 2 and 3 advance on a short timer so the ordered phases are visible
   * even though a denylist check returns in ~2s. The verdict replaces this
   * panel the instant the real result lands, whatever phase we are on.
   */
  const [phase, setPhase] = useState(1);
  useEffect(() => {
    const t2 = setTimeout(() => setPhase(2), 650);
    const t3 = setTimeout(() => setPhase(3), 1500);
    return () => {
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, []);

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        padding: `${SP.x6}px ${INSET_X}`,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          className="pe-spin"
          style={{
            width: 16,
            height: 16,
            borderRadius: "50%",
            border: `2px solid ${CONTROL}`,
            borderTopColor: INK,
            display: "block",
          }}
        />
        <span style={{ ...label(), color: INK }}>Verifying onchain</span>

        {/* Eight seconds is long enough to notice a wrong address.

            Same height and same right edge as the network badge one card
            above it — they are the two things pinned to the top-right of the
            page, one after the other, so any difference between them reads as
            a mistake. */}
        <button
          type="button"
          onClick={onCancel}
          className="pe-reset"
          style={{
            marginLeft: "auto",
            height: H.chip,
            padding: `0 ${SP.x2}px`,
            borderRadius: R_PILL,
            border: `${BORDER}px solid ${CONTROL}`,
            ...small(),
            color: MUTED,
          }}
        >
          Cancel
        </button>
      </div>

      <div
        style={{
          fontFamily: SANS,
          fontWeight: T.h2.fontWeight,
          letterSpacing: T.h2.letterSpacing,
          fontSize: "clamp(32px, 4.5vw, 48px)",
          lineHeight: 1,
          marginTop: SP.x3,
        }}
      >
        Screening the recipient
      </div>

      <div className="pe-sweep" style={{ marginTop: SP.x3, borderRadius: R_INSET, maxWidth: 620 }}>
        <div
          style={{
            background: FIELD,
            padding: `${SP.x2}px ${SP.x2}px`,
            display: "grid",
            gridTemplateColumns: "max-content minmax(0, 1fr)",
            columnGap: 18,
            rowGap: 8,
            alignItems: "baseline",
          }}
        >
          <span style={{ ...small(), color: MUTED }}>Recipient</span>
          <span style={{ fontFamily: MONO, ...T.mono, color: BODY }}>{middle(to)}</span>
        </div>
      </div>

      <div style={{ marginTop: SP.x4, display: "flex", flexDirection: "column", gap: SP.x1_5 }}>
        {/*
          The three phases are real and strictly ordered — submit, screen,
          quorum — but the gateway reports only once, at the end, so we cannot
          confirm each individually. They advance on an estimated cadence
          (see `phase` below) as an indication of progress, not a per-phase
          receipt; whatever phase we are showing when the real verdict lands,
          the panel is replaced by it. Honest because the order is true and the
          only claim made is "in progress", never "confirmed".
        */}
        <Step n={1} done={phase >= 1}>
          Task submitted to the Newton gateway
        </Step>
        <Step n={2} done={phase >= 2}>
          Screened against the sanctions list bound to the policy on chain
        </Step>
        <Step n={3} done={phase >= 3}>
          Operator quorum evaluates the policy and signs the result
        </Step>
      </div>

      <div
        style={{
          marginTop: "auto",
          height: 4,
          borderRadius: R_PILL,
          background: "rgba(27,27,27,0.1)",
          overflow: "hidden",
        }}
      >
        <div className="pe-sweep" style={{ height: "100%", width: "100%" }} />
      </div>
    </div>
  );
}

function Step({ n, children, done }: { n: number; children: React.ReactNode; done?: boolean }) {
  return (
    <div style={{ display: "flex", gap: SP.x2, alignItems: "baseline" }}>
      <span style={{ fontFamily: MONO, ...T.monoSm, color: done ? INK : MUTED_2, width: 16 }}>
        {done ? "✓" : `0${n}`}
      </span>
      <span style={{ ...T.value, fontFamily: SANS, color: done ? INK : BODY }}>{children}</span>
    </div>
  );
}

/* ── Shared: Tag (label) and Cta (button) ─────────────────────
 *
 * The two were conflated: status labels like "Clear" and "Listed on" were
 * drawn as bordered pills, identical to pressable things like "Copy". A label
 * states a fact about the outcome; a Cta is something you do. They should not
 * look the same. Tag is a soft-filled, borderless, non-interactive badge; Cta
 * is the single pill-button treatment everything pressable goes through.
 */

function Tag({
  tone = "muted",
  children,
}: {
  tone?: "strong" | "muted";
  children: React.ReactNode;
}) {
  const tones = {
    // "Designated" / "Listed on X" — the finding, so it carries weight.
    strong: { background: "rgba(27,27,27,0.10)", color: INK },
    // "Clear" / "No match on X" — reassurance, so it recedes.
    muted: { background: "rgba(27,27,27,0.05)", color: MUTED },
  } as const;
  return (
    <span
      style={{
        ...small(),
        borderRadius: R_PILL,
        padding: `${SP.half}px ${SP.x1_5}px`,
        whiteSpace: "nowrap",
        ...tones[tone],
      }}
    >
      {children}
    </span>
  );
}

function Cta({
  variant = "outline",
  size = "md",
  href,
  onClick,
  title,
  style,
  children,
}: {
  variant?: "fill" | "outline";
  size?: "sm" | "md";
  href?: string;
  onClick?: () => void;
  title?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const fill = variant === "fill";
  const base: React.CSSProperties = {
    height: size === "sm" ? H.chip : H.control,
    padding: size === "sm" ? `0 ${SP.x2}px` : `0 ${SP.x3}px`,
    borderRadius: R_PILL,
    border: `${BORDER}px solid ${INK}`,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: SP.x1,
    cursor: "pointer",
    ...label(),
    // fill's colours come from .pe-dark, so its :hover works (inline styles
    // would out-specify the hover rule); outline sets its own flat colours.
    ...(fill ? {} : { background: "transparent", color: INK }),
    ...style,
  };
  // pe-dark → primary fill + hover. pe-action-btn (the mobile full-width
  // stack rule) only belongs on the md action-rule buttons; a sm inline chip
  // like Copy must not stretch to 100% on a phone.
  const cls = `pe-reset${size === "sm" ? "" : " pe-action-btn"}${fill ? " pe-dark" : ""}`;
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={cls} style={base}>
      {children}
    </a>
  ) : (
    <button type="button" onClick={onClick} title={title} className={cls} style={base}>
      {children}
    </button>
  );
}

/* ── Decision ───────────────────────────────────────────── */

function Decision({
  outcome,
  to,
  stale,
  onReset,
}: {
  outcome: Outcome;
  to: string;
  stale: boolean;
  onReset: () => void;
}) {
  /**
   * The fill is its own layer so it can be clipped in independently of the
   * text above it — and keyed by verdict so a second run re-runs the wash
   * rather than swapping colour instantly under a static headline.
   */
  const p = outcome.parties;

  /**
   * Recipient only, which is now the whole policy.
   *
   * /api/screen still attributes both sides, because it queries the same feed
   * per address and the sender is in the intent. But the deployed policy no
   * longer consults the payer, so a sender dataset here could not have
   * contributed to the verdict — listing it under "Listed on" would attribute
   * a denial to a match that did not cause it.
   */
  const flagged: string[] = [];
  if (p?.to?.sanctioned) flagged.push("recipient");

  const allDatasets = [...(p?.to?.datasets ?? []), ...outcome.datasets];
  const regimes = [...new Set(allDatasets.map((d) => DATASET_REGIME[d]).filter(Boolean))];

  /**
   * Only claimed once attribution has come back. Before that the verdict is
   * the verdict — a sentence naming a party we have not identified would be a
   * guess dressed as a finding.
   */
  const who = outcome.verdict !== "block" || flagged.length === 0 ? null : "The recipient is designated.";

  return (
    <>
      {/*
        The colour, as its own layer. Keyed by verdict so a second run replays
        the wash instead of swapping the fill instantly beneath a headline
        that is already sitting there.
      */}
      <div
        key={outcome.verdict}
        aria-hidden
        className="pe-wash"
        style={{ position: "absolute", inset: 0, backgroundImage: FILL[outcome.verdict] }}
      />

      {/*
        The verdict does not scroll.
        A decision you have to scroll to finish reading is not a decision you
        can take in at a glance, and this panel has exactly one job. Padding
        drops on shorter viewports (clamp on vh) so the content fits rather
        than overflowing — the sizes give way, not the reader.
      */}
      <div
        style={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          // Vertical still gives way on a short window; horizontal is the
          // shared inset, so the actions on the rule land on the same right
          // edge as the network badge in the masthead.
          padding: `clamp(20px, 4vh, 56px) ${INSET_X}`,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        {/*
          Nothing above the headline any more.

          New check used to sit up here in its own row with the stale notice,
          which cost 44px of a panel that cannot scroll and put a button in
          the first thing the eye lands on — above the verdict it is meant to
          follow. It has moved down to the rule, next to the explorer link,
          where the two things you can do now live together.
        */}
        <div
          className="pe-reveal"
          style={{
            fontFamily: SANS,
            fontWeight: T.h1.fontWeight,
            // Sized against height as well as width: the panel no longer
            // scrolls, so on a short window the headline has to yield.
            fontSize: "clamp(36px, min(7vw, 9vh), 76px)",
            lineHeight: 1,
            letterSpacing: T.h1.letterSpacing,
          }}
        >
          {outcome.headline}
        </div>

        {/* Reason, lists, parties — arriving in the order you would say them. */}
        <div className="pe-seq" style={{ display: "contents" }}>
        <div style={{ ...T.valueLg, fontFamily: SANS, color: INK, marginTop: SP.x2, maxWidth: "46ch" }}>
          {who ? `${who} ${outcome.reason}` : outcome.reason}
        </div>

      {/*
        The two sources disagreeing is itself the finding.

        The verdict is signed by a quorum; the attribution below it is an
        unsigned lookup done here, afterwards. If the operators denied and a
        fresh lookup finds the recipient unlisted, something moved between the
        two — a delisting, a feed update, a divergent oracle — and the page
        must say so rather than print "Non Compliant" above a recipient marked
        Clear and let the reader reconcile it.
      */}
      {/*
        Framed as the system working, because it is. A refusal to answer on
        stale data is the fail-closed path doing its job; read cold, "blocked"
        looks like a fault.
      */}
      {outcome.verdict === "unavailable" && (
        <div style={{ ...small(), marginTop: SP.x2, maxWidth: "54ch", opacity: 0.8 }}>
          This is the policy behaving correctly. A screening service that cannot answer is treated
          the same as one that is down — the transfer is refused rather than allowed on stale
          information.
        </div>
      )}

      {outcome.verdict === "block" && p?.to && flagged.length === 0 && (
        <div style={{ ...small(), marginTop: SP.x2, maxWidth: "52ch", opacity: 0.75 }}>
          The operators denied this transfer, but a lookup against the same list just now finds this
          recipient undesignated. The signed verdict stands — the difference is worth investigating
          in the operator response.
        </div>
      )}

      {/*
        Only the regimes that actually matched.

        This previously rendered all four with a per-list outcome, which on a
        denial printed "OFAC no match · EU no match · UN no match · UK no
        match" directly beneath the word "Non Compliant" — four statements
        contradicting the headline above them, because the attestation carries
        no dataset information and the code filled the gap with defaults.
      */}
      {outcome.verdict === "block" && regimes.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: SP.x1, marginTop: SP.x3, alignItems: "center" }}>
          <span style={{ ...small(), color: "rgba(27,27,27,0.6)" }}>Listed on</span>
          {regimes.map((r) => (
            <Tag key={r} tone="strong">{r}</Tag>
          ))}
        </div>
      )}

      {/*
        The "No match on US · EU · UN · UK" chips were here.

        They were true while the oracle queried a consolidated feed. With the
        denylist policy bound, one list is checked and naming four regimes
        would be a claim the verdict cannot support — the same defect as the
        per-list theatre these chips replaced, just pointing the other way.
        The reason line above already says the recipient is not designated,
        which is exactly as much as is known.

        Restore these with the yente policy.
      */}

      {/* Rule names, when the policy returns them — the actual reason. */}
      {outcome.denies.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: SP.x1, marginTop: SP.x2 }}>
          {outcome.denies.map((d) => (
            <span
              key={d}
              style={{
                fontFamily: MONO,
                ...T.monoSm,
                border: `${BORDER}px solid rgba(27,27,27,0.3)`,
                borderRadius: R_PILL,
                padding: `${SP.half}px ${SP.x1_5}px`,
              }}
            >
              {d}
            </span>
          ))}
        </div>
      )}

          </div>

      {/*
        Both actions ride the divider.

        The rule separates the finding above from the detail below, which is
        the right place for "what now" — you have read the verdict, and these
        are the two things you can do about it. New check is outlined and goes
        first; the attestation is filled and goes last, because it is the one
        that leaves the page.

        The stale notice sits on the left of the same rule. It used to have
        its own row at the top of the panel, which reserved 20px plus a 24px
        margin permanently for a string that is empty almost always.
      */}
      <div
        className="pe-actions"
        style={{
          display: "flex",
          alignItems: "center",
          gap: SP.x3,
          margin: `${SP.x4}px 0 ${SP.x3}px`,
        }}
      >
        {stale && (
          <span style={{ ...small(), color: BODY, flexShrink: 0 }}>Inputs changed · run again</span>
        )}

        {/* The divider that the buttons ride. Hidden on mobile, where the
            buttons stack full-width and a horizontal rule between them is
            noise. */}
        <div className="pe-actions-line" style={{ flex: 1, height: 1, background: "rgba(27,27,27,0.16)" }} />

        <Cta variant="outline" onClick={onReset} style={{ flexShrink: 0 }}>
          New check
        </Cta>

        {outcome.explorerUrl && (
          <Cta variant="fill" href={outcome.explorerUrl} style={{ flexShrink: 0, minWidth: 0 }}>
            {/* Full label on desktop; the "on the Newton explorer" tail is
                hidden on mobile via CSS to keep the pill on one screen. */}
            View attestation<span className="pe-attest-tail">&nbsp;on the Newton explorer</span> ↗
          </Cta>
        )}
      </div>

      <div
        className="pe-parties"
        style={{ display: "flex", alignItems: "flex-start", gap: SP.x3, flexWrap: "wrap" }}
      >
        {/* No Designated/Clear tag when nothing was screened — an unscreened
            address is not a clear one. */}
        <PartyBlock name="Recipient" address={to} party={outcome.verdict === "unavailable" ? undefined : p?.to} />

        {/*
          "Was this address clean" is not answerable; only "was it clean
          then". A screenshot of this panel without a time is not evidence of
          anything.
        */}
        {/* Row heights match PartyBlock (label row = tag height, value row =
            the Copy button height) so "Decided" lines up with "Recipient" and
            the timestamp lines up with the address beside it. */}
        <div style={{ display: "flex", flexDirection: "column", gap: SP.half }}>
          <div style={{ display: "flex", alignItems: "center", minHeight: H.chip - 12 }}>
            <span style={{ ...small(), color: "rgba(27,27,27,0.62)" }}>Decided</span>
          </div>
          {/* Sans, not mono. A timestamp is not a hash, and setting it like
              one made it compete with the addresses beside it. */}
          <div style={{ display: "flex", alignItems: "center", minHeight: H.chip }}>
            <span style={{ ...small() }}>{stamp(outcome.decidedAt)}</span>
          </div>
        </div>

      </div>
      </div>
    </>
  );
}

function PartyBlock({ name, address, party }: { name: string; address: string; party?: Party }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard needs a secure context; failing silently beats an error the
      // reader cannot act on.
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: SP.half }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, minHeight: H.chip - 12 }}>
        <span style={{ ...small(), color: "rgba(27,27,27,0.62)" }}>{name}</span>
        {party && (
          <Tag tone={party.sanctioned ? "strong" : "muted"}>
            {party.sanctioned ? "Designated" : "Clear"}
          </Tag>
        )}
        {/* On a phone Copy rides up here beside the tag; the long address gets
            the whole next row to itself instead of sharing it with a button
            that pushed the wrapped hash off-balance. Hidden on desktop. */}
        <span className="pe-copy-mobile" style={{ display: "none", flexShrink: 0 }}>
          <Cta variant="outline" size="sm" onClick={copy} title={address}>
            {copied ? "Copied" : "Copy"}
          </Cta>
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: SP.x1, minHeight: H.chip }}>
        {/*
          Whole, not truncated. Two different addresses can share a prefix and
          a suffix, and this panel is the thing people screenshot as the
          record — an abbreviation in a compliance artifact is a hazard, not a
          tidiness.
        */}
        <span style={{ fontFamily: MONO, ...T.mono, wordBreak: "break-all" }}>{address}</span>
        <span className="pe-copy-desktop" style={{ flexShrink: 0 }}>
          <Cta variant="outline" size="sm" onClick={copy} title={address}>
            {copied ? "Copied" : "Copy"}
          </Cta>
        </span>
      </div>
    </div>
  );
}

/*
 * The evidence rail is gone.
 *
 * It went through a bottom strip, a panel at the foot, a side column, a
 * floating drawer and finally two small copy boxes anchored out of flow in
 * the bottom-right corner. Every version was an attempt to answer "where does
 * the detail live" without letting the detail rearrange the verdict.
 *
 * The answer turned out to be that it does not live on this screen. The raw
 * gateway response, the deployed Rego and the shared run history are three
 * things nobody reads in a 300px box next to a decision — and the one link
 * that matters, the attestation, is on the rule where it can't be missed.
 *
 * The routes behind them still work: /api/policy-source resolves the deployed
 * policy from the chain and /api/history reads the shared feed. Nothing on
 * the client calls them any more.
 */

/* ── Reading the operator response ──────────────────────── */

/**
 * The decision, from either RPC.
 *
 *   newt_simulatePolicy → evaluation_result.result, a boolean.
 *   newt_createTask     → task_response.evaluation_result, a BYTES32 —
 *                         all-zero for false, …0001 for true.
 *
 * Only the first was handled once, so every submitted task parsed as "no
 * verdict found" and the caller rendered that as Compliant. Undefined here
 * must never reach a happy branch at the call site.
 */
function extractAllow(result: any): boolean | undefined {
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
 * Strict on purpose: anything that is not exactly zero or exactly one is
 * undefined, not "truthy". A loose "ends in 1" test reads 0x…21 as allowed,
 * and a wrong ALLOW is the one error this page must never make.
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

/** Raw dataset ids from a confirmed hit, if the response carries them. */
function extractDatasets(result: any): string[] {
  const seen: unknown[] = [result?.evaluation_result?.datasets, result?.result?.datasets, result?.datasets];
  for (const c of seen) {
    if (Array.isArray(c) && c.every((x) => typeof x === "string") && c.length) return c as string[];
  }
  return [];
}
