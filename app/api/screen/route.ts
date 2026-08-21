import { NextResponse } from "next/server";

/**
 * Which party is designated, and on which lists.
 *
 * The on-chain verdict is a single bit. `newt_createTask` returns
 * `task_response.evaluation_result` as a bytes32 — allowed or not — and
 * nothing else. It does not say which side tripped, or which regime listed
 * them. That is correct for an attestation (the signed claim is "this intent
 * is authorised") but it leaves the page unable to answer the first question
 * anyone asks: *which one?*
 *
 * So this asks the same screening data the operators' oracle asked, using the
 * same query the WASM component builds — sanctions-oracle/yente.js, a
 * CryptoWallet match on publicKey. One call per address, so the answer is
 * attributable per party.
 *
 * IMPORTANT, and surfaced in the UI: this is an explanation, not the
 * attestation. It runs here, unsigned, after the fact. If it ever disagreed
 * with the on-chain verdict, the on-chain verdict is the one that counts —
 * and the disagreement would itself be the finding.
 */

export const runtime = "nodejs";

export async function POST(req: Request) {
  const base = process.env.YENTE_URL;
  const dataset = process.env.YENTE_DATASET ?? "sanctions";

  if (!base) {
    return NextResponse.json({ ok: false, error: "YENTE_URL is not set." }, { status: 400 });
  }

  let addresses: string[] = [];
  try {
    const body = await req.json();
    addresses = Array.isArray(body?.addresses) ? body.addresses.filter((a: unknown) => typeof a === "string") : [];
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!addresses.length) {
    return NextResponse.json({ ok: false, error: "No addresses supplied." }, { status: 400 });
  }

  // Same shape the oracle sends: one /match call, one query key per address.
  const queries: Record<string, unknown> = {};
  addresses.forEach((a, i) => {
    queries[`a${i}`] = { schema: "CryptoWallet", properties: { publicKey: [a] } };
  });

  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/match/${encodeURIComponent(dataset)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ queries }),
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `Screening API returned ${res.status}.` }, { status: 502 });
    }

    const body = await res.json();

    const out = addresses.map((address, i) => {
      const results = body?.responses?.[`a${i}`]?.results;
      if (!Array.isArray(results)) return { address, screened: false, sanctioned: null, datasets: [] };

      /**
       * `match === true` only. yente returns near-misses with match=false;
       * treating a candidate as a hit is how a screening tool starts refusing
       * people for resembling someone.
       */
      const hits = results.filter((r: any) => r && r.match === true);
      const datasets: string[] = [];
      for (const h of hits) for (const d of h.datasets ?? []) if (!datasets.includes(d)) datasets.push(d);

      return { address, screened: true, sanctioned: hits.length > 0, datasets };
    });

    return NextResponse.json({ ok: true, parties: out });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
