/**
 * The wizard's content model.
 *
 *   goal  →  provider  →  rules  →  recipient  →  run
 *
 * Every PolicyData address here is a real deployment on Ethereum Sepolia
 * (11155111), taken from newton-policy-packs/deployments.json (stagef = the
 * testnet AVS env) or from Newton's own demos.
 */

import { OFAC_ETH_ADDRESSES } from "./ofac-addresses";

export const CHAIN_ID = 11155111;

/**
 * A real NewtonPolicyClient deployed on Sepolia, borrowed from
 * newt-foundation/newton-chainalysis-demo so a run needs no contracts of your own.
 *
 * The gateway calls `getOwner()` on this address before evaluating. The address
 * in the SDK quickstart docs (0xb1aD…6b69) reverts on that call — it is not a
 * live PolicyClient — so use this one.
 *
 * Override with NEXT_PUBLIC_POLICY_CLIENT once you deploy your own from the
 * dashboard ("Deploy a sample one" in the project wizard).
 */
export const DEMO_POLICY_CLIENT =
  process.env.NEXT_PUBLIC_POLICY_CLIENT ??
  "0x02aaa12c39644429243Fc5DF2eF0bE59F4496250";

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export interface Provider {
  id: string;
  name: string;
  blurb: string;
  /** Live PolicyData (oracle) contract on Sepolia. */
  policyData: string;
  /** Rego namespace for this oracle's output. */
  dataPath: string;
  /**
   * Secrets the oracle needs before it can answer. Empty means it works with
   * no signup — Newton fronts the upstream API.
   */
  requiredSecrets: string[];
  /** What the oracle emits, so the rule builder can only offer real fields. */
  fields: string[];
  /**
   * Whether this provider's policy is the one currently bound on-chain.
   *
   * A PolicyClient binds exactly ONE policy, so only one provider can be
   * submitted for a real attestation at a time. Submitting while a different
   * provider is selected does not error — operators evaluate whichever policy
   * IS bound, and the result gets attributed to the provider on screen. With
   * yente bound, submitting under the denylist returns
   * "screening_unavailable": a denial that has nothing to do with the
   * denylist, presented as though it did.
   */
  submittable: boolean;
}

export const PROVIDERS: Record<string, Provider> = {
  "local-denylist": {
    id: "local-denylist",
    name: "Local OFAC denylist (no oracle)",
    blurb:
      `All ${OFAC_ETH_ADDRESSES.length} OFAC-designated Ethereum addresses travel with the policy as params — no data oracle, no API key, nothing to deploy. Runs today. It's a snapshot, so it drifts the moment Treasury updates; use a live oracle for anything real.`,
    // No PolicyData contract at all. The route sends an empty policy_data array.
    policyData: "",
    dataPath: "data.params",
    requiredSecrets: [],
    fields: ["__params_only__"],
    // Has its own PolicyClient (POLICY_CLIENT_DENYLIST), so Submit evaluates
    // THIS policy rather than borrowing the one bound to the yente client.
    submittable: true,
  },
  yente: {
    id: "yente",
    name: "OpenSanctions (self-hosted yente)",
    blurb:
      "Multi-regime screening — OFAC, EU, UN, UK HMT/OFSI, Israel NBCTF, Japan MoF. Self-hosted, so every operator queries the same instance and gets the same answer. You run the infrastructure, and commercial use needs an OpenSanctions data licence.",
    // Set after deploying the yente oracle: see ../sanctions-oracle/yente.js
    policyData: process.env.NEXT_PUBLIC_YENTE_POLICY_DATA ?? "",
    // data.wasm, not data.data — verified empirically by probing the live
    // gateway, after data.data silently resolved to nothing and made the
    // policy deny everything.
    dataPath: "data.wasm",
    requiredSecrets: [],
    // "sides" marks the two-sided to.*/from.* shape. The flattened payee
    // fields are still emitted for older policies, but the wizard's rules use
    // the explicit sides so payer coverage isn't optional.
    fields: ["status", "sides", "address", "sanctioned", "datasets", "match_score"],
    // Bound on-chain and verified in all three directions: clean payee
    // allows, sanctioned payee denies, sanctioned payer denies.
    submittable: true,
  },
  chainalysis: {
    id: "chainalysis",
    name: "Chainalysis Address Screening",
    blurb:
      "UNTESTED in this project — we have never successfully run it end to end. Points at a Newton staging deployment on Sepolia and needs your Chainalysis key uploaded via `newton-cli secrets upload` first. Without that key the oracle errors and, because screening fails closed, every address comes back denied — which looks identical to a working policy blocking a dirty wallet. Verify against a known-clean address before believing any result.",
    // Sepolia, stagef (testnet) env, from newton-policy-packs/deployments.json.
    // Prod on Sepolia is 0x226d196d565b92952669701Fb6cb85B586706996.
    policyData: "0x223F563c3CfD087cB1857851629b4d8CE7738448",
    dataPath: "data.wasm.chainalysis",
    requiredSecrets: ["CHAINALYSIS_SANCTIONS_KEY"],
    fields: ["sanctioned", "is_high_risk", "risk_categories"],
    submittable: false,
  },
  persona: {
    id: "persona",
    name: "Persona KYC",
    blurb: "Identity inquiry: approval status, age, country, state, bot score.",
    policyData: "0xC8fB6a529ad401bC97CF689473C16237eAA3717d",
    dataPath: "data.wasm.persona",
    requiredSecrets: ["PERSONA_API_KEY"],
    fields: ["status", "computed.age", "country_code", "state", "bot_score"],
    submittable: false,
  },
  sumsub: {
    id: "sumsub",
    name: "Sumsub KYC",
    blurb: "Alternative identity provider. Same shape of checks as Persona.",
    policyData: "0xC2a7E414A055dCc08F3B0808ceEC291bF9C43F52",
    dataPath: "data.wasm.sumsub",
    requiredSecrets: ["SUMSUB_API_KEY"],
    fields: ["status", "country", "age"],
    submittable: false,
  },
  webacy: {
    id: "webacy",
    name: "Webacy Risk",
    blurb: "Wallet and contract risk scoring.",
    policyData: "0x838d2c1d000434a00fCC81fD5F5c0C99cF6047bF",
    dataPath: "data.wasm.webacy",
    requiredSecrets: ["WEBACY_API_KEY"],
    fields: ["risk_score"],
    submittable: false,
  },
  blockaid: {
    id: "blockaid",
    name: "Blockaid",
    blurb: "Transaction and address threat detection.",
    policyData: "0x97697E15119b85365eFa6eF3C2Dc704c177b6384",
    dataPath: "data.wasm.blockaid",
    requiredSecrets: ["BLOCKAID_API_KEY"],
    fields: ["is_malicious"],
    submittable: false,
  },
};

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export interface Goal {
  id: string;
  name: string;
  blurb: string;
  providers: string[];
  rules: string[];
}

/**
 * One goal, two providers.
 *
 * The identity, jurisdiction and exposure goals, and the Chainalysis
 * provider, are removed rather than hidden. Every one of them was scaffolding
 * pointing at an oracle we had never successfully called, and an unreachable
 * oracle makes a fail-closed policy deny everything — which is
 * indistinguishable from correct sanctions screening. Offering a choice that
 * silently produces that is worse than offering no choice.
 *
 * What remains is what has been verified end to end on Sepolia: a params-only
 * denylist, and yente. The rule and provider definitions for the removed ones
 * are still in this file, so re-enabling any of them is a matter of adding
 * the id back here — after testing it against a KNOWN-CLEAN address.
 */
export const GOALS: Record<string, Goal> = {
  sanctions: {
    id: "sanctions",
    name: "Newton AML/OFAC Policy Engine",
    blurb:
      "Block payments to or from sanctioned addresses, enforced on-chain by an operator quorum before the transaction executes.",
    providers: ["local-denylist", "yente"],
    rules: [
      "payee_not_on_denylist",
      "payer_not_on_denylist",
      "denylist_configured",
      "yente_available",
      "yente_addresses_screened",
      "yente_not_listed",
      "yente_payer_not_listed",
      "yente_regime_blocklist",
      "yente_min_score",
    ],
  },
};

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export interface RuleParamDef {
  key: string;
  label: string;
  type: "number" | "string" | "list";
  placeholder?: string;
  default: unknown;
}

export interface Rule {
  id: string;
  label: string;
  /** Why you'd turn it on, in one line. */
  blurb: string;
  /** Recommended on by default. */
  defaultOn: boolean;
  params: RuleParamDef[];
  /**
   * Emits the Rego for this rule. `d` is the provider's data path.
   * Returns { helpers, deny } — helpers are top-level rules, deny is the
   * `deny contains ...` clause.
   */
  rego: (d: string) => { helpers: string[]; deny: string };
}

export { OFAC_ETH_ADDRESSES, OFAC_SNAPSHOT_DATE } from "./ofac-addresses";

/** The full OFAC-designated Ethereum set. See ./ofac-addresses.ts on staleness. */
export const OFAC_SEED_ADDRESSES = OFAC_ETH_ADDRESSES;

export const RULES: Record<string, Rule> = {
  payee_not_on_denylist: {
    id: "payee_not_on_denylist",
    label: "Block payees on the denylist",
    blurb:
      "Matches the recipient against a list carried in the policy params. No oracle call, so nothing to deploy or authenticate.",
    defaultOn: true,
    params: [
      {
        key: "sanctioned_addresses",
        label: "Sanctioned addresses",
        type: "list",
        placeholder: "0x…, 0x…",
        default: OFAC_SEED_ADDRESSES,
      },
    ],
    rego: () => ({
      helpers: [
        `denylist contains lower(a) if {
    some a in data.params.sanctioned_addresses
}`,
      ],
      deny: `deny contains "payee_on_denylist" if denylist[lower(input.to)]`,
    }),
  },
  payer_not_on_denylist: {
    id: "payer_not_on_denylist",
    label: "Block payers on the denylist",
    blurb: "Same list, applied to the sender as well as the recipient.",
    // On by default: screening only one side of a transfer is a gap, not a
    // preference, and the surprising default is the dangerous one.
    defaultOn: true,
    params: [],
    rego: () => ({
      helpers: [],
      deny: `deny contains "payer_on_denylist" if denylist[lower(input.from)]`,
    }),
  },
  denylist_configured: {
    id: "denylist_configured",
    label: "Fail closed if the denylist is empty",
    blurb:
      "Without this, an unconfigured or expired params list means an empty denylist — and an empty denylist allows everyone. This is the one place the params-only policy fails OPEN, so leaving it off is a real risk rather than a strictness setting.",
    defaultOn: true,
    params: [],
    rego: () => ({
      helpers: [],
      deny: `deny contains "denylist_not_configured" if count(denylist) == 0`,
    }),
  },
  yente_available: {
    id: "yente_available",
    label: "Fail closed if yente is unreachable",
    blurb:
      "Self-hosting means the screening service is yours to keep up. If it's down, deny rather than approve — an unreachable sanctions check is not a clean one.",
    defaultOn: true,
    params: [],
    rego: (d) => ({
      helpers: [`yente_ok if ${d}.status == 200`],
      deny: `deny contains "screening_unavailable" if not yente_ok`,
    }),
  },
  yente_addresses_screened: {
    id: "yente_addresses_screened",
    label: "Require that the oracle screened the addresses asked about",
    blurb:
      "Confirms the answer describes this transfer. A response about a different address — stale cache, mismatched args — is not evidence that this one is clean.",
    defaultOn: true,
    params: [],
    rego: (d) => ({
      helpers: [
        `payee_screened if ${d}.to.screened == true`,
        `payer_screened if ${d}.from.screened == true`,
        `payee_address_matches if lower(${d}.to.address) == lower(input.to)`,
        `payer_address_matches if lower(${d}.from.address) == lower(input.from)`,
      ],
      deny: `deny contains "payee_not_screened" if not payee_screened

deny contains "payer_not_screened" if not payer_screened

deny contains "payee_address_mismatch" if not payee_address_matches

deny contains "payer_address_mismatch" if not payer_address_matches`,
    }),
  },
  yente_not_listed: {
    id: "yente_not_listed",
    label: "Block payees on any sanctions list",
    blurb: "Matches across every dataset yente indexes, not just OFAC.",
    defaultOn: true,
    params: [],
    rego: (d) => ({
      // min_score defaults to 0 when the confidence rule is off, so this
      // helper stands alone rather than depending on another rule being
      // selected. Cross-rule dependencies were how the old version denied
      // clean addresses whenever the score rule was enabled by itself.
      helpers: [
        `default min_score := 0`,
        `min_score := data.params.min_match_score if is_number(data.params.min_match_score)`,
        `payee_hit if {
    ${d}.to.sanctioned == true
    ${d}.to.match_score >= min_score
}`,
      ],
      deny: `deny contains "payee_sanctioned" if payee_hit`,
    }),
  },
  yente_payer_not_listed: {
    id: "yente_payer_not_listed",
    label: "Block payers on any sanctions list",
    blurb:
      "Screens the sender as well as the recipient. Without this a sanctioned wallet can still send — the same gap the params-only policy closes with its payer rule.",
    defaultOn: true,
    params: [],
    rego: (d) => ({
      helpers: [
        `default min_score := 0`,
        `min_score := data.params.min_match_score if is_number(data.params.min_match_score)`,
        `payer_hit if {
    ${d}.from.sanctioned == true
    ${d}.from.match_score >= min_score
}`,
      ],
      deny: `deny contains "payer_sanctioned" if payer_hit`,
    }),
  },
  yente_regime_blocklist: {
    id: "yente_regime_blocklist",
    label: "Block specific regimes only",
    blurb:
      "Narrow enforcement to chosen lists — useful when your obligations differ by jurisdiction. Leave empty to enforce all of them.",
    defaultOn: false,
    params: [
      {
        key: "blocked_datasets",
        label: "Dataset IDs",
        type: "list",
        placeholder: "us_ofac_sdn, eu_fsf, gb_hmt_sanctions",
        default: ["us_ofac_sdn", "eu_fsf", "gb_hmt_sanctions"],
      },
    ],
    rego: (d) => ({
      helpers: [],
      deny: `deny contains "payee_listed_in_blocked_regime" if {
    some ds in ${d}.to.datasets
    ds in data.params.blocked_datasets
}

deny contains "payer_listed_in_blocked_regime" if {
    some ds in ${d}.from.datasets
    ds in data.params.blocked_datasets
}`,
    }),
  },
  yente_min_score: {
    id: "yente_min_score",
    label: "Require a minimum match confidence",
    blurb:
      "Yente scores each confirmed match. An exact wallet match is ~1.0; lower values come from fuzzy name matching. Raising this makes weak hits stop counting as sanctioned — it narrows what gets blocked rather than blocking more.",
    defaultOn: false,
    params: [
      { key: "min_match_score", label: "Minimum score (0–1)", type: "number", default: 0.9 },
    ],
    // No deny of its own. The threshold gates the payee/payer hit rules above
    // via min_score. An earlier version added a "match_below_confidence" deny,
    // which inverted the stated intent — a weak match should mean "not
    // actioned", not "denied for being weak".
    rego: () => ({ helpers: [], deny: "" }),
  },
  screening_available: {
    id: "screening_available",
    label: "Fail closed if screening is unavailable",
    blurb:
      "If the provider errors or times out, deny rather than let the payment through. Turn this off and an outage becomes an open door.",
    defaultOn: true,
    params: [],
    rego: (d) => ({
      helpers: [`screening_succeeded if ${d}.status == 200`],
      deny: `deny contains "screening_unavailable" if not screening_succeeded`,
    }),
  },
  screened_address_matches: {
    id: "screened_address_matches",
    label: "Require the screened address to match the payee",
    blurb:
      "Proves the oracle checked the address you're actually paying, not a different one.",
    defaultOn: true,
    params: [],
    rego: (d) => ({
      helpers: [`screening_matches if lower(${d}.address) == lower(input.to)`],
      deny: `deny contains "screening_address_mismatch" if not screening_matches`,
    }),
  },
  not_sanctioned: {
    id: "not_sanctioned",
    label: "Block OFAC SDN listed addresses",
    blurb: "The core sanctions check.",
    defaultOn: true,
    params: [],
    rego: (d) => ({
      helpers: [`not_sanctioned if ${d}.sanctioned == false`],
      deny: `deny contains "address_sanctioned" if not not_sanctioned`,
    }),
  },
  not_high_risk: {
    id: "not_high_risk",
    label: "Block high-risk addresses",
    blurb:
      "Beyond the SDN list — Chainalysis risk categorisation. Needs the paid screening key.",
    defaultOn: false,
    params: [],
    rego: (d) => ({
      helpers: [`not_high_risk if ${d}.is_high_risk == false`],
      deny: `deny contains "address_high_risk" if not not_high_risk`,
    }),
  },
  no_blocked_category: {
    id: "no_blocked_category",
    label: "Block specific risk categories",
    blurb: "Mixers, stolen funds, ransomware, and so on.",
    defaultOn: false,
    params: [
      {
        key: "risk_categories_blocklist",
        label: "Blocked categories",
        type: "list",
        placeholder: "mixer, stolen_funds, ransomware",
        default: ["mixer", "stolen_funds", "ransomware"],
      },
    ],
    rego: (d) => ({
      helpers: [],
      deny: `deny contains "risk_category_blocked" if {
    some cat in ${d}.risk_categories
    cat in data.params.risk_categories_blocklist
}`,
    }),
  },
  kyc_approved: {
    id: "kyc_approved",
    label: "Require an approved KYC inquiry",
    blurb: "Anything other than approved — pending, failed, expired — is denied.",
    defaultOn: true,
    params: [],
    rego: (d) => ({
      helpers: [`kyc_approved if ${d}.status == "approved"`],
      deny: `deny contains "kyc_not_approved" if not kyc_approved`,
    }),
  },
  age_minimum: {
    id: "age_minimum",
    label: "Enforce a minimum age",
    blurb: "Derived from the verified document, not self-reported.",
    defaultOn: true,
    params: [
      { key: "min_age", label: "Minimum age", type: "number", default: 18 },
    ],
    rego: (d) => ({
      helpers: [`age_ok if ${d}.computed.age >= data.params.min_age`],
      deny: `deny contains "below_minimum_age" if not age_ok`,
    }),
  },
  bot_score_max: {
    id: "bot_score_max",
    label: "Cap the bot score",
    blurb: "Rejects automation and likely synthetic identities. Lower is stricter.",
    defaultOn: false,
    params: [
      { key: "max_bot_score", label: "Max bot score", type: "number", default: 2 },
    ],
    rego: (d) => ({
      helpers: [`bot_ok if ${d}.bot_score <= data.params.max_bot_score`],
      deny: `deny contains "bot_score_too_high" if not bot_ok`,
    }),
  },
  country_allowlist: {
    id: "country_allowlist",
    label: "Only allow specific countries",
    blurb: "An empty list means any country not explicitly blocked.",
    defaultOn: true,
    params: [
      {
        key: "allowed_countries",
        label: "Allowed countries (ISO alpha-2)",
        type: "list",
        placeholder: "US, CA, GB, DE",
        default: ["US", "CA", "GB", "DE", "FR", "NL", "SG", "AU"],
      },
    ],
    rego: (d) => ({
      helpers: [
        `allowed_countries contains upper(c) if { some c in data.params.allowed_countries }`,
        `country_allowed if count(allowed_countries) == 0`,
        `country_allowed if allowed_countries[upper(${d}.country_code)]`,
      ],
      deny: `deny contains "country_not_allowed" if not country_allowed`,
    }),
  },
  country_blocklist: {
    id: "country_blocklist",
    label: "Block specific countries",
    blurb: "Takes precedence over the allowlist. Comprehensively sanctioned territories.",
    defaultOn: true,
    params: [
      {
        key: "blocked_countries",
        label: "Blocked countries (ISO alpha-2)",
        type: "list",
        placeholder: "IR, KP, SY, CU",
        default: ["IR", "KP", "SY", "CU", "RU", "BY"],
      },
    ],
    rego: (d) => ({
      helpers: [
        `blocked_countries contains upper(c) if { some c in data.params.blocked_countries }`,
      ],
      deny: `deny contains "country_blocked" if blocked_countries[upper(${d}.country_code)]`,
    }),
  },
  state_blocklist: {
    id: "state_blocklist",
    label: "Block specific states",
    blurb: "For licensing regimes — NY's BitLicense being the usual reason.",
    defaultOn: false,
    params: [
      {
        key: "blocked_states",
        label: "Blocked states",
        type: "list",
        placeholder: "NY, NC",
        default: ["NY"],
      },
    ],
    rego: (d) => ({
      helpers: [
        `blocked_states contains upper(s) if { some s in data.params.blocked_states }`,
        `subject_state := upper(${d}.state) if is_string(${d}.state)`,
      ],
      deny: `deny contains "state_blocked" if blocked_states[subject_state]`,
    }),
  },
  amount_ceiling: {
    id: "amount_ceiling",
    label: "Cap the transaction amount",
    blurb: "Per-authorization ceiling, in wei. Zero disables the check.",
    defaultOn: false,
    params: [
      { key: "max_amount", label: "Max amount (wei)", type: "number", default: 0 },
    ],
    rego: () => ({
      helpers: [
        `amount_ok if data.params.max_amount == 0`,
        `amount_ok if to_number(input.value) <= data.params.max_amount`,
      ],
      deny: `deny contains "amount_exceeds_ceiling" if not amount_ok`,
    }),
  },
  chain_allowlist: {
    id: "chain_allowlist",
    label: "Restrict to specific chains",
    blurb: "Empty means any chain.",
    defaultOn: false,
    params: [
      {
        key: "allowed_chain_ids",
        label: "Allowed chain IDs",
        type: "list",
        placeholder: "11155111",
        default: [11155111],
      },
    ],
    rego: () => ({
      helpers: [
        `allowed_chains contains id if { some id in data.params.allowed_chain_ids }`,
        `chain_ok if count(allowed_chains) == 0`,
        `chain_ok if allowed_chains[input.chain_id]`,
      ],
      deny: `deny contains "chain_not_allowed" if not chain_ok`,
    }),
  },
};

// ---------------------------------------------------------------------------
// Rego generation
// ---------------------------------------------------------------------------

/**
 * Which oracle fields each rule reads.
 *
 * A rule whose fields the chosen provider doesn't emit is not merely useless —
 * it's actively harmful. `not_high_risk if data.data.is_high_risk == false`
 * against an oracle with no `is_high_risk` is undefined, so the paired deny
 * fires and the policy rejects everything. Fail-closed is right, but only when
 * the check is one the provider can actually answer. So we filter.
 */
export const RULE_REQUIRED_FIELDS: Record<string, string[]> = {
  // Read only data.params, so they work with the oracle-less provider.
  payee_not_on_denylist: ["__params_only__"],
  payer_not_on_denylist: ["__params_only__"],
  denylist_configured: ["__params_only__"],
  yente_available: ["status"],
  // These read the two-sided shape (to.*/from.*), so they gate on `sides`
  // rather than the flattened payee fields.
  yente_addresses_screened: ["sides"],
  yente_not_listed: ["sides"],
  yente_payer_not_listed: ["sides"],
  yente_regime_blocklist: ["sides"],
  yente_min_score: ["sides"],
  screening_available: ["status"],
  screened_address_matches: ["address"],
  not_sanctioned: ["sanctioned"],
  not_high_risk: ["is_high_risk"],
  no_blocked_category: ["risk_categories"],
  kyc_approved: ["status"],
  age_minimum: ["computed.age"],
  bot_score_max: ["bot_score"],
  country_allowlist: ["country_code"],
  country_blocklist: ["country_code"],
  state_blocklist: ["state"],
  // These read the intent, not the oracle.
  amount_ceiling: [],
  chain_allowlist: [],
};

/** Rules for this goal that the chosen provider can actually satisfy. */
export function rulesForProvider(goalId: string, providerId: string): string[] {
  const g = GOALS[goalId];
  const p = PROVIDERS[providerId];
  if (!g || !p) return [];
  return g.rules.filter((rid) =>
    (RULE_REQUIRED_FIELDS[rid] ?? []).every((f) => p.fields.includes(f)),
  );
}

export const PACKAGE_NAME = "newton_builder_policy";
export const ENTRYPOINT = `${PACKAGE_NAME}.allow`;

export interface Selection {
  goalId: string;
  providerId: string;
  ruleIds: string[];
  params: Record<string, unknown>;
}

/**
 * Compose Rego from the wizard state.
 *
 * The shape matters: every check is a positive assertion plus a negated deny,
 * so missing oracle data leaves the assertion undefined, fires the deny, and
 * `default allow := false` holds. Fail closed. Written the obvious way — a bare
 * `allow if data.x == y` — an oracle outage would instead make every rule
 * undefined and, with no deny to catch it, you'd be relying on luck.
 */
export function generateRego(sel: Selection): string {
  const provider = PROVIDERS[sel.providerId];
  if (!provider) return "// pick a data provider";

  const rules = sel.ruleIds.map((id) => RULES[id]).filter(Boolean);
  if (rules.length === 0) return "// pick at least one policy";

  const helpers: string[] = [];
  const denies: string[] = [];
  for (const r of rules) {
    const { helpers: h, deny } = r.rego(provider.dataPath);
    // Rules deliberately declare every helper they depend on, so two rules
    // needing the same one (min_score, say) both carry it. Emitting it twice
    // is a Rego conflict — "complete rules must not produce multiple
    // outputs" — so dedupe here rather than making rules depend on each
    // other's selection state. That coupling is what previously let one
    // toggle silently break another rule's logic.
    for (const helper of h) {
      if (!helpers.includes(helper)) helpers.push(helper);
    }
    // A rule may contribute only helpers or only a threshold, with no deny of
    // its own. Empty strings would otherwise leave stray blank lines.
    if (deny.trim()) denies.push(deny);
  }

  return `# Generated by the Newton Policy Builder
# Goal:     ${GOALS[sel.goalId]?.name ?? sel.goalId}
# Provider: ${provider.name}
# Reads:    ${provider.dataPath}.*

package ${PACKAGE_NAME}

default allow := false

${helpers.join("\n")}

${denies.join("\n\n")}

allow if count(deny) == 0
`;
}

/** Only the params the selected rules actually use. */
export function collectParams(sel: Selection): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const id of sel.ruleIds) {
    for (const p of RULES[id]?.params ?? []) {
      out[p.key] = sel.params[p.key] ?? p.default;
    }
  }
  return out;
}

export function defaultParams(ruleIds: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const id of ruleIds) {
    for (const p of RULES[id]?.params ?? []) out[p.key] = p.default;
  }
  return out;
}

/** A known OFAC SDN listing — the address that should always be denied. */
export const SANCTIONED_TEST_ADDRESS =
  "0x7F367cC41522cE07553e823bf3be79A889DEbe1B";

export const CLEAN_TEST_ADDRESS =
  "0x1111111111111111111111111111111111111111";
