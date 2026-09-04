/**
 * Load the sanctioned-address list into the denylist PolicyClient's params.
 *
 *   node policy/setparams.mjs                 # dry run, all pool addresses
 *   node policy/setparams.mjs --confirm       # sends
 *   node policy/setparams.mjs --limit 12      # fewer, if the payload is refused
 *
 * WHY THIS EXISTS
 *
 * The yente oracle is unusable right now: Newton's runtime stopped providing
 * `newton:provider/tlsn@0.2.0`, and a policy redeployed to fix that cannot be
 * read by the operators — a freshly pinned CID is fetchable from ipfs.io and
 * Pinata but reports `not found in persisted immutable data backend`. Both
 * blockers are Newton's, and between them there is no working oracle-backed
 * configuration.
 *
 * The denylist policy has neither problem. Its CID was pinned in August and IS
 * in the operator backend — verified by a real quorum-signed task. It has no
 * WASM at all, so there is no component to instantiate and no tlsn to miss.
 * And its address list lives in `policyParams` ON CHAIN, so changing it needs
 * one transaction and no IPFS.
 *
 * WHAT YOU GIVE UP, STATED PLAINLY
 *
 * This is a static snapshot of N addresses, not live multi-regime screening.
 * It cannot catch a designation made this morning. Anything the demo says
 * about a "consolidated live feed" stops being true while this is bound, and
 * the UI copy must say so — a screen that claims live screening while reading
 * a frozen list is the exact category of lie this project exists to avoid.
 *
 * WHY THE POOL AND NOT THE FULL OFAC LIST
 *
 * `deploy/10-shrink-params.mjs` cut this list from 93 addresses to 3 while
 * debugging a failure — "~4KB → ~0.2KB" — so a large payload is suspected of
 * having broken something before. The pool is 24 addresses (~1KB), which is
 * what the UI's "Sanctioned address" button actually offers, so every address
 * a visitor can reach with one click is covered. --limit exists to bisect if
 * even that is refused.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, formatEther, toHex } from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const B = (s) => `\x1b[1m${s}\x1b[0m`;
const RED = (s) => `\x1b[31m${s}\x1b[0m`;

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
const CONFIRM = process.argv.includes("--confirm");
const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

const CLIENT = E.POLICY_CLIENT_DENYLIST;
const OWNER_KEY = E.OWNER_PRIVATE_KEY;

if (!CLIENT) {
  console.error("POLICY_CLIENT_DENYLIST is not set in .env.local.");
  process.exit(1);
}
if (!OWNER_KEY) {
  console.error("OWNER_PRIVATE_KEY is not set.  set -a; source ../deploy/.env; set +a");
  process.exit(1);
}

/**
 * Read straight from the generated pool rather than importing it — this is a
 * .mjs script and that is a .ts module, and adding a TypeScript loader to set
 * one contract field is not worth it.
 */
const pool = [
  ...readFileSync(join(ROOT, "lib/sanctioned-pool.ts"), "utf8").matchAll(/"(0x[0-9a-fA-F]{40})"/g),
].map((m) => m[1]);

if (!pool.length) {
  console.error(RED("No addresses found in lib/sanctioned-pool.ts. Refusing to write an empty"));
  console.error(RED("denylist — the policy denies on `denylist_not_configured`, so an empty"));
  console.error(RED("list would deny every transfer and look exactly like screening working."));
  process.exit(1);
}

const addresses = pool.slice(0, LIMIT);
const params = { sanctioned_addresses: addresses };
const policyParams = toHex(new TextEncoder().encode(JSON.stringify(params)));

const ABI = [
  { type: "function", name: "setPolicy", stateMutability: "nonpayable",
    inputs: [{ name: "policyConfig", type: "tuple", components: [
      { name: "policyParams", type: "bytes" },
      { name: "expireAfter", type: "uint32" },
    ] }], outputs: [{ name: "policyId", type: "bytes32" }] },
  { type: "function", name: "getPolicyAddress", stateMutability: "view",
    inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "getPolicyId", stateMutability: "view",
    inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "getOwner", stateMutability: "view",
    inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "getPolicyConfig", stateMutability: "view",
    inputs: [{ name: "policyId", type: "bytes32" }],
    outputs: [{ type: "tuple", components: [
      { name: "policyParams", type: "bytes" },
      { name: "expireAfter", type: "uint32" },
    ] }] },
];

const rpc = E.SEPOLIA_RPC_URL || E.RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const account = privateKeyToAccount(OWNER_KEY.startsWith("0x") ? OWNER_KEY : `0x${OWNER_KEY}`);
const pub = createPublicClient({ chain: sepolia, transport: http(rpc) });
const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpc) });

const call = (fn, args) => pub.readContract({ address: CLIENT, abi: ABI, functionName: fn, args });

const [owner, policyAddress, policyId, balance] = await Promise.all([
  call("getOwner"),
  call("getPolicyAddress"),
  call("getPolicyId"),
  pub.getBalance({ address: account.address }),
]);

/**
 * expireAfter is carried across, not re-chosen. It is the one field in this
 * config with a unit ambiguity (the CLI talks in blocks, the chain reports
 * 300) and this script has no business resolving that.
 */
const current = await pub
  .readContract({ address: policyAddress, abi: ABI, functionName: "getPolicyConfig", args: [policyId] })
  .catch(() => null);
const expireAfter = Number(current?.expireAfter ?? current?.[1] ?? 0) || 300;

let currentCount = 0;
try {
  const raw = current?.policyParams ?? current?.[0] ?? "0x";
  currentCount = JSON.parse(Buffer.from(raw.slice(2), "hex").toString("utf8"))
    .sanctioned_addresses.length;
} catch {
  /* unknown */
}

console.log(`\n${B("Denylist params")}`);
console.log(`  client        ${CLIENT}`);
console.log(`  policy        ${policyAddress}`);
console.log(`  addresses     ${currentCount} -> ${addresses.length}`);
console.log(`  payload       ${(policyParams.length - 2) / 2} bytes`);
console.log(`  expireAfter   ${expireAfter}  (carried across)`);
console.log(`\n${B("Signer")}`);
console.log(`  address       ${account.address}`);
console.log(`  client owner  ${owner}`);
console.log(`  balance       ${formatEther(balance)} ETH`);

if (owner.toLowerCase() !== account.address.toLowerCase()) {
  console.error(RED("\nSigner is not the client owner. setPolicy is onlyPolicyClientOwner."));
  process.exit(1);
}

if (!CONFIRM) {
  console.log(`\n${B("First three")}`);
  for (const a of addresses.slice(0, 3)) console.log(`  ${a}`);
  console.log(RED("\nDRY RUN. Nothing sent. Re-run with --confirm.\n"));
  process.exit(0);
}

console.log(`\n${B("setPolicy")}`);
const hash = await wallet.writeContract({
  address: CLIENT, abi: ABI, functionName: "setPolicy",
  args: [{ policyParams, expireAfter }],
});
console.log(`  https://sepolia.etherscan.io/tx/${hash}`);
const receipt = await pub.waitForTransactionReceipt({ hash });
console.log(`  ${receipt.status}`);
if (receipt.status !== "success") process.exit(1);

const newId = await call("getPolicyId");
console.log(`\n  policyId  ${policyId}\n         -> ${newId}`);
console.log("\nVerify with a real task before trusting it:");
console.log(`  curl -sS -X POST https://newton-policy-builder.vercel.app/api/evaluate \\`);
console.log(`    -H 'content-type: application/json' \\`);
console.log(`    -d '{"mode":"submit","providerId":"local-denylist","to":"${addresses[0]}"}'`);
console.log("\nevaluation_result all zeros = denied. Then try a clean address and");
console.log("make sure it is ALLOWED — a list that denies everything looks identical");
console.log("to one that works.\n");
