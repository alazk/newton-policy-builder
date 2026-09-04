# Two blockers on Sepolia

Both reproducible, both outside our control. Written for Newton; kept here so
the evidence survives.

Environment: Sepolia (11155111), `newton-cli`, PolicyClient
`0x749753713fC04bbDB5dAf9C66cdE293512fe0eE7`.

---

## 1. Runtime no longer provides `newton:provider/tlsn@0.2.0`

Operators return:

```
Data provider error: Parse error: Failed to process policy data:
policy data 0x1160AC847c1F13195875A106E6bebB9ac23E25b2:
Parse error: failed to instantiate wasm component: component imports
instance `newton:provider/tlsn@0.2.0`, but a matching implementation was
not found in the linker
```

The component was built with `componentize-js` against `newton-provider.wit`,
package `newton:provider@0.2.0`, whose world declares `http`, `secrets` and
`tlsn`. It calls only `http`. It had been working for weeks.

Note the error names `tlsn` and not `http`, so `http@0.2.0` still resolves —
the runtime has dropped one interface from a pinned package version. Any
component built against that WIT breaks, whether or not it uses tlsn, because
every declared import must be satisfied at instantiation.

**Worked around** by removing `secrets` and `tlsn` from the world and
rebuilding. `newton-cli policy simulate` then returns DENIED for a designated
address with `status: 200` and `match_score: 1`. But shipping that fix requires
a redeploy, which hits issue 2.

**Question:** is `newton:provider@0.2.0` still supported, and is there a
current WIT to build against?

---

## 2. Policy CIDs deployed now are not readable by operators

```
Data provider error: Network error: object
bafkreiciv3qsjccb5wjsqzhsgkquhw2vmcxjnwnj6cp3gjkukd7sr42cai
not found in persisted immutable data backend
```

State of that policy — everything looks correct:

```
policy            0xDDD3AC3ceE21a096407E3D9c921908dB1fb743D2
policyData        0x7D0371875617d103c8CC28e257125869fA341008
policyCid         bafkreiciv3qsjccb5wjsqzhsgkquhw2vmcxjnwnj6cp3gjkukd7sr42cai
wasmCid           bafybeidjruvdj4q7bhh6hh3agas7czqg6gyshd25qtqgq2eqjzbnjcq4te
policyCodeHash    0xa2532ab470713e4d120c8731e1efe0a450346741795e63d286a8b5a7069f4143
isPolicyVerified  true
entrypoint        newton_yente.allow
```

Both CIDs are publicly retrievable:

```
$ curl -o /dev/null -w '%{http_code} %{size_download}\n' \
    https://ipfs.io/ipfs/bafkreiciv3qsjcc…
200 8492

$ curl -o /dev/null -w '%{http_code} %{size_download}\n' \
    https://ipfs.io/ipfs/bafybeidjruvdj4…
200 12495303
```

Eight consecutive successes on each, from `ipfs.io`, `gateway.pinata.cloud`
and our dedicated Pinata gateway.

### The decisive test

The dashboard's **own oracle simulator** — Newton code, Newton servers, Newton
backend — fails to resolve the wasm it was just told to reference:

```
Simulation Error: failed to execute PolicyData WASM at
0x66E2f53107790caB29a6374484d705c7b87fa243: failed resolving WASM binary
(cid=bafybeidxn6l2eqgidgupesfwz4hm4x4kzcj7pdyi7udbpavywmslot6olm):
object … not found in persisted immutable data backend
```

That wasm was uploaded minutes earlier via `newton-cli policy deploy` on the
Newton IPFS proxy (log line: `Uploading via Newton IPFS proxy`), and the
PolicyData contract deployed successfully on chain. The upload path reports
success; the backend the simulator reads from does not have the object.

Four independent upload paths, all failing identically:

1. `newton-cli policy deploy` with direct Pinata (`PINATA_JWT` set)
2. `newton-cli policy deploy` via the Newton IPFS proxy (`PINATA_JWT` unset) —
   the documented default
3. Dashboard "Publish"
4. Dashboard "Custom Data Oracle" → Simulate

### What has been ruled out

- **Propagation delay.** Still failing hours later, with the CID serving 200
  publicly throughout.
- **A bad pin.** Re-pinned via `api.pinata.cloud/pinning/pinFileToIPFS` with
  `cidVersion: 1`; returns the identical CID and `isDuplicate: true`.
- **Authentication.** Ran `newton-cli login` (wallet
  `0x8b4ba870…`), then redeployed. Output shows uploads to Pinata only, with no
  registration or dashboard step. Same error afterwards.
- **A stale or wrong deployment.** `isPolicyVerified()` is true and the source
  on chain is byte-identical to the local file.
- **Wrong address.** The error names exactly the CID the PolicyClient is bound
  to (`getPolicyAddress → getPolicyCid`). The operators resolve the right
  object; they cannot fetch it.
- **Account / token mismatch.** One Newton account (`sub 9558fbd8…`, wallet
  `0x8b4ba870…`), one `rpc` API key. The CLI upload (login JWT) and the task
  evaluation (that API key) are the same account, and the fallback denylist
  policy works with that same key against an older, ingested CID — so the
  account's read path is fine.
- **CLI version.** Reproduced on the dashboard, which does not use the CLI at
  all (paths 3 and 4 above). An older CLI cannot be the cause.

A policy deployed **2026-08-19**, CID
`bafkreibr4ruqxldeolxwelet7wc6ki7vm7a2ykk7fgxe6fitzphqmcacea`, is read by
operators without trouble. Everything deployed since is not.

Our `deploy/1-upload.mjs` carries a note that `cli.newton.xyz` was dead by the
time it was written, and it uploads to Pinata directly to work around that. If
that host was what ingested content into the operator backend, that would fit
the timeline exactly.

**Question:** how does a policy CID enter the persisted immutable data backend?
Is there a fetch trigger, a schedule, an authenticated upload, or a gateway the
operators must be pointed at? `newton-cli policy deploy` does not appear to
perform that step, and `policy-data` and `policy-files` expose no upload
command.

---

## Impact

Between them, no new policy can be deployed to Sepolia: issue 1 breaks every
existing component, and issue 2 prevents shipping the fix.

Our demo is running on a params-only fallback policy whose CID predates the
breakage, which is why it still works — it fetches nothing at evaluation time.
