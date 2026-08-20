/**
 * Prove the history route reads real logs.
 *
 *   node scripts/verify-history.mjs
 *
 * Why this exists: the event ABI in app/api/history/route.ts was transcribed
 * from the contracts, and the whole struct tree is hashed into topic0. A
 * single wrong type does not throw — it produces a topic that matches no log
 * ever emitted, and the feed comes back empty looking exactly like "no runs
 * yet". That is the same shape of bug as the data.data/data.wasm one: a
 * failure that presents as an ordinary empty result.
 *
 * So this checks the two things that can be wrong independently:
 *   1. does the signature hash to a topic that appears on chain at all
 *   2. does a decoded task actually carry our PolicyClient and a sane address
 */

import { createPublicClient, http, parseAbiItem, toEventSelector } from "viem";
import { sepolia } from "viem/chains";
import { readFileSync } from "node:fs";
import path from "node:path";

// .env.local, without adding a dotenv dependency.
const env = Object.fromEntries(
  readFileSync(path.join(process.cwd(), ".env.local"), "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const POLICY_CLIENT = env.POLICY_CLIENT_YENTE ?? env.POLICY_CLIENT;
const RPC = env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";

const NEW_TASK_CREATED = parseAbiItem(
  "event NewTaskCreated(bytes32 indexed taskId, (bytes32 taskId, address policyClient, uint32 taskCreatedBlock, uint32 quorumThresholdPercentage, (address from, address to, uint256 value, bytes data, uint256 chainId, bytes functionSignature) intent, bytes intentSignature, bytes wasmArgs, bytes quorumNumbers, uint256 initializationTimestamp) task, (address policyAddress, bytes32 policyId, (bytes policyParams, uint32 expireAfter) policyConfig) state)",
);

const POLICY_DENIED = parseAbiItem(
  "event PolicyDenied(address indexed policyClient, bytes32 indexed taskId, bytes32 policyId, bytes32 intentHash, uint32 referenceBlock)",
);

const GET_TASK_MANAGER = parseAbiItem(
  "function getNewtonPolicyTaskManager() view returns (address)",
);

const client = createPublicClient({ chain: sepolia, transport: http(RPC) });

console.log("client        ", POLICY_CLIENT);
console.log("NewTaskCreated", toEventSelector(NEW_TASK_CREATED));
console.log("PolicyDenied  ", toEventSelector(POLICY_DENIED));

// Asked of the client. Public RPCs reject getLogs with no address filter, so
// this has to come first — everything below is scoped to it.
const taskManager = await client.readContract({
  address: POLICY_CLIENT,
  abi: [GET_TASK_MANAGER],
  functionName: "getNewtonPolicyTaskManager",
});
console.log("task manager  ", taskManager, "\n");

const head = await client.getBlockNumber();
const fromBlock = head > 7200n ? head - 7200n : 0n;
console.log(`scanning ${fromBlock}..${head}\n`);

const denials = await client.getLogs({
  address: taskManager,
  event: POLICY_DENIED,
  args: { policyClient: POLICY_CLIENT },
  fromBlock,
  toBlock: head,
});
console.log(`PolicyDenied for this client: ${denials.length}`);

const created = await client.getLogs({
  address: taskManager,
  event: NEW_TASK_CREATED,
  fromBlock,
  toBlock: head,
});

console.log(`NewTaskCreated decoded: ${created.length}`);

if (created.length === 0) {
  console.log(
    "\nFAIL — denials exist on this contract but no NewTaskCreated decoded.\n" +
      "That means the NewTaskCreated signature above is wrong: its topic0 does\n" +
      "not match what the contract emits. Re-check the struct types against\n" +
      "INewtonProverTaskManager.Task and INewtonPolicy.PolicyState.",
  );
  process.exit(1);
}

const mine = created.filter(
  (l) => l.args.task?.policyClient?.toLowerCase() === POLICY_CLIENT.toLowerCase(),
);
console.log(`  of which ours: ${mine.length}\n`);

for (const l of mine.slice(-5)) {
  const t = l.args.task;
  console.log(
    `  block ${l.blockNumber}  to ${t.intent.to}  ${
      denials.some((d) => d.args.taskId === t.taskId) ? "NON COMPLIANT" : "allowed/pending"
    }`,
  );
}

console.log(
  mine.length > 0
    ? "\nOK — the ABI decodes real logs and the client filter matches."
    : "\nDecoding works, but no task on this contract belongs to POLICY_CLIENT.\n" +
        "Check that .env.local points at the client the UI actually submits to.",
);
