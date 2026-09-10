/**
 * Try the yente policy in SIMULATE mode, which sends the Rego inline.
 *
 *   node policy/test-simulate.mjs <recipient-address>
 *
 * Submit mode (newt_createTask) makes operators fetch the policy CID from the
 * "persisted immutable data backend" — the fetch that has failed all day.
 * Simulate (newt_simulatePolicy) carries the Rego in the request body, so the
 * policy is never fetched. It still names a PolicyData address, and the
 * operator resolves the WASM from that contract's on-chain CID — so if this
 * ALSO fails, the error will name the wasm CID (bafybei…) not the policy CID
 * (bafkrei…), which tells us the wasm is unreadable too, separately.
 *
 * Simulate is one operator, not a quorum, and produces no on-chain attestation.
 * For a demo that screens live against OpenSanctions, that may be an acceptable
 * trade if submit stays blocked.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = process.env.APP_URL || "https://newton-policy-builder.vercel.app";

const to = process.argv[2] || "0x175d44451403edf28469df03a9280c1197adb92c";
const from = "0x1111111111111111111111111111111111111111";

const rego = readFileSync(
  join(ROOT, "..", "sanctions-oracle", "yente-policy-files", "policy.rego"),
  "utf8",
);

// The PolicyData the new policy is bound to — the rev-2 wasm.
const policyDataAddress = "0x66E2f53107790caB29a6374484d705c7b87fa243";

const body = {
  mode: "test", // anything but "submit" routes to newt_simulatePolicy
  rego,
  params: {},
  policyDataAddress,
  to,
  from,
};

const res = await fetch(`${APP}/api/evaluate`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const json = await res.json();

if (!json.ok) {
  console.log("route error:", json.error);
  if (json.raw) console.log("raw:", JSON.stringify(json.raw).slice(0, 400));
  process.exit(1);
}

// simulate returns evaluation_result.result as a boolean.
const r = json.result;
const allow = r?.evaluation_result?.result ?? r?.result?.allow ?? r?.allow;
console.log(`recipient  ${to}`);
console.log(`verdict    ${allow === false ? "DENIED" : allow === true ? "ALLOWED" : "unclear"}`);
console.log(`raw        ${JSON.stringify(r).slice(0, 600)}`);
