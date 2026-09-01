/**
 * Build the two JSON files `newton-cli policy simulate` needs.
 *
 *   node policy/simargs.mjs clean
 *   node policy/simargs.mjs sanctioned
 *   node policy/simargs.mjs 0xsome... 0xother...      (recipient, sender)
 *
 * Writes /tmp/newton-intent.json and /tmp/newton-wasm-args.json, then prints
 * the simulate command with those paths filled in.
 *
 * Why a generator rather than two checked-in fixtures: wasm_args carries
 * YENTE_URL, which is a tunnel pointing at somebody's machine. It belongs in
 * .env.local, not in a file in the repo — and a fixture with a stale URL in it
 * would screen against nothing and pass, which is the failure this whole
 * exercise is about.
 *
 * Shapes are lifted from app/api/evaluate/route.ts, which is the code that
 * actually talks to the gateway:
 *
 *   intent     { from, to, value, data, chain_id, function_signature }
 *   wasm_args  { to, from, yente_url, dataset }
 *
 * The route hex-encodes wasm_args before putting them on the wire. The CLI
 * takes "a JSON file containing arguments for WASM execution", so this writes
 * plain JSON and lets the CLI do its own encoding.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

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

/**
 * A real OFAC-designated wallet from the generated pool, and a random one.
 *
 * The clean address is generated rather than fixed: a hardcoded "clean"
 * address is one designation away from being a sanctioned one, and the test
 * would then fail for a reason that looks like a bug.
 */
const POOL = join(ROOT, "lib/sanctioned-pool.ts");
const sanctioned = readFileSync(POOL, "utf8").match(/"(0x[0-9a-fA-F]{40})"/)?.[1];

// A function, not a constant. Computed once, the same address landed in both
// `to` and `from`, so the clean run screened one address twice and could not
// have distinguished payee handling from payer handling — the two halves of
// the policy this file exists to exercise.
const clean = () =>
  "0x" +
  Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

const [a, b] = process.argv.slice(2);
let to;
if (a === "clean" || !a) to = clean();
else if (a === "sanctioned") to = sanctioned;
else to = a;

if (!to) {
  console.error("No address. Pass 'clean', 'sanctioned', or a 0x address.");
  process.exit(1);
}

// Both files still name the same sender. The policy stopped screening the
// payer, so a mismatch no longer denies — but keeping them consistent means
// the simulation matches what the app sends, which is the point of a
// simulation.
/**
 * A sender is still required — every transaction has one, and the oracle
 * refuses a request without it. The policy no longer consults the answer, so
 * this only has to be a well-formed address that is on no list.
 */
const from = b || clean();

if (!E.YENTE_URL) {
  console.error("YENTE_URL is not set in .env.local.");
  console.error("The oracle refuses to run without it rather than screening against nothing,");
  console.error("so the simulation would return status 400 and deny for the wrong reason.");
  process.exit(1);
}

const intent = {
  from,
  to,
  value: "0x0",
  data: "0x",
  chain_id: "0x" + (Number(E.CHAIN_ID) || 11155111).toString(16),
  function_signature: "0x",
};

const wasmArgs = {
  to,
  from,
  yente_url: E.YENTE_URL,
  dataset: E.YENTE_DATASET || "sanctions",
};

writeFileSync("/tmp/newton-intent.json", JSON.stringify(intent, null, 2));
writeFileSync("/tmp/newton-wasm-args.json", JSON.stringify(wasmArgs, null, 2));

const label = a === "sanctioned" ? "SANCTIONED" : "clean";
console.log(`\n  recipient  ${to}   (${label})`);
console.log(`  sender     ${from}   (not screened by the policy)`);
console.log(`  expect     ${label === "SANCTIONED" ? "DENIED" : "ALLOWED"}\n`);
console.log(`Wrote /tmp/newton-intent.json and /tmp/newton-wasm-args.json\n`);
// cd included, because the wasm and rego paths are relative to that directory
// and the last few runs of this were pasted from the wrong one.
console.log(`cd "${join(ROOT, "..", "sanctions-oracle")}" && newton-cli policy simulate \\
  --rego-file yente-policy-files/policy.rego \\
  --wasm-file yente-policy-files/policy.wasm \\
  --entrypoint newton_yente.allow \\
  --intent-json /tmp/newton-intent.json \\
  --wasm-args /tmp/newton-wasm-args.json \\
  --policy-params-data "${join(ROOT, "policy/params.json")}"\n`);
