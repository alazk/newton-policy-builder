# Status — Newton Sanctions Policy Engine

_Last verified: 2026-09-04._

A live demo of on-chain sanctions screening enforced by a Newton operator
quorum on Ethereum Sepolia. This file is the single source of truth for what is
running, what is parked, and how to move between them.

---

## What is live

**https://newton-policy-builder.vercel.app**

Enter a recipient; it is screened against a sanctions list and an operator
quorum signs the decision on Sepolia before the transfer would execute. The
verdict is a real `newt_createTask` with an attestation you can open in the
Newton explorer — not a simulation.

It runs on the **params-only denylist policy**: 119 sanctioned addresses held
on-chain in the PolicyClient's params, no WASM oracle, no IPFS fetch at
evaluation time. Verified end-to-end on the live site — a clean address
**Compliant**, a designated address **Non Compliant**, both quorum-signed.

This is a **fixed snapshot, Ethereum only**, drawn from four sanctions sources
(US OFAC SDN 104, Israel MOD 15, Japan MoF 9, France Trésor 2). It is not a live
feed and cannot catch a designation made after the snapshot. The UI and metadata
say so; keep it that way while this policy is bound.

```
provider (lib/catalog.ts)  local-denylist
policy client              0xfd054556b4d00d8b0f897b1ae377ecd17fccae78
policy                     0x627222E71CCEc59C315c83C095f12458FaB5B221
policy cid                 bafkreigvmehmguzwvy3wla2q56jk25jpfog3ecuym5v6cquoeocjodhqri
addresses                  119 (lib/ofac-full.ts ∪ pool ∪ 0xB10C list)
regenerate                 node sanctions-api/emit-full-list.mjs
```

To change the list by hand: `node policy/setparams.mjs --confirm` (one
transaction, no IPFS). It **skips the write when the on-chain list already
matches**, and always re-test a **clean** address after — a failed params write
makes the policy deny everything, which looks identical to it working.

**Auto-refresh:** `.github/workflows/refresh-onchain.yml` runs daily, after
sanctions-api's own refresh, regenerates the Ethereum list, and pushes it
on-chain only if it changed — then verifies a clean address is Compliant and a
sanctioned one is Non Compliant, failing the run if not. Needs repo secrets:
`OWNER_PRIVATE_KEY` (rotate the exposed one first), `POLICY_CLIENT_DENYLIST`,
optional `SEPOLIA_RPC_URL`, and `NEWTON_API_KEY`. Most days it spends no gas.

---

## What is parked: the live yente oracle

The oracle-backed path — real, multi-regime screening against a live
OpenSanctions (yente) instance — is **built, fixed, deployed, verified, and
bound**. It is one working operator-fetch from live, and that fetch is blocked
by a Newton-side issue (below).

```
policy client   0x749753713fC04bbDB5dAf9C66cdE293512fe0eE7   (bound to ↓)
policy          0xb06abbf45715CB53231d7Dd8b2AfFaBc76485a30   (rev-3)
policy data     0x6Ed506B76EC859D0dfE2Fca945AD9A2b9038ca82
policy cid      bafkreie5hep5mo57ukxr6bzvoosofcdrefr6ee4jt3i3ztqlorysdvub74
wasm cid        bafybeiebq6aensds72cqdejp4w3gmrlka5tervhn3bsj2je436o6h3khd4
code hash       0x3b1fbfa63a09d4657894644e23aa3b12266ca146be831ee60fa7f823f3feb2b7
entrypoint      newton_yente.allow
source          ../sanctions-oracle/yente-policy-files/policy.rego
oracle API      https://sanctions-api-liard.vercel.app  (1749 wallets, live)
```

(rev-1 `0xDDD3AC3c…` and rev-2 `0x990A6E4f…` are superseded, still on chain.
Each redeploy produced a fresh CID; none ingested — the CID is not the variable.)

The oracle itself is confirmed working: the API is up, and
`newton-cli policy simulate` returns **DENIED** for a designated address with
`status: 200` and real dataset matches (`us_ofac_sdn`, `il_mod_crypto`) on
Regorus — the exact engine the operators run.

Four screening fixes are baked into that policy, each caught during this work:

1. **tlsn import removed.** The WASM declared `newton:provider/tlsn@0.2.0` and
   `secrets` but calls neither. When Newton's runtime stopped serving `tlsn`,
   every task failed to instantiate on an interface the oracle never uses.
2. **`lower(null)` guarded.** In Regorus that is a fatal error, not undefined —
   so when the oracle returned `address: null`, the whole policy *crashed*
   instead of denying, making `screening_unavailable` unreachable exactly when
   the oracle was down. `is_string()` guards fix it.
3. **Confidence gate inverted.** A confirmed hit with an absent `match_score`
   was allowed with an empty deny set; now it denies.
4. **Payer rules removed.** The UI generates the sender, so payer rules could
   only ever misfire and deny a clean recipient for an unrelated reason.

---

## Why yente is not live: the Newton-side blocker

Operators cannot fetch the policy or WASM:

```
Data provider error: Network error: object bafkreidos2… not found in
persisted immutable data backend
```

Every upload path pins the content to IPFS (publicly resolvable — confirmed 200
from ipfs.io and Pinata) but it never reaches the backend the operators read
from. CIDs from ~3 weeks ago resolve; nothing uploaded since does.

Isolated by elimination — none of these is the cause:

- **Address wiring** — the error names exactly the CID the client is bound to.
- **Account / token** — one Newton account (`0x8b4ba870…`, one `rpc` key); the
  denylist works with that same key against an older ingested CID.
- **Upload tool** — reproduced on four independent paths, two of them inside
  Newton's own product with no CLI involved:
  1. `newton-cli` direct Pinata
  2. `newton-cli` Newton IPFS proxy (`deploy` and `generate-cids`)
  3. Dashboard **Publish**
  4. Dashboard **Custom Data Oracle → Simulate**

The dashboard paths are decisive: Newton's own web backend cannot ingest content
Newton's own proxy accepted minutes earlier. This is a backend ingestion
regression on their side, not a configuration issue here. Full write-up:
`policy/NEWTON-ISSUE.md`.

---

## Switching to live yente when the backend recovers

The client is already bound to the yente policy, so this is a front-end switch
plus verification — no new on-chain transactions needed unless a rebind is
required.

1. **Confirm the CID now resolves** (the whole blocker):
   ```bash
   curl -sS -X POST https://newton-policy-builder.vercel.app/api/evaluate \
     -H 'content-type: application/json' \
     -d '{"mode":"submit","providerId":"yente","to":"0x175d44451403edf28469df03a9280c1197adb92c","policyDataAddress":"x"}' \
     | python3 -c 'import sys,json; r=json.load(sys.stdin).get("result") or {}; print(r.get("error") or "RESOLVED")'
   ```
   If this still says "not found", the backend has not recovered — stop.

2. **If a rebind is needed** (e.g. the binding drifted):
   ```bash
   node policy/bind.mjs 0x990A6E4f57A2561a744EEc169E3fa92Dba098682 --confirm
   ```

3. **Flip the provider** — in `lib/catalog.ts`, change
   `providers: ["local-denylist"]` back to `providers: ["yente"]`.

4. **Restore the live-feed copy** at the markers left in place:
   `components/Wizard.tsx` (card blurb, screening step, the "No match on"
   regime chips) and `app/layout.tsx` (metadata description).

5. **Ship and verify:**
   ```bash
   bash deploy.sh "Switch to live yente oracle"
   ```
   Then a clean address must read **Compliant** and a designated one **Non
   Compliant** on the live site. Clean first — it is the only case that
   distinguishes a working policy from one denying everything.

---

## Tooling (policy/)

| Script | Purpose |
| --- | --- |
| `check.mjs` | Read Sepolia directly: current CID, config, code hash, chain-vs-source diff. `--after` compares to a snapshot. No dev server, no pip. |
| `bind.mjs` | Point a PolicyClient at a Policy, carrying params across as raw chain bytes. Dry run unless `--confirm`; resumes a half-finished bind. |
| `setparams.mjs` | Load the OFAC address union into the denylist client's params. One transaction. This is what the live site screens against. |
| `simargs.mjs` | Build intent + wasm-args JSON for `newton-cli policy simulate`. |
| `test-simulate.mjs` | Try the policy in simulate mode (inline Rego), to isolate policy-fetch from wasm-fetch failures. |
| `gate_test.py` | Six inputs through the old and corrected confidence gate. `pip install regopy`. |
| `DEPLOY.md` | Full on-chain deploy/rollback runbook. |
| `NEWTON-ISSUE.md` | The backend-ingestion reproduction, for Newton. |

---

## Known gaps

- **Live yente is blocked on Newton's backend** (above). Not fixable here.
- **The demo is a fixed 97-address OFAC snapshot**, not a live feed, while the
  denylist policy is bound.
- **Stale-data path never exercised** — set `MAX_AGE_HOURS = 0` in
  `sanctions-api` to force the grey `unavailable` verdict.
- **Mobile untested** below 640px.
- **New Policy owned by the deployer key** from `../deploy/.env`
  (`0x0710868c…`); those keys were pasted in a transcript and want rotating,
  then `transferOwnership`.
- **`lib/catalog.ts` still carries multi-provider/composable-rule scaffolding**
  the UI no longer surfaces; it feeds `scripts/emit-rego.mjs`.
