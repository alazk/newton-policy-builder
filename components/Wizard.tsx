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

import { useMemo, useState } from "react";
import {
  GOALS,
  PROVIDERS,
  RULES,
  generateRego,
  defaultParams,
  rulesForProvider,
  SANCTIONED_TEST_ADDRESS,
  CLEAN_TEST_ADDRESS,
  type Selection,
} from "@/lib/catalog";

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
const CARD_H = 178;

type Outcome = {
  headline: string;
  reason: string;
  denies: string[];
  explorerUrl?: string | null;
  evidence: [string, string][];
  raw: unknown;
  tone: "ok" | "block" | "error";
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
  const [run, setRun] = useState<RunState>({ status: "idle" });

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

  function failWith(reason: string, raw: unknown) {
    setRun({
      status: "result",
      outcome: { headline: "Couldn't complete", reason, denies: [], evidence: [], raw, tone: "error" },
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

      const allow = extractAllow(json.result);
      setRun({
        status: "result",
        outcome: {
          headline: allow === false ? "Non Compliant" : "Compliant",
          reason: extractReason(json.result) ?? "",
          denies: extractDenies(json.result),
          explorerUrl: json.explorerUrl ?? null,
          evidence: extractEvidence(json.result),
          raw: json.result,
          tone: allow === false ? "block" : "ok",
        },
      });
    } catch (e) {
      failWith(asText(e), null);
    }
  }

  const ruleColor = (t: Outcome["tone"]) => (t === "ok" ? "#3F6F55" : "#C2621A");
  const typeColor = (t: Outcome["tone"]) => (t === "ok" ? "#2E5A44" : "#C2621A");

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
          gap: 32,
          padding: "20px 48px",
          borderBottom: "3px solid #000000",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
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
        <div style={{ display: "flex", alignItems: "center", gap: 9, border: "2px solid #000000", padding: "6px 13px" }}>
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
            padding: "32px 48px 36px",
            display: "flex",
            flexDirection: "column",
            gap: 24,
            overflowY: "auto",
            transition: "max-width 0.45s ease",
          }}
        >
          {/* 01 — the policy, before the address. The address is this
              module's input, not the subject of the page. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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
                border: "3px solid #000000",
                background: policySelected ? "#000000" : "#FAF9F6",
                color: policySelected ? "#FAF9F6" : "#000000",
                display: "flex",
                flexDirection: "column",
                cursor: "pointer",
                minHeight: CARD_H,
              }}
            >
              <div style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
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
                  borderTop: policySelected ? "none" : "1px solid rgba(0,0,0,0.16)",
                  fontFamily: SANS,
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  padding: "8px 22px",
                }}
              >
                {policySelected ? "Applied" : "Select"}
              </div>
            </button>
          </div>

          {/* 02 — recipient */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <StepHead n="02">Add a recipient</StepHead>

            <input
              value={to}
              onChange={(e) => {
                setTo(e.target.value.trim());
                invalidate();
              }}
              spellCheck={false}
              placeholder="0x…"
              className="dc-input"
              style={{
                width: "100%",
                border: "3px solid #000000",
                background: "#FFFFFF",
                color: "#000000",
                fontFamily: MONO,
                fontSize: 16,
                letterSpacing: "-0.015em",
                padding: "15px 18px",
                outline: "none",
              }}
            />

            {showInvalid && <div style={{ fontSize: 14, color: "#8E2B1F" }}>Not a valid 20-byte address.</div>}

            <div style={{ fontSize: 14.5, color: "#5C5C55" }}>Or try one of these:</div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10 }}>
              <Shortcut
                active={to.toLowerCase() === CLEAN_TEST_ADDRESS.toLowerCase()}
                label="Ordinary wallet"
                onClick={() => {
                  setTo(CLEAN_TEST_ADDRESS);
                  invalidate();
                }}
              />
              <Shortcut
                active={to.toLowerCase() === SANCTIONED_TEST_ADDRESS.toLowerCase()}
                label="Sanctioned wallet"
                onClick={() => {
                  setTo(SANCTIONED_TEST_ADDRESS);
                  invalidate();
                }}
              />
            </div>
          </div>

          {/* The action. No step number: the other two are decisions, this is
              what they lead to. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button
              type="button"
              onClick={verify}
              disabled={!ready}
              className={`dc-reset dc-primary${!ready ? " dc-disabled" : run.status === "idle" ? " dc-ready" : ""}`}
              style={{
                background: "#000000",
                color: "#FAF9F6",
                textAlign: "center",
                cursor: "pointer",
                fontFamily: SANS,
                fontSize: 14,
                fontWeight: 600,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                padding: "17px 24px",
              }}
            >
              Verify policy onchain
            </button>

            {/* A greyed primary button with no explanation reads as broken
                rather than waiting. */}
            {!ready && !busy && (
              <div style={{ fontSize: 14, color: "#5C5C55" }}>
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
        <div
          className="dc-rail dc-pad"
          aria-hidden={!split}
          style={{
            width: split ? "50%" : 0,
            flexShrink: 0,
            overflow: "hidden",
            // Single property so nothing overrides it: with border-box a
            // zero-width element still renders its padding, which showed as a
            // sliver down the right edge.
            padding: split ? "32px 48px 36px" : 0,
            borderLeft: `${split ? 3 : 0}px solid #000000`,
            transition: "width 0.45s ease, padding 0.45s ease, border-left-width 0.45s ease",
            background: "#FAF9F6",
            display: "flex",
            flexDirection: "column",
            gap: 20,
          }}
        >
          {/* An invisible copy of the step header opposite, so the two columns
              align by construction rather than by a computed offset. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div aria-hidden style={{ visibility: "hidden" }}>
              <StepHead n="00">Spacer</StepHead>
            </div>

            {run.status !== "result" ? (
              <div
                style={{
                  border: "3px solid #000000",
                  background: "#FAF9F6",
                  padding: "22px 26px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  gap: 10,
                  minHeight: CARD_H,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
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
            ) : (
              <div
                style={{
                  border: "3px solid #000000",
                  borderTop: `12px solid ${ruleColor(run.outcome.tone)}`,
                  background: "#FAF9F6",
                  padding: "20px 26px 24px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  minHeight: CARD_H,
                  animation: "fadeUp 0.24s ease-out both",
                  // Faded, not removed: the verdict was real, it just no
                  // longer describes what is in the form.
                  opacity: run.stale ? 0.4 : 1,
                  transition: "opacity 0.2s ease",
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
                    color: typeColor(run.outcome.tone),
                  }}
                >
                  {run.outcome.headline}
                </div>

                {/* Prose only where it is the sole explanation. For a verdict
                    the headline says it, and the deny chip says why. */}
                {run.outcome.tone === "error" && (
                  <div style={{ fontSize: 14.5, lineHeight: 1.45, color: "#171714", maxWidth: "44ch" }}>
                    {run.outcome.reason}
                  </div>
                )}

                {run.outcome.denies.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                    {run.outcome.denies.map((d) => (
                      <span
                        key={d}
                        style={{
                          fontFamily: MONO,
                          fontSize: 11.5,
                          border: `2px solid ${typeColor(run.outcome.tone)}`,
                          color: typeColor(run.outcome.tone),
                          padding: "4px 8px",
                        }}
                      >
                        {d}
                      </span>
                    ))}
                  </div>
                )}

                {run.outcome.explorerUrl && (
                  <a
                    href={run.outcome.explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      marginTop: "auto",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      background: "#000000",
                      color: "#FAF9F6",
                      fontFamily: SANS,
                      fontSize: 11.5,
                      fontWeight: 600,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      padding: "12px 16px",
                    }}
                  >
                    <span>View attestation</span>
                    <span aria-hidden style={{ letterSpacing: 0 }}>
                      Newton Explorer ↗
                    </span>
                  </a>
                )}
              </div>
            )}
          </div>

          {/* Evidence, not a restatement. These come from the operator
              response and exist nowhere else on the page. */}
          {run.status === "result" && run.outcome.evidence.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {run.outcome.evidence.map(([k, v]) => (
                <Fact key={k} k={k} v={v} />
              ))}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column" }}>
            <Expander label="Raw operator response +" disabled={run.status !== "result"}>
              <CodeBlock text={run.status === "result" ? asText(run.outcome.raw) : ""} wrap />
            </Expander>

            <Expander label="Policy source +">
              <div style={{ padding: "2px 0" }}>
                {(
                  [
                    ["PolicyClient", process.env.NEXT_PUBLIC_POLICY_CLIENT ?? ""],
                    ["Oracle", provider?.policyData ?? ""],
                  ] as [string, string][]
                ).map(([k, addr]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 18, padding: "6px 0" }}>
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
              </div>
              <CodeBlock text={rego} />
            </Expander>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Pieces ────────────────────────────────────────────────── */

function StepHead({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
      <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 19, lineHeight: 1 }}>{n}</div>
      <div style={{ fontFamily: SANS, fontSize: 12, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase" }}>
        {children}
      </div>
      <div style={{ flex: 1, height: 2, background: "#000000", opacity: 0.14 }} />
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

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 20,
        padding: "8px 0",
        // No rule of its own: the expander below already draws one, and two
        // hairlines a few pixels apart read as a mistake.
      }}
    >
      <div
        style={{
          fontFamily: SANS,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.13em",
          textTransform: "uppercase",
          color: "#5C5C55",
          whiteSpace: "nowrap",
        }}
      >
        {k}
      </div>
      <div
        style={{
          fontFamily: MONO,
          fontSize: 12,
          color: "#171714",
          textAlign: "right",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {v}
      </div>
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
        border: "2px solid #000000",
        background: active ? "#000000" : "transparent",
        color: active ? "#FAF9F6" : "#000000",
        padding: "12px 16px",
        cursor: "pointer",
        textAlign: "center",
        fontSize: 14.5,
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
function CodeBlock({ text, wrap }: { text: string; wrap?: boolean }) {
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
    <div style={{ position: "relative", marginTop: 8 }}>
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
          border: "2px solid #000000",
          background: "#FFFFFF",
          padding: 13,
          paddingTop: 30,
          fontFamily: MONO,
          fontSize: 11,
          lineHeight: 1.55,
          whiteSpace: wrap ? "pre-wrap" : "pre",
        }}
      >
        {text}
      </pre>
    </div>
  );
}

function Expander({ label, children, disabled }: { label: string; children: React.ReactNode; disabled?: boolean }) {
  return (
    <details
      style={{
        borderTop: "1px solid rgba(0,0,0,0.16)",
        padding: "10px 0",
        opacity: disabled ? 0.4 : 1,
        pointerEvents: disabled ? "none" : "auto",
      }}
    >
      <summary
        style={{
          cursor: "pointer",
          fontFamily: SANS,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.13em",
          textTransform: "uppercase",
          color: "#5C5C55",
        }}
      >
        {label}
      </summary>
      {children}
    </details>
  );
}

/* ── Reading the operator response ─────────────────────────── */

/**
 * The decision lives at evaluation_result.result. Returning undefined rather
 * than false matters: an unparseable response is not a denial, and rendering
 * it as one would be a lie in the direction that looks safe.
 */
function extractAllow(result: any): boolean | undefined {
  const er = result?.evaluation_result;
  if (typeof er?.result === "boolean") return er.result;
  if (typeof er?.result?.allow === "boolean") return er.result.allow;
  if (typeof result?.result?.allow === "boolean") return result.result.allow;
  if (typeof result?.allow === "boolean") return result.allow;
  if (typeof result?.result === "boolean") return result.result;
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
