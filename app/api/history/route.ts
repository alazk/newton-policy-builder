import { NextResponse } from "next/server";
import { createPublicClient, http, parseAbiItem } from "viem";
import { sepolia } from "viem/chains";

/**
 * Recent runs, for everyone.
 *
 * The history used to live in a `useState` array, so it emptied on reload and
 * no two people ever saw the same list. This reads it from Sepolia instead.
 *
 * No database, and that is the point: every run already creates a real task
 * against the PolicyClient, so the chain is the record. An app-side copy would
 * be a second account of what happened, free to drift from the attestations it
 * claims to describe — which is the exact failure this project has already hit
 * once, when the page reported Compliant while the explorer said otherwise.
 *
 * Three sources, from INewtonProverTaskManager:
 *
 *   NewTaskCreated(bytes32 indexed taskId, Task task, PolicyState state)
 *       what was screened. `task.intent.to` is the address, `task.policyClient`
 *       says whether it was ours. The client is NOT indexed, so it cannot be a
 *       topic filter — we decode and discard the rest.
 *
 *   PolicyDenied(address indexed policyClient, bytes32 indexed taskId, ...)
 *       a quorum-signed denial, and topic-filterable by client.
 *
 *   taskResponseHash(taskId) → bytes32
 *       non-zero once a response has been recorded on-chain.
 *
 * The contract's own NatSpec is emphatic that absence of PolicyDenied is NOT
 * proof of allowance — a withheld response emits nothing at all. So allowance
 * is never inferred from silence: a task counts as ALLOWED only when a
 * response hash exists AND no denial was emitted. Anything else is reported as
 * pending, which is honest about the difference between "permitted" and "we
 * have not heard back".
 */

export const runtime = "nodejs";

/**
 * ~3.5 hours of Sepolia at 12s blocks.
 *
 * Deliberately short. Free RPCs cap getLogs ranges — often well under the
 * 7200 this used to ask for — and a rejected range returns an error for the
 * whole feed rather than a partial answer. A demo only needs the last few
 * runs.
 */
const LOOKBACK_BLOCKS = 1_000n;

/** Enough to show a clean result and a sanctioned one together, with spares. */
const LIMIT = 12;

/**
 * Transcribed from INewtonProverTaskManager, INewtonPolicy and NewtonMessage,
 * not guessed.
 *
 * The whole struct tree is part of the signature that gets hashed into topic0,
 * so one wrong type here does not degrade — it produces a hash that matches no
 * log ever emitted, and the feed comes back empty with no error to explain
 * why. `state` is INewtonPolicy.PolicyState, a STRUCT of
 * (address, bytes32, (bytes, uint32)); reading it as the enum the name
 * suggests is exactly that silent failure.
 */
const NEW_TASK_CREATED = parseAbiItem(
  "event NewTaskCreated(bytes32 indexed taskId, (bytes32 taskId, address policyClient, uint32 taskCreatedBlock, uint32 quorumThresholdPercentage, (address from, address to, uint256 value, bytes data, uint256 chainId, bytes functionSignature) intent, bytes intentSignature, bytes wasmArgs, bytes quorumNumbers, uint256 initializationTimestamp) task, (address policyAddress, bytes32 policyId, (bytes policyParams, uint32 expireAfter) policyConfig) state)",
);

const POLICY_DENIED = parseAbiItem(
  "event PolicyDenied(address indexed policyClient, bytes32 indexed taskId, bytes32 policyId, bytes32 intentHash, uint32 referenceBlock)",
);

const TASK_RESPONSE_HASH = parseAbiItem(
  "function taskResponseHash(bytes32 taskId) view returns (bytes32)",
);

/**
 * The task manager, asked of the client rather than discovered from its logs.
 *
 * The first version read the manager's address off a PolicyDenied log, which
 * meant querying logs with no `address` filter. Public RPCs refuse that —
 * publicnode answers "Please specify an address in your request" — so the
 * whole feed failed before it started. It was also circular: no denials in
 * range meant no address, which meant no history, even though the tasks were
 * right there.
 *
 * INewtonPolicyClient exposes the binding directly, so one eth_call gets it,
 * every getLogs below is address-scoped, and the answer stays correct if the
 * AVS redeploys.
 */
const GET_TASK_MANAGER = parseAbiItem(
  "function getNewtonPolicyTaskManager() view returns (address)",
);

export async function GET() {
  const policyClient = (process.env.POLICY_CLIENT_YENTE ?? process.env.POLICY_CLIENT) as
    | `0x${string}`
    | undefined;

  if (!policyClient) {
    return NextResponse.json({ ok: false, error: "No PolicyClient configured." }, { status: 400 });
  }

  const client = createPublicClient({
    chain: sepolia,
    transport: http(process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com"),
  });

  try {
    const head = await client.getBlockNumber();
    const fromBlock = head > LOOKBACK_BLOCKS ? head - LOOKBACK_BLOCKS : 0n;

    const taskManager = await client.readContract({
      address: policyClient,
      abi: [GET_TASK_MANAGER],
      functionName: "getNewtonPolicyTaskManager",
    });

    /** Both queries are address-scoped; public RPCs reject anything wider. */
    const [denials, created] = await Promise.all([
      client.getLogs({
        address: taskManager,
        event: POLICY_DENIED,
        args: { policyClient },
        fromBlock,
        toBlock: head,
      }),
      client.getLogs({
        address: taskManager,
        event: NEW_TASK_CREATED,
        fromBlock,
        toBlock: head,
      }),
    ]);

    const denied = new Set(denials.map((l) => l.args.taskId as string));

    // Newest first, and only this client's.
    const mine = created
      .filter((l) => {
        const task = (l.args as any).task;
        return task?.policyClient?.toLowerCase() === policyClient.toLowerCase();
      })
      .sort((a, b) => Number(b.blockNumber! - a.blockNumber!))
      .slice(0, LIMIT);

    /**
     * One eth_call per task to see whether a response was ever recorded. Only
     * needed for tasks with no denial: a denial is already proof of one.
     */
    const runs = await Promise.all(
      mine.map(async (log) => {
        const task = (log.args as any).task;
        const taskId = task.taskId as string;
        /**
         * Both parties. The sender used to be a hidden constant, so recording
         * only `intent.to` was harmless; now that it varies, a transfer denied
         * for its SENDER would appear here as a clean-looking recipient marked
         * Non Compliant — the feed misattributing the very thing it exists to
         * record.
         */
        const address = task.intent.to as string;
        const sender = task.intent.from as string;

        if (denied.has(taskId)) {
          return { taskId, address, sender, verdict: "denied" as const, block: Number(log.blockNumber) };
        }

        let responded = false;
        try {
          const hash = await client.readContract({
            address: taskManager,
            abi: [TASK_RESPONSE_HASH],
            functionName: "taskResponseHash",
            args: [taskId as `0x${string}`],
          });
          responded = hash !== "0x0000000000000000000000000000000000000000000000000000000000000000";
        } catch {
          // Treated as "not yet heard back" rather than as an allow.
        }

        return {
          taskId,
          address,
          sender,
          verdict: responded ? ("allowed" as const) : ("pending" as const),
          block: Number(log.blockNumber),
        };
      }),
    );

    return NextResponse.json({ ok: true, runs, taskManager, fromBlock: Number(fromBlock) });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
