import { NextResponse } from "next/server";

/**
 * How fresh the sanctions data is.
 *
 * The policy fails closed when the screening API is *down* — no answer, no
 * allow. It cannot fail closed when the API is up and merely out of date,
 * because a stale answer is well-formed and confident. An address designated
 * yesterday screens clean against a snapshot from last week, and the page
 * prints COMPLIANT in green with an attestation to match.
 *
 * That is the failure this endpoint exists to make visible. It does not
 * prevent it — only the oracle refusing to answer on stale data would, and
 * that lives on-chain — but an unnoticed problem and a displayed one are
 * different things.
 *
 * Proxied server-side because YENTE_URL is server-side config and does not
 * belong in the browser bundle.
 */

export const runtime = "nodejs";

export async function GET() {
  const base = process.env.YENTE_URL;
  if (!base) {
    return NextResponse.json({ ok: false, error: "YENTE_URL is not set." }, { status: 400 });
  }

  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/healthz`, {
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });

    const body = await res.json().catch(() => null);

    if (!res.ok || !body) {
      return NextResponse.json(
        { ok: false, error: `Screening API returned ${res.status}.` },
        { status: 502 },
      );
    }

    const ageHours = typeof body.ageHours === "number" ? body.ageHours : null;

    return NextResponse.json({
      ok: true,
      count: body.count ?? null,
      ageHours,
      generatedAt: body.generatedAt ?? null,
      // Unknown age is treated as stale. The alternative is calling data fresh
      // because we failed to find out how old it is.
      stale: ageHours === null ? true : ageHours > 48,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
