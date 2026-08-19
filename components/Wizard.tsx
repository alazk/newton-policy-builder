"use client";

/**
 * One screen: pick a source, put an address in, get a verdict out.
 *
 * This replaced a four-step wizard. The steps were honest about the data model
 * — goal, provider, rules, run — but they were four clicks in front of the only
 * thing anyone wants to see, and the rule toggles were misleading: Submit
 * evaluates the policy deployed on-chain, so editing rules changed the Test
 * result and nothing else. Removing controls that don't affect the real
 * decision is a correctness fix as much as a design one.
 *
 * The rules still exist in the catalog and still generate the Rego shown under
 * "policy source"; they are simply applied at their defaults rather than
 * presented as knobs.
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

type RunState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; allow: boolean; reason?: string; raw: unknown }
  | { status: "submitting" }
  | { status: "submitted"; taskId: string | null; explorerUrl: string | null; raw: unknown }
  | { status: "error"; error: string; hint?: string; raw?: unknown };

const GOAL_ID = Object.keys(GOALS)[0];

/**
 * Three addresses that tell the whole story.
 *
 * The clean one is not decoration. Both providers deny the sanctioned
 * addresses, so a completely broken policy — one that cannot read its oracle
 * and denies unconditionally — passes both of those tests. Only the clean case
 * catches it.
 */
const SCENARIOS = [
  {
    id: "clean",
    label: "Clean wallet",
    note: "not on any list",
    address: CLEAN_TEST_ADDRESS,
    tone: "ok" as const,
  },
  {
    id: "ofac",
    label: "OFAC SDN",
    note: "both sources block",
    address: SANCTIONED_TEST_ADDRESS,
    tone: "bad" as const,
  },
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
  const [to, setTo] = useState(CLEAN_TEST_ADDRESS);
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

  async function doRun() {
    setRun({ status: "running" });
    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rego, params: effectiveParams, policyDataAddress: provider.policyData, to }),
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        setRun({ status: "error", error: asText(json.error) || "Request failed", hint: json.hint, raw: json.raw });
        return;
      }
      if (json.result?.success === false || json.result?.error) {
        setRun({ status: "error", error: asText(json.result.error ?? "evaluation failed"), raw: json.result });
        return;
      }
      const allow = extractAllow(json.result);
      if (allow === undefined) {
        setRun({
          status: "error",
          error: "Couldn't find the decision in the response. Check the raw output below.",
          raw: json.result,
        });
        return;
      }
      setRun({ status: "done", allow, reason: extractReason(json.result), raw: json.result });
    } catch (e) {
      setRun({ status: "error", error: asText(e) });
    }
  }

  async function doSubmit() {
    setRun({ status: "submitting" });
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
      if (!res.ok || json.ok === false) {
        setRun({ status: "error", error: asText(json.error) || "Submit failed", hint: json.hint, raw: json.raw });
        return;
      }
      setRun({
        status: "submitted",
        taskId: json.taskId ?? null,
        explorerUrl: json.explorerUrl ?? null,
        raw: json.result,
      });
    } catch (e) {
      setRun({ status: "error", error: asText(e) });
    }
  }

  const validAddress = /^0x[a-fA-F0-9]{40}$/.test(to);
  const busy = run.status === "running" || run.status === "submitting";

  return (
    <div className="mx-auto w-full max-w-3xl">
      {/* ── Header ───────────────────────────────────────────── */}
      <header className="flex flex-wrap items-end justify-between gap-6 border-b-[3px] border-[var(--rule)] px-6 py-7 sm:px-10">
        <div>
          <div className="eyebrow">Newton</div>
          <h1 className="display mt-1.5 text-[34px] leading-[1.05] sm:text-[46px]">
            AML / OFAC Policy Engine
          </h1>
        </div>
        <div className="flex items-center gap-2 pb-1 text-[11.5px] text-[var(--muted)]">
          <span className="pulse inline-block size-1.5 rounded-full bg-[var(--accent)]" />
          Ethereum Sepolia · operator quorum live
        </div>
      </header>

      <div className="px-6 py-9 sm:px-10">
        {/* ── Source ─────────────────────────────────────────── */}
        <div className="mb-9">
          <SectionLabel n="01">Screening source</SectionLabel>
          <div className="grid gap-3 sm:grid-cols-2">
            {goal.providers.map((pid) => {
              const p = PROVIDERS[pid];
              const active = pid === providerId;
              return (
                <button
                  key={pid}
                  onClick={() => pickProvider(pid)}
                  className={`group border p-5 text-left transition ${
                    active
                      ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--bg)]"
                      : "border-[var(--line)] bg-[var(--raised)] hover:border-[var(--ink)]"
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="serif text-[20px] leading-none">
                      {pid === "yente" ? "OpenSanctions" : "Denylist"}
                    </span>
                    <span
                      className={`eyebrow ${active ? "text-[var(--bg)]/60" : ""}`}
                      style={active ? undefined : { color: "var(--accent)" }}
                    >
                      {pid === "yente" ? "Live" : "Snapshot"}
                    </span>
                  </div>
                  <p
                    className={`mt-3 text-[12.5px] leading-relaxed ${
                      active ? "text-[var(--bg)]/70" : "text-[var(--muted)]"
                    }`}
                  >
                    {pid === "yente"
                      ? "~1,700 wallets across OFAC, EU, UN and UK lists. Refreshed daily."
                      : "93 OFAC addresses carried in the policy params. No oracle call."}
                  </p>
                  <div
                    className={`mono mt-4 text-[10.5px] ${
                      active ? "text-[var(--bg)]/50" : "text-[var(--faint)]"
                    }`}
                  >
                    {p?.dataPath}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Address ────────────────────────────────────────── */}
        <div className="mb-9">
          <SectionLabel n="02">Recipient address</SectionLabel>

          <input
            value={to}
            onChange={(e) => {
              setTo(e.target.value.trim());
              setRun({ status: "idle" });
            }}
            spellCheck={false}
            placeholder="0x…"
            className="mono w-full border border-[var(--line)] bg-[var(--raised)] px-4 py-4 text-[14px] tracking-tight outline-none transition focus:border-[var(--ink)]"
          />

          {to && !validAddress && (
            <p className="mt-2 text-[12px] text-[var(--bad)]">Not a valid 20-byte address.</p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {SCENARIOS.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  setTo(s.address);
                  setRun({ status: "idle" });
                }}
                className={`flex items-center gap-2 border px-3 py-2 text-left text-[12px] transition ${
                  to.toLowerCase() === s.address.toLowerCase()
                    ? "border-[var(--ink)] bg-[var(--raised)]"
                    : "border-[var(--line)] bg-[var(--raised)] hover:border-[var(--ink)]"
                }`}
              >
                <span
                  className="inline-block size-1.5 shrink-0 rounded-full"
                  style={{ background: s.tone === "ok" ? "var(--ok)" : "var(--bad)" }}
                />
                <span>
                  <span className="font-medium">{s.label}</span>
                  <span className="ml-1.5 text-[var(--faint)]">{s.note}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Decision ───────────────────────────────────────── */}
        <div>
          <SectionLabel n="03">Decision</SectionLabel>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={doSubmit}
              disabled={!validAddress || busy || !provider?.submittable}
              className="flex-1 border border-[var(--ink)] bg-[var(--ink)] px-6 py-4 text-[14px] font-medium text-[var(--bg)] transition hover:bg-[var(--ink-soft)] disabled:opacity-25"
            >
              {run.status === "submitting" ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="pulse inline-block size-1.5 rounded-full bg-[var(--bg)]" />
                  Awaiting quorum…
                </span>
              ) : (
                "Screen on-chain"
              )}
            </button>
            <button
              onClick={doRun}
              disabled={!validAddress || busy}
              className="border border-[var(--ink)] bg-transparent px-6 py-4 text-[14px] font-medium transition hover:bg-[var(--surface)] disabled:opacity-25"
            >
              {run.status === "running" ? "Testing…" : "Quick test"}
            </button>
          </div>

          <p className="mt-3 text-[12.5px] leading-relaxed text-[var(--muted)]">
            <span className="font-medium text-[var(--ink)]">Screen on-chain</span> submits a real
            task: an operator quorum evaluates the deployed policy and signs the result.{" "}
            <span className="font-medium text-[var(--ink)]">Quick test</span> asks a single operator
            and records nothing.
          </p>

          {!provider?.submittable && (
            // Each PolicyClient binds one policy. Submitting under a provider
            // without its own client would evaluate a different policy and
            // label the answer with this one.
            <p className="mt-3 border-l-2 border-[var(--warn)] bg-[var(--warn-bg)] px-3 py-2.5 text-[12px] leading-relaxed text-[var(--muted)]">
              This source has no PolicyClient deployed, so it can only be tested — a real submission
              would evaluate a different policy and report the result as though it came from this
              one.
            </p>
          )}
        </div>

      {/* ── Verdict ──────────────────────────────────────────── */}
      {run.status === "done" && (
        <Verdict
          tone={run.allow ? "ok" : "bad"}
          headline={run.allow ? "Allowed" : "Blocked"}
          sub={run.reason ?? "Evaluated by one operator. Not recorded on-chain."}
          raw={run.raw}
        />
      )}

      {run.status === "submitted" && (
        <Verdict tone="neutral" headline="Attested" sub="Quorum reached and the result signed." raw={run.raw}>
          {run.explorerUrl && (
            <a
              href={run.explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-flex items-center gap-1.5 border border-[var(--ink)] bg-[var(--ink)] px-4 py-2.5 text-[13px] font-medium text-[var(--bg)] transition hover:bg-[var(--ink-soft)]"
            >
              View attestation <span aria-hidden>↗</span>
            </a>
          )}
        </Verdict>
      )}

      {run.status === "error" && (
        <Verdict tone="warn" headline="Couldn't complete" sub={run.hint ?? ""} raw={run.raw}>
          <pre className="mono mt-2 max-h-44 overflow-auto whitespace-pre-wrap text-[12px] leading-relaxed">
            {run.error}
          </pre>
        </Verdict>
      )}

        {/* ── Machinery ──────────────────────────────────────── */}
        <details className="mt-9 border-t border-[var(--line)] pt-5">
          <summary className="eyebrow cursor-pointer transition hover:text-[var(--ink)]">
            Policy source
          </summary>

          <dl className="mono mt-4 space-y-1.5 text-[11.5px]">
            <Row k="PolicyClient" v={process.env.NEXT_PUBLIC_POLICY_CLIENT ?? "—"} />
            <Row k="Oracle" v={provider?.policyData || "none — params only"} />
            <Row k="Reads" v={`${provider?.dataPath}.*`} />
          </dl>

          <pre className="mono mt-4 max-h-80 overflow-auto border border-[var(--line)] bg-[var(--raised)] p-4 text-[11.5px] leading-relaxed">
            {rego}
          </pre>
        </details>
      </div>
    </div>
  );
}

/* ── Building blocks ───────────────────────────────────────── */

/** Numbered rule, per the design: 01 / 02 / 03 against a hairline. */
function SectionLabel({ n, children }: { n?: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      {n && <span className="eyebrow" style={{ color: "var(--accent)" }}>{n}</span>}
      <span className="eyebrow">{children}</span>
      <span className="h-px flex-1 bg-[var(--line)]" />
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="shrink-0 text-[var(--faint)]">{k}</dt>
      <dd className="truncate text-[var(--muted)]">{v}</dd>
    </div>
  );
}

function Verdict({
  tone,
  headline,
  sub,
  raw,
  children,
}: {
  tone: "ok" | "bad" | "warn" | "neutral";
  headline: string;
  sub?: string;
  raw?: unknown;
  children?: React.ReactNode;
}) {
  const skin = {
    ok: "bg-[var(--ok-bg)] border-[var(--ok-line)]",
    bad: "bg-[var(--bad-bg)] border-[var(--bad-line)]",
    warn: "bg-[var(--warn-bg)] border-[var(--warn-line)]",
    neutral: "bg-[var(--surface)] border-[var(--line)]",
  } as const;
  const accent = {
    ok: "var(--ok)",
    bad: "var(--bad)",
    warn: "var(--warn)",
    neutral: "var(--ink)",
  } as const;

  return (
    <div className={`fade-up mt-6 border p-7 ${skin[tone]}`}>
      <div className="eyebrow" style={{ color: accent[tone] }}>
        Verdict
      </div>
      {/*
        Large and serif on purpose. The verdict is the only thing on screen
        that matters, and every failure in this system reads as a denial —
        so it needs to be unmissable which one you got.
      */}
      <div
        className="display mt-2 text-[46px] leading-[0.95] sm:text-[62px]"
        style={{ color: accent[tone] }}
      >
        {headline}
      </div>
      {sub && (
        <p className="serif mt-3 max-w-lg text-[15px] leading-relaxed text-[var(--muted)]">{sub}</p>
      )}
      {children}
      {raw != null && (
        <details className="mt-5">
          <summary className="eyebrow cursor-pointer transition hover:text-[var(--ink)]">
            Raw operator response
          </summary>
          <pre className="mono mt-2.5 max-h-72 overflow-auto border border-[var(--line)] bg-[var(--raised)] p-3.5 text-[11px] leading-relaxed">
            {asText(raw)}
          </pre>
        </details>
      )}
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
