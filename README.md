# Newton Sanctions Policy Engine

Enter a recipient. It is screened against a consolidated sanctions feed (US,
EU, UN, UK and others) and an operator quorum signs the decision on Ethereum
Sepolia **before** the transfer would execute.

The policy screens both parties — it denies `payer_not_screened` when one is
missing — so every run also carries a sender. That sender is freshly generated
random bytes rather than a second field: random is on no list, so it can only
ever be the clean half, and the recipient stays the only variable.

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

The oracle screens **both** parties in one lookup and the deployed Rego denies
on any of nine rules — including `payer_sanctioned`, which is why the sender is
a field and not a constant.

### Three things this codebase learned the hard way

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
   operators evaluate the `policyCid` bound on-chain. The "Deployed policy"
   panel resolves that from the chain (`getPolicyCid` → IPFS) and deliberately
   does *not* fall back to locally generated Rego.

---

## Fail-closed behaviour

| Condition | Result |
| --- | --- |
| Screening API down | `screening_unavailable` → denied |
| Screening data > 48h old | API returns 503 → `screening_unavailable` → denied |
| Verdict unreadable | UI shows **No decision**; transfer stays blocked |
| Either party unscreened | `payee_not_screened` / `payer_not_screened` → denied |

Stale data returning a confident ALLOW was the last fail-open, and it is closed
in the screening API rather than in the UI — the badge and the watchdog make
staleness *visible*; only the API refusing makes it *enforced*.

---

## Routes

| Route | Does |
| --- | --- |
| `/api/evaluate` | Submits the task. Rate-limited per IP. |
| `/api/history` | Recent runs, read from Sepolia logs. No database. |
| `/api/policy-source` | The deployed policy, resolved from chain and fetched from IPFS. |
| `/api/screen` | Which party is designated, and on which lists. Explanation, not attestation. |
| `/api/screening-health` | How old the sanctions data is. |

---

## Design system

`lib/ds.ts` holds the tokens — 8px spacing grid, radii, control heights, type
scale, colour. Components read from it rather than carrying numbers inline.
Verdict fills keep green and orange; interaction is ink, so the only colour
that means anything is the outcome.

---

## Deploying

```bash
bash deploy.sh
```

Refuses if a `.env` file is staged, typechecks, runs the real production build
locally, then commits, pushes and promotes with `vercel --prod`. The `--prod`
matters: no domain alias is attached, so a git push alone leaves
`newton-policy-builder.vercel.app` on the previous build.

---

## Known gaps

- **Mobile is untested.** Rules exist below 640px; nobody has opened it on a
  phone.
- **Inbound screening is designed, not built** — see `../inbound/DESIGN.md`.
  You cannot block an inbound transfer on a public chain; you gate the credit.
- **The rate limit is in-memory**, so it resets with the serverless instance
  and is not shared between them. Enough for a stuck retry loop, not for a
  determined abuser.
- **`lib/catalog.ts` still carries multiple providers and composable rules**
  that the UI no longer surfaces. It feeds `scripts/emit-rego.mjs`.
