# Deploying the corrected policy

> For the current live/parked state and the switch-to-yente steps, read
> **`../STATUS.md`** first. This file is the deeper on-chain runbook.

## What the site is running RIGHT NOW

**The denylist policy, not the yente one.** This is a fallback, and the reason
is two Newton-side failures, neither of them in this repo.

```
client        0xfd054556b4d00d8b0f897b1ae377ecd17fccae78   (POLICY_CLIENT_DENYLIST)
policy        0x627222E71CCEc59C315c83C095f12458FaB5B221
cid           bafkreigvmehmguzwvy3wla2q56jk25jpfog3ecuym5v6cquoeocjodhqri  (pinned August)
policyId      0x120a4c18c77638c869571e5f10e42e76d2b314ab664e23ddb724224bf393290c
entrypoint    newton_sanctions.allow
params        119 addresses (US OFAC/IL/JP/FR, ETH only), 5381 bytes
expireAfter   300
```

Params-only: no WASM, no oracle, no IPFS fetch at evaluation time. Verified end
to end on the live site — a clean address ALLOWED, and `0x7F367cC4…` (from the
OFAC-only portion, so it also proves the new entries took) DENIED. Both
quorum-signed.

It screens a **fixed list of 119 addresses** across US OFAC, Israel, Japan and
France (Ethereum only). Not live screening, and it cannot catch a designation
made after the snapshot. Regenerate with `node scripts/emit-full-list.mjs`.
`lib/catalog.ts` and the UI copy reflect this; keep it that way while bound.

**The deployed rego is frozen — do not edit it to fix the two imprecisions
below.** Its source is `../deploy/policy-files/policy.rego`, pinned as
`bafkreigvmehm…`, and that exact CID is why it works: it was ingested into the
operator backend in August, and — per NEWTON-ISSUE.md — no CID uploaded since
can be. Change one character of the rego and you get a new CID the operators
cannot fetch, and the demo goes dark. The rule reads
`data.params.sanctioned_addresses`, so the address list is updated through
`setPolicy` params (setparams.mjs) without touching the rego at all.

Two harmless imprecisions live with the freeze:

- Its header comment says "OFAC sanctions screening"; the params are now
  multi-regime. It is a comment — the rule screens whatever is in the params.
- It carries `payer_on_sanctions_list`, screening `input.from`. The UI
  generates a random clean sender, so it never fires. Inert, not wrong.

Both would need a redeploy to correct, and a redeploy breaks ingestion. Leave
them.

To change the list: `node policy/setparams.mjs --confirm`. One transaction, no
IPFS. Always re-test a **clean** address afterwards — if a params write fails,
`denylist_not_configured` fires and everything denies, which is indistinguishable
from screening working.

**A note on payload size.** `deploy/10-shrink-params.mjs` cut this list from 93
addresses to 3 while debugging, leaving a standing belief that ~4KB of params
had broken something. It had not — 4391 bytes wrote fine. That script changed
`expireAfter` in the same transaction, so the two hypotheses were never
separated, and the list stayed small for months on the strength of the wrong
one.

---

## The yente policy: deployed, correct, unreachable

Current (rev-2 — the client `0x7497…` is bound to this):

```
policy        0x990A6E4f57A2561a744EEc169E3fa92Dba098682
policyData    0x66E2f53107790caB29a6374484d705c7b87fa243
cid           bafkreidos2nj2mxvqdfndvnccgbhpgxlqa3icuduszmq7uzbcjmsn57wzi
wasmCid       bafybeidxn6l2eqgidgupesfwz4hm4x4kzcj7pdyi7udbpavywmslot6olm
codeHash      0xe03c05d35e110453cdc7b197cec5d1e43f462dcb47fe9bc4eec864d93dbb28ba
entrypoint    newton_yente.allow
```

(rev-1 `0xDDD3AC3c…` / cid `bafkreiciv3…` / wasm `bafybeidjruvdj…` was the same
policy before a content bump to force fresh CIDs; superseded, still on chain.)

Four fixes, all verified on Regorus via `newton-cli policy simulate`:

1. **`tlsn` removed from the WIT world.** `yente.js` imports only
   `newton:provider/http@0.2.0` but the world declared `secrets` and `tlsn`
   too. A component must have every declared import satisfied whether or not
   it calls them, so when Newton's runtime stopped serving `tlsn@0.2.0` every
   task died on an interface the oracle never uses.
2. **`is_string()` guards.** `lower(null)` is a fatal error in Regorus, not
   undefined — so when the oracle returned `address: null`, the policy
   *crashed* instead of denying, making `screening_unavailable` unreachable
   exactly when the oracle was broken.
3. **Confidence gate inverted**, so a confirmed hit with an absent
   `match_score` denies rather than being allowed with an empty deny set.
4. **Payer rules removed**, since the UI generates the sender.

### Why it is not bound

Operators report:

```
Network error: object bafkreiciv3qsjcc… not found in persisted immutable
data backend
```

That CID is retrievable from `ipfs.io` and `gateway.pinata.cloud` — confirmed
with eight consecutive 200s. So their store is not public IPFS, and content
pinned today does not reach it. CIDs pinned in August do. `deploy/1-upload.mjs`
notes that `cli.newton.xyz` is dead; if that service was what ingested content
into the operator backend, nothing deployed since can be read.

Ruled out, so nobody repeats them: propagation delay (hours, with the CID
serving 200 throughout); a bad pin (re-pinned via the legacy public endpoint,
identical CID, `isDuplicate: true`); authentication (`newton-cli login` then
redeploy — uploads to Pinata only, no registration step, same error); and a
stale deployment (`isPolicyVerified()` true, chain source byte-identical to the
repo). Full write-up in `policy/NEWTON-ISSUE.md`.

Also note `newton-cli policy deploy` reverts with `0x04a5b3ee` on step 2 when
the wasm CID is unchanged — the factory will not mint a second PolicyData for
identical content. That is expected, not a failure: the PolicyData already
exists at `0x7D0371875617d103c8CC28e257125869fA341008`. Use `--skip-data
--policy-data-address` to redeploy just the Policy.

### Restoring it

When Newton fixes either issue:

```bash
node policy/bind.mjs 0xDDD3AC3ceE21a096407E3D9c921908dB1fb743D2 --confirm
```

Then in `lib/catalog.ts` set `providers: ["yente"]`, and put the live-feed
language back in the card blurb, the screening step, the "No match on" chips
and `app/layout.tsx`. Each is marked in place.

**Bind only after checking the CID from a gateway you do not control.** Pinata
answering proves your pin exists, nothing more. That check existed in this file
before the first attempt and was skipped, which is why the first deploy left
the demo returning "No decision" for an hour.

### Older yente policy, before these fixes

```
policy   0xf5c9D9eddCb85395e4D53db309AE3E915ad3897D
cid      bafkreibr4ruqxldeolxwelet7wc6ki7vm7a2ykk7fgxe6fitzphqmcacea
```

Readable by operators, but its PolicyData holds the wasm with the `tlsn`
import, so it fails to instantiate. Not a working fallback.

**Two things moved that you did not ask to move.** `newton-cli` deployed
through its own factory (`0xdfd5ac2D…`, newer than the old `0xe37952D9…` — the
version gate passed before any gas was spent) and set the Policy's owner to the
deployer key from `deploy/.env` (`0x0710868c…`) rather than the previous owner
`0x8b4bA870…`. Neither breaks anything: `owner` gates `setMetadataCid` and
`transferOwnership`, while `setPolicy` is `OnlyPolicyClient`. But control of the
Policy now sits with a key that has been in a chat transcript. `transferOwnership`
once you have rotated.

**IPFS.** The CID was served by Pinata immediately and by the public gateways
only later — `ipfs.io` does not 404 while a pin propagates, it hangs. If
`check.mjs` reports "no gateway answered" right after a deploy, that is
propagation, not a failed pin. Confirm with `gateway.pinata.cloud` before
concluding anything.

---

## Short version

```bash
node policy/check.mjs
```

Prints what is deployed, what would change, the `policyCodeHash` you need, and
every value to carry into `initialize()`. Reads Sepolia directly — no dev
server, no pip install.

Then the two transactions: pin the file, `initialize` a new Policy, repoint the
`PolicyClient`. Then:

```bash
node policy/check.mjs --after
```

Which tells you whether the CID moved and whether anything else moved with it.

Everything below is either detail on those two transactions or the reasoning
behind a line in that script.

**Do you need to do this at all?** The bug requires the oracle to return
`sanctioned: true` with `match_score` absent. The oracle computes that score
over confirmed hits, so a true `sanctioned` implies a score exists and the path
is unreachable today. Nothing is accruing. The cost of leaving it is that the
Rego on the explorer visibly fails open in a file whose own comments say
undefined must never read as clean — a credibility cost, not a live one.
Deferring it to the next redeploy for another reason is a defensible call.

---

Replacing the Rego the operator quorum evaluates. This is an on-chain change,
not a Vercel deploy — `deploy.sh` does not touch it and never has.

**Three changes**, all in
`../sanctions-oracle/yente-policy-files/policy.rego`:

1. **The confidence gate was inverted** relative to every other rule in the
   file, so a confirmed sanctioned match with an absent `match_score` was
   allowed, with an empty deny set. Measured both ways in `policy/gate_test.py`.
   Latent — the current oracle cannot produce that input.

2. **`lower(null)` crashed the whole evaluation.** When the oracle cannot
   screen it returns `address: null`; Regorus raises rather than returning
   undefined, so the policy produced no answer at all and
   `screening_unavailable` was unreachable exactly when it was needed. Guarded
   with `is_string()`. **Reachable, and confirmed on the real engine** —
   `newton-cli policy simulate` went from `Failed to evaluate` to `DENIED`.

3. **The payer rules are removed.** A deliberate loosening: the interface
   generates the sender rather than asking for one, so `payer_sanctioned` could
   never fire legitimately while `payer_not_screened` and
   `payer_address_mismatch` could still fire spuriously and deny a clean
   recipient for an unrelated reason.

(2) is the one that justifies the deploy on its own.

**Who runs this:** you. Every step below needs `OWNER_PRIVATE_KEY` or the
Pinata JWT, and those do not leave your machine.

**Shape of the job, established in step 2:** the Rego is **immutable** on a
deployed Policy — there is no CID setter. This is a new `Policy` plus a
repointed `PolicyClient`, not a one-line update. Budget accordingly.

---

## 0. Rotate the keys first, if you have not

`deploy/.env` was pasted into a chat transcript earlier in this project:
`PRIVATE_KEY`, `OWNER_PRIVATE_KEY` and the Pinata JWT are all compromised and
should be treated as public.

This matters more here than it looks. The owner is who calls `initialize` and
who can repoint the client, so anyone holding that key can stand up a Policy
whose Rego is `default allow := true` and point your client at it. The page
would keep resolving the source from chain and would faithfully display the
permissive policy — everything on screen would be accurate and the demo would
approve every sanctioned address in existence.

Rotate, move the owner role, then come back to step 1.

---

## 1. Record what is deployed now, so you can prove what changed

```bash
node policy/check.mjs
```

It resolves `PolicyClient.getPolicyAddress()` → `Policy.getPolicyCid()` → IPFS,
the same chain state the operators read, and saves it to
`/tmp/policy-before.json` for `--after` and for rollback.

**The diff it prints should show only the gate rules.** If it shows anything
else, `policy/newton_yente.rego` has drifted from the chain and you are about
to deploy something you have not read. Stop and reconcile first.

---

## 2. The write path: there is no CID setter

Read off the ABI the SDK ships —
`node_modules/@newton-xyz/sdk/dist/types/abis/newtonPolicyAbi.d.ts`, which is
the contract's own interface rather than anybody's recollection.

`INewtonPolicy` exposes exactly three non-view functions:

| Function                                  | Changes                          |
| ----------------------------------------- | -------------------------------- |
| `initialize(factory, entrypoint, policyCid, schemaCid, policyData[], metadataCid, owner, policyCodeHash)` | everything, once |
| `setPolicy((bytes policyParams, uint32 expireAfter)) → bytes32` | **params only** |
| `setMetadataCid(string)`                  | metadata only                    |

**`setPolicy` does not take a CID.** It sets `policyParams` and `expireAfter`
and returns a `policyId`. That is the `min_match_score` dial, not the Rego.
There is no `setPolicyCid`, and `policyCid` is a plain view.

So **the Rego is immutable on a deployed Policy.** Changing it means a new
Policy — `initialize` on a fresh instance — and the `PolicyClient` repointed at
it. This is the expensive branch.

Three consequences that follow, all of which bite quietly:

1. **`policyCodeHash` is committed at `initialize`.** The contract carries
   `isPolicyVerified()` and an `InvalidPolicyCodeHash` error, so the hash and
   the pinned bytes have to agree. The SDK computes it for you if you pass
   `policyBytes`; otherwise pass `policyCodeHash` as `keccak256` of the exact
   Rego bytes. Pin and hash **the same file** — a trailing newline added by an
   editor between the two steps is a different hash.

2. **`POLICY_CLIENT_*` may go stale in two places.** `.env.local` and Vercel.
   If `/api/evaluate` still points at the old client while `/api/policy-source`
   reads the new one, the page will display the corrected policy while the
   operators evaluate the old one. Nothing on screen would say so.

3. **`policyId` is derived, not chosen.** `precomputePolicyId(...)` in the SDK
   takes policyContract, policyData, params, client, policyUri, schemaUri,
   entrypoint and expireAfter — so params and CID both feed it. A new policy is
   a new id, and `/api/history` keys off the client, not the id, so old runs
   stay readable.

Step 1 prints all eight `initialize` arguments under **Carry these into
initialize() unchanged** — read off the current Policy's own view functions, so
there is nothing to retype from memory. The new Policy should differ from the
old one in the Rego and nothing else.

The SDK path is `policyFunctions.initialize({ walletClient, policyContractAddress, ... })`.
`newton-cli` wraps the same thing (`commands/policy.rs`, per the SDK's own
comment); prefer whichever you used the first time, so the two deployments
differ in one variable rather than two.

---

## 3. Pin the corrected Rego

Whatever pinned the current CID should pin this one — same service, same
account, so the two are comparable and the old one stays reachable for
rollback.

```bash
# Pinata, if that is still the path. Uses the JWT from deploy/.env.
curl -s -X POST https://api.pinata.cloud/pinning/pinFileToIPFS \
  -H "Authorization: Bearer $PINATA_JWT" \
  -F "file=@policy/newton_yente.rego" \
  | jq -r .IpfsHash
```

Confirm it is retrievable from a gateway you do not control before binding it.
`/api/policy-source` tries ipfs.io, cloudflare-ipfs.com and gateway.pinata.cloud
in that order, and a CID that only resolves on Pinata will make the page look
broken to everyone else:

```bash
NEW_CID=<hash from above>
for gw in https://ipfs.io/ipfs/ https://cloudflare-ipfs.com/ipfs/; do
  printf '%-40s ' "$gw"
  curl -sf --max-time 10 "$gw$NEW_CID" | head -1 || echo "FAILED"
done
```

---

## 3.5. Simulate on the real engine first

`newton-cli policy simulate` runs Regorus — the engine the operators run — not
the rego-cpp interpreter `gate_test.py` uses. It costs nothing and settles the
one risk that matters more than the bug:

```bash
newton-cli policy simulate \
  --rego-file policy/newton_yente.rego \
  --entrypoint newton_yente.allow \
  --wasm-file <the yente oracle .wasm> \
  --policy-params-data policy/params.json \
  --wasm-args <args naming a KNOWN-CLEAN address>
```

Then again with a known-sanctioned address. Clean **first**: a Rego file that
fails to parse makes every rule undefined, every negated deny fire, and the
policy deny everything — at which point the sanctioned case passes for entirely
the wrong reason. This is why `min_score` is written as `default` plus an
override rather than an `else` clause; Regorus is a documented OPA *subset* and
somebody already lost time to that.

What this does **not** prove: case C. `data.wasm` is the output of running the
real oracle, and the real oracle cannot produce a confirmed hit without a
score, so the input that triggers the bug is not reachable through `simulate`
without a stub WASM. Case C stays proven by reasoning plus `gate_test.py` on a
different engine. Proportionate, given the same unreachability is why the bug
is not live.

---

## 4. Deploy

One command. It orchestrates generate-cids → deploy-data → deploy-policy, and
`--policy-file` makes it compute `keccak256` of the local bytes itself — so the
pin and the hash come from the same read of the same file and cannot disagree.

```bash
newton-cli policy deploy \
  --policy-dir <the dir this policy was first deployed from> \
  --policy-file policy/newton_yente.rego \
  --policy-data-address 0x1160AC847c1F13195875A106E6bebB9ac23E25b2 \
  --skip-data \
  --chain-id 11155111
```

`--skip-data` with an explicit `--policy-data-address` is what keeps the
existing yente oracle rather than deploying a second one. Without it you get a
new PolicyData, and the new Policy would be bound to an oracle that has never
answered anything.

`PRIVATE_KEY`, `PINATA_JWT` and `RPC_URL` are read from the environment. They
stay there.

**`--policy-dir` matters.** `deploy` takes no `--entrypoint`, `--schema-cid`,
`--metadata-cid` or `--owner` flags, so those come from the directory's
`configs/deployment.toml` and its layout. Point it at the directory this policy
was originally deployed from, or the new Policy will differ from the old one in
more than the Rego. Step 1 printed the four values to check against.

**Watch `expireAfter`.** The CLI's `--expire-after-blocks` defaults to "300
seconds converted to blocks"; the chain currently reports `300`. Those are not
obviously the same unit. `check.mjs --after` flags it if the number moves.

Then repoint the `PolicyClient` at the new Policy — `deploy` creates the
Policy, it does not rebind your client.

The `policyCodeHash` to pass is the one step 1 printed — `keccak256` of the
exact bytes of `policy/newton_yente.rego`, via viem. Pin **that same file**;
if your editor adds a trailing newline between pinning and hashing, the hash no
longer describes the bytes.

If `isPolicyVerified()` comes back false on the new Policy, stop. The operators
will refuse it, every task will fail, and a task that fails looks the same as a
task that was denied.

---

## 5. Verify against the chain, not against your intention

```bash
node policy/check.mjs --after
```

It compares against the snapshot from step 1 and reports:

- whether the CID moved — and says so loudly if it did **not**, which means the
  client is still on the old policy
- whether `entrypoint`, `expireAfter`, `schemaCid`, `owner` or `params` moved
  with it, which would be an accident
- whether the source now on chain is byte-identical to the repo
- `isPolicyVerified()`

One thing it cannot check: Vercel. It reads `POLICY_CLIENT_YENTE ??
POLICY_CLIENT` from your local environment, so if production still names the
old client it will keep submitting to the old policy while localhost looks
correct. Nothing on screen would say so.

```bash
npx vercel env ls
```

Must name the same client the script printed.

---

## 6. Behavioural check — all four, in this order

The order matters. A clean address is the only case that can distinguish "the
policy works" from "the policy denies everything", which is the failure this
project has already shipped twice.

| # | Input                         | Expect                    | Catches                          |
|---|-------------------------------|---------------------------|----------------------------------|
| 1 | Known-clean address           | Compliant                 | policy that denies everything    |
| 2 | Known-sanctioned address      | Non Compliant             | policy that allows everything    |
| 3 | Malformed / non-address       | refused before submission | client validation                |
| 4 | Screening feed stale          | Screening unavailable     | fail-closed path                 |

Case 1 first. If a parse error crept in, every rule is undefined, every negated
deny fires, and case 2 passes for entirely the wrong reason.

Case 4 needs `MAX_AGE_HOURS = 0` in `sanctions-api` — this has never actually
been exercised, and the grey `unavailable` verdict has never been seen against
a genuinely stale feed.

For case 1 and 2, check the Newton explorer as well as the dashboard. They
disagreed once, and the dashboard was the one that was wrong.

---

## 7. Roll back

Cheap, because the old Policy is not modified by any of this — it is still
deployed, still initialized, still holding the old CID. Rolling back is
repointing the `PolicyClient` at the old `policyAddress` from step 1, and
reverting the env vars if they changed. No re-pin, no re-initialize.

Which is the one good thing about the Rego being immutable.

---

## What this does not fix

`blocked_datasets`. The on-chain comment says "when blocked_datasets is set,
only those lists are enforced", but the rules only add a second reason on top
of `payee_sanctioned`, which already fires on any confirmed hit. Setting it
narrows nothing.

Left alone deliberately: the behaviour is stricter than the comment promises,
and correcting it would mean the quorum signs a policy that denies *less* than
the current one. That is a compliance decision, not a cleanup, and it should be
made on purpose.
