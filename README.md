# Newton Sanctions Policy Engine

Enter a recipient. It is screened against a consolidated sanctions feed (US,
EU, UN, UK and others) and an operator quorum signs the decision on Ethereum
Sepolia **before** the transfer would execute.

The recipient is the only thing screened. Every run still carries a sender —
transactions have one, and the oracle requires it — but it is freshly generated
random bytes and the policy does not consult the answer.

The payer rules were removed in the same redeploy that fixed the confidence
gate. In a real AML programme you screen the originator too; here the page had
stopped asking for a sender, so `payer_sanctioned` could never fire
legitimately while `payer_not_screened` could still fire spuriously and deny a
clean recipient for an unrelated reason. See
`sanctions-oracle/yente-policy-files/policy.rego`.

The verdict on screen comes from a real `newt_createTask` — not a simulation.
It has an attestation you can open in the Newton explorer.

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

The oracle screens both parties in one lookup; the deployed Rego reads only the
recipient's half and denies on five rules.

### Four things this codebase learned the hard way

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

---

## Fail-closed behaviour

| Condition | Result |
| --- | --- |
| Screening API down | `screening_unavailable` → denied |
| Screening data > 48h old | API returns 503 → `screening_unavailable` → denied |
| Verdict unreadable | UI shows **No decision**; transfer stays blocked |
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

The Rego the operators run is **not in this repo**. It lives at
`../sanctions-oracle/yente-policy-files/policy.rego`, next to the params
schema, the metadata and the `policy.wasm` that `newton-cli policy deploy -p`
reads. One copy, in the directory that deploys it.

`policy/` here holds the tooling around it:

| | |
| --- | --- |
| `check.mjs` | Reads Sepolia directly — current CID, config, `policyCodeHash`, and a diff of chain against the source. `--after` compares to the snapshot and says whether a deploy landed. No dev server, no pip. |
| `bind.mjs` | Points the PolicyClient at a new Policy, carrying `policyParams` across as raw bytes. Dry run unless `--confirm`. Detects and resumes a half-finished bind. |
| `simargs.mjs` | Builds the intent and wasm-args JSON for `newton-cli policy simulate`, and prints the command. |
| `gate_test.py` | Six inputs through the old and new confidence gate. `pip install regopy`. |
| `DEPLOY.md` | What is currently deployed, how to replace it, how to roll back. |

Changing the policy means a **new Policy contract** — `initialize` commits the
CID and there is no setter — plus a client rebind. `DEPLOY.md` has the order.

Both scripts need `OWNER_PRIVATE_KEY` and friends, which live in
`../deploy/.env`, not in `.env.local`:

```bash
set -a; source ../deploy/.env; set +a
```

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
git push alone leaves `newton-policy-builder.vercel.app` on the previous build.

`vercel` is fetched by `npx` and needs a session — `npx vercel login` if it
answers `Error: Not authorized`. Nothing else in this repo downloads anything;
`npm run typecheck` uses the local TypeScript.

This deploys **the site only**. The policy is a separate, on-chain deploy —
see `policy/DEPLOY.md`.

---

## Known gaps

- **`YENTE_URL` points at a tunnel to a laptop.** Close the lid and every check
  on the deployed site returns `screening_unavailable` — correctly, fail-closed,
  and indistinguishable to a visitor from the site being broken. This is the
  single biggest thing between the demo and being genuinely deployed. yente
  needs Elasticsearch and a periodic dataset load, so it is not a drop-in.
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
