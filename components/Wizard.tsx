"use client";

/**
 * The Policy Engine design, wired to real evaluation.
 *
 * Markup and inline styles are copied from the design file so the layout,
 * type scale and spacing match exactly. What is NOT copied is its logic: that
 * file simulates verdicts with a latency slider and a hardcoded answer for one
 * address. Here every decision comes from a Newton operator evaluating the
 * policy actually deployed on Sepolia.
 *
 * That distinction matters more than usual in this app. A screening tool that
 * fakes results looks identical to one that works — and this project already
 * lost a day to a policy that denied everything while appearing correct,
 * because the only address anyone tested was one that ought to be denied.
 */

import { useMemo, useState } from "react";
import {
  GOALS,
  PROVIDERS,
  RULES,
  generateRego,
  collectParams,
  defaultParams,
  rulesForProvider,
  SANCTIONED_TEST_ADDRESS,
  CLEAN_TEST_ADDRESS,
  type Selection,
} from "@/lib/catalog";

const GOAL_ID = Object.keys(GOALS)[0];

/* Type stacks, matching the design file's declarations. */
const DISPLAY = "'GT Sectra Display',Georgia,serif";
const SERIF = "'GT Sectra',Georgia,serif";
const SANS = "-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,monospace";

type Outcome = {
  allow: boolean | null;
  headline: string;
  eyebrow: string;
  reason: string;
  denies: string[];
  meta: [string, string][];
  explorerUrl?: string | null;
  raw: unknown;
  tone: "ok" | "block";
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string; detail: string }
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
  const first = goal.providers[0];

  const [providerId, setProviderId] = useState(first);
  const [ruleIds, setRuleIds] = useState<string[]>(() =>
    rulesForProvider(GOAL_ID, first).filter((r) => RULES[r]?.defaultOn),
  );
  const [params, setParams] = useState<Record<string, unknown>>(() =>
    defaultParams(rulesForProvider(GOAL_ID, first).filter((r) => RULES[r]?.defaultOn)),
  );
  const [to, setTo] = useState(CLEAN_TEST_ADDRESS);
  const [run, setRun] = useState<RunState>({ status: "idle" });

  const provider = PROVIDERS[providerId];
  const selection: Selection = { goalId: GOAL_ID, providerId, ruleIds, params };
  const rego = useMemo(() => generateRego(selection), [providerId, ruleIds]);
  const effectiveParams = useMemo(() => collectParams(selection), [ruleIds, params]);

  const valid = /^0x[a-fA-F0-9]{40}$/.test(to);
  const showInvalid = Boolean(to) && !valid;
  const busy = run.status === "running";

  function pickProvider(pid: string) {
    const defaults = rulesForProvider(GOAL_ID, pid).filter((r) => RULES[r]?.defaultOn);
    setProviderId(pid);
    setRuleIds(defaults);
    setParams(defaultParams(defaults));
    setRun({ status: "idle" });
  }

  function fail(reason: string, raw: unknown, mode: string, secs: number | null) {
    setRun({
      status: "result",
      outcome: {
        allow: null,
        headline: "Couldn't complete",
        eyebrow: "Error",
        reason,
        denies: [],
        meta: metaRows(mode, secs),
        raw,
        tone: "block",
      },
    });
  }

  function metaRows(mode: string, secs: number | null, denies: string[] = []): [string, string][] {
    return [
      ["Mode", mode],
      ["Source", provider?.name ?? "—"],
      ["Recipient", shortAddr(to)],
      ["Deny set", denies.length ? JSON.stringify(denies) : "[]"],
      ["Latency", secs != null ? `${secs.toFixed(2)}s` : "—"],
    ];
  }

  async function doRun() {
    setRun({ status: "running", label: "Quick test", detail: `newt_simulatePolicy · ${provider?.dataPath}` });
    const t0 = performance.now();
    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rego, params: effectiveParams, policyDataAddress: provider.policyData, to }),
      });
      const json = await res.json();
      const secs = (performance.now() - t0) / 1000;

      if (!res.ok || json.ok === false)
        return fail(asText(json.error) || "Request failed", json.raw, "newt_simulatePolicy · 1 operator", secs);
      if (json.result?.success === false || json.result?.error)
        return fail(asText(json.result.error), json.result, "newt_simulatePolicy · 1 operator", secs);

      const allow = extractAllow(json.result);
      if (allow === undefined)
        return fail("Couldn't find the decision in the response.", json.result, "newt_simulatePolicy · 1 operator", secs);

      const denies = extractDenies(json.result);
      setRun({
        status: "result",
        outcome: {
          allow,
          headline: allow ? "Compliant" : "Non Compliant",
          eyebrow: "Quick test · nothing recorded",
          reason:
            extractReason(json.result) ??
            (allow
              ? `No deny rule fired. Screened against ${provider?.name} via ${provider?.dataPath}.`
              : `The policy produced at least one denial. Screened against ${provider?.name}.`),
          denies,
          meta: metaRows("newt_simulatePolicy · 1 operator", secs, denies),
          raw: json.result,
          tone: allow ? "ok" : "block",
        },
      });
    } catch (e) {
      fail(asText(e), null, "newt_simulatePolicy · 1 operator", null);
    }
  }

  async function doSubmit() {
    setRun({ status: "running", label: "Screen on-chain", detail: "newt_createTask · BLS aggregation" });
    const t0 = performance.now();
    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "submit",
          to,
          policyDataAddress: provider.policyData,
          // Routes to this provider's own PolicyClient. Without it every
          // submit lands on one client, and the verdict belongs to whichever
          // policy that client has bound rather than the one on screen.
          providerId,
        }),
      });
      const json = await res.json();
      const secs = (performance.now() - t0) / 1000;

      if (!res.ok || json.ok === false)
        return fail(asText(json.error) || "Submit failed", json.raw, "newt_createTask · quorum", secs);

      const allow = extractAllow(json.result);
      const denies = extractDenies(json.result);
      setRun({
        status: "result",
        outcome: {
          allow: allow ?? null,
          headline: allow === false ? "Non Compliant" : "Compliant",
          eyebrow: "Screened on-chain · quorum signed",
          reason:
            extractReason(json.result) ??
            (allow === false
              ? "An operator quorum evaluated the deployed policy and signed a denial."
              : "An operator quorum evaluated the deployed policy and signed an approval."),
          denies,
          meta: metaRows("newt_createTask · quorum", secs, denies),
          explorerUrl: json.explorerUrl ?? null,
          raw: json.result,
          tone: allow === false ? "block" : "ok",
        },
      });
    } catch (e) {
      fail(asText(e), null, "newt_createTask · quorum", null);
    }
  }

  const network = "Ethereum Sepolia";

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
            {network} · Operator quorum live
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
        {/* ── Left column ────────────────────────────────────── */}
        <div style={{ padding: "44px 48px 60px", display: "flex", flexDirection: "column", gap: 42, overflowY: "auto" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <StepHead n="01">Screening source</StepHead>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 14 }}>
              {goal.providers.map((pid) => {
                const p = PROVIDERS[pid];
                const active = pid === providerId;
                return (
                  <div
                    key={pid}
                    onClick={() => pickProvider(pid)}
                    className="dc-hover"
                    style={{
                      border: "3px solid #000000",
                      background: "#FDFCF7",
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                    }}
                  >
                    <div style={{ padding: "18px 20px 20px", display: "flex", flexDirection: "column", gap: 9, flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 20, lineHeight: 1.15 }}>
                          {pid === "yente" ? "OpenSanctions" : "Denylist"}
                        </div>
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
                          {pid === "yente" ? "Live" : "Snapshot"}
                        </div>
                      </div>
                      <div style={{ fontSize: 15, lineHeight: 1.4, color: "#171714" }}>
                        {pid === "yente"
                          ? "~1,700 wallets across OFAC, EU, UN and UK lists. Refreshed daily."
                          : "93 OFAC addresses carried in the policy params. No oracle call."}
                      </div>
                      <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "-0.01em", color: "#5C5C55", marginTop: "auto" }}>
                        {p?.dataPath}
                      </div>
                    </div>
                    {active && (
                      <div
                        style={{
                          background: "#000000",
                          color: "#FDFCF7",
                          fontFamily: SANS,
                          fontSize: 10.5,
                          fontWeight: 700,
                          letterSpacing: "0.14em",
                          textTransform: "uppercase",
                          padding: "8px 20px",
                        }}
                      >
                        Selected
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <StepHead n="02">Recipient address</StepHead>

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

            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <Shortcut
                active={to.toLowerCase() === CLEAN_TEST_ADDRESS.toLowerCase()}
                swatch="#3F6F55"
                label="Clean wallet"
                note="not on any list"
                onClick={() => {
                  setTo(CLEAN_TEST_ADDRESS);
                  setRun({ status: "idle" });
                }}
              />
              <Shortcut
                active={to.toLowerCase() === SANCTIONED_TEST_ADDRESS.toLowerCase()}
                swatch="#C2621A"
                label="OFAC SDN"
                note="both sources block"
                onClick={() => {
                  setTo(SANCTIONED_TEST_ADDRESS);
                  setRun({ status: "idle" });
                }}
              />
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <StepHead n="03">Decision</StepHead>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <div
                onClick={() => !busy && valid && provider?.submittable && doSubmit()}
                className={`dc-primary${!valid || busy || !provider?.submittable ? " dc-disabled" : ""}`}
                style={{
                  flex: 1,
                  minWidth: 220,
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
                Screen on-chain
              </div>
              <div
                onClick={() => !busy && valid && doRun()}
                className={`dc-hover${!valid || busy ? " dc-disabled" : ""}`}
                style={{
                  minWidth: 180,
                  border: "3px solid #000000",
                  textAlign: "center",
                  cursor: "pointer",
                  fontFamily: SANS,
                  fontSize: 14.5,
                  fontWeight: 600,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  padding: "16px 24px",
                }}
              >
                Quick test
              </div>
            </div>

            <div style={{ fontSize: 15, lineHeight: 1.5, color: "#3A3A34", maxWidth: "52ch" }}>
              <span style={{ fontFamily: SERIF, fontWeight: 700, color: "#000000" }}>Screen on-chain</span> submits a
              real task: an operator quorum evaluates the deployed policy and signs the result.{" "}
              <span style={{ fontFamily: SERIF, fontWeight: 700, color: "#000000" }}>Quick test</span> asks a single
              operator and records nothing.
            </div>

            {!provider?.submittable && (
              // A PolicyClient binds one policy. Submitting under a provider
              // without its own client would evaluate a different policy and
              // report the answer as though it came from this one.
              <div
                style={{
                  borderLeft: "3px solid #C2621A",
                  background: "#FBF3E9",
                  padding: "12px 16px",
                  fontSize: 14,
                  lineHeight: 1.5,
                  color: "#3A3A34",
                  maxWidth: "52ch",
                }}
              >
                This source has no PolicyClient deployed, so it can only be tested. A real submission would evaluate a
                different policy and label the result as this one.
              </div>
            )}
          </div>
        </div>

        {/* ── Right column ───────────────────────────────────── */}
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
            <div
              style={{
                border: "3px solid #000000",
                background: "#FDFCF7",
                padding: "34px 34px 38px",
                display: "flex",
                flexDirection: "column",
                gap: 16,
              }}
            >
              <Eyebrow>Verdict</Eyebrow>
              <div style={{ fontFamily: DISPLAY, fontWeight: 300, fontSize: 52, lineHeight: 1.02, letterSpacing: "-0.02em" }}>
                No decision yet
              </div>
              <div style={{ fontSize: 16, lineHeight: 1.5, color: "#3A3A34", maxWidth: "44ch" }}>
                Pick a screening source and an address, then run it. The policy is evaluated as a deny set, so a missing
                oracle answer produces a named denial rather than a silent pass.
              </div>
            </div>
          )}

          {run.status === "running" && (
            <div
              style={{
                border: "3px solid #000000",
                background: "#FDFCF7",
                padding: 34,
                display: "flex",
                flexDirection: "column",
                gap: 16,
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
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "#000000",
                    animation: "pulseDot 1s ease-in-out infinite",
                  }}
                />
                <div>{run.label}</div>
              </div>
              <div style={{ fontFamily: DISPLAY, fontWeight: 300, fontSize: 52, lineHeight: 1.02, letterSpacing: "-0.02em" }}>
                Screening
              </div>
              <div style={{ fontFamily: MONO, fontSize: 12.5, color: "#5C5C55" }}>{run.detail}</div>
            </div>
          )}

          {run.status === "result" && (
            <>
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
                <Eyebrow>{run.outcome.eyebrow}</Eyebrow>
                {/*
                  The design sets this at 74/62px. Reduced on request — it was
                  overpowering the meta rows that explain WHY the verdict is
                  what it is, and in this system the reason matters as much as
                  the answer.
                */}
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
                      <div
                        key={d}
                        style={{
                          fontFamily: MONO,
                          fontSize: 12,
                          border: "2px solid #C2621A",
                          color: "#C2621A",
                          padding: "5px 9px",
                        }}
                      >
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
                    View attestation ↗
                  </a>
                )}
              </div>

              <div style={{ display: "flex", flexDirection: "column" }}>
                {run.outcome.meta.map(([k, v]) => (
                  <div
                    key={k}
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
                        fontFamily: MONO,
                        fontSize: 12.5,
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
                ))}

                <details style={{ marginTop: 16 }}>
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
                    Raw operator response +
                  </summary>
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
                    {asText(run.outcome.raw)}
                  </pre>
                </details>
              </div>
            </>
          )}

          {/* Policy source — pinned to the bottom of the rail. */}
          <div style={{ border: "3px solid #000000", background: "#FDFCF7", marginTop: "auto" }}>
            <div
              style={{
                padding: "16px 22px",
                borderBottom: "3px solid #000000",
                fontFamily: SANS,
                fontSize: 11.5,
                fontWeight: 700,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
              }}
            >
              Policy source
            </div>
            <div style={{ padding: "14px 22px 4px" }}>
              {(
                [
                  ["PolicyClient", shortAddr(process.env.NEXT_PUBLIC_POLICY_CLIENT ?? "")],
                  ["Oracle", provider?.policyData ? shortAddr(provider.policyData) : "params only"],
                  ["Reads", `${provider?.dataPath}.*`],
                ] as [string, string][]
              ).map(([k, v]) => (
                <div
                  key={k}
                  style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 18, padding: "8px 0" }}
                >
                  <div style={{ fontFamily: MONO, fontSize: 11.5, color: "#5C5C55", whiteSpace: "nowrap" }}>{k}</div>
                  <div
                    style={{
                      fontFamily: MONO,
                      fontSize: 11.5,
                      color: "#171714",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {v}
                  </div>
                </div>
              ))}
            </div>
            <pre
              style={{
                margin: "10px 22px 22px",
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
      <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 20, lineHeight: 1 }}>{n}</div>
      <div
        style={{
          fontFamily: SANS,
          fontSize: 12.5,
          fontWeight: 700,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
        }}
      >
        {children}
      </div>
      <div style={{ flex: 1, height: 2, background: "#000000", opacity: 0.14 }} />
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: SANS,
        fontSize: 11.5,
        fontWeight: 700,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: "#5C5C55",
      }}
    >
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
      style={{ display: "flex", alignItems: "center", gap: 9, border: "2px solid #000000", padding: "9px 13px", cursor: "pointer" }}
    >
      {active && <div style={{ width: 9, height: 9, background: swatch }} />}
      <div style={{ fontSize: 14.5 }}>{label}</div>
      <div style={{ fontSize: 14.5, color: "#5C5C55" }}>{note}</div>
    </div>
  );
}

/**
 * The decision lives at evaluation_result.result. The fallbacks cover shapes the
 * SDK types imply. Returning undefined rather than false matters: an
 * unparseable response is not a denial, and showing it as one would be a lie in
 * the direction that looks safe.
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

/**
 * Named deny reasons, when the operator returns them.
 *
 * Rendered only if genuinely present. The design mocks up chips like
 * `yente_payee_listed`; inventing one would make a denial look better
 * explained than it is, and in this system every failure — including bugs —
 * arrives as a denial.
 */
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
