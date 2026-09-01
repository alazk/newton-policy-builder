/**
 * Everything in the runbook that reads rather than signs.
 *
 *   node policy/check.mjs           before: what is deployed, what would change
 *   node policy/check.mjs --after   after:  did it land, did anything else move
 *
 * No dev server. The first version of this shelled out to
 * /api/policy-source, which meant `npm run dev` had to be up to answer a
 * question about the chain — a needless moving part between you and the
 * answer. This does the same reads directly: viem is already a dependency and
 * the ABI is the one the SDK ships.
 *
 * No python either. keccak256 comes from viem, so there is nothing to pip
 * install and no chance of reaching for sha3-256 by mistake, which is a
 * different hash that would sail through review and fail on chain.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, parseAbiItem, keccak256 } from "viem";
import { sepolia } from "viem/chains";

// Resolved against the script, not the shell's cwd, so it works from
// anywhere. Relative paths would have made `cd policy && node check.mjs`
// report "no .env.local" and fall over on a missing POLICY_CLIENT — an
// error that points at your config rather than at where you are standing.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const AFTER = process.argv.includes("--after");

/**
 * The deployable file, which lives outside this repo.
 *
 * `newton-cli policy deploy -p` reads a directory: the Rego, the params
 * schema, the metadata and policy.wasm together. That directory is the policy.
 * Diffing a copy kept over here would mean this script could pass while the
 * file that actually deploys had drifted — which is the exact shape of the
 * generated-policy.rego problem.
 */
const REGO_LABEL = process.env.REGO_PATH || "../sanctions-oracle/yente-policy-files/policy.rego";
const REGO = process.env.REGO_PATH || join(ROOT, REGO_LABEL);
const SNAPSHOT = "/tmp/policy-before.json";

if (!existsSync(REGO)) {
  console.error(`Cannot find the policy source at ${REGO}`);
  console.error("Set REGO_PATH, or fix the path at the top of this script.");
  process.exit(1);
}

const B = (s) => `\x1b[1m${s}\x1b[0m`;
const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const say = (s) => console.log(`\n${B(s)}`);

/** .env.local is not loaded for a bare node script, so read it ourselves. */
function env(file = join(ROOT, ".env.local")) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const E = { ...env(), ...process.env };
const CLIENT = E.POLICY_CLIENT_YENTE || E.POLICY_CLIENT;

if (!CLIENT) {
  console.error("No POLICY_CLIENT_YENTE or POLICY_CLIENT in .env.local.");
  process.exit(1);
}

const client = createPublicClient({
  chain: sepolia,
  transport: http(E.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com"),
});

// Straight from @newton-xyz/sdk/dist/types/abis/newtonPolicyAbi — the
// contract's own interface, not a recollection of it.
const fn = {
  policyAddress: parseAbiItem("function getPolicyAddress() view returns (address)"),
  policyId: parseAbiItem("function getPolicyId() view returns (bytes32)"),
  cid: parseAbiItem("function getPolicyCid() view returns (string)"),
  entrypoint: parseAbiItem("function getEntrypoint() view returns (string)"),
  schemaCid: parseAbiItem("function getSchemaCid() view returns (string)"),
  metadataCid: parseAbiItem("function metadataCid() view returns (string)"),
  owner: parseAbiItem("function owner() view returns (address)"),
  verified: parseAbiItem("function isPolicyVerified() view returns (bool)"),
  policyData: parseAbiItem("function getPolicyData() view returns (address[])"),
  factory: parseAbiItem("function factory() view returns (address)"),
  config: parseAbiItem(
    "function getPolicyConfig(bytes32 policyId) view returns ((bytes policyParams, uint32 expireAfter))",
  ),
};

const read = (address, item, args) =>
  client
    .readContract({ address, abi: [item], functionName: item.name, args })
    .catch((e) => ({ __err: e.shortMessage || e.message }));

const val = (v) => (v && v.__err ? null : v);

/**
 * Ordered by who is likely to have it, not by preference.
 *
 * A freshly pinned CID lives on Pinata's nodes and nowhere else until the DHT
 * catches up, and ipfs.io does not 404 in the meantime — it hangs for the full
 * timeout looking for a provider. Asking it first meant waiting 30 seconds to
 * be told nothing, and reporting "could not fetch" about content that was
 * sitting on a gateway two lines down.
 *
 * The public gateways stay in the list, and it is worth noticing when they
 * start answering: that is the signal the policy is retrievable by someone who
 * is not you.
 */
const PIN_GW = (process.env.PINATA_GATEWAY || "").replace(/^https?:\/\//, "").replace(/\/$/, "");

const GATEWAYS = [
  ...(PIN_GW ? [`https://${PIN_GW}/ipfs/`] : []),
  "https://gateway.pinata.cloud/ipfs/",
  "https://ipfs.io/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
];

async function fromIpfs(cid) {
  for (const gw of GATEWAYS) {
    try {
      const res = await fetch(gw + cid, { signal: AbortSignal.timeout(10_000) });
      if (res.ok) return { source: await res.text(), via: gw };
    } catch {
      /* next gateway */
    }
  }
  return { source: "", via: "" };
}

// ── Read ──────────────────────────────────────────────────────────

const policyAddress = val(await read(CLIENT, fn.policyAddress));
if (!policyAddress) {
  console.error(`getPolicyAddress() failed on ${CLIENT}. Wrong address, or wrong network?`);
  process.exit(1);
}

const [cid, entrypoint, schemaCid, metadataCid, owner, verified, policyData, factory, policyId] =
  await Promise.all([
    read(policyAddress, fn.cid),
    read(policyAddress, fn.entrypoint),
    read(policyAddress, fn.schemaCid),
    read(policyAddress, fn.metadataCid),
    read(policyAddress, fn.owner),
    read(policyAddress, fn.verified),
    read(policyAddress, fn.policyData),
    read(policyAddress, fn.factory),
    read(CLIENT, fn.policyId),
  ]);

let params = null;
let paramsHex = null;
let expireAfter = null;
if (val(policyId)) {
  const cfg = await read(policyAddress, fn.config, [policyId]);
  if (val(cfg)) {
    expireAfter = Number(cfg.expireAfter ?? cfg[1] ?? 0) || null;
    const raw = cfg.policyParams ?? cfg[0] ?? "0x";
    /**
     * The RAW bytes are kept as well as the parsed object, because the rebind
     * has to set the identical bytes. Re-serialising {"blocked_datasets":[]}
     * from the parsed form could differ by a space, and policyParams feeds
     * precomputePolicyId — different bytes, different policyId, and every
     * attestation from then on carries a different id than the ones before it.
     */
    if (raw && raw !== "0x") {
      paramsHex = raw;
      try {
        params = JSON.parse(Buffer.from(raw.slice(2), "hex").toString("utf8"));
      } catch {
        params = null; // unreadable is reported as unknown, never as absent
      }
    }
  }
}

const { source, via } = await fromIpfs(val(cid) ?? "");
const local = readFileSync(REGO);

const state = {
  cid: val(cid),
  policyAddress,
  policyClient: CLIENT,
  entrypoint: val(entrypoint),
  params,
  paramsHex,
  expireAfter,
  schemaCid: val(schemaCid),
  metadataCid: val(metadataCid),
  owner: val(owner),
  policyData: val(policyData),
  factory: val(factory),
  isPolicyVerified: val(verified),
  via,
  source,
};

// ── Report ────────────────────────────────────────────────────────

say("On chain");
console.log(
  `  client        ${CLIENT}
  policy        ${policyAddress}
  cid           ${state.cid}
  entrypoint    ${state.entrypoint}
  params        ${params ? JSON.stringify(params) : "unreadable"}
  expireAfter   ${expireAfter ?? "unset"}
  verified      ${state.isPolicyVerified}
  source via    ${via || RED("no gateway answered")}`,
);

// Grouped by the call that consumes them. These are two different functions
// with two different argument lists, and an earlier version of this script
// printed them as one block — which listed params and expireAfter as
// initialize() arguments (they are not) and omitted _factory (which is).
say("initialize() — all eight, in order");
console.log(
  `  _factory         ${state.factory}
  _entrypoint      ${state.entrypoint}
  _policyCid       <the new pin, from step 3>
  _schemaCid       ${state.schemaCid}
  _policyData[]    ${(state.policyData || []).join(", ") || "—"}
  _metadataCid     ${state.metadataCid || '""'}
  _owner           ${state.owner}
  _policyCodeHash  <printed below>`,
);

say("setPolicy() — separately, afterwards");
console.log(
  `  policyParams   ${params ? JSON.stringify(params) : "—"}
  expireAfter    ${expireAfter ?? "—"}`,
);
console.log("\n  policyParams and expireAfter are NOT initialize() arguments. A fresh");
console.log("  Policy has no config until setPolicy is called, and min_score then");
console.log("  falls back to its default — which happens to be the same 0 you have");
console.log("  today, so a missed setPolicy would look like nothing was wrong.");

say(`policyCodeHash for ${REGO_LABEL}`);
console.log(`  ${keccak256(local)}`);
console.log("  Pin and hash the same bytes. initialize() commits this and");
console.log("  isPolicyVerified() checks it; a mismatch fails every task, and a");
console.log("  failed task looks exactly like a denied one.");

if (!AFTER) {
  writeFileSync(SNAPSHOT, JSON.stringify(state, null, 2));

  say("What would change");
  if (!source) {
    console.log(RED("  Could not fetch the deployed source. Cannot diff."));
  } else if (source === local.toString()) {
    console.log("  Nothing — the repo already matches the chain.");
  } else {
    const chain = source.split("\n");
    const repo = local.toString().split("\n");
    const only = (a, b) => a.filter((l) => l.trim() && !l.trim().startsWith("#") && !b.includes(l));
    for (const l of only(chain, repo)) console.log(RED(`  - ${l.trim()}`));
    for (const l of only(repo, chain)) console.log(`  + ${l.trim()}`);
    // This used to say "only the gate rules should appear", which stopped
    // being true the moment the deploy carried three changes instead of one —
    // and a warning that fires when nothing is wrong is a warning you learn to
    // scroll past. It cannot know which diff is intended, so it says what it
    // can stand behind.
    console.log("\n  Read every line. This is what the operators would start running.");
    console.log("  Anything you did not put there means the repo has drifted.");
  }

  say("Roll back to");
  console.log(`  policy ${policyAddress}   cid ${state.cid}`);
  console.log(`\n  Saved ${SNAPSHOT}`);
} else {
  say("Did it land?");
  if (!existsSync(SNAPSHOT)) {
    console.log("  No snapshot — run without --after first, next time.");
  } else {
    const before = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
    console.log(
      before.cid === state.cid
        ? RED(`  !! cid UNCHANGED (${state.cid}) — the client is still on the old policy`)
        : `  cid   ${before.cid} -> ${state.cid}`,
    );
    // Anything other than the policy and its CID moving is an accident.
    for (const k of ["entrypoint", "expireAfter", "schemaCid", "owner", "factory"]) {
      const a = JSON.stringify(before[k]);
      const b = JSON.stringify(state[k]);
      console.log(a === b ? `  ${k} unchanged` : RED(`  !! ${k} MOVED: ${a} -> ${b}`));
    }
    const pa = JSON.stringify(before.params);
    const pb = JSON.stringify(state.params);
    console.log(pa === pb ? "  params unchanged" : RED(`  !! params MOVED: ${pa} -> ${pb}`));
  }

  say("Chain vs repo");
  if (!source) {
    /**
     * Not the same thing as a mismatch, and saying "DIFFERS" here was wrong.
     * An empty source means no public gateway served the CID — which is its
     * own, more urgent problem: the operators fetch the policy by CID too, so
     * a CID that nothing will serve makes every task fail.
     */
    console.log(RED("  Could not fetch the source from any gateway — nothing to compare."));
    console.log(RED("  A freshly pinned CID can take minutes to propagate. Until it does,"));
    console.log(RED("  an operator asked to evaluate this policy may not be able to read it."));
  } else if (source === local.toString()) {
    console.log("  Identical — the operators run this file.");
  } else {
    console.log(RED("  DIFFERS. The explorer is not showing " + REGO_LABEL));
  }

  if (state.isPolicyVerified === false) {
    console.log(RED("\n  isPolicyVerified() is FALSE. The code hash does not match the"));
    console.log(RED("  pinned bytes. Every task will fail. Stop here."));
  }

  say("Now run all four by hand");
  console.log(`  1  clean address       -> Compliant       (catches deny-everything)
  2  sanctioned address  -> Non Compliant   (catches allow-everything)
  3  malformed input     -> refused locally
  4  stale feed          -> Screening unavailable

  Case 1 FIRST. A parse error denies everything, and case 2 then passes
  for entirely the wrong reason.`);
}

say("PolicyClient, in both environments");
console.log(`  local    ${CLIENT}`);
console.log("  remote   npx vercel env ls    <- must name the same client");
console.log("");
