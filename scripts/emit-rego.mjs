/**
 * Write the Rego the wizard composes to a file, so it can be parsed.
 *
 *   npx tsx scripts/emit-rego.mjs
 *   newton-cli regorus parse generated-policy.rego
 *
 * Run through tsx, not `node --experimental-strip-types`. Node's type
 * stripping executes TypeScript but keeps Node's ESM resolver, which demands
 * explicit file extensions — and `catalog.ts` imports `./ofac-addresses`
 * without one, the way every bundler allows. tsx resolves those the way
 * Next.js does, so the script runs against the same module graph the app does
 * rather than a rewritten copy of it.
 *
 * The builder generates its policy at runtime and never writes it down, which
 * means the only thing that has ever judged it is the gateway accepting it.
 * That is a weak check: the gateway compiles the policy, but a policy that
 * compiles and a policy that is correct are different claims, and this project
 * has already been caught out by exactly that gap once.
 *
 * Node 22 strips TypeScript types natively, so this imports the real catalog
 * rather than a copy that could drift from it.
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));

const { GOALS, RULES, generateRego, defaultParams, rulesForProvider } = await import(
  path.join(dir, "..", "lib", "catalog.ts")
);

const goalId = Object.keys(GOALS)[0];
const providerId = GOALS[goalId].providers[0];
const ruleIds = rulesForProvider(goalId, providerId).filter((r) => RULES[r]?.defaultOn);

const rego = generateRego({
  goalId,
  providerId,
  ruleIds,
  params: defaultParams(ruleIds),
});

const out = path.join(dir, "..", "generated-policy.rego");
await writeFile(out, rego);

console.log(`goal      ${goalId}`);
console.log(`provider  ${providerId}`);
console.log(`rules     ${ruleIds.join(", ") || "(none)"}`);
console.log(`\nwrote ${out}\n`);
console.log("Now:  newton-cli regorus parse generated-policy.rego");
