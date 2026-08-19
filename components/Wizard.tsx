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
    <div className="mx-auto w-full max-w-2xl px-5 py-14">
      {/* ── Header ───────────────────────────────────────────── */}
      <header className="mb-9">
        <div className="inline-flex items-center gap-2 rounded-full bg-[var(--surface)] px-3 py-1.5 text-[11.5px] font-medium text-[var(--muted)] ring-1 ring-[var(--line)]">
          <span className="pulse inline-block size-1.5 rounded-full bg-[var(--ok)]" />
          Ethereum Sepolia · live operator quorum
        </div>
        <h1 className="mt-4 text-[32px] font-semibold leading-[1.15] tracking-[-0.025em]">
          Newton AML/OFAC
          <br />
          Policy Engine
        </h1>
        <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-[var(--muted)]">
          Sanctions screening enforced before a transaction executes. Both the sender and the
          recipient are checked, and the decision is signed by an operator quorum on-chain.
        </p>
      </header>

      {/* ── Source ───────────────────────────────────────────── */}
      <div className="mb-6">
        <SectionLabel>Screening source</SectionLabel>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {goal.providers.map((pid) => {
            const p = PROVIDERS[pid];
            const active = pid === providerId;
            return (
              <button
                key={pid}
                onClick={() => pickProvider(pid)}
                className={`group rounded-2xl p-4 text-left transition ${
                  active
                    ? "bg-[var(--ink)] text-white ring-1 ring-[var(--ink)]"
                    : "bg-[var(--surface)] ring-1 ring-[var(--line)] hover:ring-[var(--faint)]"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[14px] font-medium leading-snug">
                    {pid === "yente" ? "OpenSanctions" : "Local denylist"}
                  </span>
                  <span
                    className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${
                      active ? "bg-white/15 text-white" : "bg-white text-[var(--muted)] ring-1 ring-[var(--line)]"
                    }`}
                  >
                    {pid === "yente" ? "live" : "snapshot"}
                  </span>
                </div>
                <p
                  className={`mt-1.5 text-[12.5px] leading-relaxed ${
                    active ? "text-white/70" : "text-[var(--muted)]"
                  }`}
                >
                  {pid === "yente"
                    ? "~1,700 wallets across OFAC, EU, UN, UK and more. Refreshed daily."
                    : "93 OFAC addresses carried in the policy params. No oracle call."}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Address ──────────────────────────────────────────── */}
      <div className="rounded-2xl bg-[var(--surface)] p-5 ring-1 ring-[var(--line)]">
        <SectionLabel>Recipient address</SectionLabel>

        <input
          value={to}
          onChange={(e) => {
            setTo(e.target.value.trim());
            setRun({ status: "idle" });
          }}
          spellCheck={false}
          placeholder="0x…"
          className="mono w-full rounded-xl bg-white px-4 py-3.5 text-[13.5px] tracking-tight ring-1 ring-[var(--line)] outline-none transition focus:ring-2 focus:ring-[var(--ink)]"
        />

        <div className="mt-3 flex flex-wrap gap-2">
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setTo(s.address);
                setRun({ status: "idle" });
              }}
              className={`flex items-center gap-2 rounded-xl px-3 py-2 text-left text-[12px] transition ${
                to.toLowerCase() === s.address.toLowerCase()
                  ? "bg-white ring-2 ring-[var(--ink)]"
                  : "bg-white ring-1 ring-[var(--line)] hover:ring-[var(--faint)]"
              }`}
            >
              <span
                className={`inline-block size-1.5 shrink-0 rounded-full ${
                  s.tone === "ok" ? "bg-[var(--ok)]" : "bg-[var(--bad)]"
                }`}
              />
              <span>
                <span className="font-medium">{s.label}</span>
                <span className="ml-1.5 text-[var(--faint)]">{s.note}</span>
              </span>
            </button>
          ))}
        </div>

        {to && !validAddress && (
          <p className="mt-2.5 text-[12px] text-[var(--bad)]">Not a valid 20-byte address</p>
        )}

        <div className="mt-5 flex flex-wrap gap-2.5">
          <button
            onClick={doSubmit}
            disabled={!validAddress || busy || !provider?.submittable}
            className="flex-1 rounded-xl bg-[var(--ink)] px-5 py-3.5 text-[14px] font-medium text-white transition hover:opacity-90 disabled:opacity-30"
          >
            {run.status === "submitting" ? (
              <span className="flex items-center justify-center gap-2">
                <span className="pulse inline-block size-1.5 rounded-full bg-white" />
                Awaiting quorum…
              </span>
            ) : (
              "Screen on-chain"
            )}
          </button>
          <button
            onClick={doRun}
            disabled={!validAddress || busy}
            className="rounded-xl bg-white px-5 py-3.5 text-[14px] font-medium ring-1 ring-[var(--line)] transition hover:ring-[var(--faint)] disabled:opacity-30"
          >
            {run.status === "running" ? "Testing…" : "Quick test"}
          </button>
        </div>

        <p className="mt-3 text-[12px] leading-relaxed text-[var(--muted)]">
          <strong className="font-medium text-[var(--ink)]">Screen on-chain</strong> submits a real
          task — an operator quorum evaluates the deployed policy and signs the result.{" "}
          <strong className="font-medium text-[var(--ink)]">Quick test</strong> asks a single
          operator and records nothing.
        </p>

        {!provider?.submittable && (
          // Each PolicyClient binds one policy. Submitting under a provider
          // without its own client would evaluate a different policy and label
          // the answer with this one.
          <p className="mt-2 rounded-lg bg-[var(--warn-bg)] px-3 py-2 text-[12px] leading-relaxed text-[var(--muted)] ring-1 ring-[var(--warn-line)]">
            This source has no PolicyClient deployed, so it can only be tested — a real submission
            would evaluate a different policy and report the result as though it came from this one.
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
              className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[var(--ink)] px-4 py-2.5 text-[13px] font-medium text-white transition hover:opacity-90"
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

      {/* ── Machinery ────────────────────────────────────────── */}
      <details className="mt-6 rounded-2xl bg-[var(--surface)] p-5 ring-1 ring-[var(--line)]">
        <summary className="cursor-pointer text-[13px] font-medium text-[var(--muted)] transition hover:text-[var(--ink)]">
          Policy source and contracts
        </summary>

        <dl className="mono mt-4 space-y-1.5 text-[11.5px]">
          <Row k="PolicyClient" v={process.env.NEXT_PUBLIC_POLICY_CLIENT ?? "—"} />
          <Row k="Oracle" v={provider?.policyData || "none — params only"} />
          <Row k="Reads" v={`${provider?.dataPath}.*`} />
        </dl>

        <pre className="mono mt-4 max-h-80 overflow-auto rounded-xl bg-white p-4 text-[11.5px] leading-relaxed ring-1 ring-[var(--line)]">
          {rego}
        </pre>
      </details>
    </div>
  );
}

/* ── Building blocks ───────────────────────────────────────── */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2.5 text-[11px] font-medium uppercase tracking-wider text-[var(--faint)]">
      {children}
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
    ok: "bg-[var(--ok-bg)] ring-[var(--ok-line)]",
    bad: "bg-[var(--bad-bg)] ring-[var(--bad-line)]",
    warn: "bg-[var(--warn-bg)] ring-[var(--warn-line)]",
    neutral: "bg-[var(--surface)] ring-[var(--line)]",
  } as const;
  const ink = {
    ok: "text-[var(--ok)]",
    bad: "text-[var(--bad)]",
    warn: "text-[var(--warn)]",
    neutral: "text-[var(--ink)]",
  } as const;

  return (
    <div className={`fade-up mt-5 rounded-2xl p-6 ring-1 ${skin[tone]}`}>
      <div className={`text-[26px] font-semibold tracking-[-0.02em] ${ink[tone]}`}>{headline}</div>
      {sub && <p className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--muted)]">{sub}</p>}
      {children}
      {raw != null && (
        <details className="mt-4">
          <summary className="cursor-pointer text-[12px] text-[var(--faint)] transition hover:text-[var(--muted)]">
            Raw operator response
          </summary>
          <pre className="mono mt-2 max-h-72 overflow-auto rounded-xl bg-white/70 p-3.5 text-[11px] leading-relaxed">
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
