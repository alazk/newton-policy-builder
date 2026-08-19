"use client";

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

const ALL_STEPS = ["Goal", "Provider", "Rules", "Run"] as const;

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

const short = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

/**
 * With a single goal, the goal step is a one-option question. Preselect it and
 * start on the provider step rather than making the user click through a
 * choice that isn't one. Written against GOALS rather than hardcoded, so
 * re-adding a goal restores the step automatically.
 */
const GOAL_IDS = Object.keys(GOALS);
const SINGLE_GOAL = GOAL_IDS.length === 1 ? GOAL_IDS[0] : "";

export default function Wizard() {
  const [step, setStep] = useState(SINGLE_GOAL ? 1 : 0);
  const [goalId, setGoalId] = useState(SINGLE_GOAL);
  // Preselecting the goal means the provider and its default rules have to be
  // seeded here too, or the Rules step opens empty and the generated policy
  // reads "// pick at least one policy".
  const initialProvider = SINGLE_GOAL ? GOALS[SINGLE_GOAL].providers[0] : "";
  const initialRules = SINGLE_GOAL
    ? rulesForProvider(SINGLE_GOAL, initialProvider).filter((r) => RULES[r]?.defaultOn)
    : [];

  const [providerId, setProviderId] = useState(initialProvider);
  const [ruleIds, setRuleIds] = useState<string[]>(initialRules);
  const [params, setParams] = useState<Record<string, unknown>>(() => defaultParams(initialRules));
  const [to, setTo] = useState("");
  const [run, setRun] = useState<RunState>({ status: "idle" });
  const [showPolicy, setShowPolicy] = useState(false);

  const goal = GOALS[goalId];
  const provider = PROVIDERS[providerId];
  const selection: Selection = { goalId, providerId, ruleIds, params };

  const rego = useMemo(() => generateRego(selection), [goalId, providerId, ruleIds]);
  const effectiveParams = useMemo(() => collectParams(selection), [ruleIds, params]);
  const available = useMemo(
    () => (goalId && providerId ? rulesForProvider(goalId, providerId) : []),
    [goalId, providerId],
  );

  function applyProvider(gid: string, pid: string) {
    const avail = rulesForProvider(gid, pid);
    const defaults = avail.filter((r) => RULES[r]?.defaultOn);
    setProviderId(pid);
    setRuleIds(defaults);
    setParams(defaultParams(defaults));
    setRun({ status: "idle" });
  }

  function pickGoal(id: string) {
    setGoalId(id);
    applyProvider(id, GOALS[id].providers[0]);
    setStep(1);
  }

  function toggleRule(id: string) {
    setRuleIds((prev) => {
      const next = prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id];
      setParams((p) => ({ ...defaultParams(next), ...p }));
      return next;
    });
    setRun({ status: "idle" });
  }

  async function doRun() {
    setRun({ status: "running" });
    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rego,
          params: effectiveParams,
          policyDataAddress: provider.policyData,
          to,
        }),
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
        // The oracle address must travel with a real task too: the deployed
        // policy knows which oracle to call, not what address to screen.
        body: JSON.stringify({
          mode: "submit",
          to,
          policyDataAddress: provider.policyData,
          // The server routes to this provider's own PolicyClient. Without it,
          // every submit lands on one client and the answer belongs to
          // whichever policy that client has bound, not the one on screen.
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
  const canRun = provider && ruleIds.length > 0 && validAddress;
  const busy = run.status === "running" || run.status === "submitting";

  return (
    <div className="mx-auto max-w-5xl px-6 pb-24 pt-12">
      {/* ── Header ───────────────────────────────────────────── */}
      <header className="mb-10">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--faint)]">
          <span className="inline-block size-1.5 rounded-full bg-[var(--ok)]" />
          Ethereum Sepolia
        </div>
        <h1 className="mt-3 text-[28px] font-semibold leading-tight tracking-[-0.02em]">
          Newton AML/OFAC Policy Engine
        </h1>
        <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-[var(--muted)]">
          Screen both sides of a transfer against sanctions lists, test it against a live Newton
          operator, then submit it for a quorum-signed attestation on-chain.
        </p>
      </header>

      {/* ── Progress ─────────────────────────────────────────── */}
      <nav className="mb-10">
        <ol className="flex items-center gap-1.5">
          {ALL_STEPS.map((label, i) => {
            // Step 0 is preselected and skipped when there is only one goal.
            // Keeping the index space intact avoids renumbering every
            // setStep call for a purely presentational change.
            if (SINGLE_GOAL && i === 0) return null;
            const state = i === step ? "current" : i < step ? "done" : "todo";
            return (
              <li key={label} className="flex flex-1 items-center gap-1.5">
                <button
                  onClick={() => i < step && setStep(i)}
                  disabled={i > step}
                  className={[
                    "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition",
                    state === "current" && "bg-[var(--ink)] text-white shadow-sm",
                    state === "done" && "bg-white text-[var(--ink)] ring-1 ring-[var(--line)] hover:ring-[var(--faint)]",
                    state === "todo" && "text-[var(--faint)]",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <span
                    className={[
                      "flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                      state === "current" && "bg-white/15",
                      state === "done" && "bg-[var(--ok-bg)] text-[var(--ok)]",
                      state === "todo" && "bg-[var(--line)]",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {state === "done" ? "✓" : i + 1}
                  </span>
                  <span className="truncate font-medium">{label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* ── Context strip ────────────────────────────────────── */}
      {goal && step > 0 && (
        <div className="fade-up mb-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-[var(--muted)]">
          <Chip>{goal.name}</Chip>
          {provider && (
            <>
              <span className="text-[var(--faint)]">→</span>
              <Chip>{provider.name}</Chip>
            </>
          )}
          {step >= 2 && ruleIds.length > 0 && (
            <>
              <span className="text-[var(--faint)]">→</span>
              <Chip>
                {ruleIds.length} {ruleIds.length === 1 ? "rule" : "rules"}
              </Chip>
            </>
          )}
        </div>
      )}

      {/* ── Step 1 · Goal ────────────────────────────────────── */}
      {step === 0 && (
        <section className="fade-up">
          <StepTitle>What are you enforcing?</StepTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            {Object.values(GOALS).map((g) => (
              <button
                key={g.id}
                onClick={() => pickGoal(g.id)}
                className="group rounded-2xl bg-[var(--surface)] p-5 text-left ring-1 ring-[var(--line)] transition hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-12px_rgba(0,0,0,0.18)] hover:ring-[var(--faint)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="font-medium">{g.name}</span>
                  <span className="mt-0.5 text-[var(--faint)] transition group-hover:translate-x-0.5 group-hover:text-[var(--ink)]">
                    →
                  </span>
                </div>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--muted)]">{g.blurb}</p>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ── Step 2 · Provider ────────────────────────────────── */}
      {step === 1 && goal && (
        <section className="fade-up">
          <StepTitle onBack={() => setStep(0)}>Where does the data come from?</StepTitle>
          <div className="space-y-3">
            {goal.providers.map((pid) => {
              const p = PROVIDERS[pid];
              const needsKey = p.requiredSecrets.length > 0;
              const active = providerId === pid;
              return (
                <button
                  key={pid}
                  onClick={() => {
                    applyProvider(goalId, pid);
                    setStep(2);
                  }}
                  className={[
                    "w-full rounded-2xl bg-[var(--surface)] p-5 text-left ring-1 transition hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-12px_rgba(0,0,0,0.18)]",
                    active ? "ring-[var(--ink)]" : "ring-[var(--line)] hover:ring-[var(--faint)]",
                  ].join(" ")}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{p.name}</span>
                    {needsKey ? (
                      <Badge tone="warn">needs {p.requiredSecrets[0]}</Badge>
                    ) : (
                      <Badge tone="ok">ready</Badge>
                    )}
                  </div>
                  <p className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--muted)]">{p.blurb}</p>
                  <p className="mono mt-2.5 text-[11.5px] text-[var(--faint)]">
                    reads {p.dataPath}.*
                    {p.policyData ? ` · ${short(p.policyData)}` : ""}
                  </p>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Step 3 · Rules ───────────────────────────────────── */}
      {step === 2 && goal && provider && (
        <section className="fade-up">
          <StepTitle onBack={() => setStep(1)}>Which checks should run?</StepTitle>

          <div className="space-y-2.5">
            {available.map((rid) => {
              const r = RULES[rid];
              const on = ruleIds.includes(rid);
              return (
                <div
                  key={rid}
                  className={[
                    "rounded-2xl bg-[var(--surface)] p-4 ring-1 transition",
                    on ? "ring-[var(--ink)]" : "ring-[var(--line)]",
                  ].join(" ")}
                >
                  <label className="flex cursor-pointer items-start gap-3">
                    <span
                      className={[
                        "mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-[6px] text-[11px] text-white transition",
                        on ? "bg-[var(--ink)]" : "bg-white ring-1 ring-[var(--line)]",
                      ].join(" ")}
                      aria-hidden
                    >
                      {on ? "✓" : ""}
                    </span>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggleRule(rid)}
                      className="sr-only"
                    />
                    <span className="min-w-0">
                      <span className="block text-[14.5px] font-medium">{r.label}</span>
                      <span className="mt-0.5 block text-[13px] leading-relaxed text-[var(--muted)]">
                        {r.blurb}
                      </span>
                    </span>
                  </label>

                  {on && r.params.length > 0 && (
                    <div className="mt-3.5 space-y-2.5 border-t border-[var(--line)] pt-3.5 pl-[30px]">
                      {r.params.map((pd) => (
                        <div key={pd.key}>
                          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-[var(--faint)]">
                            {pd.label}
                          </label>
                          <input
                            className="mono w-full rounded-lg bg-[var(--bg)] px-3 py-2 text-[12.5px] ring-1 ring-[var(--line)] transition focus:bg-white focus:outline-none focus:ring-[var(--faint)]"
                            placeholder={pd.placeholder}
                            value={displayParam(params[pd.key] ?? pd.default)}
                            onChange={(e) => {
                              const v =
                                pd.type === "number"
                                  ? Number(e.target.value) || 0
                                  : pd.type === "list"
                                    ? e.target.value.split(",").map((x) => x.trim()).filter(Boolean)
                                    : e.target.value;
                              setParams((p) => ({ ...p, [pd.key]: v }));
                              setRun({ status: "idle" });
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Generated policy — collapsed by default so it doesn't dominate */}
          <div className="mt-4 overflow-hidden rounded-2xl bg-[var(--surface)] ring-1 ring-[var(--line)]">
            <button
              onClick={() => setShowPolicy((s) => !s)}
              className="flex w-full items-center justify-between px-5 py-3.5 text-left transition hover:bg-[var(--bg)]"
            >
              <span className="text-[13.5px] font-medium">Generated policy</span>
              <span className="flex items-center gap-2 text-[12px] text-[var(--faint)]">
                <span className="mono">{rego.split("\n").length} lines</span>
                <span className={showPolicy ? "rotate-180 transition" : "transition"}>⌄</span>
              </span>
            </button>
            {showPolicy && (
              <div className="fade-up grid gap-4 border-t border-[var(--line)] p-5 lg:grid-cols-2">
                <div>
                  <Label>Rego</Label>
                  <pre className="mono max-h-72 overflow-auto rounded-xl bg-[var(--bg)] p-3.5 text-[11.5px] leading-relaxed">
                    {rego}
                  </pre>
                </div>
                <div>
                  <Label>Params</Label>
                  <pre className="mono max-h-72 overflow-auto rounded-xl bg-[var(--bg)] p-3.5 text-[11.5px] leading-relaxed">
                    {JSON.stringify(effectiveParams, null, 2)}
                  </pre>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => setStep(3)}
            disabled={ruleIds.length === 0}
            className="mt-6 rounded-xl bg-[var(--ink)] px-5 py-3 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-30"
          >
            Continue
          </button>
        </section>
      )}

      {/* ── Step 4 · Run ─────────────────────────────────────── */}
      {step === 3 && provider && (
        <section className="fade-up">
          <StepTitle onBack={() => setStep(2)}>Which address are you screening?</StepTitle>

          <div className="rounded-2xl bg-[var(--surface)] p-5 ring-1 ring-[var(--line)]">
            <input
              value={to}
              onChange={(e) => {
                setTo(e.target.value.trim());
                setRun({ status: "idle" });
              }}
              placeholder="0x…"
              spellCheck={false}
              className="mono w-full rounded-xl bg-[var(--bg)] px-4 py-3.5 text-[14px] ring-1 ring-[var(--line)] transition focus:bg-white focus:outline-none focus:ring-[var(--ink)]"
            />
            <div className="mt-2.5 flex flex-wrap gap-2">
              <QuickPick onClick={() => setTo(SANCTIONED_TEST_ADDRESS)} tone="bad">
                Sanctioned
              </QuickPick>
              <QuickPick onClick={() => setTo(CLEAN_TEST_ADDRESS)} tone="ok">
                Clean
              </QuickPick>
              {to && !validAddress && (
                <span className="self-center text-[12px] text-[var(--bad)]">
                  Not a valid 20-byte address
                </span>
              )}
            </div>

            <div className="mt-5 flex flex-wrap gap-2.5">
              <button
                onClick={doSubmit}
                disabled={!validAddress || busy}
                className="rounded-xl bg-[var(--ink)] px-5 py-3 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-30"
              >
                {run.status === "submitting" ? (
                  <span className="flex items-center gap-2">
                    <span className="pulse inline-block size-1.5 rounded-full bg-white" />
                    Submitting…
                  </span>
                ) : (
                  "Submit for attestation"
                )}
              </button>
              <button
                onClick={doRun}
                disabled={!canRun || busy}
                className="rounded-xl bg-white px-5 py-3 text-sm font-medium ring-1 ring-[var(--line)] transition hover:ring-[var(--faint)] disabled:opacity-30"
              >
                {run.status === "running" ? "Testing…" : "Test only"}
              </button>
            </div>

            <p className="mt-3 text-[12.5px] leading-relaxed text-[var(--muted)]">
              <strong className="font-medium text-[var(--ink)]">Submit</strong> creates a
              quorum-signed task against the policy deployed on-chain — it appears in the explorer
              and returns an attestation. <strong className="font-medium text-[var(--ink)]">Test</strong>{" "}
              evaluates the rules above with one operator; instant, but nothing is recorded.
            </p>

            {/*
              The two buttons do not evaluate the same policy, and nothing on
              screen used to say so. Submit evaluates the policy deployed
              on-chain with its on-chain params; the rules and values chosen in
              this wizard are not sent. Someone toggling rules and pressing
              Submit would reasonably believe they were testing their edits.
            */}
            <p className="mt-2 rounded-lg bg-[var(--warn-bg,#fff8e6)] px-3 py-2 text-[12.5px] leading-relaxed text-[var(--muted)] ring-1 ring-[var(--line)]">
              <strong className="font-medium text-[var(--ink)]">Heads up:</strong> Submit ignores the
              rules and values you picked above. Operators evaluate the policy already deployed
              on-chain, with its own stored params. Only <em>Test</em> runs what's in this wizard —
              to make an edit real you have to redeploy the policy.
            </p>
          </div>

          {/* ── Result ─────────────────────────────────────── */}
          {run.status === "done" && (
            <ResultCard tone={run.allow ? "ok" : "bad"} title={run.allow ? "Allowed" : "Denied"}>
              <p className="text-[13.5px] text-[var(--muted)]">
                {run.reason ?? "Evaluated by a Newton operator. Not recorded on-chain."}
              </p>
              <RawDetails data={run.raw} />
            </ResultCard>
          )}

          {run.status === "submitted" && (
            <ResultCard tone="neutral" title="Task submitted">
              <p className="text-[13.5px] text-[var(--muted)]">
                Operators evaluated the deployed policy and signed the result.
              </p>
              {run.taskId && (
                <p className="mono mt-3 break-all rounded-lg bg-[var(--bg)] p-2.5 text-[11.5px]">
                  {run.taskId}
                </p>
              )}
              {run.explorerUrl && (
                <a
                  href={run.explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-[var(--ink)] px-4 py-2.5 text-[13px] font-medium text-white transition hover:opacity-90"
                >
                  View in explorer <span aria-hidden>↗</span>
                </a>
              )}
              <RawDetails data={run.raw} />
            </ResultCard>
          )}

          {run.status === "error" && (
            <ResultCard tone="warn" title="Couldn't complete">
              <pre className="mono max-h-44 overflow-auto whitespace-pre-wrap text-[12px] leading-relaxed">
                {run.error}
              </pre>
              {run.hint && <p className="mt-2 text-[13px] text-[var(--muted)]">{run.hint}</p>}
              <RawDetails data={run.raw} />
            </ResultCard>
          )}
        </section>
      )}
    </div>
  );
}

/* ── Small building blocks ─────────────────────────────────── */

function StepTitle({ children, onBack }: { children: React.ReactNode; onBack?: () => void }) {
  return (
    <div className="mb-5 flex items-center gap-3">
      {onBack && (
        <button
          onClick={onBack}
          className="rounded-lg bg-white px-2.5 py-1.5 text-[12px] text-[var(--muted)] ring-1 ring-[var(--line)] transition hover:text-[var(--ink)] hover:ring-[var(--faint)]"
        >
          ← Back
        </button>
      )}
      <h2 className="text-[17px] font-medium tracking-[-0.01em]">{children}</h2>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-white px-2.5 py-1 text-[12px] ring-1 ring-[var(--line)]">
      {children}
    </span>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "ok" | "warn" }) {
  const map = {
    ok: "bg-[var(--ok-bg)] text-[var(--ok)] ring-[var(--ok-line)]",
    warn: "bg-[var(--warn-bg)] text-[var(--warn)] ring-[var(--warn-line)]",
  } as const;
  return (
    <span className={`rounded-full px-2.5 py-1 text-[11.5px] font-medium ring-1 ${map[tone]}`}>
      {children}
    </span>
  );
}

function QuickPick({
  children,
  onClick,
  tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone: "ok" | "bad";
}) {
  const dot = tone === "ok" ? "bg-[var(--ok)]" : "bg-[var(--bad)]";
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-[12px] ring-1 ring-[var(--line)] transition hover:ring-[var(--faint)]"
    >
      <span className={`inline-block size-1.5 rounded-full ${dot}`} />
      {children}
    </button>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-[var(--faint)]">
      {children}
    </div>
  );
}

function ResultCard({
  tone,
  title,
  children,
}: {
  tone: "ok" | "bad" | "warn" | "neutral";
  title: string;
  children: React.ReactNode;
}) {
  const map = {
    ok: "bg-[var(--ok-bg)] ring-[var(--ok-line)]",
    bad: "bg-[var(--bad-bg)] ring-[var(--bad-line)]",
    warn: "bg-[var(--warn-bg)] ring-[var(--warn-line)]",
    neutral: "bg-[var(--surface)] ring-[var(--line)]",
  } as const;
  const titleColor = {
    ok: "text-[var(--ok)]",
    bad: "text-[var(--bad)]",
    warn: "text-[var(--warn)]",
    neutral: "text-[var(--ink)]",
  } as const;
  return (
    <div className={`fade-up mt-5 rounded-2xl p-5 ring-1 ${map[tone]}`}>
      <div className={`text-[17px] font-semibold tracking-[-0.01em] ${titleColor[tone]}`}>
        {title}
      </div>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function RawDetails({ data }: { data: unknown }) {
  if (data == null) return null;
  return (
    <details className="mt-3.5">
      <summary className="cursor-pointer text-[12px] text-[var(--faint)] transition hover:text-[var(--muted)]">
        Raw operator response
      </summary>
      <pre className="mono mt-2 max-h-72 overflow-auto rounded-xl bg-white/70 p-3.5 text-[11px] leading-relaxed">
        {asText(data)}
      </pre>
    </details>
  );
}

function displayParam(v: unknown): string {
  return Array.isArray(v) ? v.join(", ") : String(v ?? "");
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
