/**
 * Point the PolicyClient at a new Policy, carrying the old config across
 * untouched.
 *
 *   node policy/bind.mjs 0xNEW_POLICY_ADDRESS            # dry run
 *   node policy/bind.mjs 0xNEW_POLICY_ADDRESS --confirm  # sends
 *
 * Needs OWNER_PRIVATE_KEY in the environment — the PolicyClient's owner, which
 * is NOT the key that deployed the policy. Both calls are
 * onlyPolicyClientOwner.
 *
 * WHY NOT deploy/3-bind-policy.mjs, which already does this:
 *
 *   1. It sets `params = { sanctioned_addresses: [...the whole OFAC list] }`.
 *      That belongs to the params-only denylist policy, not this one. The
 *      yente policy reads min_match_score and blocked_datasets, neither of
 *      which would be there — it would still WORK, because both fall back to
 *      defaults, which is exactly what makes it dangerous. A misconfigured
 *      policy that behaves correctly today is one that surprises you later.
 *
 *   2. EXPIRE_AFTER defaults to 1,000,000 blocks. The live config is 300.
 *
 *   3. It reads deployment.json for the policy address, which still names the
 *      old one.
 *
 * So this takes the address as an argument and the config from the chain
 * itself — the raw policyParams bytes, not a re-serialised copy of them.
 * policyParams feeds precomputePolicyId, so a re-encoding that differs by a
 * single space produces a different policyId and every attestation after it
 * stops matching the ones before.
 *
 * Contract surface is lifted from deploy/3-bind-policy.mjs, which cites
 * newton-contracts src/mixins/NewtonPolicyClient.sol:
 *
 *   setPolicyAddress(address)  — binds, and runs a version gate against the
 *                                TaskManager's minCompatiblePolicyVersion
 *   setPolicy((bytes,uint32))  — sets params, returns policyId
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, formatEther, isAddress } from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const B = (s) => `\x1b[1m${s}\x1b[0m`;

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
const NEW_POLICY = process.argv.slice(2).find((a) => a.startsWith("0x"));

if (!NEW_POLICY || !isAddress(NEW_POLICY)) {
  console.error("Usage: node policy/bind.mjs 0xNEW_POLICY_ADDRESS [--confirm]");
  process.exit(1);
}

const CLIENT = E.POLICY_CLIENT_YENTE || E.POLICY_CLIENT;
const OWNER_KEY = E.OWNER_PRIVATE_KEY;

if (!CLIENT) {
  console.error("No POLICY_CLIENT_YENTE or POLICY_CLIENT.");
  process.exit(1);
}
if (!OWNER_KEY) {
  console.error("OWNER_PRIVATE_KEY is not set. It is the PolicyClient's owner key,");
  console.error("not the deployer's — both calls here are onlyPolicyClientOwner.");
  console.error("  set -a; source ../deploy/.env; set +a");
  process.exit(1);
}

const ABI = [
  { type: "function", name: "setPolicyAddress", stateMutability: "nonpayable",
    inputs: [{ name: "policy", type: "address" }], outputs: [] },
  // On the POLICY, not the client. Non-zero once setPolicy has registered this
  // client — the only way to tell a finished bind from a half-finished one.
  { type: "function", name: "clientToPolicyId", stateMutability: "view",
    inputs: [{ name: "", type: "address" }], outputs: [{ type: "bytes32" }] },
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
  // On the POLICY. Reads back the exact bytes currently in force.
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

const call = (functionName, args) =>
  pub.readContract({ address: CLIENT, abi: ABI, functionName, args });

const [owner, currentPolicy, currentId, balance] = await Promise.all([
  call("getOwner"),
  call("getPolicyAddress").catch(() => "0x0000000000000000000000000000000000000000"),
  call("getPolicyId"),
  pub.getBalance({ address: account.address }),
]);

/**
 * The config comes from the chain, not from a file in /tmp.
 *
 * This used to require the snapshot `check.mjs` writes. Then a reboot cleared
 * /tmp and the ROLLBACK refused to run — a recovery tool failing because a
 * scratch file went missing, at the exact moment you need it. The bytes in
 * force are readable from the contract that holds them, so read them there.
 */
const cfg = await pub
  .readContract({
    address: currentPolicy, abi: ABI, functionName: "getPolicyConfig", args: [currentId],
  })
  .catch(() => null);

const paramsHex = cfg?.policyParams ?? cfg?.[0] ?? null;
const expireAfter = Number(cfg?.expireAfter ?? cfg?.[1] ?? 0) || null;

if (!paramsHex || paramsHex === "0x" || !expireAfter) {
  console.error(RED("\nCould not read the live policy config. Refusing to guess."));
  console.error(`  policy ${currentPolicy}  policyId ${currentId}`);
  process.exit(1);
}

let paramsText = "(not UTF-8 JSON)";
try {
  paramsText = Buffer.from(paramsHex.slice(2), "hex").toString("utf8");
} catch {
  /* shown as-is */
}

console.log(`\n${B("Rebinding")}`);
console.log(`  client        ${CLIENT}`);
console.log(`  from policy   ${currentPolicy}`);
console.log(`  to policy     ${NEW_POLICY}`);
console.log(`  policyId now  ${currentId}`);
console.log(`\n${B("Config read from chain, carried across byte for byte")}`);
console.log(`  policyParams  ${paramsHex}`);
console.log(`                ${paramsText}`);
console.log(`  expireAfter   ${expireAfter}`);
console.log(`\n${B("Signer")}`);
console.log(`  address       ${account.address}`);
console.log(`  client owner  ${owner}`);
console.log(`  balance       ${formatEther(balance)} ETH`);

if (owner.toLowerCase() !== account.address.toLowerCase()) {
  console.error(RED("\nSigner is not the client owner. Both calls would revert."));
  process.exit(1);
}

/**
 * This is two transactions, so there is a third state between "not bound" and
 * "bound": the address is set but setPolicy has not registered a config.
 *
 * An earlier version exited here on `currentPolicy === NEW_POLICY` with
 * "already bound, nothing to do" — which is exactly wrong in that middle
 * state. It would have looked at a half-finished bind and reported success,
 * leaving the client pointed at a Policy that holds no config for it. Tasks
 * would fail, and a failed task reads like a denial.
 *
 * clientToPolicyId on the NEW policy is what distinguishes them.
 */
const addressBound = currentPolicy.toLowerCase() === NEW_POLICY.toLowerCase();
const registeredId = await pub
  .readContract({ address: NEW_POLICY, abi: ABI, functionName: "clientToPolicyId", args: [CLIENT] })
  .catch(() => "0x0");
const configured = !/^0x0*$/.test(registeredId);

if (addressBound && configured) {
  console.log("\nAlready bound and configured. Nothing to do.");
  console.log(`  policyId  ${registeredId}`);
  process.exit(0);
}

if (addressBound && !configured) {
  console.log(RED("\nHALF-BOUND — resuming."));
  console.log("  setPolicyAddress landed; setPolicy did not. The client points at the");
  console.log("  new Policy, which holds no config for it. Running setPolicy only.");
}

// Simulated first, because setPolicyAddress runs a version gate: it reads the
// policy's factory version against the TaskManager's
// minCompatiblePolicyVersion and reverts with IncompatiblePolicyVersion. Far
// better to see that here than in a receipt.
if (!addressBound) {
  console.log(`\n${B("Simulating setPolicyAddress")}`);
  await pub.simulateContract({
    address: CLIENT, abi: ABI, functionName: "setPolicyAddress",
    args: [NEW_POLICY], account,
  });
  console.log("  ok — version gate passed");
}

if (!CONFIRM) {
  console.log(RED("\nDRY RUN. Nothing sent."));
  console.log("setPolicy cannot be simulated until the address is bound, so it only");
  console.log("runs for real. Re-run with --confirm.\n");
  process.exit(0);
}

if (!addressBound) {
  console.log(`\n${B("setPolicyAddress")}  (1 of 2 — do not interrupt)`);
  const h1 = await wallet.writeContract({
    address: CLIENT, abi: ABI, functionName: "setPolicyAddress", args: [NEW_POLICY],
  });
  console.log(`  https://sepolia.etherscan.io/tx/${h1}`);
  const r1 = await pub.waitForTransactionReceipt({ hash: h1 });
  console.log(`  ${r1.status}`);
  if (r1.status !== "success") process.exit(1);
}

console.log(`\n${B("setPolicy")}  (2 of 2 — do not interrupt)`);
const h2 = await wallet.writeContract({
  address: CLIENT, abi: ABI, functionName: "setPolicy",
  args: [{ policyParams: paramsHex, expireAfter }],
});
console.log(`  https://sepolia.etherscan.io/tx/${h2}`);
const r2 = await pub.waitForTransactionReceipt({ hash: h2 });
console.log(`  ${r2.status}`);
if (r2.status !== "success") process.exit(1);

const newId = await call("getPolicyId");
console.log(`\n  policyId  ${currentId}\n         -> ${newId}`);
if (/^0x0+$/.test(newId)) {
  console.error(RED("\npolicyId is zero — the binding did not take."));
  process.exit(1);
}

console.log("\nNow: node policy/check.mjs --after\n");
