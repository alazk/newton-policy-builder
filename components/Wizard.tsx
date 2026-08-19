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

  // Unselected by default, so the first step is something the user does
  // rather than something already done for them. The Verify button stays
  // disabled until a policy is chosen.
  const [policySelected, setPolicySelected] = useState(false);

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
      className="dc-page"
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
        className="dc-mast"
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
          {/*
            The real mark, not Georgia standing in for GT Sectra. Plain <img>
            rather than next/image: it is a fixed-size decorative logo, so the
            optimisation pipeline buys nothing and adds a dependency on the
            image loader working in every deploy target.
          */}
          <img
            src="/newton-logo.svg"
            alt="Newton"
            style={{ height: 26, width: "auto", display: "block" }}
          />
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
        className="dc-split"
        style={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: "minmax(0,1.02fr) minmax(0,1fr)",
          alignItems: "stretch",
        }}
      >
        {/* ── Left ───────────────────────────────────────────── */}
        {/* No scroll: the left side is meant to fit on one screen. If content
            ever outgrows it, tighten the content rather than restoring the
            scrollbar — a three-step flow that scrolls stops reading as three
            steps. */}
        <div className="dc-pad" style={{ padding: "40px 48px 48px", display: "flex", flexDirection: "column", gap: 34 }}>
          {/*
            The policy comes first, not the address.

            The page used to open on an input box, which framed this as "look
            up an address" — a lookup tool. It isn't: a policy module is being
            applied, and the address is that module's input. Leading with the
            module, tagged Deployed and footed Applied, makes the relationship
            legible without adding anything to click.
          */}
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <StepHead n="01">Select a policy</StepHead>

            {/*
              Clickable, and selected by default. There is one policy, so the
              click changes nothing — but a card that responds to being pressed
              reads as a choice you have made rather than a banner you have
              been shown, which is the distinction that matters here.
            */}
            {/*
              Selection inverts the whole card, not just the foot. A small
              state change on a large element is easy to miss, and this is the
              step that gates the rest of the page — if it doesn't read as
              selected, the disabled Verify button looks broken instead of
              waiting.
            */}
            <button
              type="button"
              aria-pressed={policySelected}
              onClick={() => setPolicySelected((v) => !v)}
              className={`dc-reset${policySelected ? "" : " dc-hover"}`}
              style={{
                border: "3px solid #000000",
                background: policySelected ? "#000000" : "#FDFCF7",
                color: policySelected ? "#FDFCF7" : "#000000",
                display: "flex",
                flexDirection: "column",
                cursor: "pointer",
              }}
            >
              <div style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 22, lineHeight: 1.1 }}>
                  Sanctions Screening
                </div>

                {/*
                  Recipient, not "either party".

                  The deployed policy does screen the sender too, and that is
                  verified — but this page always sends the same clean sender,
                  so nothing here exercises it. Claiming both would describe
                  the policy rather than what this interface does.
                */}
                <div style={{ fontSize: 15, lineHeight: 1.45, color: policySelected ? "#FDFCF7" : "#171714" }}>
                  Blocks a transaction if the recipient appears on a sanctions list.
                </div>
              </div>

              <div
                style={{
                  // Inverted against an inverted card: a light bar on black.
                  background: policySelected ? "#FDFCF7" : "transparent",
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

          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <StepHead n="02">Add a recipient</StepHead>


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
                label="Ordinary wallet"
                onClick={() => {
                  setTo(CLEAN_TEST_ADDRESS);
                  setRun({ status: "idle" });
                }}
              />
              <Shortcut
                active={to.toLowerCase() === SANCTIONED_TEST_ADDRESS.toLowerCase()}
                label="Sanctioned wallet"
                onClick={() => {
                  setTo(SANCTIONED_TEST_ADDRESS);
                  setRun({ status: "idle" });
                }}
              />
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <StepHead n="03">Enforcement</StepHead>

            <button
              type="button"
              onClick={verify}
              disabled={!valid || busy || !policySelected}
              // Deselecting the policy disables enforcement. Otherwise the
              // selection would be decorative, which is worse than not
              // offering it.
              // Pulses only while it is ready and unused — once there is a
              // verdict on screen the prompt has done its job and becomes
              // noise.
              className={`dc-reset dc-primary${
                !valid || busy || !policySelected
                  ? " dc-disabled"
                  : run.status === "idle"
                    ? " dc-ready"
                    : ""
              }`}
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
            </button>

            {/*
              Say what is missing. A greyed primary button with no explanation
              reads as broken rather than waiting, and on first load both
              prerequisites are unmet.
            */}
            {(!policySelected || !valid) && !busy && (
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
          className="dc-rail dc-pad dc-scroll"
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
          {/*
            The panel is never empty.

            It used to show "No decision yet" — a large card whose only job was
            to say nothing had happened, leaving half the screen as a waiting
            room. Now it states the decision that is ABOUT to be made, in the
            same shape the verdict will take, so pressing the button fills the
            card in rather than replacing a placeholder. The facts underneath
            stay put across all three states.
          */}
          {run.status !== "result" && (
            <div
              style={{
                border: "3px solid #000000",
                borderTop: "12px solid rgba(0,0,0,0.16)",
                background: "#FDFCF7",
                padding: "30px 34px 34px",
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
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
                {busy && (
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#000000", animation: "pulseDot 1s ease-in-out infinite" }} />
                )}
                <div>{busy ? "Awaiting quorum" : "Pending decision"}</div>
              </div>

              <div
                style={{
                  fontFamily: DISPLAY,
                  fontWeight: 300,
                  fontSize: 44,
                  lineHeight: 1.02,
                  letterSpacing: "-0.02em",
                  color: busy ? "#000000" : "#5C5C55",
                }}
              >
                {busy ? "Screening" : "Not yet decided"}
              </div>

              {busy && (
                <div style={{ fontSize: 16, lineHeight: 1.45, color: "#3A3A34", maxWidth: "46ch" }}>
                  Independent operators are each evaluating the policy and signing their result.
                  The signatures are being aggregated.
                </div>
              )}
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

          {/*
            What is being checked, stated before the run and unchanged after
            it. Constant across states so the panel reads as one continuous
            thing filling in, rather than three cards swapping places.
          */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <Fact k="Policy" v={policySelected ? "Sanctions Screening" : "None selected"} />
            <Fact k="Lists" v="OFAC · EU · UN · UK" />
            <Fact k="Address" v={to ? shortAddr(to) : "Not entered"} mono />
          </div>

          {/* Directly under the facts, not pinned to the bottom — the rail is
              taller than the content and the gap read as a mistake. */}
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
                    [
                      "PolicyClient",
                      shortAddr(process.env.NEXT_PUBLIC_POLICY_CLIENT ?? ""),
                      process.env.NEXT_PUBLIC_POLICY_CLIENT ?? "",
                    ],
                    [
                      "Oracle",
                      provider?.policyData ? shortAddr(provider.policyData) : "params only",
                      provider?.policyData ?? "",
                    ],
                    ["Reads", `${provider?.dataPath}.*`, ""],
                  ] as [string, string, string][]
                ).map(([k, v, addr]) => (
                  <div key={k} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 18, padding: "8px 0" }}>
                    <div style={{ fontFamily: MONO, fontSize: 11.5, color: "#5C5C55", whiteSpace: "nowrap" }}>{k}</div>
                    {/*
                      Linked to Etherscan where there is a contract behind it.
                      "Deployed" is the strongest claim this page makes and it
                      was previously unverifiable text — one click to check it
                      is worth more than another sentence asserting it.
                    */}
                    {addr ? (
                      <a
                        href={`https://sepolia.etherscan.io/address/${addr}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          fontFamily: MONO,
                          fontSize: 11.5,
                          color: "#171714",
                          textDecoration: "underline",
                          textUnderlineOffset: 3,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {v} ↗
                      </a>
                    ) : (
                      <div style={{ fontFamily: MONO, fontSize: 11.5, color: "#171714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {v}
                      </div>
                    )}
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

/** A row in the persistent "what is being checked" block. */
function Fact({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 20,
        padding: "11px 0",
        borderBottom: "1px solid rgba(0,0,0,0.16)",
      }}
    >
      <div
        style={{
          fontFamily: SANS,
          fontSize: 10.5,
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
          fontFamily: mono ? MONO : SERIF,
          fontSize: mono ? 12.5 : 14,
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

/** A labelled fact about the policy module. `inv` for the selected (black) card. */
function Attr({ k, v, inv }: { k: string; v: string; inv?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 10, fontSize: 13.5, lineHeight: 1.4 }}>
      <div style={{ color: inv ? "rgba(253,252,247,0.55)" : "#5C5C55", minWidth: 92, flexShrink: 0 }}>{k}</div>
      <div style={{ color: inv ? "#FDFCF7" : "#171714" }}>{v}</div>
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

/**
 * Selection is shown by inverting the card rather than by a swatch. With no
 * subtitle there is nothing for a marker to sit against, and a lone square
 * beside two words reads as a checkbox nobody asked for.
 */
function Shortcut({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`dc-reset${active ? "" : " dc-hover"}`}
      style={{
        // 3px when active, matching the policy card's frame weight, so the
        // selected state is visible from the border as well as the fill.
        border: active ? "3px solid #000000" : "2px solid #000000",
        background: active ? "#000000" : "transparent",
        color: active ? "#FDFCF7" : "#000000",
        padding: active ? "12px 15px" : "13px 16px",
        cursor: "pointer",
        textAlign: "center",
        fontSize: 15,
        fontWeight: active ? 700 : 400,
      }}
    >
      {label}
    </button>
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
