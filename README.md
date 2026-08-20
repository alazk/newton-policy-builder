# Newton Policy Builder

Four steps: **goal → provider → policies → recipient → run.**

"Run" is a real evaluation. The generated Rego goes to a Newton operator and is
executed against a live oracle contract on Ethereum Sepolia. Nothing is deployed.

---

## Setup

```bash
cd policy-builder
npm install
cp .env.local.example .env.local
# paste your key from dashboard.newton.xyz → API Keys
npm run dev
```

Open [localhost:3000](http://localhost:3000).

The API key is read server-side in `app/api/evaluate/route.ts` and never reaches
the browser. It authenticates to the gateway and authorizes secrets management,
so keep it that way if you deploy this.

---

## What makes it work

`simulatePolicy` from `@newton-xyz/sdk` takes **raw Rego plus a deployed
PolicyData address**. That's the whole reason a builder is possible — whatever the
wizard composes gets evaluated for real without deploying a contract first.

```ts
walletClient.simulatePolicy({
  policyClient,
  policy: rego,            // ← generated from your selections
  entrypoint: "newton_builder_policy.allow",
  intent: { from, to, value, data, chainId, functionSignature },
  policyData: [{ policyDataAddress, wasmArgs }],
  policyParams: params,
});
```

`simulateTask`, which the docs quickstart uses, only works against an
already-deployed policy. `simulatePolicy` is the one that accepts arbitrary Rego.

---

## The one path that runs with no signup

**Screen for sanctions → Chainalysis Sanctions (Newton-hosted)** uses PolicyData
`0x30E545603d6205B6887BAb0C1a630aa383d71e07`, a Newton-hosted proxy over the free
Chainalysis sanctions API. No provider account, no key upload.

The other providers are real deployed oracles on Sepolia, but they need their own
credentials uploaded (`newton-cli secrets upload`) before they'll answer. The UI
marks them `needs <KEY>` rather than letting you hit a confusing failure.

| Provider | Sepolia PolicyData | Credentials |
| --- | --- | --- |
| Chainalysis (Newton-hosted) | `0x30E5…1e07` | none |
| Chainalysis pack | `0x223F…8448` | `CHAINALYSIS_SANCTIONS_KEY` |
| Persona | `0xC8fB…717d` | `PERSONA_API_KEY` |
| Sumsub | `0xC2a7…3F52` | `SUMSUB_API_KEY` |
| Webacy | `0x838d…47bF` | `WEBACY_API_KEY` |
| Blockaid | `0x9769…6384` | `BLOCKAID_API_KEY` |

---

## The test that proves it

Step 4 has two shortcut buttons.

- **Clean address** `0x1111…1111` → allowed
- **Sanctioned address** `0x7F367cC41522cE07553e823bf3be79A889DEbe1B` → denied

The second is a real OFAC SDN listing (Danil Potekhin, designated 2020-09-16). I
tested the underlying sanctions endpoint directly and it returns two
identifications for that address and an empty array for the clean one.

---

## How the generated Rego is shaped

Every check is a positive assertion plus a negated deny:

```rego
screening_succeeded if data.data.status == 200
deny contains "screening_unavailable" if not screening_succeeded
allow if count(deny) == 0
```

This is deliberate. Written the obvious way — `allow if data.data.sanctioned ==
false` — an oracle outage makes the reference undefined, the rule never fires, and
you're relying on `default allow := false` catching every case. With the deny-set
form, missing data actively produces a deny you can name and show the user.

That's also why "Fail closed if screening is unavailable" is on by default and
worth leaving on.

---

## Status

**Verified working end to end** against a real Newton operator on Sepolia, using
the *Local OFAC denylist* provider:

| Recipient | Result |
| --- | --- |
| `0x7F367cC4…DEbe1B` (OFAC SDN) | **Denied** |
| `0x1111…1111` (clean) | **Allowed** |

Both round-tripped through `newt_simulatePolicy`. Nothing is deployed — the Rego
and params go to the gateway and an operator evaluates them.

### What it took to get the request accepted

Four rejections, each a real mismatch between the SDK and this gateway build:

1. `missing field 'chain_id'` — the SDK puts `chain_id` only inside `intent`;
   this gateway also wants it at the top of `params`. Hence the direct JSON-RPC
   call instead of `walletClient.simulatePolicy`.
2. `id: invalid type: integer` — `id` must be a **UUID string**, not a JSON-RPC
   scalar.
3. `invalid type: string "0xaa36a7", expected u64` — top-level `chain_id` is a
   plain integer while the one inside `intent` is a hex quantity. Same name, two
   encodings.
4. `policy client … is owned by …, not by caller` — the caller derived from your
   API key must own the PolicyClient on-chain. The docs say this is only enforced
   when a PolicyData declares secrets; in practice it's always enforced.

### The bug worth remembering

`extractAllow()` originally returned `false` when it couldn't find the decision,
and the decision turned out to live at `evaluation_result.result` — a path it
didn't check. So a clean address rendered as **Denied** while the gateway had
said `true`.

It now returns `undefined` on an unrecognised shape and the UI shows an error.
A response you can't parse is not a denial, and rendering it as one is a silent
lie in the direction that looks safe but isn't — you'd trust a screening result
that never happened.

### Still open

- **Not typechecked.** The Desktop folder isn't reachable from my sandbox. Run
  `npx tsc --noEmit` before you rely on it.
- **Chainalysis is untested.** It needs an API key uploaded via
  `newton-cli secrets upload`. The custom WASM oracle in `../sanctions-oracle/`
  *is* deployed and verified end to end — see `verify-both.mjs`.
- **The denylist is a static snapshot.** Five addresses, frozen. Fine for a
  demo, wrong for anything real — that's what the WASM oracle solves.

---

## Extending it

Add a provider or rule in `lib/catalog.ts` — the UI is generated from it, so a new
entry appears in the wizard with no component changes. Rules return `{ helpers,
deny }` Rego fragments that get composed into one policy.

To go from here to a deployed policy: copy the generated Rego, then
`newton-cli regorus parse` → `policy-files generate-cids` → `policy deploy`. See
[../ROADMAP.md](../ROADMAP.md) stage 3.

The CLI installs via `newtup`; latest stable is `v0.5.1`:

```bash
curl -fsSL https://cli.newton.xyz | sh
export PATH="$HOME/.newton/bin:$PATH"
newtup
newton-cli --version
```

If `newtup` is already on the path, `newtup` alone updates it.
