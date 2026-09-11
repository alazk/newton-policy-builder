# Newton Sanctions Demo

Enter a recipient address. It is screened against a sanctions list and an
operator quorum signs the decision on Ethereum Sepolia **before** the transfer
would execute. The verdict is a real `newt_createTask` with an attestation you
can open in the Newton Explorer — not a simulation.

The recipient is the only thing screened. Each run also carries a sender
(transactions need one), but it is freshly generated and the policy does not
consult it — the screen has a single input on purpose.

Live: **https://sanctions-demo.newt.foundation** (hosted on the Newton team
Vercel project `newton-aml-ofac-policy-engine`).

---

## Setup

```bash
cd policy-builder
npm install
cp .env.local.example .env.local   # fill in — see below
bash dev.sh
```

`dev.sh` frees port 3000, clears `.next`, typechecks (non-blocking), and starts
the server.

### Environment

`.env.local` is gitignored; a fresh clone will not run without it.

| Variable | Purpose |
| --- | --- |
| `NEWTON_API_KEY` | Authenticates to the Newton gateway. Server-side only. Its account must **own the PolicyClient on-chain**, or the gateway returns 401. |
| `POLICY_CLIENT_DENYLIST` | The PolicyClient tasks are submitted against — currently `0x749753713fC04bbDB5dAf9C66cdE293512fe0eE7`. |
| `NEXT_PUBLIC_POLICY_CLIENT` | Same client address, for display. Baked at build time. |
| `SEPOLIA_RPC_URL` | Optional. Defaults to a public endpoint. |

On Vercel these live under Settings → Environment Variables; changing them
needs a redeploy to take effect.

The demo runs on PolicyClient `0x749753…`, bound to the denylist policy
`0x627222E7…` (CID `bafkreigvmehm…`, entrypoint `newton_sanctions.allow`, 119
addresses). Owner/signer is `0x8b4bA870…`. An earlier client, `0xfd0545…`, was
repurposed by another project — do not point the demo back at it.

---

## How it works

```
UI ──▶ /api/evaluate ──▶ newt_createTask ──▶ operator quorum ──▶ attestation
```

The policy is written in Rego and screens the recipient against a list of
sanctioned addresses held in the PolicyClient's on-chain parameters. Every
operator evaluates the identical rule against the identical list and signs the
same verdict; the combined signature is the attestation the smart contract
would check before releasing funds.

The rule fails closed: an empty or missing list denies rather than approves —
an empty sanctions list is not evidence that an address is clean.

---

## The sanctions list

`lib/ofac-full.ts` holds every sanctioned Ethereum address from a **point-in-time
snapshot** of the OpenSanctions feed (all regimes — currently ~119, across US
OFAC, Israel, Japan and France). It is captured once and frozen on-chain; it does
not track the feed automatically.

To cut a new snapshot, regenerate the list from the `sanctions-api` data and push
it to the on-chain params by hand:

```bash
node scripts/emit-full-list.mjs         # reads ../sanctions-api/wallets.json → lib/ofac-full.ts

set -a; source ../deploy/.env; set +a   # OWNER_PRIVATE_KEY etc.
node policy/setparams.mjs               # dry run
node policy/setparams.mjs --confirm     # send (one transaction, skips if unchanged)
```

Always re-test a **clean** address afterward — a failed params write makes the
policy deny everything, which looks identical to it working.

---

## Routes

| Route | Purpose |
| --- | --- |
| `/api/evaluate` | Submits the task. Rate-limited per IP. |
| `/api/screen` | Which lists an address is on. Explanation, not attestation. |
| `/api/screening-health` | Freshness of the sanctions data. |

---

## Deploying

```bash
bash deploy.sh "what changed"
```

Refuses if a `.env` file is staged, typechecks, runs the production build
locally, then commits, pushes, and promotes with `vercel --prod`. Deploys the
site only; the on-chain policy is managed separately (`policy/DEPLOY.md`).

---

## Design system

`lib/ds.ts` holds the tokens — 8px spacing grid, radii, control heights, type
scale, colour. Components read from it rather than carrying inline values.
Verdict fills carry the only meaningful colour; interaction is ink.

---

## Notes

- Runs on **Ethereum Sepolia**, a test network.
- The list is a **frozen snapshot** — it does not pick up a designation made
  after the snapshot was cut. Re-run the steps under "The sanctions list" to
  capture a newer one.
- An oracle-backed variant that screens a live feed at evaluation time lives in
  `../sanctions-oracle/`; `policy/DEPLOY.md` covers deploying it.
