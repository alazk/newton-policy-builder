"use client";

/**
 * Controls left, decision right.
 *
 * The verdict is the product — everything on the left exists to produce it —
 * so it gets its own permanent panel rather than appearing below the fold
 * after a run. It also means the previous result stays visible while you
 * change a source and run again, which is what makes the two providers
 * comparable.
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

type Outcome = {
  allow: boolean | null;
  headline: string;
  eyebrow: string;
  reason?: string;
  denySet: string[];
  mode: string;
  latency: number | null;
  explorerUrl?: string | null;
  raw: unknown;
  tone: "ok" | "bad" | "warn";
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string; detail: string }
  | { status: "result"; outcome: Outcome };

const GOAL_ID = Object.keys(GOALS)[0];

const SCENARIOS = [
  { id: "clean", label: "Clean wallet", note: "not on any list", address: CLEAN_TEST_ADDRESS, tone: "ok" as const },
  { id: "ofac", label: "OFAC SDN", note: "both sources block", address: SANCTIONED_TEST_ADDRESS, tone: "bad" as const },
];

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

const shortAddr = (a: string) => (a.length > 14 ? `${a.slice(0, 10)}…${a.slice(-6)}` : a);

export default function Wizard() {
  const goal = GOALS[GOAL_ID];
  const firstProvider = goal.providers[0];

  const [providerId, setProviderId] = useState(firstProvider);
  const [ruleIds, setRuleIds] = useState<string[]>(() =>
    rulesForProvider(GOAL_ID, firstProvider).filter((r) => RULES[r]?.defaultOn),
  );
  const [params, setParams] = useState<Record<string, unknown>>(() =>
    defaultParams(rulesForProvider(GOAL_ID, firstProvider).filter((r) => RULES[r]?.defaultOn)),
  );
  const [to, setTo] = useState(SANCTIONED_TEST_ADDRESS);
  const [run, setRun] = useState<RunState>({ status: "idle" });

  const provider = PROVIDERS[providerId];
  const selection: Selection = { goalId: GOAL_ID, providerId, ruleIds, params };

  const rego = useMemo(() => generateRego(selection), [providerId, ruleIds]);
  const effectiveParams = useMemo(() => collectParams(selection), [ruleIds, params]);

  function pickProvider(pid: string) {
    const defaults = rulesForProvider(GOAL_ID, pid).filter((r) => RULES[r]?.defaultOn);
    setProviderId(pid);
    setRuleIds(defaults);
    setParams(defaultParams(defaults));
    setRun({ status: "idle" });
  }

  function fail(error: string, raw: unknown, mode: string, latency: number | null) {
    setRun({
      status: "result",
      outcome: {
        allow: null,
        headline: "Couldn't complete",
        eyebrow: "Error",
        reason: error,
        denySet: [],
        mode,
        latency,
        raw,
        tone: "warn",
      },
    });
  }

  async function doRun() {
    setRun({ status: "running", label: "Screening", detail: "newt_simulatePolicy · 1 operator" });
    const t0 = performance.now();
    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rego, params: effectiveParams, policyDataAddress: provider.policyData, to }),
      });
      const json = await res.json();
      const latency = (performance.now() - t0) / 1000;

      if (!res.ok || json.ok === false) return fail(asText(json.error) || "Request failed", json.raw, "newt_simulatePolicy", latency);
      if (json.result?.success === false || json.result?.error)
        return fail(asText(json.result.error ?? "evaluation failed"), json.result, "newt_simulatePolicy", latency);

      const allow = extractAllow(json.result);
      if (allow === undefined)
        return fail("Couldn't find the decision in the response.", json.result, "newt_simulatePolicy", latency);

      setRun({
        status: "result",
        outcome: {
          allow,
          headline: allow ? "Compliant" : "Non Compliant",
          eyebrow: "Quick test · nothing recorded",
          reason: extractReason(json.result),
          denySet: extractDenySet(json.result),
          mode: "newt_simulatePolicy · 1 operator",
          latency,
          raw: json.result,
          tone: allow ? "ok" : "bad",
        },
      });
    } catch (e) {
      fail(asText(e), null, "newt_simulatePolicy", null);
    }
  }

  async function doSubmit() {
    setRun({ status: "running", label: "Awaiting quorum", detail: "newt_createTask · BLS aggregation" });
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
      const latency = (performance.now() - t0) / 1000;

      if (!res.ok || json.ok === false)
        return fail(asText(json.error) || "Submit failed", json.raw, "newt_createTask", latency);

      const allow = extractAllow(json.result);
      setRun({
        status: "result",
        outcome: {
          allow: allow ?? null,
          headline: allow === false ? "Non Compliant" : allow === true ? "Compliant" : "Attested",
          eyebrow: "Screened on-chain · quorum signed",
          reason: extractReason(json.result),
          denySet: extractDenySet(json.result),
          mode: "newt_createTask · operator quorum",
          latency,
          explorerUrl: json.explorerUrl ?? null,
          raw: json.result,
          tone: allow === false ? "bad" : "ok",
        },
      });
    } catch (e) {
      fail(asText(e), null, "newt_createTask", null);
    }
  }

  const validAddress = /^0x[a-fA-F0-9]{40}$/.test(to);
  const busy = run.status === "running";

  return (
    // Fixed height, no document scroll — each column scrolls on its own, so
    // the verdict stays put while you change a source and run again. That
    // side-by-side comparison is the whole point of having two providers.
    <div className="flex h-screen flex-col overflow-hidden">
      {/* ── Masthead ─────────────────────────────────────────── */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b-[3px] border-[var(--rule)] px-7 py-5">
        <div className="flex items-center gap-4">
          <span className="display text-[30px] leading-none">Newton</span>
          <span className="bg-[var(--ink)] px-4 py-2.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--bg)]">
            AML / OFAC Policy Engine
          </span>
        </div>
        <div className="flex items-center gap-2 border border-[var(--line)] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
          <span className="pulse inline-block size-1.5 rounded-full bg-[var(--faint)]" />
          Ethereum Sepolia · Operator quorum live
        </div>
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-2">
        {/* ── Controls ───────────────────────────────────────── */}
        <div className="overflow-y-auto border-[var(--rule)] px-7 py-8 lg:border-r-[3px]">
          <SectionLabel n="01">Screening source</SectionLabel>

          <div className="grid gap-4 sm:grid-cols-2">
            {goal.providers.map((pid) => {
              const p = PROVIDERS[pid];
              const active = pid === providerId;
              return (
                <button
                  key={pid}
                  onClick={() => pickProvider(pid)}
                  className={`flex flex-col border text-left transition ${
                    active ? "border-[var(--ink)] bg-[var(--surface)]" : "border-[var(--line)] hover:border-[var(--ink)]"
                  }`}
                >
                  <div className="flex-1 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <span className="serif text-[21px] leading-none">
                        {pid === "yente" ? "OpenSanctions" : "Denylist"}
                      </span>
                      <span className="border border-[var(--ink)] px-2 py-1 text-[9.5px] font-semibold uppercase tracking-[0.12em]">
                        {pid === "yente" ? "Live" : "Snapshot"}
                      </span>
                    </div>
                    <p className="serif mt-3 text-[14px] leading-[1.5] text-[var(--ink)]">
                      {pid === "yente"
                        ? "~1,700 wallets across OFAC, EU, UN and UK lists. Refreshed daily."
                        : "93 OFAC addresses carried in the policy params. No oracle call."}
                    </p>
                    <div className="mono mt-4 text-[11px] text-[var(--muted)]">{p?.dataPath}</div>
                  </div>
                  {active && (
                    <div className="bg-[var(--ink)] px-5 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--bg)]">
                      Selected
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-9">
            <SectionLabel n="02">Recipient address</SectionLabel>
            <input
              value={to}
              onChange={(e) => {
                setTo(e.target.value.trim());
                setRun({ status: "idle" });
              }}
              spellCheck={false}
              placeholder="0x…"
              className="mono w-full border border-[var(--ink)] bg-transparent px-5 py-4 text-[15px] outline-none"
            />
            {to && !validAddress && (
              <p className="mt-2 text-[12px] text-[var(--bad)]">Not a valid 20-byte address.</p>
            )}

            <div className="mt-3 flex flex-wrap gap-3">
              {SCENARIOS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    setTo(s.address);
                    setRun({ status: "idle" });
                  }}
                  className={`serif flex items-center gap-2.5 border px-4 py-2.5 text-[14px] transition ${
                    to.toLowerCase() === s.address.toLowerCase()
                      ? "border-[var(--ink)]"
                      : "border-[var(--line)] hover:border-[var(--ink)]"
                  }`}
                >
                  <span
                    className="inline-block size-2.5 shrink-0"
                    style={{ background: s.tone === "ok" ? "transparent" : "var(--warn)", border: s.tone === "ok" ? "1px solid var(--muted)" : "none" }}
                  />
                  {s.label}
                  <span className="text-[var(--muted)]">{s.note}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-9">
            <SectionLabel n="03">Decision</SectionLabel>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={doSubmit}
                disabled={!validAddress || busy || !provider?.submittable}
                className="flex-1 bg-[var(--ink)] px-6 py-4 text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--bg)] transition hover:bg-[var(--ink-soft)] disabled:opacity-25"
              >
                Screen on-chain
              </button>
              <button
                onClick={doRun}
                disabled={!validAddress || busy}
                className="border border-[var(--ink)] px-6 py-4 text-[13px] font-semibold uppercase tracking-[0.1em] transition hover:bg-[var(--surface)] disabled:opacity-25"
              >
                Quick test
              </button>
            </div>

            <p className="serif mt-4 max-w-md text-[14px] leading-[1.55]">
              <strong className="font-bold">Screen on-chain</strong> submits a real task: an operator
              quorum evaluates the deployed policy and signs the result.{" "}
              <strong className="font-bold">Quick test</strong> asks a single operator and records
              nothing.
            </p>

            {!provider?.submittable && (
              // Each PolicyClient binds one policy. Submitting under a provider
              // without its own client would evaluate a different policy and
              // label the answer with this one.
              <p className="mt-4 border-l-2 border-[var(--warn)] bg-[var(--warn-bg)] px-4 py-3 text-[12.5px] leading-relaxed text-[var(--muted)]">
                This source has no PolicyClient deployed, so it can only be tested — a real
                submission would evaluate a different policy and report the result as though it came
                from this one.
              </p>
            )}
          </div>
        </div>

        {/* ── Decision panel ─────────────────────────────────── */}
        <div className="overflow-y-auto bg-[var(--surface)] px-7 py-8">
          {run.status === "idle" && (
            <div className="border border-[var(--line)] p-8">
              <div className="eyebrow">Verdict</div>
              {/* Display Light at 52px per the spec — the idle state should
                  read as absence, not as a result. */}
              <div className="mt-3 text-[52px] font-light leading-[0.95] text-[var(--faint)] [font-family:var(--display)]">
                No decision yet
              </div>
              <p className="serif mt-4 max-w-md text-[14.5px] leading-[1.6] text-[var(--muted)]">
                Pick a screening source and an address, then run it. The policy is evaluated as a
                deny set, so a missing oracle answer produces a named denial rather than a silent
                pass.
              </p>
            </div>
          )}

          {run.status === "running" && (
            <div className="border border-[var(--line)] p-8">
              <div className="eyebrow flex items-center gap-2">
                <span className="pulse inline-block size-1.5 rounded-full bg-[var(--warn)]" />
                {run.detail}
              </div>
              <div className="display mt-3 text-[40px] leading-[0.95]">{run.label}</div>
            </div>
          )}

          {run.status === "result" && <Decision o={run.outcome} to={to} provider={provider} rego={rego} />}
        </div>
      </div>
    </div>
  );
}

/* ── Decision panel ────────────────────────────────────────── */

function Decision({
  o,
  to,
  provider,
  rego,
}: {
  o: Outcome;
  to: string;
  provider: any;
  rego: string;
}) {
  /**
   * The rule and the headline are different weights of the same idea, and for
   * the compliant state the spec gives them different greens — a lighter rule
   * over darker type, so the type stays readable at 62px without the rule
   * looking muddy.
   */
  const rule = o.tone === "ok" ? "var(--ok)" : o.tone === "bad" ? "var(--warn)" : "var(--bad)";
  const type = o.tone === "ok" ? "var(--ok-type)" : o.tone === "bad" ? "var(--warn)" : "var(--bad)";

  return (
    <div className="fade-up">
      <div className="border border-[var(--line)] bg-[var(--raised)]">
        <div className="h-3" style={{ background: rule }} />
        <div className="p-8">
          <div className="eyebrow">{o.eyebrow}</div>
          <div
            className="display mt-3 text-[52px] leading-[0.92] sm:text-[62px]"
            style={{ color: type }}
          >
            {o.headline}
          </div>
          {o.reason && (
            <p className="serif mt-4 max-w-lg text-[16px] leading-[1.55]">{o.reason}</p>
          )}

          {o.denySet.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-2">
              {o.denySet.map((d) => (
                <span
                  key={d}
                  className="mono border px-3 py-1.5 text-[12px]"
                  style={{ borderColor: type, color: type }}
                >
                  {d}
                </span>
              ))}
            </div>
          )}

          {o.explorerUrl && (
            <a
              href={o.explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-6 inline-flex items-center gap-1.5 bg-[var(--ink)] px-5 py-3 text-[12px] font-semibold uppercase tracking-[0.1em] text-[var(--bg)] transition hover:bg-[var(--ink-soft)]"
            >
              View attestation <span aria-hidden>↗</span>
            </a>
          )}
        </div>
      </div>

      {/* Facts about the run, not about the decision. */}
      <dl className="mt-7 space-y-0">
        <Row k="Mode" v={o.mode} />
        <Row k="Source" v={provider?.name ?? "—"} />
        <Row k="Recipient" v={shortAddr(to)} mono />
        <Row k="Deny set" v={o.denySet.length ? JSON.stringify(o.denySet) : "[]"} mono />
        <Row k="Latency" v={o.latency != null ? `${o.latency.toFixed(2)}s` : "—"} />
      </dl>

      <details className="mt-5 border-t border-[var(--line)] pt-4">
        <summary className="eyebrow cursor-pointer transition hover:text-[var(--ink)]">
          Raw operator response +
        </summary>
        <pre className="mono mt-3 max-h-72 overflow-auto border border-[var(--line)] bg-[var(--raised)] p-4 text-[11px] leading-relaxed">
          {asText(o.raw)}
        </pre>
      </details>

      <div className="mt-7 border border-[var(--ink)]">
        <div className="border-b border-[var(--ink)] px-5 py-3 text-[10.5px] font-semibold uppercase tracking-[0.14em]">
          Policy source
        </div>
        <dl className="px-5 py-3">
          <Row k="PolicyClient" v={shortAddr(process.env.NEXT_PUBLIC_POLICY_CLIENT ?? "—")} mono bare />
          <Row k="Oracle" v={provider?.policyData ? shortAddr(provider.policyData) : "params only"} mono bare />
          <Row k="Reads" v={`${provider?.dataPath}.*`} mono bare />
        </dl>
        <pre className="mono max-h-72 overflow-auto border-t border-[var(--line)] bg-[var(--raised)] p-5 text-[11.5px] leading-relaxed">
          {rego}
        </pre>
      </div>
    </div>
  );
}

/* ── Building blocks ───────────────────────────────────────── */

function SectionLabel({ n, children }: { n?: string; children: React.ReactNode }) {
  return (
    <div className="mb-5 flex items-center gap-4">
      {n && <span className="display text-[15px] leading-none">{n}</span>}
      <span className="eyebrow text-[var(--ink)]">{children}</span>
      <span className="h-px flex-1 bg-[var(--line)]" />
    </div>
  );
}

function Row({ k, v, mono, bare }: { k: string; v: string; mono?: boolean; bare?: boolean }) {
  return (
    <div
      className={`flex items-baseline justify-between gap-6 ${
        bare ? "py-1" : "border-b border-[var(--line)] py-3"
      }`}
    >
      <dt className="eyebrow shrink-0">{k}</dt>
      <dd className={`truncate text-right text-[13px] ${mono ? "mono" : "serif"}`}>{v}</dd>
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
 * The named deny reasons, when the operator returns them.
 *
 * Shown only if actually present. Inventing a plausible-looking reason when
 * the response does not carry one would make a denial look better explained
 * than it is — and in this system every failure, including bugs, arrives as a
 * denial.
 */
function extractDenySet(result: any): string[] {
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
