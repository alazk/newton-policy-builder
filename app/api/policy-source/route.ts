import { NextResponse } from "next/server";
import { createPublicClient, http, parseAbiItem } from "viem";
import { sepolia } from "viem/chains";

/**
 * The policy the operators actually run.
 *
 * The wizard composes Rego locally and used to display that under "Policy
 * source". But in submit mode the operators evaluate the policyCid bound to
 * the PolicyClient on-chain — the wizard's Rego is not sent anywhere. The two
 * had drifted: the deployed policy carries two deny rules
 * (payee/payer_listed_in_blocked_regime) the builder never emits, so the panel
 * was showing 7 of the 9 rules being enforced and calling it the policy.
 *
 * Harmless today, since those rules only fire when data.params.blocked_datasets
 * is non-empty and it is empty. But "the display agrees with reality until it
 * doesn't" is precisely the failure mode this project has already paid for
 * twice — once when the page read Compliant off a response it could not parse,
 * and once when a policy could not see its own oracle.
 *
 * So this resolves the source from the chain:
 *
 *   PolicyClient.getPolicyAddress()  →  Policy.getPolicyCid()  →  IPFS
 *
 * Nothing here is configured by hand; re-deploy the policy and this follows.
 */

export const runtime = "nodejs";

const GET_POLICY_ADDRESS = parseAbiItem("function getPolicyAddress() view returns (address)");
const GET_POLICY_CID = parseAbiItem("function getPolicyCid() view returns (string)");
const GET_ENTRYPOINT = parseAbiItem("function getEntrypoint() view returns (string)");
const GET_POLICY_ID = parseAbiItem("function getPolicyId() view returns (bytes32)");
const GET_POLICY_CONFIG = parseAbiItem(
  "function getPolicyConfig(bytes32 policyId) view returns ((bytes policyParams, uint32 expireAfter))",
);

/**
 * Tried in order. One gateway is a single point of failure for the one panel
 * on this page that claims to show what is enforced.
 */
const GATEWAYS = [
  "https://ipfs.io/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
];

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
    const policyAddress = await client.readContract({
      address: policyClient,
      abi: [GET_POLICY_ADDRESS],
      functionName: "getPolicyAddress",
    });

    const [cid, entrypoint] = await Promise.all([
      client.readContract({ address: policyAddress, abi: [GET_POLICY_CID], functionName: "getPolicyCid" }),
      client
        .readContract({ address: policyAddress, abi: [GET_ENTRYPOINT], functionName: "getEntrypoint" })
        .catch(() => ""),
    ]);

    let source = "";
    let via = "";
    const failures: string[] = [];

    for (const gw of GATEWAYS) {
      try {
        const res = await fetch(gw + cid, { signal: AbortSignal.timeout(8_000) });
        if (!res.ok) {
          failures.push(`${gw} → ${res.status}`);
          continue;
        }
        source = await res.text();
        via = gw;
        break;
      } catch (e) {
        failures.push(`${gw} → ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (!source) {
      /**
       * Deliberately an error, not a fallback to the locally generated Rego.
       * Substituting one for the other is how the panel came to misdescribe
       * itself in the first place.
       */
      return NextResponse.json(
        {
          ok: false,
          error: `Could not fetch ${cid} from any gateway.`,
          detail: failures,
          cid,
          policyAddress,
        },
        { status: 502 },
      );
    }

    /**
     * The policy's parameters, so `min_match_score` stops being invisible.
     *
     * The Rego reads `data.params.min_match_score` and falls back to 0 — and
     * 0 means any confirmed hit denies. That is the dial where the actual
     * compliance judgment lives, and the page had no way to say what it was
     * set to. Best-effort: policyParams is opaque `bytes` on-chain, so this
     * tries UTF-8 JSON (what the gateway sends) and reports nothing rather
     * than guessing if that fails.
     */
    let params: Record<string, unknown> | null = null;
    let expireAfter: number | null = null;
    try {
      const policyId = await client.readContract({
        address: policyClient,
        abi: [GET_POLICY_ID],
        functionName: "getPolicyId",
      });
      const cfg: any = await client.readContract({
        address: policyAddress,
        abi: [GET_POLICY_CONFIG],
        functionName: "getPolicyConfig",
        args: [policyId],
      });
      expireAfter = Number(cfg?.expireAfter ?? cfg?.[1] ?? 0) || null;

      const raw: string = cfg?.policyParams ?? cfg?.[0] ?? "0x";
      if (raw && raw !== "0x") {
        const text = Buffer.from(raw.slice(2), "hex").toString("utf8");
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object") params = parsed;
      }
    } catch {
      // Unreadable params are reported as unknown, not as absent.
      params = null;
    }

    return NextResponse.json({ ok: true, source, cid, entrypoint, policyAddress, via, params, expireAfter });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
