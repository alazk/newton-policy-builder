/**
 * A throttle for the one route that spends money.
 *
 * Every call to /api/evaluate creates a real task: it consumes gateway quota
 * against a single API key and writes a row to the PolicyClient's on-chain
 * history. The site is public and the button is the entire point, so one
 * person with a loop can drain the quota on their own.
 *
 * (The "Earlier runs" panel that read that history is gone; /api/history still
 * serves it and nothing calls it. The quota is the live reason this exists.)
 *
 * WHAT THIS IS NOT: durable. Vercel runs each region's functions in separate
 * instances and recycles them freely, so this counter resets when an instance
 * does and is not shared between them. A determined abuser gets more than the
 * limit suggests.
 *
 * It is still worth having. The realistic failure here is a stuck retry loop
 * or someone leaning on the button, and an in-memory window stops both without
 * adding a database to a demo. Anything stronger means durable storage, at
 * which point the honest move is Upstash rather than pretending this is more
 * than it is.
 */

type Hit = { count: number; resetAt: number };

const WINDOW_MS = 60_000;
const MAX_IN_WINDOW = 6;

/**
 * Bounded on purpose: an unbounded Map keyed by client IP is a slow memory
 * leak that a scraper can accelerate.
 */
const MAX_KEYS = 5_000;
const hits = new Map<string, Hit>();

function sweep(now: number) {
  for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  if (hits.size > MAX_KEYS) hits.clear();
}

/**
 * Vercel sets x-forwarded-for; the client-supplied value is only trustworthy
 * because the platform overwrites it at the edge. Falling back to a constant
 * means everyone shares one bucket, which is the safe direction to fail.
 */
export function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "anonymous";
}

export function rateLimit(key: string): { ok: true } | { ok: false; retryAfter: number } {
  const now = Date.now();
  sweep(now);

  const existing = hits.get(key);
  if (!existing || existing.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { ok: true };
  }

  if (existing.count >= MAX_IN_WINDOW) {
    return { ok: false, retryAfter: Math.ceil((existing.resetAt - now) / 1000) };
  }

  existing.count += 1;
  return { ok: true };
}
