"use client";

/**
 * Newton AML/OFAC Policy Engine.
 *
 * The deployed policy already decides correctly — that is verified in both
 * directions by sanctions-oracle/verify-both.mjs. What this page has to do is
 * make the decision legible: what was checked, against what, and what happens
 * next.
 *
 * Structure is three floating cards on a grey field: masthead, stage,
 * evidence. The stage is one element that changes state rather than three that
 * take turns — at rest it holds the console, in flight the screening, at the
 * end the verdict fills it edge to edge.
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

import { useCallback, useEffect, useRef, useState } from "react";
import { GOALS, PROVIDERS, SANCTIONED_TEST_ADDRESS } from "@/lib/catalog";
import { SANCTIONED_POOL } from "@/lib/sanctioned-pool";
import { C, H, R, SP, T, BORDER } from "@/lib/ds";

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
 * the OFAC lockup, which is a mark rather than a label.
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
const short = (a: string) => (a && a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a || "—");

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
 *   pass        — neither party designated
 *   block       — a party is designated
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

type SharedRun = {
  taskId: string;
  address: string;
  sender?: string;
  verdict: "allowed" | "denied" | "pending";
  block: number;
};

type DeployedPolicy = {
  source: string;
  cid: string;
  entrypoint: string;
  policyAddress: string;
  via: string;
  /** null when the on-chain params could not be decoded — unknown, not absent. */
  params: Record<string, unknown> | null;
  expireAfter: number | null;
};

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
const REGIMES = ["OFAC", "EU", "UN", "UK"] as const;

const DATASET_REGIME: Record<string, (typeof REGIMES)[number]> = {
  us_ofac_sdn: "OFAC",
  us_ofac_cons: "OFAC",
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
  const [from, setFrom] = useState("");

  /**
   * Which shortcut last filled each field, so the buttons can show state.
   * Cleared when the address is typed by hand — the shortcut is no longer the
   * source of what is in the box.
   */
  const [toPick, setToPick] = useState<Pick>(null);
  const [fromPick, setFromPick] = useState<Pick>(null);
  const [focus, setFocus] = useState<"to" | "from" | null>(null);
  const [picked, setPicked] = useState<"clean" | "ofac" | null>(null);
  const [run, setRun] = useState<RunState>({ status: "idle" });

  const [history, setHistory] = useState<SharedRun[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [deployed, setDeployed] = useState<DeployedPolicy | null>(null);
  const [deployedError, setDeployedError] = useState<string | null>(null);
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
    setFrom("");
    setToPick(null);
    setFromPick(null);
    setThrottled(null);
    window.history.replaceState(null, "", window.location.pathname);
  }

  const stageRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const toValid = isAddress(to);
  const fromValid = isAddress(from);
  const busy = run.status === "running";

  /**
   * Either party is enough.
   *
   * The policy needs both — an unscreened party is a denial, not a skip — but
   * that is the policy's problem, not the visitor's. Leave one empty and a
   * clean address is generated for it at submit time and shown in the result,
   * so the transfer is complete and the side you care about is the only
   * variable. Requiring both meant pasting an address you had no opinion
   * about before you could test the one you did.
   */
  const anyFilled = toValid || fromValid;
  const noneBroken = (!to || toValid) && (!from || fromValid);
  const ready = applied && anyFilled && noneBroken && !busy;

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/history");
      const json = await res.json();
      if (json.ok) {
        setHistory(json.runs ?? []);
        setHistoryError(null);
      } else setHistoryError(asText(json.error));
    } catch (e) {
      setHistoryError(asText(e));
    }
  }, []);

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
    loadHistory();

    fetch("/api/policy-source")
      .then((r) => r.json())
      .then((j) => (j.ok ? setDeployed(j) : setDeployedError(asText(j.error))))
      .catch((e) => setDeployedError(asText(e)));

    // Unknown freshness counts as stale, never as healthy-until-proven.
    fetch("/api/screening-health")
      .then((r) => r.json())
      .then((j) => setHealth(j.ok ? j : { ok: false, stale: true, ageHours: null, count: null }))
      .catch(() => setHealth({ ok: false, stale: true, ageHours: null, count: null }));
  }, [loadHistory]);

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
    // Whatever was left blank gets a clean address, committed to state so the
    // result shows exactly what was screened.
    const sendTo = toValid ? to : randomOrdinary();
    const sendFrom = fromValid ? from : randomOrdinary();
    if (sendTo !== to) setTo(sendTo);
    if (sendFrom !== from) setFrom(sendFrom);

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
            ? "Neither party is designated. The transfer may proceed."
            : "The transfer is blocked.",
          denies: extractDenies(json.result),
          datasets: extractDatasets(json.result),
          explorerUrl: json.explorerUrl ?? null,
          raw: json.result,
          decidedAt: new Date().toISOString(),
        },
      });

      loadHistory();

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
            from={from}
            focus={focus}
            setFocus={setFocus}
            onTo={(v) => {
              setTo(v);
              setToPick(null);
              invalidate();
            }}
            onFrom={(v) => {
              setFrom(v);
              setFromPick(null);
              invalidate();
            }}
            toPick={toPick}
            fromPick={fromPick}
            // Each party gets its own pair, so any combination is one click
            // per side — clean/clean, sanctioned/clean, either direction.
            onPickTo={(kind) => {
              setTo(kind === "clean" ? randomOrdinary() : randomSanctioned(to));
              setToPick(kind);
              invalidate();
            }}
            onPickFrom={(kind) => {
              setFrom(kind === "clean" ? randomOrdinary() : randomSanctioned(from));
              setFromPick(kind);
              invalidate();
            }}
            ready={ready}
            onVerify={verify}
            toValid={toValid}
            fromValid={fromValid}
            throttled={throttled}
            policyText={policyTextOf(deployed, deployedError, provider)}
          />
        )}

        {run.status === "running" && (
          <Screening to={to} from={from} onCancel={() => abortRef.current?.abort()} />
        )}

        {done && (
          <Decision
            outcome={done}
            to={to}
            from={from}
            stale={run.status === "done" && Boolean(run.stale)}
            onReset={reset}
            /*
             * Copy targets, not panels. The detail belongs to this decision,
             * but nobody reads a Rego policy in a drawer on a demo screen —
             * they take it somewhere with a scrollbar.
             */
            evidence={
              <EvidenceRail raw={asText(done.raw)} history={history} historyError={historyError} />
            }
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
        // Shorter. Two elements did not need 16px of vertical air on a
        // fixed-height console — every pixel here is one the stage loses.
        padding: `${SP.x1_5}px ${SP.x2}px`,
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
            field label, and the sheet has no opinion on marks. */}
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
          OFAC
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
          border: `${BORDER}px solid ${stale ? FLAG : HAIRLINE}`,
          borderRadius: R_PILL,
          padding: "8px 16px",
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
  from: string;
  focus: "to" | "from" | null;
  setFocus: (v: "to" | "from" | null) => void;
  onTo: (v: string) => void;
  onFrom: (v: string) => void;
  toPick: Pick;
  fromPick: Pick;
  onPickTo: (k: "clean" | "ofac") => void;
  onPickFrom: (k: "clean" | "ofac") => void;
  ready: boolean;
  onVerify: () => void;
  toValid: boolean;
  fromValid: boolean;
  throttled: string | null;
  policyText: string;
}) {
  const {
    applied,
    onApply,
    to,
    from,
    focus,
    setFocus,
    onTo,
    onFrom,
    toPick,
    fromPick,
    onPickTo,
    onPickFrom,
    ready,
    onVerify,
    toValid,
    fromValid,
    throttled,
    policyText,
  } = props;

  /**
   * Either party is enough; whatever is left blank gets a clean address. So
   * the only things worth saying are "no policy" and "that is not an
   * address" — nagging for a second address you have no opinion about is
   * asking the visitor to do the demo's homework.
   */
  const hint = throttled
    ? throttled
    : !applied
      ? "No policy applied"
      : (to && !toValid) || (from && !fromValid)
        ? "Not a valid address"
        : !toValid && !fromValid
          ? "Fill either party"
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
        padding: `${SP.x5}px ${SP.x6}px`,
      }}
    >
      <div className="pe-console" style={{ width: "100%", maxWidth: 1180, margin: "0 auto" }}>
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
              // Fills its column instead of floating at a fixed height, which
              // left it stranded beside a much taller second step.
              flex: 1,
              minHeight: SP.x10 * 3.2, // 256, on the grid
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

            <div style={{ ...T.value, fontFamily: SANS, color: BODY, marginTop: SP.x2, maxWidth: "34ch" }}>
              Blocks the transfer if either party appears on a sanctions list. Enforced by an operator
              quorum before the transaction executes.
            </div>

            <div style={{ marginTop: "auto", paddingTop: SP.x3, ...label(), color: applied ? INK : FLAG }}>
              {applied ? "Applied · tap to remove" : "Removed · nothing will be enforced"}
            </div>
          </button>

          {/*
            Readable before a run, not only after one.
            The deployed policy was reachable only from the verdict, so anyone
            who wanted to know what would be enforced had to enforce it first.
          */}
          <CopyBox label="Deployed policy" text={policyText} />
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
            Each party owns its own shortcuts. One control that filled
            "whichever side is selected" meant reading a mode indicator to
            know where a click would land; two pairs means the button you
            press is next to the box it fills, and any combination —
            sanctioned sender with a clean recipient, both dirty, either
            direction — is one click per side.
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
            The sender is a field because the deployed policy screens it. It
            was hardcoded and invisible for the whole life of this demo, which
            left payer_sanctioned and payer_not_screened — half the policy —
            unreachable from the interface.
          */}
          <Field
            name="Sender"
            raw={from}
            focused={focus === "from"}
            onFocus={() => setFocus("from")}
            onBlur={() => setFocus(null)}
            onChange={onFrom}
            onEnter={() => ready && onVerify()}
            invalid={Boolean(from) && !fromValid}
          >
            <Pickers picked={fromPick} onPick={onPickFrom} party="sender" empty={!from} />
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
      hint: `A real OFAC-designated wallet from the live feed`,
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
function Screening({ to, from, onCancel }: { to: string; from: string; onCancel: () => void }) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        padding: `${SP.x6}px ${SP.x6}px`,
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

        {/* Eight seconds is long enough to notice a wrong address. */}
        <button
          type="button"
          onClick={onCancel}
          className="pe-reset"
          style={{
            marginLeft: "auto",
            height: SP.x5,
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
        Screening both parties
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
          <span style={{ ...small(), color: MUTED }}>Sender</span>
          <span style={{ fontFamily: MONO, ...T.mono, color: BODY }}>{middle(from)}</span>
        </div>
      </div>

      <div style={{ marginTop: SP.x4, display: "flex", flexDirection: "column", gap: SP.x1_5 }}>
        {/*
          Only the first step can be marked done, and only because we did it.
          The gateway returns once, at the end — there is no progress to read
          from a quorum mid-flight — so ticking 02 and 03 on a timer would be
          inventing status.
        */}
        <Step n={1} done>
          Task submitted to the Newton gateway
        </Step>
        <Step n={2}>
          Both addresses screened against the consolidated list — OFAC, EU, UN and UK in one lookup
        </Step>
        <Step n={3}>Operator quorum evaluates the policy and signs the result</Step>
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

/* ── Decision ───────────────────────────────────────────── */

function Decision({
  outcome,
  to,
  from,
  stale,
  onReset,
  evidence,
}: {
  outcome: Outcome;
  to: string;
  from: string;
  stale: boolean;
  onReset: () => void;
  evidence: React.ReactNode;
}) {
  /**
   * The fill is its own layer so it can be clipped in independently of the
   * text above it — and keyed by verdict so a second run re-runs the wash
   * rather than swapping colour instantly under a static headline.
   */
  const p = outcome.parties;
  const flagged: string[] = [];
  if (p?.to?.sanctioned) flagged.push("recipient");
  if (p?.from?.sanctioned) flagged.push("sender");

  const allDatasets = [...(p?.to?.datasets ?? []), ...(p?.from?.datasets ?? []), ...outcome.datasets];
  const regimes = [...new Set(allDatasets.map((d) => DATASET_REGIME[d]).filter(Boolean))];

  /**
   * Only claimed once attribution has come back. Before that the verdict is
   * the verdict — a sentence naming a party we have not identified would be a
   * guess dressed as a finding.
   */
  const who =
    outcome.verdict !== "block"
      ? null
      : flagged.length === 2
        ? "Both parties are designated."
        : flagged.length === 1
          ? `The ${flagged[0]} is designated.`
          : null;

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
          padding: "clamp(20px, 4vh, 56px) clamp(24px, 4vw, 56px)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        {/*
          New check sits top-right of the outcome, directly under the network
          badge — the same corner the page already uses for "state of the
          system" rather than buried in a strip at the bottom.
        */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: SP.x3,
            marginBottom: SP.x3,
          }}
        >
          <div style={{ ...small(), color: BODY, minHeight: 20 }}>
            {stale ? "Inputs changed · run again" : ""}
          </div>

          {/* The way out, and nothing else. The evidence has its own corner. */}
          <div style={{ flexShrink: 0 }}>
            <button
              type="button"
              onClick={onReset}
              className="pe-reset"
              style={{
                height: H.control,
                padding: `0 ${SP.x3}px`,
                borderRadius: R_PILL,
                border: `${BORDER}px solid ${INK}`,
                background: "transparent",
                color: INK,
                ...T.label,
                fontFamily: SANS,
                display: "flex",
                alignItems: "center",
              }}
            >
              New check
            </button>
          </div>
        </div>

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
        fresh lookup finds neither party listed, something moved between the
        two — a delisting, a feed update, a divergent oracle — and the page
        must say so rather than print "Non Compliant" above two parties both
        marked Clear and let the reader reconcile it.
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

      {outcome.verdict === "block" && p?.to && p?.from && flagged.length === 0 && (
        <div style={{ ...small(), marginTop: SP.x2, maxWidth: "52ch", opacity: 0.75 }}>
          The operators denied this transfer, but a lookup against the same list just now finds
          neither party designated. The signed verdict stands — the difference is worth
          investigating in the operator response.
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
            <span
              key={r}
              style={{
                borderRadius: R_PILL,
                border: `${BORDER}px solid ${INK}`,
                background: "rgba(27,27,27,0.08)",
                padding: `${SP.x1}px ${SP.x2}px`,
                ...label(),
              }}
            >
              {r}
            </span>
          ))}
        </div>
      )}

      {outcome.verdict === "pass" && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: SP.x1, marginTop: SP.x3, alignItems: "center" }}>
          <span style={{ ...small(), color: "rgba(27,27,27,0.6)" }}>No match on</span>
          {REGIMES.map((r) => (
            <span
              key={r}
              style={{
                borderRadius: R_PILL,
                border: `${BORDER}px solid rgba(27,27,27,0.22)`,
                padding: `${SP.x1}px ${SP.x2}px`,
                ...label(),
                color: "rgba(27,27,27,0.7)",
              }}
            >
              {r}
            </span>
          ))}
        </div>
      )}

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
        The attestation link rides the divider.

        It was down among the parties, competing with three blocks of address
        detail for the same eye. On the rule it separates the finding above
        from the evidence below — which is exactly what following the link
        does.
      */}
      <div
        className="pe-clear-corner"
        style={{
          display: "flex",
          alignItems: "center",
          gap: SP.x3,
          margin: `${SP.x4}px 0 ${SP.x3}px`,
        }}
      >
        <div style={{ flex: 1, height: 1, background: "rgba(27,27,27,0.16)" }} />

        {outcome.explorerUrl && (
          <a
            href={outcome.explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="pe-dark"
            style={{
              flexShrink: 0,
              height: H.control,
              padding: `0 ${SP.x3}px`,
              borderRadius: R_PILL,
              display: "flex",
              alignItems: "center",
              gap: SP.x1,
              ...label(),
            }}
          >
            View attestation on the Newton explorer ↗
          </a>
        )}
      </div>

      <div
        className="pe-parties pe-clear-corner"
        style={{ display: "flex", alignItems: "flex-end", gap: SP.x3, flexWrap: "wrap" }}
      >
        {/* No Designated/Clear tag when nothing was screened — an unscreened
            address is not a clear one. */}
        <PartyBlock name="Recipient" address={to} party={outcome.verdict === "unavailable" ? undefined : p?.to} />
        <PartyBlock name="Sender" address={from} party={outcome.verdict === "unavailable" ? undefined : p?.from} />

        {/*
          "Was this address clean" is not answerable; only "was it clean
          then". A screenshot of this panel without a time is not evidence of
          anything.
        */}
        <div style={{ display: "flex", flexDirection: "column", gap: SP.half }}>
          <span style={{ ...small(), color: "rgba(27,27,27,0.62)" }}>Decided</span>
          {/* Sans, not mono. A timestamp is not a hash, and setting it like
              one made it compete with the addresses beside it. */}
          <span style={{ ...small() }}>{stamp(outcome.decidedAt)}</span>
        </div>

        {/*
          "Previous" lived here. Earlier runs already carries the contrast,
          with more of it — and this block only appeared when two verdicts
          disagreed, so the bottom row changed shape depending on history.
        */}
        </div>

        {/*
          Bottom right, and out of flow.

          Absolute means it cannot push the verdict around no matter what it
          contains — which is what lets the panel stay unscrollable. The
          content column reserves room for it (paddingRight below) so the
          parties never run underneath.
        */}
        <div
          className="pe-corner"
          style={{
            position: "absolute",
            right: "clamp(24px, 4vw, 56px)",
            bottom: "clamp(20px, 4vh, 56px)",
            zIndex: 1,
          }}
        >
          {evidence}
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
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <span style={{ ...small(), color: "rgba(27,27,27,0.62)" }}>{name}</span>
        {party && (
          <span
            style={{
              ...small(),
              color: party.sanctioned ? INK : "rgba(27,27,27,0.5)",
              border: `${BORDER}px solid ${party.sanctioned ? INK : "rgba(27,27,27,0.25)"}`,
              borderRadius: R_PILL,
              padding: `${SP.half}px ${SP.x1}px`,
            }}
          >
            {party.sanctioned ? "Designated" : "Clear"}
          </span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: SP.x1 }}>
        {/*
          Whole, not truncated. Two different addresses can share a prefix and
          a suffix, and this panel is the thing people screenshot as the
          record — an abbreviation in a compliance artifact is a hazard, not a
          tidiness.
        */}
        <span style={{ fontFamily: MONO, ...T.mono, wordBreak: "break-all" }}>{address}</span>
        <button
          type="button"
          onClick={copy}
          className="pe-reset"
          title={address}
          style={{
            borderRadius: R_PILL,
            border: `${BORDER}px solid rgba(27,27,27,0.3)`,
            padding: `${SP.half}px ${SP.x1}px`,
            ...small(),
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

/* ── Evidence ───────────────────────────────────────────── */

/**
 * What gets copied under "Deployed policy": the addresses that identify it,
 * the CID it was fetched from, the one parameter that is a judgment rather
 * than plumbing, and then the Rego. Pasted anywhere, it still says what it is.
 */
function policyTextOf(
  deployed: DeployedPolicy | null,
  deployedError: string | null,
  provider: { policyData?: string } | undefined,
): string {
  if (!deployed?.source) {
    return deployedError
      ? `Couldn't fetch the deployed policy.\n\n${deployedError}`
      : "Resolving from chain…";
  }

  return [
    `# PolicyClient  ${process.env.NEXT_PUBLIC_POLICY_CLIENT ?? "—"}`,
    `# Policy        ${deployed.policyAddress}`,
    `# Oracle        ${provider?.policyData ?? "—"}`,
    `# CID           ${deployed.cid}`,
    `# min_match_score ${
      deployed.params && typeof deployed.params.min_match_score === "number"
        ? deployed.params.min_match_score
        : "not set — defaults to 0, so any confirmed match denies"
    }`,
    "",
    deployed.source,
  ].join("\n");
}

/**
 * Three things worth taking away, and a button that takes each.
 *
 * This has been a bottom strip, a panel at the foot, a side column and a
 * floating drawer. Every one of them rearranged the verdict in order to
 * describe it, and none of them was what the detail is actually for: nobody
 * reads a Rego policy or a gateway JSON blob in a 200px window on a demo
 * screen. They copy it and read it somewhere that has a scrollbar and a
 * search box.
 *
 * So there is nothing to expand. Three small boxes, each naming what it holds
 * and handing it over.
 */
function EvidenceRail(props: {
  raw: string;
  history: SharedRun[];
  historyError: string | null;
}) {
  const { raw, history, historyError } = props;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: SP.x1, width: 300 }}>
      {/*
        Two things, and they behave differently on purpose.

        The gateway response is a JSON blob — unreadable in a 300px box, so it
        is a copy target. A handful of runs is readable: verdict, address,
        link. So that one opens.

        Deployed policy is neither; it lives in the console, where it can be
        read before a decision rather than after one, and it does not change
        between runs.
      */}
      <CopyBox label="Operator response" text={raw} />
      <RunsBox history={history} historyError={historyError} />
    </div>
  );
}

function RunsBox({ history, historyError }: { history: SharedRun[]; historyError: string | null }) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: SP.x1,
          padding: `${SP.x1_5}px ${SP.x2}px`,
          borderRadius: R_INSET,
          border: `${BORDER}px solid ${open ? INK : "rgba(27,27,27,0.22)"}`,
          background: "rgba(255,255,255,0.4)",
          transition: "border-color 0.18s ease",
        }}
      >
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="pe-reset"
          style={{ flex: 1, minWidth: 0, textAlign: "left", ...T.label, fontFamily: SANS, color: INK }}
        >
          Earlier runs
        </button>

        {/* No copy here: each row already links to its own attestation, which
            is the thing worth taking away. */}
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          onClick={() => setOpen((v) => !v)}
          className="pe-reset"
          style={{
            flexShrink: 0,
            width: 20,
            height: 20,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "rgba(27,27,27,0.5)",
            // Points up when closed: that is the direction it will open.
            transform: open ? "none" : "rotate(180deg)",
            transition: "transform 0.18s ease",
          }}
        >
          ▾
        </button>
      </div>

      {/*
        Opens upward, because the box now sits at the bottom of the panel and
        there is nothing below it to open into. Anchored to this box rather
        than to the panel, so nothing else on the verdict shifts to make room.
      */}
      {open && (
        <div
          className="pe-rise"
          style={{
            position: "absolute",
            bottom: `calc(100% + ${SP.half}px)`,
            right: 0,
            width: "100%",
            maxHeight: 240,
            overflow: "auto",
            background: SURFACE,
            border: `${BORDER}px solid ${HAIRLINE}`,
            borderRadius: R_INSET,
            padding: SP.x1,
            boxShadow: "0 12px 32px rgba(27,27,27,0.14)",
            zIndex: 2,
          }}
        >
          {historyError && (
            <div style={{ ...small(), color: ERROR, padding: SP.x1 }}>
              Couldn&rsquo;t read the chain: {historyError}
            </div>
          )}

          {!historyError && history.length === 0 && (
            <div style={{ ...small(), color: MUTED, padding: SP.x1 }}>
              No runs on this client in the last ~3 hours.
            </div>
          )}

          {history.map((h) => (
            <a
              key={h.taskId}
              href={`https://explorer.newton.xyz/testnet/task/${h.taskId}`}
              target="_blank"
              rel="noreferrer"
              className="pe-hover"
              style={{
                display: "flex",
                alignItems: "center",
                gap: SP.x1,
                padding: `${SP.x1}px`,
                borderRadius: R.sm,
                border: `${BORDER}px solid transparent`,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  flexShrink: 0,
                  background:
                    h.verdict === "allowed" ? PASS : h.verdict === "denied" ? FLAG : "transparent",
                  border: h.verdict === "pending" ? `${BORDER}px solid ${MUTED_2}` : "none",
                }}
              />
              <span style={{ fontFamily: MONO, ...T.monoSm, color: BODY }}>{short(h.address)}</span>
              <span
                style={{
                  marginLeft: "auto",
                  ...T.monoSm,
                  fontFamily: SANS,
                  color: h.verdict === "allowed" ? PASS : h.verdict === "denied" ? FLAG : MUTED,
                }}
              >
                {h.verdict === "allowed" ? "Compliant" : h.verdict === "denied" ? "Non Compliant" : "Awaiting"}
              </span>
              <span style={{ fontFamily: MONO, ...T.monoSm, color: MUTED_2 }}>↗</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function CopyBox({ label: name, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard needs a secure context; failing silently beats an error the
      // reader cannot act on.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="pe-reset"
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: SP.x2,
        padding: `${SP.x1_5}px ${SP.x2}px`,
        borderRadius: R_INSET,
        border: `${BORDER}px solid rgba(27,27,27,0.22)`,
        background: "rgba(255,255,255,0.4)",
        textAlign: "left",
        transition: "background 0.18s ease, border-color 0.18s ease",
      }}
    >
      <span style={{ ...T.label, fontFamily: SANS, color: INK }}>{name}</span>

      <span
        style={{
          ...T.monoSm,
          fontFamily: SANS,
          flexShrink: 0,
          borderRadius: R_PILL,
          border: `${BORDER}px solid rgba(27,27,27,0.28)`,
          padding: `${SP.half}px ${SP.x1_5}px`,
          color: INK,
        }}
      >
        {copied ? "Copied" : "Copy"}
      </span>
    </button>
  );
}


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
