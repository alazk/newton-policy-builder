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

/* ── Tokens ─────────────────────────────────────────────── */

const INK = "#1B1B1B";
const FIELD = "#F1F1F1";
const SURFACE = "#FFFFFF";
const HAIRLINE = "#E2E2E2";
const CONTROL = "#CCCCCC";
const BODY = "#4A4A4A";
const MUTED = "#6B6B6B";
const MUTED_2 = "#A5A5A5";
const PASS = "#3F6F55";
const FLAG = "#C2621A";
const ERROR = "#8E2B1F";

const DISPLAY = "var(--display)";
const SANS = "var(--sans)";
const MONO = "var(--mono)";

const R_CARD = 22;
const R_INSET = 16;
const R_PILL = 999;

const GAP = 12;
const PAGE_PAD = 14;

/**
 * One spacing scale, both axes.
 *
 * The gap between two buttons side by side and the gap between two stacked
 * rows were different numbers for no reason, which is what makes a grid look
 * hand-placed. S1 sits inside a control group, S2 between groups, S3 between
 * columns.
 */
const S1 = 8;
const S2 = 14;
const S3 = 22;

const label = (size = 10): React.CSSProperties => ({
  fontFamily: SANS,
  fontSize: size,
  fontWeight: 600,
  letterSpacing: "0.15em",
  textTransform: "uppercase",
});

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

type Verdict = "pass" | "block" | "none";

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
  const [drawer, setDrawer] = useState<"raw" | "policy" | "runs" | null>(null);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /** The run before this one, for comparison. The whole demonstration is
      that clean and sanctioned differ, and you could only see one at a time. */
  const [prev, setPrev] = useState<{ verdict: Verdict; headline: string; to: string; from: string } | null>(
    null,
  );

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

    if (run.status === "done" && run.outcome.verdict !== "none") {
      setPrev({ verdict: run.outcome.verdict, headline: run.outcome.headline, to, from });
    }

    const ac = new AbortController();
    abortRef.current = ac;
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
      <Masthead health={health} />

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
            gap: 10,
            padding: "12px 20px",
            borderRadius: R_CARD,
            border: `1px solid ${FLAG}`,
            background: "#FFF3E6",
            color: "#7A3D0E",
            fontSize: 14,
          }}
        >
          <span style={{ ...label(10), color: FLAG }}>
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
        tabIndex={-1}
        role={run.status === "idle" ? undefined : "status"}
        aria-live={run.status === "idle" ? undefined : "polite"}
        aria-atomic={run.status === "idle" ? undefined : true}
        className={done ? "pe-drop" : undefined}
        style={{
          flex: 1,
          minHeight: 0,
          borderRadius: R_CARD,
          border: `1px solid ${HAIRLINE}`,
          background: done ? undefined : SURFACE,
          backgroundImage: done ? FILL[done.verdict] : undefined,
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
            prev={prev}
            stale={run.status === "done" && Boolean(run.stale)}
          />
        )}
      </div>

      <EvidenceBar
        open={drawer}
        setOpen={setDrawer}
        hasRun={run.status === "done"}
        raw={run.status === "done" ? asText(run.outcome.raw) : ""}
        deployed={deployed}
        deployedError={deployedError}
        provider={provider}
        history={history}
        historyError={historyError}
        showReset={run.status !== "idle"}
        onReset={() => {
          setRun({ status: "idle" });
          setDrawer(null);
        }}
      />
    </div>
  );
}

/* ── Masthead ───────────────────────────────────────────── */

function Masthead({ health }: { health: ScreeningHealth | null }) {
  const stale = health?.stale ?? false;

  return (
    <div
      className="pe-mast"
      style={{
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 24,
        padding: "14px 20px",
        background: SURFACE,
        border: `1px solid ${HAIRLINE}`,
        borderRadius: R_CARD,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <img src="/newton-logo.svg" alt="Newton" style={{ height: 20, display: "block" }} />
        <span
          className="pe-dark"
          style={{ ...label(10), borderRadius: R_PILL, padding: "8px 14px" }}
        >
          AML / OFAC
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
          border: `1px solid ${stale ? FLAG : HAIRLINE}`,
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
        <span style={{ ...label(10), color: INK }}>Sepolia</span>
        {stale && (
          <span style={{ ...label(10), color: FLAG }}>
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
  } = props;

  /**
   * Either party is enough; whatever is left blank gets a clean address. So
   * the only things worth saying are "no policy" and "that is not an
   * address" — nagging for a second address you have no opinion about is
   * asking the visitor to do the demo's homework.
   */
  const hint = !applied
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
        padding: "40px 46px",
      }}
    >
      <div className="pe-console" style={{ width: "100%", maxWidth: 1180, margin: "0 auto" }}>
        {/* 01 */}
        <div style={{ display: "flex", flexDirection: "column", gap: S2 }}>
          {/* "Active policy", because it already is. A single compulsory
              option presented as a choice is a speed bump, not a decision. */}
          <Head n="01">Active policy</Head>

          <button
            type="button"
            aria-pressed={applied}
            onClick={onApply}
            className="pe-reset"
            style={{
              background: FIELD,
              border: `1px solid ${applied ? INK : "transparent"}`,
              borderRadius: R_INSET,
              padding: 26,
              // Fills its column instead of floating at a fixed height, which
              // left it stranded beside a much taller second step.
              flex: 1,
              minHeight: 260,
              display: "flex",
              flexDirection: "column",
              width: "100%",
              transition: "border-color 0.18s ease",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, width: "100%" }}>
              <span style={{ fontFamily: DISPLAY, fontSize: 32, lineHeight: 1.05, letterSpacing: "-0.01em" }}>
                Sanctions Screening
              </span>
              <span
                aria-hidden
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  border: `1px solid ${applied ? INK : CONTROL}`,
                  background: applied ? INK : SURFACE,
                  color: "#fff",
                  fontSize: 13,
                  lineHeight: "20px",
                  textAlign: "center",
                  flexShrink: 0,
                  transition: "background 0.18s ease, border-color 0.18s ease",
                }}
              >
                {applied ? "✓" : ""}
              </span>
            </div>

            <div style={{ fontSize: 16, lineHeight: 1.5, color: BODY, marginTop: 14, maxWidth: "34ch" }}>
              Blocks the transfer if either party appears on a sanctions list. Enforced by an operator
              quorum before the transaction executes.
            </div>

            <div style={{ marginTop: "auto", paddingTop: 22, ...label(10), color: applied ? INK : FLAG }}>
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
            <Head n="02">Add a transfer</Head>
            <span style={{ fontSize: 14, color: MUTED, minHeight: 20 }}>{hint}</span>
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
              height: 76,
              width: "100%",
              borderRadius: R_PILL,
              ...label(11),
              fontSize: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              // Outlined rather than a grey slab. A filled grey block at this
              // size reads as a region, not as a control that is not ready.
              background: ready ? undefined : "transparent",
              border: ready ? "1px solid transparent" : `1px solid ${CONTROL}`,
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

function Head({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
      <span style={{ fontFamily: DISPLAY, fontSize: 22, color: MUTED_2, lineHeight: 1 }}>{n}</span>
      <span style={{ ...label(11), color: INK }}>{children}</span>
    </div>
  );
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
      <span style={{ ...label(10), color: MUTED }}>{name}</span>

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
          width: "100%",
          height: 72,
          borderRadius: R_INSET,
          border: `1px solid ${invalid ? ERROR : "transparent"}`,
          background: FIELD,
          padding: "0 22px",
          fontFamily: MONO,
          fontSize: 15,
          color: INK,
        }}
      />
      {invalid ? (
        <span style={{ fontSize: 12.5, color: ERROR }}>Not a valid 20-byte address.</span>
      ) : hint ? (
        <span style={{ fontSize: 12.5, color: MUTED_2 }}>{hint}</span>
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
  return (
    <div style={{ display: "flex", gap: S1 }}>
      {/*
        Labels say what the button puts in the box, not what it is called.
        "Random address" described the method; what someone needs to know is
        which outcome they are setting up.
      */}
      <Picker
        active={picked === "clean"}
        empty={empty}
        onClick={() => onPick("clean")}
        title={`Fill the ${party} with a randomly generated address, which is not on any list`}
      >
        Clean address
      </Picker>
      <Picker
        active={picked === "ofac"}
        empty={empty}
        onClick={() => onPick("ofac")}
        title={`Fill the ${party} with a real OFAC-designated wallet from the live feed`}
      >
        Sanctioned address
      </Picker>
    </div>
  );
}

function Picker({
  active,
  onClick,
  title,
  empty,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title?: string;
  empty?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      title={title}
      className="pe-reset"
      style={{
        flex: 1,
        height: 48,
        borderRadius: R_PILL,
        // Outlined while the field is empty: with nothing typed these are the
        // way in, not a shortcut past something.
        border: `1px solid ${active ? INK : empty ? CONTROL : "transparent"}`,
        background: active ? INK : FIELD,
        color: active ? "#fff" : INK,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        fontSize: 14.5,
        transition: "background 0.18s ease, color 0.18s ease, border-color 0.18s ease",
      }}
    >
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
    <div style={{ flex: 1, minHeight: 0, padding: "46px 52px", display: "flex", flexDirection: "column" }}>
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
        <span style={{ ...label(11), color: INK }}>Verifying onchain</span>

        {/* Eight seconds is long enough to notice a wrong address. */}
        <button
          type="button"
          onClick={onCancel}
          className="pe-reset"
          style={{
            marginLeft: "auto",
            height: 36,
            padding: "0 16px",
            borderRadius: R_PILL,
            border: `1px solid ${CONTROL}`,
            ...label(9),
            color: MUTED,
          }}
        >
          Cancel
        </button>
      </div>

      <div
        style={{
          fontFamily: DISPLAY,
          fontSize: "clamp(40px, 6vw, 72px)",
          lineHeight: 1,
          marginTop: 26,
          letterSpacing: "-0.02em",
        }}
      >
        Screening both parties
      </div>

      <div className="pe-sweep" style={{ marginTop: 22, borderRadius: R_INSET, maxWidth: 620 }}>
        <div
          style={{
            background: FIELD,
            padding: "16px 20px",
            display: "grid",
            gridTemplateColumns: "max-content minmax(0, 1fr)",
            columnGap: 18,
            rowGap: 8,
            alignItems: "baseline",
          }}
        >
          <span style={{ ...label(9), color: MUTED }}>Recipient</span>
          <span style={{ fontFamily: MONO, fontSize: 13, color: BODY }}>{middle(to)}</span>
          <span style={{ ...label(9), color: MUTED }}>Sender</span>
          <span style={{ fontFamily: MONO, fontSize: 13, color: BODY }}>{middle(from)}</span>
        </div>
      </div>

      <div style={{ marginTop: 30, display: "flex", flexDirection: "column", gap: 13 }}>
        <Step n={1}>Task submitted to the Newton gateway</Step>
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

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 14, alignItems: "baseline" }}>
      <span style={{ fontFamily: MONO, fontSize: 12, color: MUTED_2 }}>0{n}</span>
      <span style={{ fontSize: 15, color: BODY, lineHeight: 1.45 }}>{children}</span>
    </div>
  );
}

/* ── Decision ───────────────────────────────────────────── */

function Decision({
  outcome,
  to,
  from,
  prev,
  stale,
}: {
  outcome: Outcome;
  to: string;
  from: string;
  prev: { verdict: Verdict; headline: string; to: string; from: string } | null;
  stale: boolean;
}) {
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
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflow: "auto",
        padding: "clamp(34px, 6vh, 76px) clamp(28px, 4vw, 64px)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}
    >
      {stale && <div style={{ ...label(10), color: BODY, marginBottom: 14 }}>Inputs changed · run again</div>}

      <div
        className="pe-reveal"
        style={{
          fontFamily: DISPLAY,
          fontSize: "clamp(52px, 9vw, 104px)",
          lineHeight: 0.94,
          letterSpacing: "-0.025em",
        }}
      >
        {outcome.headline}
      </div>

      <div style={{ fontSize: 18.5, lineHeight: 1.45, color: INK, marginTop: 18, maxWidth: "46ch" }}>
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
      {outcome.verdict === "block" && p?.to && p?.from && flagged.length === 0 && (
        <div style={{ fontSize: 14.5, lineHeight: 1.5, marginTop: 14, maxWidth: "52ch", opacity: 0.75 }}>
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
        <div style={{ display: "flex", flexWrap: "wrap", gap: 9, marginTop: 22, alignItems: "center" }}>
          <span style={{ ...label(9), color: "rgba(27,27,27,0.6)" }}>Listed on</span>
          {regimes.map((r) => (
            <span
              key={r}
              style={{
                borderRadius: R_PILL,
                border: `1px solid ${INK}`,
                background: "rgba(27,27,27,0.08)",
                padding: "7px 14px",
                ...label(10),
              }}
            >
              {r}
            </span>
          ))}
        </div>
      )}

      {outcome.verdict === "pass" && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 9, marginTop: 22, alignItems: "center" }}>
          <span style={{ ...label(9), color: "rgba(27,27,27,0.6)" }}>No match on</span>
          {REGIMES.map((r) => (
            <span
              key={r}
              style={{
                borderRadius: R_PILL,
                border: "1px solid rgba(27,27,27,0.22)",
                padding: "7px 14px",
                ...label(10),
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
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
          {outcome.denies.map((d) => (
            <span
              key={d}
              style={{
                fontFamily: MONO,
                fontSize: 12,
                border: `1px solid rgba(27,27,27,0.3)`,
                borderRadius: R_PILL,
                padding: "5px 12px",
              }}
            >
              {d}
            </span>
          ))}
        </div>
      )}

      <div style={{ height: 1, background: "rgba(27,27,27,0.16)", margin: "30px 0 22px", maxWidth: 1080 }} />

      <div style={{ display: "flex", alignItems: "flex-end", gap: 26, flexWrap: "wrap", maxWidth: 1080 }}>
        <PartyBlock name="Recipient" address={to} party={p?.to} />
        <PartyBlock name="Sender" address={from} party={p?.from} />

        {/*
          "Was this address clean" is not answerable; only "was it clean
          then". A screenshot of this panel without a time is not evidence of
          anything.
        */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ ...label(9), color: "rgba(27,27,27,0.62)" }}>Decided</span>
          <span style={{ fontFamily: MONO, fontSize: 13 }}>{stamp(outcome.decidedAt)}</span>
        </div>

        {/*
          The previous verdict, because the demonstration is the contrast. One
          at a time, a policy that denies everything looks exactly like one
          that works.
        */}
        {prev && prev.verdict !== outcome.verdict && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ ...label(9), color: "rgba(27,27,27,0.62)" }}>Previous</span>
            <span style={{ fontSize: 13 }}>
              {prev.headline} · {short(prev.to)}
            </span>
          </div>
        )}

        {/*
          Absent when nothing was signed. A "view attestation" link on a run
          that produced no attestation points at a claim that does not exist.
        */}
        {outcome.explorerUrl && (
          <a
            href={outcome.explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="pe-dark"
            style={{
              marginLeft: "auto",
              height: 52,
              padding: "0 26px",
              borderRadius: R_PILL,
              display: "flex",
              alignItems: "center",
              gap: 10,
              ...label(10),
            }}
          >
            View attestation on the Newton explorer ↗
          </a>
        )}
      </div>
    </div>
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
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <span style={{ ...label(9), color: "rgba(27,27,27,0.62)" }}>{name}</span>
        {party && (
          <span
            style={{
              ...label(9),
              color: party.sanctioned ? INK : "rgba(27,27,27,0.5)",
              border: `1px solid ${party.sanctioned ? INK : "rgba(27,27,27,0.25)"}`,
              borderRadius: R_PILL,
              padding: "2px 8px",
            }}
          >
            {party.sanctioned ? "Designated" : "Clear"}
          </span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {/*
          Whole, not truncated. Two different addresses can share a prefix and
          a suffix, and this panel is the thing people screenshot as the
          record — an abbreviation in a compliance artifact is a hazard, not a
          tidiness.
        */}
        <span style={{ fontFamily: MONO, fontSize: 13, wordBreak: "break-all" }}>{address}</span>
        <button
          type="button"
          onClick={copy}
          className="pe-reset"
          title={address}
          style={{
            borderRadius: R_PILL,
            border: `1px solid rgba(27,27,27,0.3)`,
            padding: "4px 10px",
            ...label(9),
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

/* ── Evidence ───────────────────────────────────────────── */

function EvidenceBar(props: {
  open: "raw" | "policy" | "runs" | null;
  setOpen: (v: "raw" | "policy" | "runs" | null) => void;
  hasRun: boolean;
  raw: string;
  deployed: DeployedPolicy | null;
  deployedError: string | null;
  provider: { policyData?: string } | undefined;
  history: SharedRun[];
  historyError: string | null;
  showReset: boolean;
  onReset: () => void;
}) {
  const { open, setOpen, hasRun, raw, deployed, deployedError, provider, history, historyError, showReset, onReset } =
    props;

  const tab = (id: "raw" | "policy" | "runs", text: string, locked: boolean) => (
    <button
      type="button"
      aria-expanded={open === id}
      onClick={() => setOpen(open === id ? null : id)}
      className="pe-reset"
      style={{
        height: 48,
        padding: "0 20px",
        borderRadius: R_PILL,
        border: `1px solid ${open === id ? INK : "transparent"}`,
        background: open === id ? INK : FIELD,
        color: open === id ? "#fff" : locked ? MUTED : INK,
        ...label(10),
        display: "flex",
        alignItems: "center",
        gap: 10,
        transition: "background 0.18s ease, color 0.18s ease",
      }}
    >
      {text}
      {/* Locked tabs stay legible and say why, rather than ghosting out. */}
      <span style={{ ...label(9), color: open === id ? "rgba(255,255,255,0.6)" : MUTED_2, fontWeight: 500 }}>
        {locked ? "after a run" : open === id ? "−" : "+"}
      </span>
    </button>
  );

  return (
    <div
      style={{
        flexShrink: 0,
        background: SURFACE,
        border: `1px solid ${HAIRLINE}`,
        borderRadius: R_CARD,
        padding: 14,
      }}
    >
      {open && (
        <div className="pe-rise" style={{ marginBottom: 14, maxHeight: 200, overflow: "auto" }}>
          {open === "raw" && (
            <Mono text={hasRun ? raw : "No run yet. The gateway's verbatim response appears here."} />
          )}

          {open === "policy" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Rows
                rows={[
                  ["PolicyClient", process.env.NEXT_PUBLIC_POLICY_CLIENT ?? ""],
                  ["Policy", deployed?.policyAddress ?? ""],
                  ["Oracle", provider?.policyData ?? ""],
                ]}
              />
              <Mono
                text={
                  deployed?.source ??
                  (deployedError
                    ? `Couldn't fetch the deployed policy.\n\n${deployedError}\n\n` +
                      `This shows what the operators run, resolved from the chain. It does\n` +
                      `not fall back to the Rego this project composes locally — that is a\n` +
                      `different document, and the two have already drifted by two deny rules.`
                    : "Resolving from chain…")
                }
              />
            </div>
          )}

          {open === "runs" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {historyError && (
                <div style={{ fontSize: 13, color: ERROR }}>Couldn&rsquo;t read the chain: {historyError}</div>
              )}
              {!historyError && history.length === 0 && (
                <div style={{ fontSize: 13, color: MUTED }}>No runs on this client in the last ~3 hours.</div>
              )}
              {history.map((h) => (
                <a
                  key={h.taskId}
                  href={`https://explorer.newton.xyz/testnet/task/${h.taskId}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 14px",
                    borderRadius: R_INSET,
                    background: FIELD,
                  }}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      flexShrink: 0,
                      background: h.verdict === "allowed" ? PASS : h.verdict === "denied" ? FLAG : "transparent",
                      border: h.verdict === "pending" ? `1px solid ${MUTED_2}` : "none",
                    }}
                  />
                  <span style={{ fontFamily: MONO, fontSize: 12.5, color: BODY }}>
                    {h.sender ? `${short(h.sender)} → ${short(h.address)}` : short(h.address)}
                  </span>
                  <span
                    style={{
                      marginLeft: "auto",
                      ...label(9),
                      color: h.verdict === "allowed" ? PASS : h.verdict === "denied" ? FLAG : MUTED,
                    }}
                  >
                    {h.verdict === "allowed" ? "Compliant" : h.verdict === "denied" ? "Non Compliant" : "Awaiting"}
                  </span>
                  <span style={{ fontFamily: MONO, fontSize: 12, color: MUTED_2 }}>↗</span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="pe-evidence" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {tab("raw", "Operator response", !hasRun)}
        {tab("policy", "Deployed policy", false)}
        {tab("runs", "Earlier runs", false)}

        {showReset && (
          <button
            type="button"
            onClick={onReset}
            className="pe-reset pe-dark"
            style={{
              height: 48,
              padding: "0 22px",
              borderRadius: R_PILL,
              ...label(10),
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            New check ↻
          </button>
        )}

      </div>
    </div>
  );
}

function Rows({ rows }: { rows: [string, string][] }) {
  return (
    <div>
      {rows.map(([k, addr]) => (
        <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "5px 2px" }}>
          <span style={{ fontFamily: MONO, fontSize: 11.5, color: MUTED }}>{k}</span>
          {addr ? (
            <a
              href={`https://sepolia.etherscan.io/address/${addr}`}
              target="_blank"
              rel="noreferrer"
              style={{ fontFamily: MONO, fontSize: 11.5, textDecoration: "underline", textUnderlineOffset: 3 }}
            >
              {short(addr)} ↗
            </a>
          ) : (
            <span style={{ fontFamily: MONO, fontSize: 11.5, color: MUTED_2 }}>—</span>
          )}
        </div>
      ))}
    </div>
  );
}

function Mono({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* secure context only */
    }
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={copy}
        className="pe-reset"
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          borderRadius: R_PILL,
          border: `1px solid ${CONTROL}`,
          background: SURFACE,
          padding: "5px 11px",
          ...label(9),
          color: MUTED,
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <pre
        style={{
          margin: 0,
          background: FIELD,
          borderRadius: R_INSET,
          padding: 16,
          paddingTop: 34,
          fontFamily: MONO,
          fontSize: 11.5,
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          color: BODY,
        }}
      >
        {text}
      </pre>
    </div>
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
