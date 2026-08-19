import { NextRequest, NextResponse } from "next/server";
import { CHAIN_ID, DEMO_POLICY_CLIENT, ENTRYPOINT } from "@/lib/catalog";

/**
 * Evaluates the generated policy against a live oracle on Ethereum Sepolia.
 *
 * This calls `newt_simulatePolicy` on the Newton gateway directly rather than
 * going through the SDK. The SDK's `simulatePolicy` builds a body that the
 * gateway rejected with `missing field 'chain_id'` — it only puts chain_id
 * inside `intent`, and this gateway build wants it at the top of `params` too.
 * Calling the RPC ourselves sidesteps that version skew and, more usefully,
 * lets us log the exact bytes on the wire when something fails.
 *
 * `newt_simulatePolicy` is what makes a builder possible: it accepts RAW REGO
 * plus a deployed PolicyData address, so whatever the wizard composes is
 * evaluated for real without deploying a contract first.
 *
 * Ownership note: the gateway only checks that you own the policy_client when
 * one of the PolicyData contracts declares a secretsSchemaCid. The
 * Newton-hosted sanctions oracle declares none, so a borrowed policy_client
 * works. Providers that need an API key will fail this check.
 */

export const runtime = "nodejs";

const GATEWAY = process.env.NEWTON_GATEWAY_URL ?? "https://gateway.testnet.newton.xyz/rpc";

export async function POST(req: NextRequest) {
  const apiKey = process.env.NEWTON_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "NEWTON_API_KEY is not set. Add it to .env.local — dashboard.newton.xyz → API Keys — then restart `npm run dev`.",
      },
      { status: 500 },
    );
  }

  let body: {
    rego?: string;
    params?: Record<string, unknown>;
    policyDataAddress?: string;
    from?: string;
    to?: string;
    value?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { rego, params, policyDataAddress, from, to, value, mode, providerId } = body;
  if (!to) {
    return NextResponse.json({ ok: false, error: "to is required" }, { status: 400 });
  }

  /**
   * Two very different things share this route.
   *
   *   simulate — newt_simulatePolicy. Sends the wizard's Rego inline, one
   *              operator evaluates it, a boolean comes back. Milliseconds.
   *              Nothing on-chain, nothing in the explorer.
   *
   *   submit   — newt_createTask. Creates a real task against the policy
   *              BOUND TO THE CLIENT on-chain, signed by an operator quorum,
   *              and it shows up in the explorer. Seconds.
   *
   * Note what this means: in submit mode the Rego in the wizard is ignored.
   * Operators evaluate the deployed policyCid, not whatever you just edited.
   */
  if (mode === "submit") {
    return submitRealTask({ from, to, value, policyDataAddress, providerId });
  }

  if (!rego) {
    return NextResponse.json({ ok: false, error: "rego is required to simulate" }, { status: 400 });
  }

  // An empty policyDataAddress means the policy reads only data.params — no
  // oracle to call, so send no policy_data at all. This is the path that works
  // without deploying anything.
  const usesOracle = Boolean(policyDataAddress);

  const chainIdHex = toQuantity(CHAIN_ID);

  // The payer is screened too, so it has to be a real address in both the
  // intent and the oracle args — and the SAME one, or the policy's
  // payer_address_mismatch rule fires.
  const sender = from || DEMO_POLICY_CLIENT;

  const rpcParams = {
    // Top level — the field the SDK omits. Note this one is a plain u64,
    // while the one inside `intent` is a hex Quantity. Same name, different
    // encoding, and the gateway is strict about both.
    chain_id: CHAIN_ID,
    policy_client: DEMO_POLICY_CLIENT,
    policy: rego,
    entrypoint: ENTRYPOINT,
    intent: {
      from: sender,
      to,
      value: value || "0x0",
      data: "0x",
      chain_id: chainIdHex,
      function_signature: "0x",
    },
    policy_data: usesOracle
      ? [
          {
            policy_data_address: policyDataAddress,
            // Hex-encoded UTF-8 JSON, per the gateway's wasm_args convention.
            wasm_args: hexEncodeJson({ to, from: sender, ...oracleArgs() }),
          },
        ]
      : [],
    policy_params: params ?? {},
  };

  const rpcBody = {
    jsonrpc: "2.0",
    // This gateway deviates from JSON-RPC 2.0: `id` must be a UUID string,
    // not an integer. An integer comes back as a 422 with a non-JSON body.
    id: crypto.randomUUID(),
    method: "newt_simulatePolicy",
    params: rpcParams,
  };

  try {
    // Without a timeout a stalled gateway hangs the request forever and the
    // page just sits on "Evaluating…".
    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(rpcBody),
      signal: AbortSignal.timeout(45_000),
    });

    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      console.error("[evaluate] non-JSON response:", res.status, text.slice(0, 500));
      return NextResponse.json(
        {
          ok: false,
          error: `Gateway returned ${res.status} with a non-JSON body`,
          raw: text.slice(0, 2000),
        },
        { status: 502 },
      );
    }

    if (json.error) {
      const message = stringifyRpcError(json.error);
      console.error("[evaluate] gateway error:", JSON.stringify(json.error, null, 2));
      console.error("[evaluate] request was:", JSON.stringify(rpcBody, null, 2));
      return NextResponse.json(
        { ok: false, error: message, hint: hintFor(message), raw: json.error },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true, result: json.result });
  } catch (err) {
    const isTimeout =
      err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    const message = isTimeout
      ? "The gateway did not respond within 45 seconds."
      : err instanceof Error
        ? err.message
        : String(err);
    console.error("[evaluate] request failed:", err);
    return NextResponse.json(
      {
        ok: false,
        error: message,
        hint: isTimeout
          ? "Retry. If it keeps timing out, the operator may be unavailable — which is exactly the case the 'fail closed' rule exists for."
          : undefined,
      },
      { status: 504 },
    );
  }
}

/**
 * Create a real, quorum-signed task — the same thing deploy/12-cidv1.mjs does
 * from the terminal, and the only path that appears in the Newton Explorer.
 */
async function submitRealTask({
  from,
  to,
  value,
  policyDataAddress,
  providerId,
}: {
  from?: string;
  to: string;
  value?: string;
  policyDataAddress?: string;
  providerId?: string;
}) {
  const apiKey = process.env.NEWTON_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "NEWTON_API_KEY is not set in .env.local" },
      { status: 500 },
    );
  }

  /**
   * One PolicyClient binds one policy, so a provider is submittable only if it
   * has a client of its own. Routing by provider here — rather than sending
   * every submit to a single client — is what stops the UI attributing one
   * provider's verdict to another. With yente bound to the shared client,
   * submitting under the denylist previously returned "screening_unavailable":
   * the yente policy's answer, labelled as the denylist's.
   *
   * Unset env means not submittable, and we say so rather than silently
   * falling back to whichever client happens to be configured.
   */
  const CLIENT_BY_PROVIDER: Record<string, string | undefined> = {
    yente: process.env.POLICY_CLIENT_YENTE ?? process.env.POLICY_CLIENT,
    "local-denylist": process.env.POLICY_CLIENT_DENYLIST,
  };

  const policyClient = providerId ? CLIENT_BY_PROVIDER[providerId] : process.env.POLICY_CLIENT;

  if (!policyClient) {
    return NextResponse.json(
      {
        ok: false,
        error:
          `No PolicyClient is configured for "${providerId}", so there is no on-chain policy to submit against.`,
        hint:
          "Use Test to evaluate this provider's rules, or deploy a PolicyClient for it and set " +
          (providerId === "local-denylist" ? "POLICY_CLIENT_DENYLIST" : "POLICY_CLIENT_YENTE") +
          " in .env.local.",
      },
      { status: 400 },
    );
  }

  const sender = from || "0x8b4bA8708239757e84aD26a503500Bc5fC1c1a48";

  const rpcBody = {
    jsonrpc: "2.0",
    id: crypto.randomUUID(),
    method: "newt_createTask",
    params: {
      chain_id: CHAIN_ID,
      policy_client: policyClient,
      intent: {
        from: sender,
        to,
        value: value || "0x0",
        data: "0x",
        chain_id: toQuantity(CHAIN_ID),
        function_signature: "0x",
      },
      /**
       * The deployed policy already knows WHICH oracle to call — that binding
       * is on-chain. What it cannot know is what to ask it: the address being
       * screened changes per task, so the args travel with the request.
       *
       * Note the shape differs from newt_simulatePolicy, which takes a
       * `policy_data: [{ policy_data_address, wasm_args }]` array. createTask
       * takes a single top-level `wasm_args` hex string and resolves the
       * oracle from the client's on-chain binding. Sending simulate's shape
       * here is not rejected — it is silently ignored, wasmArgs arrives as
       * "0x", the oracle gets no address, returns HTTP 400, and the
       * fail-closed rule denies. A clean wallet then reads NON COMPLIANT for
       * a reason that has nothing to do with sanctions.
       */
      ...(policyDataAddress
        ? { wasm_args: hexEncodeJson({ to, from: sender, ...oracleArgs() }) }
        : {}),
    },
  };

  try {
    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(rpcBody),
      signal: AbortSignal.timeout(60_000),
    });

    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { ok: false, error: `Gateway returned ${res.status}: ${text.slice(0, 300)}` },
        { status: 502 },
      );
    }

    if (json.error) {
      const message = stringifyRpcError(json.error);
      console.error("[submit] gateway error:", JSON.stringify(json.error, null, 2));
      return NextResponse.json(
        { ok: false, error: message, hint: hintFor(message), raw: json.error },
        { status: 502 },
      );
    }

    const taskId =
      json.result?.taskId ?? json.result?.task_id ?? json.result?.task?.taskId ?? null;

    return NextResponse.json({
      ok: true,
      mode: "submit",
      taskId,
      policyClient,
      explorerUrl: taskId
        ? `https://explorer.newton.xyz/testnet/task/${taskId}`
        : null,
      result: json.result,
    });
  } catch (err) {
    const isTimeout =
      err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return NextResponse.json(
      {
        ok: false,
        error: isTimeout
          ? "The gateway did not respond within 60 seconds."
          : err instanceof Error
            ? err.message
            : String(err),
      },
      { status: 504 },
    );
  }
}

/** Ethereum JSON-RPC Quantity: compact hex, no leading zeros. */
function toQuantity(n: number): string {
  return "0x" + n.toString(16);
}

/**
 * Per-oracle wasmArgs beyond the address being screened.
 *
 * The yente oracle has no default endpoint on purpose — it refuses to run
 * without `yente_url` rather than silently screening against nothing. That
 * makes the URL a required input here. It's server-side env, not
 * NEXT_PUBLIC_*, because a tunnel URL pointing at a machine on someone's desk
 * doesn't belong in the browser bundle.
 *
 * Harmless for the other providers: their oracles ignore keys they don't read.
 */
function oracleArgs(): Record<string, string> {
  const url = process.env.YENTE_URL;
  return url ? { yente_url: url, dataset: process.env.YENTE_DATASET ?? "sanctions" } : {};
}

/** wasm_args is a hex-encoded UTF-8 JSON string. */
function hexEncodeJson(obj: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return "0x" + out;
}

/** JSON-RPC errors arrive in several shapes; never let one render as [object Object]. */
function stringifyRpcError(e: unknown): string {
  if (typeof e === "string") return e;
  const o = e as Record<string, any>;
  if (o?.message && typeof o.message === "string") {
    return o.data ? `${o.message} — ${JSON.stringify(o.data)}` : o.message;
  }
  try {
    return JSON.stringify(e, null, 2);
  } catch {
    return String(e);
  }
}

function hintFor(message: string): string | undefined {
  const m = message.toLowerCase();
  if (m.includes("is owned by") || m.includes("owned by another user") || m.includes("authorizationfailed")) {
    return "You need your own PolicyClient — the gateway requires the caller (derived from your API key) to be its on-chain owner, and it enforces this even for oracles that need no secrets. Deploy one at dashboard.newton.xyz: create a project on Ethereum Sepolia, then 'Deploy a sample one' at the PolicyClient step. Put the address in .env.local as NEXT_PUBLIC_POLICY_CLIENT and restart the dev server.";
  }
  if (m.includes("query on-chain owner") || m.includes("no owner") || m.includes("execution reverted")) {
    return "The policy_client address isn't a live NewtonPolicyClient on Sepolia — getOwner() reverted. Deploy one from dashboard.newton.xyz and set NEXT_PUBLIC_POLICY_CLIENT in .env.local.";
  }
  if (m.includes("unauthor") || m.includes("401") || m.includes("api key")) {
    return "The API key was rejected. Check NEWTON_API_KEY in .env.local, and restart the dev server after editing it.";
  }
  if (m.includes("secret")) {
    return "This oracle needs provider credentials uploaded first. Switch to the Newton-hosted Chainalysis provider.";
  }
  if (m.includes("parse") || m.includes("rego") || m.includes("compile") || m.includes("entrypoint")) {
    return "The generated Rego failed to compile. Copy it from step 3 and run `newton-cli regorus parse` to see where.";
  }
  if (m.includes("missing field")) {
    return "The gateway rejected the request shape. The exact body sent is logged in the terminal running `npm run dev`.";
  }
  return undefined;
}
