# Newton Sanctions Demo

Enter a recipient. It is screened against a sanctions list and an operator
quorum signs the decision on Ethereum Sepolia **before** the transfer would
execute.

The verdict on screen comes from a real `newt_createTask` — not a simulation.
It has an attestation you can open in the Newton explorer.

> ### Running on the fallback policy
>
> The site currently screens a **fixed list of 119 sanctioned addresses** held
> on chain (US OFAC, Israel, Japan, France; Ethereum only), not a live feed. It
> cannot catch a designation made after the snapshot.
>
> The oracle-backed policy is written, fixed, deployed and verified — it just
> cannot be reached. Two Newton-side failures:
>
> 1. Their runtime stopped providing `newton:provider/tlsn@0.2.0`, so any
>    component built against `newton:provider@0.2.0` fails to instantiate.
> 2. A policy CID pinned today reports `not found in persisted immutable data
>    backend` even though it serves from `ipfs.io` and Pinata. CIDs pinned in
>    August resolve. So no newly deployed policy can be read at all.
>
> **`STATUS.md` is the single source of truth** — live addresses, the parked
> yente deployment, the full evidence for the Newton-side blocker, and the exact
> steps to switch to live yente when their backend recovers. `policy/DEPLOY.md`
> is the on-chain runbook; `policy/NEWTON-ISSUE.md` is the reproduction for
> Newton.

The recipient is the only thing screened. Every run still carries a sender —
transactions have one — but it is freshly generated random bytes and the
policy does not consult the answer. The payer rules were removed once the page
stopped asking for a sender: `payer_sanctioned` could never fire legitimately
against a generated address, while `payer_not_screened` could still fire
spuriously and deny a clean recipient for an unrelated reason.

---

## Setup

```bash
cd policy-builder
npm install
cp .env.local.example .env.local   # then fill it in — see below
bash dev.sh
```

`dev.sh` kills anything on port 3000, clears `.next`, typechecks (without
blocking) and starts the server. Those are the three causes of "can't reach
localhost" when the code is fine.

### Environment

`.env.local` is gitignored and never ships. A fresh clone will not run without
it.

| Variable | Why |
| --- | --- |
| `NEWTON_API_KEY` | Authenticates to the gateway. Server-side only. |
| `POLICY_CLIENT_YENTE` | The PolicyClient the task is submitted against. |
| `NEXT_PUBLIC_POLICY_CLIENT` | Same address, for display. Baked at build time. |
| `YENTE_URL` | The screening API. Also used by `/api/screen` and `/api/screening-health`. |
| `SEPOLIA_RPC_URL` | Optional. Defaults to a public endpoint. |

On Vercel these live in Settings → Environment Variables. Changing them does
not affect an existing deployment — redeploy after.

---

## How a check works

```
UI ──▶ /api/evaluate ──▶ newt_createTask ──▶ operator quorum
                                                  │
                          WASM oracle ──▶ YENTE_URL/match
                                                  │
                                    bytes32 evaluation_result
```

That is the oracle-backed path, and it is the one currently bypassed. The
denylist policy in force has no WASM leg at all: the address list arrives as
`data.params.sanctioned_addresses`, set on the PolicyClient, so a check is
`newt_createTask` → quorum → verdict with nothing fetched at evaluation time.

### Five things this codebase learned the hard way

1. **Every failure presents as a denial.** A broken oracle, a wrong data path
   and a correct sanctions block are indistinguishable if you only ever test an
   address that should be denied. `../sanctions-oracle/verify-both.mjs` exists
   for that reason and checks three directions.

2. **The two RPCs answer in different shapes.** `newt_simulatePolicy` returns
   `evaluation_result.result` as a boolean; `newt_createTask` returns
   `task_response.evaluation_result` as a **bytes32**. Reading only the first
   made every submitted task parse as "no verdict", which the UI then rendered
   as Compliant while the explorer showed the real denial. See `extractAllow`.

3. **The composed policy is not the enforced policy.** In submit mode the
   operators evaluate the `policyCid` bound on-chain. `node policy/check.mjs`
   resolves that from the chain (`getPolicyCid` → IPFS) and diffs it against
   `../sanctions-oracle/yente-policy-files/policy.rego`, which is the one copy
   of the source.

4. **Test on Regorus, not on OPA.** Regorus is a documented OPA *subset* and
   diverges exactly where this policy lives — undefined handling. `lower(null)`
   is undefined in OPA and rego-cpp; in Regorus it is a fatal error that aborts
   evaluation, so for one deploy the policy *crashed* rather than denying
   whenever the oracle failed — making `screening_unavailable` unreachable
   precisely when it was needed. Found by `newton-cli policy simulate`. A green
   test on any other engine proves nothing.

5. **An unused import is still an import.** `yente.js` calls one interface,
   `newton:provider/http@0.2.0`. The WIT world declared `secrets` and `tlsn`
   as well. A component must have every declared import satisfied at
   instantiation whether or not it ever calls them — so when Newton's runtime
   stopped serving `tlsn@0.2.0`, every task died on an interface the oracle
   does not use. Declare what you call.

   The corollary, which cost more: **you do not control the runtime you deploy
   into.** A pinned package version stopped meaning a fixed surface, and there
   was no local test that could have caught it, because the break was on the
   other side. `deploy/1-upload.mjs` already carried a note that
   `cli.newton.xyz` was dead. Read those notes as a pattern, not as history.

---

## Fail-closed behaviour

**Denylist policy (in force):**

| Condition | Result |
| --- | --- |
| Address list empty or expired | `denylist_not_configured` → denied |
| Verdict unreadable | UI shows **No decision**; transfer stays blocked |
| Operators cannot fetch the policy | task errors → **No decision**, never a verdict |

An empty list matches nobody, so without that first rule an unconfigured policy
would approve everything while looking like it worked. An empty sanctions list
is not evidence that an address is clean.

**Oracle policy (parked):**

| Condition | Result |
| --- | --- |
| Screening API down | `screening_unavailable` → denied |
| Screening data > 48h old | API returns 503 → `screening_unavailable` → denied |
| Recipient unscreened | `payee_not_screened` → denied |
| Oracle returns a null address | `payee_address_mismatch` → denied |

Stale data returning a confident ALLOW was the last fail-open, and it is closed
in the screening API rather than in the UI — the badge and the watchdog make
staleness *visible*; only the API refusing makes it *enforced*.

---

## Routes

| Route | Does | Called by the UI |
| --- | --- | --- |
| `/api/evaluate` | Submits the task. Rate-limited per IP. | yes |
| `/api/screen` | Which party is designated, and on which lists. Explanation, not attestation. | yes |
| `/api/screening-health` | How old the sanctions data is. Drives the stale badge. | yes |
| `/api/history` | Recent runs, read from Sepolia logs. No database. | **no** |
| `/api/policy-source` | The deployed policy, resolved from chain and fetched from IPFS. | **no** |

The last two lost their callers when the evidence rail came off the verdict
panel. Both still work and are worth keeping — `/api/history` is the only
shared, chain-derived record of runs — but nothing on the site exercises them,
so nothing on the site will tell you when they break.

---

## The deployed policy

There are two, and neither Rego file lives in this repo:

- **Live (denylist):** `../deploy/policy-files/policy.rego` — the params-only
  policy the operators run now. Frozen: its CID predates Newton's migration and
  is why it still resolves; do not edit it (see `policy/DEPLOY.md`). The address
  list is on-chain params, updated via `setparams.mjs`.
- **Parked (yente):** `../sanctions-oracle/yente-policy-files/policy.rego` — the
  oracle-backed policy, next to the params schema, metadata and `policy.wasm`
  that `newton-cli policy deploy -p` reads. Built and verified, blocked only by
  Newton's ingestion.

`policy/` here holds the tooling around both:

| | |
| --- | --- |
| `check.mjs` | Reads Sepolia directly — current CID, config, `policyCodeHash`, and a diff of chain against the source. `--after` compares to the snapshot and says whether a deploy landed. No dev server, no pip. |
| `bind.mjs` | Points the PolicyClient at a new Policy, carrying `policyParams` across as raw bytes read from chain. Dry run unless `--confirm`. Detects and resumes a half-finished bind. |
| `setparams.mjs` | Loads the on-chain denylist params from `lib/ofac-full.ts` ∪ `lib/sanctioned-pool.ts` ∪ `lib/ofac-addresses.ts`, deduped. **Skips the write when the list is unchanged.** This is what the live site screens against. |
| `simargs.mjs` | Builds the intent and wasm-args JSON for `newton-cli policy simulate`, and prints the command. |
| `test-simulate.mjs` | Runs the yente policy in simulate mode (inline Rego) to isolate a policy-fetch failure from a wasm-fetch one. |
| `watch-yente.sh` | Polls the yente path until the backend ingests the CID; beeps and exits when it resolves. |
| `gate_test.py` | Six inputs through the old and new confidence gate. `pip install regopy`. |
| `DEPLOY.md` | What is currently deployed, how to replace it, how to roll back. |
| `NEWTON-ISSUE.md` | The backend-ingestion reproduction, for Newton. |

Changing the **yente** policy means a new Policy contract (`initialize` commits
the CID; there is no setter) plus a client rebind — `DEPLOY.md` has the order.
Changing the **denylist** is different: its address list is on-chain params, so
`setparams.mjs` updates it in one transaction without a new policy or CID.

The on-chain scripts need `OWNER_PRIVATE_KEY` and friends, which live in
`../deploy/.env`, not in `.env.local`:

```bash
set -a; source ../deploy/.env; set +a
```

### Keeping the list current

`sanctions-api/emit-full-list.mjs` regenerates `lib/ofac-full.ts` — every
sanctioned Ethereum address in the live feed, all regimes — from the
`sanctions-api` snapshot. Run it, then `setparams.mjs --confirm`.

`.github/workflows/refresh-onchain.yml` does this on a daily schedule: it
regenerates the list, pushes it on-chain **only if it changed** (the skip guard
means most days cost no gas), then verifies a clean address is Compliant and a
sanctioned one is Non Compliant, failing the run otherwise. Arm it by adding
repo secrets: `OWNER_PRIVATE_KEY` (rotate the exposed one first),
`POLICY_CLIENT_DENYLIST`, optional `SEPOLIA_RPC_URL`, `NEWTON_API_KEY`.

---

## Design system

`lib/ds.ts` holds the tokens — 8px spacing grid, radii, control heights, type
scale, colour. Components read from it rather than carrying numbers inline.
Verdict fills keep green and orange; interaction is ink, so the only colour
that means anything is the outcome.

---

## Deploying

```bash
bash deploy.sh "what changed"
```

The message is required. Refuses if a `.env` file is staged, typechecks, runs
the real production build locally, then commits, rebases, pushes and promotes
with `vercel --prod`. The `--prod` matters: no domain alias is attached, so a
git push alone leaves `newton-sanctions-demo.vercel.app` on the previous build.

`vercel` is fetched by `npx` and needs a session — `npx vercel login` if it
answers `Error: Not authorized`. Nothing else in this repo downloads anything;
`npm run typecheck` uses the local TypeScript.

This deploys **the site only**. The policy is a separate, on-chain deploy —
see `policy/DEPLOY.md`.

---

## Known gaps

- **The site is on the fallback policy** and screens 119 fixed sanctioned
  addresses (US/IL/JP/FR, ETH only) held on-chain, not a live oracle feed. See
  the box at the top and `STATUS.md`. The oracle path is blocked Newton-side.
- **`YENTE_URL` differs between environments.** Production sends
  `https://sanctions-api-liard.vercel.app` — a deployed service, not a laptop.
  `sanctions-oracle/yente-deployment.json` still records a Cloudflare *quick*
  tunnel (random hostname, dies with the process), which is presumably what
  local runs use. Worth reconciling: a demo whose screening endpoint depends on
  which machine submitted the task is a demo with two different behaviours.
- **The stale-data path has never been exercised.** Set `MAX_AGE_HOURS = 0` in
  `sanctions-api` to force it. The grey `unavailable` verdict has never been
  seen against a genuinely stale feed.
- **Mobile is untested.** Rules exist below 640px; nobody has opened it on a
  phone.
- **The new Policy is owned by the deployer key** from `../deploy/.env`
  (`0x0710868c…`), not the previous owner. Nothing breaks — `owner` gates
  `setMetadataCid` and `transferOwnership`, not `setPolicy` — but those keys
  have been pasted into a chat transcript and want rotating, then
  `transferOwnership`.
- **Inbound screening is designed, not built** — see `../inbound/DESIGN.md`.
  You cannot block an inbound transfer on a public chain; you gate the credit.
- **The rate limit is in-memory**, so it resets with the serverless instance
  and is not shared between them. Enough for a stuck retry loop, not for a
  determined abuser.
- **`lib/catalog.ts` still carries multiple providers and composable rules**
  that the UI no longer surfaces, including payer rules the deployed policy no
  longer has. It feeds `scripts/emit-rego.mjs` and nothing else.
- **`generated-policy.rego` and `policy/newton_yente.rego` are stubs** pointing
  at the real source. They are kept because both filenames appear in older
  notes, and a file that lies is worse than one that is missing.
