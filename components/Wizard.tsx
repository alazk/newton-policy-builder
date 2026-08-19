"use client";

/**
 * Address in, verdict out.
 *
 * Deliberately narrow. Earlier versions offered a source picker, rule toggles
 * and a second "quick test" button; each was a decision the person looking at
 * this has no basis to make, and two of them changed nothing about the
 * on-chain result. What remains is the one action that produces a real,
 * quorum-signed answer.
 *
 * Layout and type are ported from the Policy Engine design file. The logic is
 * not: that file simulates verdicts. Every number here comes from an operator
 * evaluating the policy deployed on Sepolia.
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

type Outcome = {
  headline: string;
  eyebrow: string;
  reason: string;
  denies: string[];
  recipient: string;
  explorerUrl?: string | null;
  raw: unknown;
  tone: "ok" | "block";
};

type RunState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "result"; outcome: Outcome };

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
  const selection: Selection = {
    goalId: GOAL_ID,
    providerId,
    ruleIds,
    params: defaultParams(ruleIds),
  };
  const rego = useMemo(() => generateRego(selection), [providerId, ruleIds]);

  const [to, setTo] = useState("");
  const [run, setRun] = useState<RunState>({ status: "idle" });

  const valid = /^0x[a-fA-F0-9]{40}$/.test(to);
  const showInvalid = Boolean(to) && !valid;
  const busy = run.status === "running";

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
        setRun({
          status: "result",
          outcome: {
            headline: "Couldn't complete",
            eyebrow: "Error",
            reason: asText(json.error) || "The request failed before a decision was reached.",
            denies: [],
            recipient: to,
            raw: json.raw,
            tone: "block",
          },
        });
        return;
      }

      const allow = extractAllow(json.result);
      const denies = extractDenies(json.result);
      setRun({
        status: "result",
        outcome: {
          headline: allow === false ? "Non Compliant" : "Compliant",
          eyebrow: "Verified on-chain · quorum signed",
          reason:
            extractReason(json.result) ??
            (allow === false
              ? "This address appears on a sanctions list. An operator quorum evaluated the deployed policy and signed a denial."
              : "This address is not on any sanctions list the policy screens. An operator quorum evaluated the deployed policy and signed an approval."),
          denies,
          recipient: to,
          explorerUrl: json.explorerUrl ?? null,
          raw: json.result,
          tone: allow === false ? "block" : "ok",
        },
      });
    } catch (e) {
      setRun({
        status: "result",
        outcome: {
          headline: "Couldn't complete",
          eyebrow: "Error",
          reason: asText(e),
          denies: [],
          recipient: to,
          raw: null,
          tone: "block",
        },
      });
    }
  }

  return (
    <div
      style={{
        height: "100vh",
        overflow: "hidden",
        background: "#FDFCF7",
        color: "#000000",
        fontFamily: SERIF,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* ── Masthead ─────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 32,
          padding: "26px 48px",
          borderBottom: "3px solid #000000",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 46, lineHeight: 1, letterSpacing: "-0.02em" }}>
            Newton
          </div>
          <div
            style={{
              background: "#000000",
              color: "#FDFCF7",
              fontFamily: SANS,
              fontSize: 15,
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              padding: "10px 16px",
            }}
          >
            AML / OFAC Policy Engine
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 9, border: "2px solid #000000", padding: "7px 14px" }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#3F6F55",
              animation: "pulseDot 1.4s ease-in-out infinite",
            }}
          />
          <div style={{ fontFamily: SANS, fontSize: 11.5, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase" }}>
            Ethereum Sepolia
          </div>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: "minmax(0,1.02fr) minmax(0,1fr)",
          alignItems: "stretch",
        }}
      >
        {/* ── Left ───────────────────────────────────────────── */}
        <div style={{ padding: "44px 48px 60px", display: "flex", flexDirection: "column", gap: 42, overflowY: "auto" }}>
          {/*
            The source is stated, not chosen. With one provider a picker was
            asking for a decision with no basis behind it.
          */}
          <div style={{ border: "3px solid #000000", background: "#FDFCF7", padding: "18px 20px", display: "flex", flexDirection: "column", gap: 9 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 20, lineHeight: 1.15 }}>OpenSanctions</div>
              <div
                style={{
                  fontFamily: SANS,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  border: "1.5px solid #000000",
                  padding: "3px 7px",
                  whiteSpace: "nowrap",
                }}
              >
                Live
              </div>
            </div>
            <div style={{ fontSize: 15, lineHeight: 1.4, color: "#171714" }}>
              ~1,700 sanctioned wallets across OFAC, EU, UN and UK lists. Refreshed daily.
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <StepHead n="01">Recipient address</StepHead>

            <input
              value={to}
              onChange={(e) => {
                setTo(e.target.value.trim());
                setRun({ status: "idle" });
              }}
              spellCheck={false}
              placeholder="0x…"
              className="dc-input"
              style={{
                width: "100%",
                border: "3px solid #000000",
                background: "#FFFEFA",
                color: "#000000",
                fontFamily: MONO,
                fontSize: 16.5,
                letterSpacing: "-0.015em",
                padding: "16px 18px",
                outline: "none",
              }}
            />

            {showInvalid && <div style={{ fontSize: 14, color: "#8E2B1F" }}>Not a valid 20-byte address.</div>}

            <div style={{ fontSize: 14.5, color: "#5C5C55" }}>Or try one of these:</div>

            {/* Equal-width columns so neither option reads as the default. */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10 }}>
              <Shortcut
                active={to.toLowerCase() === CLEAN_TEST_ADDRESS.toLowerCase()}
                swatch="#3F6F55"
                label="An ordinary wallet"
                note="no sanctions history"
                onClick={() => {
                  setTo(CLEAN_TEST_ADDRESS);
                  setRun({ status: "idle" });
                }}
              />
              <Shortcut
                active={to.toLowerCase() === SANCTIONED_TEST_ADDRESS.toLowerCase()}
                swatch="#C2621A"
                label="A sanctioned wallet"
                note="on the US Treasury list"
                onClick={() => {
                  setTo(SANCTIONED_TEST_ADDRESS);
                  setRun({ status: "idle" });
                }}
              />
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <StepHead n="02">Verification</StepHead>

            <div
              onClick={() => !busy && valid && verify()}
              className={`dc-primary${!valid || busy ? " dc-disabled" : ""}`}
              style={{
                background: "#000000",
                color: "#FDFCF7",
                textAlign: "center",
                cursor: "pointer",
                fontFamily: SANS,
                fontSize: 14.5,
                fontWeight: 600,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                padding: "19px 24px",
              }}
            >
              Verify policy onchain
            </div>
          </div>
        </div>

        {/* ── Right ──────────────────────────────────────────── */}
        <div
          style={{
            borderLeft: "3px solid #000000",
            background: "#F7F4EA",
            padding: "44px 48px 60px",
            display: "flex",
            flexDirection: "column",
            gap: 26,
            overflowY: "auto",
          }}
        >
          {run.status === "idle" && (
            <div style={{ border: "3px solid #000000", background: "#FDFCF7", padding: "34px 34px 38px", display: "flex", flexDirection: "column", gap: 16 }}>
              <Eyebrow>Verdict</Eyebrow>
              <div style={{ fontFamily: DISPLAY, fontWeight: 300, fontSize: 52, lineHeight: 1.02, letterSpacing: "-0.02em" }}>
                No decision yet
              </div>
              <div style={{ fontSize: 16, lineHeight: 1.5, color: "#3A3A34", maxWidth: "44ch" }}>
                Enter an address and verify it. The policy is evaluated as a set of denials, so an
                unreachable data source produces a named refusal rather than a silent pass.
              </div>
            </div>
          )}

          {run.status === "running" && (
            <div style={{ border: "3px solid #000000", background: "#FDFCF7", padding: 34, display: "flex", flexDirection: "column", gap: 16 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  fontFamily: SANS,
                  fontSize: 11.5,
                  fontWeight: 700,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "#5C5C55",
                }}
              >
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#000000", animation: "pulseDot 1s ease-in-out infinite" }} />
                <div>Awaiting quorum</div>
              </div>
              <div style={{ fontFamily: DISPLAY, fontWeight: 300, fontSize: 52, lineHeight: 1.02, letterSpacing: "-0.02em" }}>
                Screening
              </div>
              <div style={{ fontFamily: MONO, fontSize: 12.5, color: "#5C5C55" }}>
                operators evaluating · signatures aggregating
              </div>
            </div>
          )}

          {run.status === "result" && (
            <div
              style={{
                border: "3px solid #000000",
                borderTop: `12px solid ${run.outcome.tone === "ok" ? "#3F6F55" : "#C2621A"}`,
                background: "#FDFCF7",
                padding: "30px 34px 34px",
                display: "flex",
                flexDirection: "column",
                gap: 14,
                animation: "fadeUp 0.24s ease-out both",
              }}
            >
              <div
                style={{
                  fontFamily: DISPLAY,
                  fontWeight: 700,
                  fontSize: 44,
                  lineHeight: 0.95,
                  letterSpacing: "-0.03em",
                  color: run.outcome.tone === "ok" ? "#2E5A44" : "#C2621A",
                }}
              >
                {run.outcome.headline}
              </div>
              <div style={{ fontSize: 16.5, lineHeight: 1.45, color: "#171714", maxWidth: "46ch" }}>
                {run.outcome.reason}
              </div>

              {run.outcome.denies.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 2 }}>
                  {run.outcome.denies.map((d) => (
                    <div key={d} style={{ fontFamily: MONO, fontSize: 12, border: "2px solid #C2621A", color: "#C2621A", padding: "5px 9px" }}>
                      {d}
                    </div>
                  ))}
                </div>
              )}

              {run.outcome.explorerUrl && (
                <a
                  href={run.outcome.explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    alignSelf: "flex-start",
                    background: "#000000",
                    color: "#FDFCF7",
                    fontFamily: SANS,
                    fontSize: 12.5,
                    fontWeight: 600,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    padding: "12px 16px",
                    marginTop: 4,
                  }}
                >
                  View on Newton Explorer ↗
                </a>
              )}
            </div>
          )}

          {/* Directly under the verdict, not pinned to the bottom — the rail
              is taller than the content and the gap read as a mistake. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            <Expander label="Raw operator response +" disabled={run.status !== "result"}>
              <pre
                style={{
                  margin: "12px 0 0",
                  maxHeight: 220,
                  overflow: "auto",
                  border: "2px solid #000000",
                  background: "#FFFEFA",
                  padding: 14,
                  fontFamily: MONO,
                  fontSize: 11.5,
                  lineHeight: 1.55,
                  whiteSpace: "pre-wrap",
                }}
              >
                {run.status === "result" ? asText(run.outcome.raw) : ""}
              </pre>
            </Expander>

            <Expander label="Policy source +">
              <div style={{ padding: "4px 0" }}>
                {(
                  [
                    ["PolicyClient", shortAddr(process.env.NEXT_PUBLIC_POLICY_CLIENT ?? "")],
                    ["Oracle", provider?.policyData ? shortAddr(provider.policyData) : "params only"],
                    ["Reads", `${provider?.dataPath}.*`],
                  ] as [string, string][]
                ).map(([k, v]) => (
                  <div key={k} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 18, padding: "8px 0" }}>
                    <div style={{ fontFamily: MONO, fontSize: 11.5, color: "#5C5C55", whiteSpace: "nowrap" }}>{k}</div>
                    <div style={{ fontFamily: MONO, fontSize: 11.5, color: "#171714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {v}
                    </div>
                  </div>
                ))}
              </div>
              <pre
                style={{
                  margin: "8px 0 0",
                  maxHeight: 230,
                  overflow: "auto",
                  border: "2px solid #000000",
                  background: "#FFFEFA",
                  padding: 16,
                  fontFamily: MONO,
                  fontSize: 11.5,
                  lineHeight: 1.6,
                  whiteSpace: "pre",
                }}
              >
                {rego}
              </pre>
            </Expander>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Pieces ────────────────────────────────────────────────── */

function Expander({
  label,
  children,
  disabled,
}: {
  label: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <details style={{ borderTop: "1px solid rgba(0,0,0,0.16)", padding: "14px 0", opacity: disabled ? 0.4 : 1, pointerEvents: disabled ? "none" : "auto" }}>
      <summary
        style={{
          cursor: "pointer",
          fontFamily: SANS,
          fontSize: 11.5,
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

function StepHead({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
      <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 20, lineHeight: 1 }}>{n}</div>
      <div style={{ fontFamily: SANS, fontSize: 12.5, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase" }}>
        {children}
      </div>
      <div style={{ flex: 1, height: 2, background: "#000000", opacity: 0.14 }} />
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: SANS, fontSize: 11.5, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#5C5C55" }}>
      {children}
    </div>
  );
}

function Shortcut({
  active,
  swatch,
  label,
  note,
  onClick,
}: {
  active: boolean;
  swatch: string;
  label: string;
  note: string;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className="dc-hover"
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 9,
        border: "2px solid #000000",
        padding: "11px 13px",
        cursor: "pointer",
        minWidth: 0,
      }}
    >
      <div
        style={{
          width: 9,
          height: 9,
          flexShrink: 0,
          alignSelf: "center",
          background: active ? swatch : "transparent",
          border: active ? "none" : "1.5px solid #5C5C55",
        }}
      />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14.5 }}>{label}</div>
        {/* Stacked rather than inline: side by side the two cards are narrow,
            and the qualifier is the part that gets truncated first. */}
        <div style={{ fontSize: 13.5, color: "#5C5C55" }}>{note}</div>
      </div>
    </div>
  );
}

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
